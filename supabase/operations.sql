begin;
create table public.suppliers(id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),name text not null check(length(trim(name))>0),contact_name text,email text,phone text,address text,tpin text,active boolean not null default true,created_at timestamptz not null default now(),unique(company_id,id));
create table public.quotations(id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),created_by uuid not null references auth.users(id),number text not null unique,customer_name text not null,customer_email text,customer_phone text,valid_until date not null,notes text,items jsonb not null,subtotal numeric(14,2) not null,tax numeric(14,2) not null,discount numeric(14,2) not null,total numeric(14,2) not null,currency text not null,store_snapshot jsonb not null,status text not null default 'draft' check(status in ('draft','sent','accepted','cancelled')),created_at timestamptz not null default now(),request_id uuid not null,unique(company_id,created_by,request_id));
create table public.purchase_orders(id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),supplier_id uuid not null,created_by uuid not null references auth.users(id),number text not null unique,items jsonb not null,total numeric(14,2) not null,currency text not null,supplier_snapshot jsonb not null,status text not null default 'ordered' check(status in ('ordered','received','cancelled')),notes text,created_at timestamptz not null default now(),received_at timestamptz,received_by uuid references auth.users(id),paid boolean not null default false,request_id uuid not null,unique(company_id,id),unique(company_id,created_by,request_id),foreign key(company_id,supplier_id) references public.suppliers(company_id,id));
create table public.cashbook_entries(id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),created_by uuid not null references auth.users(id),entry_date date not null default current_date,type text not null check(type in ('income','expense')),category text not null,description text not null,amount numeric(14,2) not null check(amount>0 and amount::text not in ('NaN','Infinity','-Infinity')),payment_method text not null check(payment_method in ('Cash','Airtel Money','MTN Money','Bank/Card')),purchase_id uuid,created_at timestamptz not null default now(),request_id uuid not null,unique(company_id,purchase_id),unique(company_id,created_by,request_id),foreign key(company_id,purchase_id) references public.purchase_orders(company_id,id));
create table public.tax_invoices(id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),sale_id uuid not null,number text not null unique,created_by uuid not null references auth.users(id),buyer_name text not null,buyer_tpin text,buyer_address text,document jsonb not null,submission_status text not null default 'not_submitted' check(submission_status='not_submitted'),created_at timestamptz not null default now(),unique(company_id,sale_id),foreign key(company_id,sale_id) references public.sales(company_id,id));
create index on public.suppliers(company_id,name);
create index on public.quotations(company_id,created_at desc);
create index on public.purchase_orders(company_id,created_at desc);
create index on public.cashbook_entries(company_id,entry_date desc);
create index on public.tax_invoices(company_id,created_at desc);
alter table public.suppliers enable row level security;
alter table public.quotations enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.cashbook_entries enable row level security;
alter table public.tax_invoices enable row level security;
revoke all on public.suppliers,public.quotations,public.purchase_orders,public.cashbook_entries,public.tax_invoices from anon,authenticated;
grant select on public.suppliers,public.quotations,public.purchase_orders,public.cashbook_entries,public.tax_invoices to authenticated;
grant insert,update on public.suppliers to authenticated;
grant update(status) on public.quotations to authenticated;
create policy supplier_read on public.suppliers for select to authenticated using(private.member_role(company_id) in ('director','supervisor'));
create policy supplier_add on public.suppliers for insert to authenticated with check(private.member_role(company_id) in ('director','supervisor'));
create policy supplier_edit on public.suppliers for update to authenticated using(private.member_role(company_id) in ('director','supervisor')) with check(private.member_role(company_id) in ('director','supervisor'));
create policy quote_read on public.quotations for select to authenticated using(private.member_role(company_id) in ('director','supervisor'));
create policy quote_status on public.quotations for update to authenticated using(private.member_role(company_id) in ('director','supervisor')) with check(private.member_role(company_id) in ('director','supervisor'));
create policy purchase_read on public.purchase_orders for select to authenticated using(private.member_role(company_id) in ('director','supervisor'));
create policy cashbook_read on public.cashbook_entries for select to authenticated using(private.member_role(company_id)='director');
create policy tax_invoice_read on public.tax_invoices for select to authenticated using(private.member_role(company_id)='director');
-- Internal operations stay outside the exposed schema. Public invoker wrappers form a narrow API.
create function private.create_quotation(p_company_id uuid,p_customer jsonb,p_items jsonb,p_discount numeric,p_valid_until date,p_notes text,p_request_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();qid uuid; prod public.products%rowtype;item record;sub numeric:=0;tx numeric:=0;rowtax numeric;items jsonb:='[]';store jsonb;
begin
 if uid is null or private.member_role(p_company_id) is null or private.member_role(p_company_id) not in ('director','supervisor') then raise exception 'Unauthorized access';end if;
 if p_request_id is null then raise exception 'Request ID is required';end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text||p_request_id::text,31));select id into qid from public.quotations where company_id=p_company_id and created_by=uid and request_id=p_request_id;if qid is not null then return qid;end if;
 if coalesce(length(trim(p_customer->>'name')),0)<1 or p_valid_until is null or p_valid_until<current_date then raise exception 'Customer name and valid expiry date are required';end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 200 then raise exception 'Add products to the quotation';end if;
 if exists(select 1 from jsonb_to_recordset(p_items) as x(product_id uuid,quantity numeric) where product_id is null or quantity is null or quantity<=0 or quantity<>trunc(quantity) or quantity>1000000) then raise exception 'Invalid quantity';end if;
 for item in select product_id,sum(quantity)::integer as quantity from jsonb_to_recordset(p_items) as x(product_id uuid,quantity numeric) group by product_id order by product_id loop
 select * into prod from public.products where company_id=p_company_id and id=item.product_id for share;if not found then raise exception 'Product not found in this store';end if;sub:=sub+prod.selling_price*item.quantity;
 end loop;
 if p_discount is null or p_discount<0 or p_discount>sub or p_discount<>round(p_discount,2) then raise exception 'Invalid discount';end if;
 for item in select product_id,sum(quantity)::integer as quantity from jsonb_to_recordset(p_items) as x(product_id uuid,quantity numeric) group by product_id order by product_id loop
 select * into prod from public.products where company_id=p_company_id and id=item.product_id;rowtax:=round(prod.selling_price*item.quantity*(case when sub>0 then (sub-p_discount)/sub else 1 end)*prod.tax_rate/100,2);tx:=tx+rowtax;items:=items||jsonb_build_array(jsonb_build_object('product_id',prod.id,'name',prod.name,'sku',prod.sku,'quantity',item.quantity,'unit_price',prod.selling_price,'tax_rate',prod.tax_rate,'tax',rowtax));end loop;
 select to_jsonb(c) into store from public.companies c where id=p_company_id;qid:=gen_random_uuid();
 insert into public.quotations(id,company_id,created_by,number,customer_name,customer_email,customer_phone,valid_until,notes,items,subtotal,tax,discount,total,currency,store_snapshot,request_id) values(qid,p_company_id,uid,'Q-'||upper(replace(qid::text,'-','')),trim(p_customer->>'name'),p_customer->>'email',p_customer->>'phone',p_valid_until,p_notes,items,sub,tx,p_discount,sub-p_discount+tx,store->>'currency',store,p_request_id);return qid;
end $$;
create function public.create_quotation(p_company_id uuid,p_customer jsonb,p_items jsonb,p_discount numeric,p_valid_until date,p_notes text,p_request_id uuid) returns uuid language sql security invoker set search_path='' as $$select private.create_quotation(p_company_id,p_customer,p_items,p_discount,p_valid_until,p_notes,p_request_id)$$;
create function private.create_purchase(p_company_id uuid,p_supplier_id uuid,p_items jsonb,p_notes text,p_request_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();pid uuid;item record;prod public.products%rowtype;supplier jsonb;items jsonb:='[]';total numeric:=0;cur text;
begin
 if uid is null or private.member_role(p_company_id) is null or private.member_role(p_company_id) not in ('director','supervisor') then raise exception 'Unauthorized access';end if;
 if p_request_id is null then raise exception 'Request ID is required';end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text||p_request_id::text,32));select id into pid from public.purchase_orders where company_id=p_company_id and created_by=uid and request_id=p_request_id;if pid is not null then return pid;end if;
 select to_jsonb(s) into supplier from public.suppliers s where company_id=p_company_id and id=p_supplier_id and active;if supplier is null then raise exception 'Select an active supplier from this store';end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 200 then raise exception 'Add products to the purchase';end if;
 if exists(select 1 from jsonb_to_recordset(p_items) as x(product_id uuid,quantity numeric,unit_cost numeric) where product_id is null or quantity is null or quantity<=0 or quantity<>trunc(quantity) or quantity>1000000 or unit_cost is null or unit_cost<0 or unit_cost::text in ('NaN','Infinity','-Infinity') or unit_cost<>round(unit_cost,2)) then raise exception 'Invalid purchase quantity or unit cost';end if;
 if exists(select 1 from jsonb_to_recordset(p_items) as x(product_id uuid) group by product_id having count(*)>1) then raise exception 'A product can only appear once per purchase';end if;
 for item in select * from jsonb_to_recordset(p_items) as x(product_id uuid,quantity integer,unit_cost numeric) order by product_id loop
 select * into prod from public.products where company_id=p_company_id and id=item.product_id;if not found then raise exception 'Product not found in this store';end if;total:=total+item.quantity*item.unit_cost;items:=items||jsonb_build_array(jsonb_build_object('product_id',prod.id,'name',prod.name,'sku',prod.sku,'quantity',item.quantity,'unit_price',item.unit_cost));end loop;
 select currency into cur from public.companies where id=p_company_id;pid:=gen_random_uuid();insert into public.purchase_orders(id,company_id,supplier_id,created_by,number,items,total,currency,supplier_snapshot,notes,request_id) values(pid,p_company_id,p_supplier_id,uid,'PO-'||upper(replace(pid::text,'-','')),items,total,cur,supplier,p_notes,p_request_id);return pid;
end $$;
create function public.create_purchase(p_company_id uuid,p_supplier_id uuid,p_items jsonb,p_notes text,p_request_id uuid) returns uuid language sql security invoker set search_path='' as $$select private.create_purchase(p_company_id,p_supplier_id,p_items,p_notes,p_request_id)$$;
create function private.receive_purchase(p_company_id uuid,p_purchase_id uuid,p_paid boolean,p_payment_method text) returns void language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();po public.purchase_orders%rowtype;item record;
begin
 if uid is null or private.member_role(p_company_id) is null or private.member_role(p_company_id) not in ('director','supervisor') then raise exception 'Unauthorized access';end if;
 select * into po from public.purchase_orders where id=p_purchase_id and company_id=p_company_id for update;if not found then raise exception 'Purchase not found';end if;if po.status='received' then return;end if;if po.status<>'ordered' then raise exception 'Only ordered purchases can be received';end if;
 if p_paid is null then raise exception 'Select payment status';end if;
 if p_paid and p_payment_method not in ('Cash','Airtel Money','MTN Money','Bank/Card') or (p_paid and p_payment_method is null) then raise exception 'Invalid payment method';end if;
 for item in select * from jsonb_to_recordset(po.items) as x(product_id uuid,quantity integer) order by product_id loop
 perform 1 from public.products where company_id=p_company_id and id=item.product_id for update;if not found then raise exception 'Purchase product no longer exists';end if;
 update public.products set stock_quantity=stock_quantity+item.quantity where company_id=p_company_id and id=item.product_id;
 insert into public.stock_movements(company_id,product_id,quantity,reason) values(p_company_id,item.product_id,item.quantity,'purchase '||po.number);
 end loop;
 update public.purchase_orders set status='received',received_at=now(),received_by=uid,paid=p_paid where id=po.id;
 if p_paid and po.total>0 then insert into public.cashbook_entries(company_id,created_by,type,category,description,amount,payment_method,purchase_id,request_id) values(p_company_id,uid,'expense','Stock purchases','Payment for '||po.number,po.total,p_payment_method,po.id,po.id);end if;
end $$;
create function public.receive_purchase(p_company_id uuid,p_purchase_id uuid,p_paid boolean,p_payment_method text) returns void language sql security invoker set search_path='' as $$select private.receive_purchase(p_company_id,p_purchase_id,p_paid,p_payment_method)$$;
create function private.cancel_purchase(p_company_id uuid,p_purchase_id uuid) returns void language plpgsql security definer set search_path='' as $$begin
 if auth.uid() is null or private.member_role(p_company_id) is null or private.member_role(p_company_id) not in ('director','supervisor') then raise exception 'Unauthorized access';end if;
 update public.purchase_orders set status='cancelled' where company_id=p_company_id and id=p_purchase_id and status='ordered';if not found then raise exception 'Only an ordered purchase can be cancelled';end if;
end $$;
create function public.cancel_purchase(p_company_id uuid,p_purchase_id uuid) returns void language sql security invoker set search_path='' as $$select private.cancel_purchase(p_company_id,p_purchase_id)$$;
create function private.record_cashbook(p_company_id uuid,p_date date,p_type text,p_category text,p_description text,p_amount numeric,p_method text,p_request_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();eid uuid;
begin
 if uid is null or private.member_role(p_company_id) is distinct from 'director' then raise exception 'Unauthorized access';end if;
 if p_request_id is null then raise exception 'Request ID required';end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text||p_request_id::text,33));select id into eid from public.cashbook_entries where company_id=p_company_id and created_by=uid and request_id=p_request_id;if eid is not null then return eid;end if;
 if p_date is null or p_type is null or p_type not in ('income','expense') or coalesce(length(trim(p_category)),0)=0 or coalesce(length(trim(p_description)),0)=0 or p_amount is null or p_amount<=0 or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<>round(p_amount,2) or p_method is null or p_method not in ('Cash','Airtel Money','MTN Money','Bank/Card') then raise exception 'Complete the entry with a valid positive amount';end if;
 insert into public.cashbook_entries(company_id,created_by,entry_date,type,category,description,amount,payment_method,request_id) values(p_company_id,uid,p_date,p_type,trim(p_category),trim(p_description),p_amount,p_method,p_request_id) returning id into eid;return eid;
end $$;
create function public.record_cashbook(p_company_id uuid,p_date date,p_type text,p_category text,p_description text,p_amount numeric,p_method text,p_request_id uuid) returns uuid language sql security invoker set search_path='' as $$select private.record_cashbook(p_company_id,p_date,p_type,p_category,p_description,p_amount,p_method,p_request_id)$$;
create function private.create_tax_invoice(p_company_id uuid,p_sale_id uuid,p_buyer jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();iid uuid;doc jsonb;store jsonb;sale public.sales%rowtype;items jsonb;
begin
 if uid is null or private.member_role(p_company_id) is distinct from 'director' then raise exception 'Unauthorized access';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_sale_id::text,34));select id into iid from public.tax_invoices where company_id=p_company_id and sale_id=p_sale_id;if iid is not null then return iid;end if;
 select * into sale from public.sales where company_id=p_company_id and id=p_sale_id;if not found then raise exception 'Sale not found in this store';end if;
 if coalesce(length(trim(p_buyer->>'name')),0)=0 then raise exception 'Customer name is required';end if;
 select to_jsonb(c) into store from public.companies c where id=p_company_id;if coalesce(length(trim(store->>'tpin')),0)=0 then raise exception 'Set your store TPIN in Store Settings first';end if;
 select jsonb_agg(jsonb_build_object('name',product_name,'quantity',quantity,'unit_price',unit_price,'tax_rate',tax_rate,'tax',tax_amount) order by id) into items from public.sale_items where company_id=p_company_id and sale_id=p_sale_id;
 doc:=jsonb_build_object('store',store,'sale',to_jsonb(sale),'items',items,'buyer',p_buyer,'fiscal_notice','LOCAL INVOICE — NOT SUBMITTED TO ZRA SMART INVOICE');iid:=gen_random_uuid();insert into public.tax_invoices(id,company_id,sale_id,number,created_by,buyer_name,buyer_tpin,buyer_address,document) values(iid,p_company_id,p_sale_id,'INV-'||upper(replace(iid::text,'-','')),uid,trim(p_buyer->>'name'),p_buyer->>'tpin',p_buyer->>'address',doc);return iid;
end $$;
create function public.create_tax_invoice(p_company_id uuid,p_sale_id uuid,p_buyer jsonb) returns uuid language sql security invoker set search_path='' as $$select private.create_tax_invoice(p_company_id,p_sale_id,p_buyer)$$;
create function private.store_report(p_company_id uuid,p_from timestamptz,p_to timestamptz) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or private.member_role(p_company_id) is distinct from 'director' then raise exception 'Unauthorized access';end if;
 if p_from is null or p_to is null or p_to<=p_from or p_to-p_from>interval '5 years' then raise exception 'Select a valid date range (maximum five years)';end if;
 select jsonb_build_object('sales',coalesce(sum(total),0),'subtotal',coalesce(sum(subtotal),0),'tax',coalesce(sum(tax),0),'discount',coalesce(sum(discount),0),'transactions',count(*),'products_sold',coalesce(sum(item_count),0)) into result from public.sales where company_id=p_company_id and created_at>=p_from and created_at<p_to and status='completed';
 result:=result||jsonb_build_object('expenses',coalesce((select sum(amount) from public.cashbook_entries where company_id=p_company_id and type='expense' and entry_date>=(p_from at time zone 'Africa/Lusaka')::date and entry_date<(p_to at time zone 'Africa/Lusaka')::date),0));
 result:=result||jsonb_build_object('top_products',coalesce((select jsonb_agg(to_jsonb(x)) from (select i.product_name,sum(i.quantity) as quantity,sum(i.quantity*i.unit_price) as revenue from public.sale_items i join public.sales s on s.id=i.sale_id and s.company_id=i.company_id where s.company_id=p_company_id and s.created_at>=p_from and s.created_at<p_to and s.status='completed' group by i.product_name order by sum(i.quantity) desc limit 10)x),'[]'));
 result:=result||jsonb_build_object('daily_sales',coalesce((select jsonb_agg(to_jsonb(x)) from (select (created_at at time zone 'Africa/Lusaka')::date as date,sum(total) as total,count(*) as transactions from public.sales where company_id=p_company_id and created_at>=p_from and created_at<p_to and status='completed' group by 1 order by 1)x),'[]'));
 result:=result||jsonb_build_object('payment_methods',coalesce((select jsonb_agg(to_jsonb(x)) from (select p.method,sum(p.amount-case when p.method='Cash' then s.change else 0 end) as total from (select company_id,sale_id,method,sum(amount) as amount from public.payments group by company_id,sale_id,method) p join public.sales s on s.id=p.sale_id and s.company_id=p.company_id where s.company_id=p_company_id and s.created_at>=p_from and s.created_at<p_to and s.status='completed' group by p.method)x),'[]'));
 result:=result||jsonb_build_object('inventory',coalesce((select jsonb_build_object('products',count(*),'low_stock',count(*) filter(where stock_quantity<=low_stock_threshold),'units',coalesce(sum(stock_quantity),0),'retail_value',coalesce(sum(stock_quantity*selling_price),0)) from public.products where company_id=p_company_id),'{}'));return result;
end $$;
create function public.store_report(p_company_id uuid,p_from timestamptz,p_to timestamptz) returns jsonb language sql security invoker set search_path='' as $$select private.store_report(p_company_id,p_from,p_to)$$;
-- Explicit grants: public wrappers and internal functions are never executable by anonymous callers.
revoke all on function private.create_quotation(uuid,jsonb,jsonb,numeric,date,text,uuid),public.create_quotation(uuid,jsonb,jsonb,numeric,date,text,uuid),private.create_purchase(uuid,uuid,jsonb,text,uuid),public.create_purchase(uuid,uuid,jsonb,text,uuid),private.receive_purchase(uuid,uuid,boolean,text),public.receive_purchase(uuid,uuid,boolean,text),private.cancel_purchase(uuid,uuid),public.cancel_purchase(uuid,uuid),private.record_cashbook(uuid,date,text,text,text,numeric,text,uuid),public.record_cashbook(uuid,date,text,text,text,numeric,text,uuid),private.create_tax_invoice(uuid,uuid,jsonb),public.create_tax_invoice(uuid,uuid,jsonb),private.store_report(uuid,timestamptz,timestamptz),public.store_report(uuid,timestamptz,timestamptz) from public,anon;
grant execute on function private.create_quotation(uuid,jsonb,jsonb,numeric,date,text,uuid),public.create_quotation(uuid,jsonb,jsonb,numeric,date,text,uuid),private.create_purchase(uuid,uuid,jsonb,text,uuid),public.create_purchase(uuid,uuid,jsonb,text,uuid),private.receive_purchase(uuid,uuid,boolean,text),public.receive_purchase(uuid,uuid,boolean,text),private.cancel_purchase(uuid,uuid),public.cancel_purchase(uuid,uuid),private.record_cashbook(uuid,date,text,text,text,numeric,text,uuid),public.record_cashbook(uuid,date,text,text,text,numeric,text,uuid),private.create_tax_invoice(uuid,uuid,jsonb),public.create_tax_invoice(uuid,uuid,jsonb),private.store_report(uuid,timestamptz,timestamptz),public.store_report(uuid,timestamptz,timestamptz) to authenticated;
commit;
