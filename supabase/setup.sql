-- Optional reference schema for a NEW Supabase project. Review/adapt before use on existing data.
-- This file is not applied automatically. Provision real companies and memberships as a trusted operator.
begin;
create schema if not exists private;
create table public.companies(id uuid primary key default gen_random_uuid(),name text not null,address text,phone text,email text,currency text not null default 'ZMW');
create table public.profiles(id uuid primary key references auth.users(id),full_name text);
create table public.company_users(company_id uuid references public.companies(id),user_id uuid references auth.users(id),role text not null check(role in ('director','supervisor','cashier')),active boolean not null default true,primary key(company_id,user_id));
create table public.products(id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),name text not null,sku text not null,barcode text,selling_price numeric(12,2) not null check(selling_price>=0),stock_quantity integer not null check(stock_quantity>=0),tax_rate numeric(5,2) not null default 0 check(tax_rate between 0 and 100),low_stock_threshold integer not null default 5 check(low_stock_threshold>=0),image_url text,unique(company_id,id),unique(company_id,sku));
create table public.sales(id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),cashier_id uuid not null references auth.users(id),cashier_name text not null,receipt_number text not null unique,created_at timestamptz not null default now(),currency text not null,subtotal numeric(12,2) not null,tax numeric(12,2) not null,discount numeric(12,2) not null,total numeric(12,2) not null,amount_paid numeric(12,2) not null,change numeric(12,2) not null,item_count integer not null,payment_method text not null,status text not null default 'completed',request_id uuid not null,unique(company_id,id),unique(company_id,cashier_id,request_id));
create table public.sale_items(id uuid primary key default gen_random_uuid(),company_id uuid not null,sale_id uuid not null,product_id uuid not null,product_name text not null,quantity integer not null check(quantity>0),unit_price numeric(12,2) not null,tax_rate numeric(5,2) not null,tax_amount numeric(12,2) not null,foreign key(company_id,sale_id) references public.sales(company_id,id),foreign key(company_id,product_id) references public.products(company_id,id));
create table public.payments(id uuid primary key default gen_random_uuid(),company_id uuid not null,sale_id uuid not null,method text not null check(method in ('Cash','Airtel Money','MTN Money','Bank/Card')),amount numeric(12,2) not null check(amount>0),foreign key(company_id,sale_id) references public.sales(company_id,id));
create table public.stock_movements(id uuid primary key default gen_random_uuid(),company_id uuid not null,product_id uuid not null,sale_id uuid,quantity integer not null,reason text not null,created_at timestamptz not null default now(),foreign key(company_id,product_id) references public.products(company_id,id),foreign key(company_id,sale_id) references public.sales(company_id,id));
create index on public.company_users(user_id);
create index on public.products(company_id);
create index on public.sales(company_id,created_at desc);
create index on public.sale_items(company_id,sale_id);
create index on public.payments(company_id,sale_id);
create function private.member_role(cid uuid) returns text language sql stable security definer set search_path='' as $$select role from public.company_users where company_id=cid and user_id=auth.uid() and active$$;
revoke all on schema private from public;
grant usage on schema private to authenticated;
revoke all on function private.member_role(uuid) from public;
grant execute on function private.member_role(uuid) to authenticated;
alter table public.companies enable row level security;
alter table public.profiles enable row level security;
alter table public.company_users enable row level security;
alter table public.products enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.payments enable row level security;
alter table public.stock_movements enable row level security;
create policy company_read on public.companies for select to authenticated using(private.member_role(id) is not null);
create policy own_profile on public.profiles for select to authenticated using(id=auth.uid());
create policy own_membership on public.company_users for select to authenticated using(user_id=auth.uid() and active);
create policy product_read on public.products for select to authenticated using(private.member_role(company_id) is not null);
create policy product_insert on public.products for insert to authenticated with check(private.member_role(company_id) in ('director','supervisor'));
create policy product_update on public.products for update to authenticated using(private.member_role(company_id) in ('director','supervisor')) with check(private.member_role(company_id) in ('director','supervisor'));
create policy sale_read on public.sales for select to authenticated using(private.member_role(company_id) in ('director','supervisor') or (private.member_role(company_id)='cashier' and cashier_id=auth.uid()));
create policy item_read on public.sale_items for select to authenticated using(exists(select 1 from public.sales s where s.company_id=sale_items.company_id and s.id=sale_items.sale_id));
create policy payment_read on public.payments for select to authenticated using(exists(select 1 from public.sales s where s.company_id=payments.company_id and s.id=payments.sale_id));
create policy movement_read on public.stock_movements for select to authenticated using(private.member_role(company_id) in ('director','supervisor'));
revoke all on public.companies,public.profiles,public.company_users,public.products,public.sales,public.sale_items,public.payments,public.stock_movements from anon,authenticated;
grant select on public.companies,public.profiles,public.company_users,public.products,public.sales,public.sale_items,public.payments,public.stock_movements to authenticated;
grant insert,update on public.products to authenticated;
-- No direct writes to financial tables, memberships, or company settings from the POS client.
-- This definer function explicitly enforces membership and uses database prices, tax and stock.
create function public.checkout_sale(p_company_id uuid,p_items jsonb,p_discount numeric,p_payments jsonb,p_request_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); sid uuid; item record; pay record; prod public.products%rowtype; sub numeric:=0; tx numeric:=0; grand numeric; amount numeric:=0; cash numeric:=0; cnt integer:=0; receipt text; cname text; cur text; discount numeric;
begin
 if uid is null or private.member_role(p_company_id) not in ('director','supervisor','cashier') or private.member_role(p_company_id) is null then raise exception 'Unauthorized access'; end if;
 if p_request_id is null then raise exception 'Missing checkout request ID'; end if;
 -- Serialize retries for the same request and lock inventory in stable order.
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||uid::text||p_request_id::text,0));
 select id into sid from public.sales where company_id=p_company_id and cashier_id=uid and request_id=p_request_id;
 if sid is not null then return sid; end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 or jsonb_array_length(p_items)>500 then raise exception 'Invalid cart'; end if;
 if exists(select 1 from jsonb_to_recordset(p_items) as x(product_id uuid,quantity numeric) where product_id is null or quantity is null or quantity<>trunc(quantity) or quantity<=0 or quantity>1000000) then raise exception 'Invalid cart quantity'; end if;
 for item in select product_id,sum(quantity)::integer as quantity from jsonb_to_recordset(p_items) as x(product_id uuid,quantity numeric) group by product_id order by product_id loop
  select * into prod from public.products where id=item.product_id and company_id=p_company_id for update;
  if not found then raise exception 'Product not found in this company'; end if;
  if prod.stock_quantity<item.quantity then raise exception 'Insufficient stock for %',prod.name; end if;
  sub:=sub+prod.selling_price*item.quantity;cnt:=cnt+item.quantity;
 end loop;
 discount:=round(p_discount,2);
 if discount is null or discount<0 or discount>sub then raise exception 'Invalid discount'; end if;
 for item in select product_id,sum(quantity)::integer as quantity from jsonb_to_recordset(p_items) as x(product_id uuid,quantity numeric) group by product_id loop
  select * into prod from public.products where id=item.product_id and company_id=p_company_id;
  tx:=tx+round(prod.selling_price*item.quantity*(case when sub>0 then (sub-discount)/sub else 1 end)*prod.tax_rate/100,2);
 end loop;
 grand:=sub-discount+tx;
 if p_payments is null or jsonb_typeof(p_payments)<>'array' or jsonb_array_length(p_payments)=0 or jsonb_array_length(p_payments)>4 then raise exception 'Invalid payment'; end if;
 for pay in select * from jsonb_to_recordset(p_payments) as x(method text,amount numeric) loop
  if pay.method is null or pay.method not in ('Cash','Airtel Money','MTN Money','Bank/Card') or pay.amount is null or pay.amount::text in ('NaN','Infinity','-Infinity') or pay.amount<=0 or pay.amount<>round(pay.amount,2) then raise exception 'Invalid payment amount or method'; end if;
  amount:=amount+pay.amount;if pay.method='Cash' then cash:=cash+pay.amount;end if;
 end loop;
 if amount<grand then raise exception 'Amount paid is below total'; end if;
 if amount-grand>cash then raise exception 'Change can only be returned from cash'; end if;
 select coalesce(p.full_name,u.email,'Cashier') into cname from auth.users u left join public.profiles p on p.id=u.id where u.id=uid;
 select currency into cur from public.companies where id=p_company_id;
 sid:=gen_random_uuid();receipt:='IP-'||to_char(now(),'YYMMDD')||'-'||upper(replace(sid::text,'-',''));
 insert into public.sales(id,company_id,cashier_id,cashier_name,receipt_number,currency,subtotal,tax,discount,total,amount_paid,change,item_count,payment_method,request_id)
 values(sid,p_company_id,uid,cname,receipt,cur,sub,tx,discount,grand,amount,amount-grand,cnt,case when jsonb_array_length(p_payments)>1 then 'Mixed payment' else p_payments->0->>'method' end,p_request_id);
 for item in select product_id,sum(quantity)::integer as quantity from jsonb_to_recordset(p_items) as x(product_id uuid,quantity numeric) group by product_id loop
  select * into prod from public.products where id=item.product_id and company_id=p_company_id;
  insert into public.sale_items(company_id,sale_id,product_id,product_name,quantity,unit_price,tax_rate,tax_amount) values(p_company_id,sid,prod.id,prod.name,item.quantity,prod.selling_price,prod.tax_rate,round(prod.selling_price*item.quantity*(case when sub>0 then (sub-discount)/sub else 1 end)*prod.tax_rate/100,2));
  update public.products set stock_quantity=stock_quantity-item.quantity where id=prod.id and company_id=p_company_id;
  insert into public.stock_movements(company_id,product_id,sale_id,quantity,reason) values(p_company_id,prod.id,sid,-item.quantity,'sale');
 end loop;
 insert into public.payments(company_id,sale_id,method,amount) select p_company_id,sid,x.method,x.amount from jsonb_to_recordset(p_payments) as x(method text,amount numeric);
 return sid;
end $$;
revoke all on function public.checkout_sale(uuid,jsonb,numeric,jsonb,uuid) from public,anon;
grant execute on function public.checkout_sale(uuid,jsonb,numeric,jsonb,uuid) to authenticated;
commit;
