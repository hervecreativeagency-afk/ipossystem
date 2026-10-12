begin;
alter table public.companies add column receipt_paper text not null default '80mm' check(receipt_paper in ('58mm','80mm','A4')),add column receipt_show_logo boolean not null default true,add column receipt_show_contacts boolean not null default true,add column receipt_return_policy text not null default '' check(length(receipt_return_policy)<=1000);
grant update(receipt_paper,receipt_show_logo,receipt_show_contacts,receipt_return_policy) on public.companies to authenticated;
create table public.cashier_shifts(id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),cashier_id uuid not null references auth.users(id),cashier_name text not null,opened_at timestamptz not null default now(),closed_at timestamptz,opening_cash numeric(14,2) not null check(opening_cash>=0),counted_cash numeric(14,2),expected_cash numeric(14,2),variance numeric(14,2),status text not null default 'open' check(status in ('open','closed')),notes text,request_id uuid not null,unique(company_id,id),unique(company_id,cashier_id,request_id));
create unique index one_open_shift on public.cashier_shifts(company_id,cashier_id) where status='open';
create table public.shift_cash_events(id uuid primary key default gen_random_uuid(),company_id uuid not null,shift_id uuid not null,created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),type text not null check(type in ('in','out')),amount numeric(14,2) not null check(amount>0),reason text not null,request_id uuid not null,unique(company_id,created_by,request_id),foreign key(company_id,shift_id) references public.cashier_shifts(company_id,id));
alter table public.sales add column shift_id uuid,add column customer_name text,add column customer_phone text,add column refunded_total numeric(14,2) not null default 0,add foreign key(company_id,shift_id) references public.cashier_shifts(company_id,id);
create index on public.sales(company_id,shift_id);
create table public.sale_refunds(id uuid primary key default gen_random_uuid(),company_id uuid not null,sale_id uuid not null,shift_id uuid,approved_by uuid not null references auth.users(id),approved_name text not null,created_at timestamptz not null default now(),reason text not null,payment_method text not null check(payment_method in ('Cash','Airtel Money','MTN Money','Bank/Card')),total numeric(14,2) not null,tax numeric(14,2) not null,net numeric(14,2) not null,number text not null unique,request_id uuid not null,unique(company_id,id),unique(company_id,approved_by,request_id),foreign key(company_id,sale_id) references public.sales(company_id,id),foreign key(company_id,shift_id) references public.cashier_shifts(company_id,id));
create table public.refund_items(id uuid primary key default gen_random_uuid(),company_id uuid not null,refund_id uuid not null,sale_item_id uuid not null,product_id uuid not null,quantity integer not null check(quantity>0),restocked boolean not null,total numeric(14,2) not null,tax numeric(14,2) not null,foreign key(company_id,refund_id) references public.sale_refunds(company_id,id),foreign key(company_id,sale_item_id) references public.sale_items(company_id,id));
create index on public.refund_items(company_id,sale_item_id);
create table public.stock_adjustments(id uuid primary key default gen_random_uuid(),company_id uuid not null,product_id uuid not null,created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),quantity integer not null check(quantity<>0),reason text not null,notes text,request_id uuid not null,unique(company_id,created_by,request_id),foreign key(company_id,product_id) references public.products(company_id,id));
create table public.audit_logs(id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),actor_id uuid references auth.users(id),actor_name text not null,created_at timestamptz not null default now(),entity text not null,record_id text,action text not null,before_data jsonb,after_data jsonb);
create index on public.audit_logs(company_id,created_at desc);
alter table public.quotations drop constraint quotations_status_check;
alter table public.quotations add constraint quotations_status_check check(status in ('draft','sent','accepted','cancelled','converted')),add column converted_sale_id uuid,add foreign key(company_id,converted_sale_id) references public.sales(company_id,id);
revoke update on public.products from authenticated;
grant update(name,sku,barcode,selling_price,tax_rate,low_stock_threshold,image_url) on public.products to authenticated;
create policy supervisor_cost_read on public.financial_product_costs for select to authenticated using(private.member_role(company_id)='supervisor');
alter table public.cashier_shifts enable row level security;
revoke all on public.cashier_shifts from anon,authenticated;
grant select on public.cashier_shifts to authenticated;
create policy tenant_read on public.cashier_shifts for select to authenticated using(private.member_role(company_id) in ('director','supervisor') or (private.member_role(company_id)='cashier' and cashier_id=auth.uid()));
alter table public.shift_cash_events enable row level security;
revoke all on public.shift_cash_events from anon,authenticated;
grant select on public.shift_cash_events to authenticated;
create policy tenant_read on public.shift_cash_events for select to authenticated using(exists(select 1 from public.cashier_shifts s where s.company_id=shift_cash_events.company_id and s.id=shift_cash_events.shift_id));
alter table public.sale_refunds enable row level security;
revoke all on public.sale_refunds from anon,authenticated;
grant select on public.sale_refunds to authenticated;
create policy tenant_read on public.sale_refunds for select to authenticated using(exists(select 1 from public.sales s where s.company_id=sale_refunds.company_id and s.id=sale_refunds.sale_id));
alter table public.refund_items enable row level security;
revoke all on public.refund_items from anon,authenticated;
grant select on public.refund_items to authenticated;
create policy tenant_read on public.refund_items for select to authenticated using(exists(select 1 from public.sale_refunds r where r.company_id=refund_items.company_id and r.id=refund_items.refund_id));
alter table public.stock_adjustments enable row level security;
revoke all on public.stock_adjustments from anon,authenticated;
grant select on public.stock_adjustments to authenticated;
create policy tenant_read on public.stock_adjustments for select to authenticated using(private.member_role(company_id) in ('director','supervisor'));
alter table public.audit_logs enable row level security;
revoke all on public.audit_logs from anon,authenticated;
grant select on public.audit_logs to authenticated;
create policy tenant_read on public.audit_logs for select to authenticated using(private.member_role(company_id)='director');
create function private.retail_audit() returns trigger language plpgsql security definer set search_path='' as $$declare b jsonb; a jsonb;cid uuid;begin
 if tg_op='UPDATE' and to_jsonb(new)=to_jsonb(old) then return new;end if;
 if tg_op<>'INSERT' then b:=to_jsonb(old);end if;if tg_op<>'DELETE' then a:=to_jsonb(new);end if;
 cid:=case when tg_table_name='companies' then coalesce(a,b)->>'id' else coalesce(a,b)->>'company_id' end;
 insert into public.audit_logs(company_id,actor_id,actor_name,entity,record_id,action,before_data,after_data) values(cid,auth.uid(),coalesce((select full_name from public.profiles where id=auth.uid()),'System'),tg_table_name,coalesce(a,b)->>'id',tg_op,b,a);return coalesce(new,old);
end $$;
revoke all on function private.retail_audit() from public,anon,authenticated;
create function private.open_shift(p_company_id uuid,p_cash numeric,p_request_id uuid) returns uuid language plpgsql security definer set search_path='' as $$declare sid uuid;begin
 if auth.uid() is null or private.member_role(p_company_id) is null then raise exception 'Unauthorized access';end if;
 if p_cash is null or p_cash<0 or p_cash::text in ('NaN','Infinity','-Infinity') or p_cash<>round(p_cash,2) or p_request_id is null then raise exception 'Enter a valid opening cash balance';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||auth.uid()::text,76));select id into sid from public.cashier_shifts where company_id=p_company_id and cashier_id=auth.uid() and request_id=p_request_id;if sid is not null then return sid;end if;
 if exists(select 1 from public.cashier_shifts where company_id=p_company_id and cashier_id=auth.uid() and status='open') then raise exception 'Close your current shift first';end if;
 insert into public.cashier_shifts(company_id,cashier_id,cashier_name,opening_cash,request_id) values(p_company_id,auth.uid(),coalesce((select full_name from public.profiles where id=auth.uid()),'Cashier'),p_cash,p_request_id) returning id into sid;return sid;
end $$;
create function private.shift_expected(p_company_id uuid,p_shift_id uuid) returns numeric language sql stable security definer set search_path='' as $$
 select s.opening_cash+coalesce((select sum(p.amount)-sum(case when p.method='Cash' then 0 else 0 end) from public.payments p join public.sales sa on sa.id=p.sale_id and sa.company_id=p.company_id where sa.company_id=p_company_id and sa.shift_id=p_shift_id and p.method='Cash'),0)-coalesce((select sum(sa.change) from public.sales sa where sa.company_id=p_company_id and sa.shift_id=p_shift_id),0)+coalesce((select sum(case when e.type='in' then e.amount else -e.amount end) from public.shift_cash_events e where e.company_id=p_company_id and e.shift_id=p_shift_id),0)-coalesce((select sum(r.total) from public.sale_refunds r where r.company_id=p_company_id and r.shift_id=p_shift_id and r.payment_method='Cash'),0) from public.cashier_shifts s where s.company_id=p_company_id and s.id=p_shift_id
$$;
revoke all on function private.shift_expected(uuid,uuid) from public,anon,authenticated;
create function private.shift_action(p_company_id uuid,p_shift_id uuid,p_action text,p_amount numeric,p_reason text,p_request_id uuid) returns void language plpgsql security definer set search_path='' as $$declare sh public.cashier_shifts%rowtype;expected numeric;begin
 if auth.uid() is null or private.member_role(p_company_id) is null then raise exception 'Unauthorized access';end if;
 select * into sh from public.cashier_shifts where company_id=p_company_id and id=p_shift_id for update;
 if not found or (sh.cashier_id<>auth.uid() and private.member_role(p_company_id) not in ('director','supervisor')) then raise exception 'Unauthorized shift';end if;
 if p_amount is null or p_amount<0 or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<>round(p_amount,2) then raise exception 'Enter a valid amount';end if;
 if p_action='close' and sh.status='closed' then return;end if;if sh.status<>'open' then raise exception 'This shift is closed';end if;
 if p_action='close' then expected:=private.shift_expected(p_company_id,p_shift_id);update public.cashier_shifts set status='closed',closed_at=now(),counted_cash=p_amount,expected_cash=expected,variance=p_amount-expected,notes=p_reason where id=sh.id;
 elsif p_action in ('in','out') then
 if p_amount<=0 or length(trim(coalesce(p_reason,'')))<3 or p_request_id is null then raise exception 'Enter a positive amount and reason';end if;
 if exists(select 1 from public.shift_cash_events where company_id=p_company_id and created_by=auth.uid() and request_id=p_request_id) then return;end if;
 insert into public.shift_cash_events(company_id,shift_id,created_by,type,amount,reason,request_id) values(p_company_id,sh.id,auth.uid(),p_action,p_amount,p_reason,p_request_id);
 else raise exception 'Invalid shift action';end if;
end $$;
alter function public.checkout_sale(uuid,jsonb,numeric,jsonb,uuid) set schema private;
alter function private.checkout_sale(uuid,jsonb,numeric,jsonb,uuid) rename to checkout_core;
revoke all on function private.checkout_core(uuid,jsonb,numeric,jsonb,uuid) from public,anon,authenticated;
create function private.retail_checkout(p_company_id uuid,p_items jsonb,p_discount numeric,p_payments jsonb,p_request_id uuid,p_customer jsonb,p_quotation_id uuid) returns uuid language plpgsql security definer set search_path='' as $$declare sid uuid;sh uuid;q public.quotations%rowtype;begin
 if auth.uid() is null or private.member_role(p_company_id) is null then raise exception 'Unauthorized access';end if;
 if p_request_id is null then raise exception 'Request ID required';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||auth.uid()::text||p_request_id::text,0));select id into sid from public.sales where company_id=p_company_id and cashier_id=auth.uid() and request_id=p_request_id;if sid is not null then return sid;end if;
 select id into sh from public.cashier_shifts where company_id=p_company_id and cashier_id=auth.uid() and status='open' for update;if sh is null then raise exception 'Open a cashier shift before checkout';end if;
 if length(coalesce(p_customer->>'name',''))>150 or length(coalesce(p_customer->>'phone',''))>40 then raise exception 'Customer details are too long';end if;
 if p_quotation_id is not null then
 if private.member_role(p_company_id) not in ('director','supervisor') then raise exception 'Quotation access restricted';end if;
 select * into q from public.quotations where company_id=p_company_id and id=p_quotation_id for update;if not found or q.status<>'accepted' then raise exception 'Quotation must be accepted and not already converted';end if;
 if q.valid_until<(now() at time zone 'Africa/Lusaka')::date then raise exception 'Quotation expired';end if;
 if (select jsonb_agg(jsonb_build_object('id',x.product_id,'q',x.quantity) order by x.product_id) from jsonb_to_recordset(p_items) x(product_id uuid,quantity numeric)) is distinct from (select jsonb_agg(jsonb_build_object('id',x.product_id,'q',x.quantity) order by x.product_id) from jsonb_to_recordset(q.items) x(product_id uuid,quantity numeric)) then raise exception 'Quotation items changed; start a regular sale instead';end if;
 end if;
 sid:=private.checkout_core(p_company_id,p_items,p_discount,p_payments,p_request_id);update public.sales set shift_id=sh,customer_name=nullif(trim(p_customer->>'name'),''),customer_phone=nullif(trim(p_customer->>'phone'),'') where id=sid;
 if p_quotation_id is not null then update public.quotations set status='converted',converted_sale_id=sid where id=q.id;end if;return sid;
end $$;
create function public.checkout_sale(p_company_id uuid,p_items jsonb,p_discount numeric,p_payments jsonb,p_request_id uuid,p_customer jsonb default null,p_quotation_id uuid default null) returns uuid language sql security invoker set search_path='' as $$select private.retail_checkout(p_company_id,p_items,p_discount,p_payments,p_request_id,p_customer,p_quotation_id)$$;
revoke all on function public.checkout_sale(uuid,jsonb,numeric,jsonb,uuid,jsonb,uuid) from public,anon;grant execute on function public.checkout_sale(uuid,jsonb,numeric,jsonb,uuid,jsonb,uuid) to authenticated;
create function private.adjust_stock(p_company_id uuid,p_product_id uuid,p_quantity integer,p_reason text,p_notes text,p_request_id uuid) returns uuid language plpgsql security definer set search_path='' as $$declare aid uuid;qty integer;begin
 if auth.uid() is null or private.member_role(p_company_id) is null or private.member_role(p_company_id) not in ('director','supervisor') then raise exception 'Operational access required';end if;
 if p_quantity is null or p_quantity=0 or length(trim(coalesce(p_reason,'')))<3 or p_request_id is null then raise exception 'Enter a stock change and reason';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,88));select id into aid from public.stock_adjustments where company_id=p_company_id and created_by=auth.uid() and request_id=p_request_id;if aid is not null then return aid;end if;
 select stock_quantity into qty from public.products where company_id=p_company_id and id=p_product_id for update;if not found or qty+p_quantity<0 then raise exception 'Invalid product or insufficient stock';end if;
 update public.products set stock_quantity=stock_quantity+p_quantity where company_id=p_company_id and id=p_product_id;
 insert into public.stock_adjustments(company_id,product_id,created_by,quantity,reason,notes,request_id) values(p_company_id,p_product_id,auth.uid(),p_quantity,p_reason,p_notes,p_request_id) returning id into aid;
 insert into public.stock_movements(company_id,product_id,quantity,reason) values(p_company_id,p_product_id,p_quantity,p_reason||' · '||coalesce(p_notes,''));return aid;
end $$;
create function private.save_retail_product(p_company_id uuid,p_product jsonb,p_unit_cost numeric,p_stock_reason text) returns uuid language plpgsql security definer set search_path='' as $$declare pid uuid:=(p_product->>'id')::uuid; oldqty integer;newqty integer:=(p_product->>'stock_quantity')::integer;begin
 if auth.uid() is null or private.member_role(p_company_id) is null or private.member_role(p_company_id) not in ('director','supervisor') then raise exception 'Operational access required';end if;
 if pid is null then insert into public.products(company_id,name,sku,barcode,selling_price,stock_quantity,tax_rate,low_stock_threshold,image_url) values(p_company_id,p_product->>'name',p_product->>'sku',nullif(p_product->>'barcode',''),(p_product->>'selling_price')::numeric,newqty,(p_product->>'tax_rate')::numeric,(p_product->>'low_stock_threshold')::integer,nullif(p_product->>'image_url','')) returning id into pid;
 if newqty>0 then insert into public.stock_movements(company_id,product_id,quantity,reason) values(p_company_id,pid,newqty,'Initial product stock');end if;
 else select stock_quantity into oldqty from public.products where company_id=p_company_id and id=pid for update;if not found then raise exception 'Product not found';end if;
 update public.products set name=p_product->>'name',sku=p_product->>'sku',barcode=nullif(p_product->>'barcode',''),selling_price=(p_product->>'selling_price')::numeric,tax_rate=(p_product->>'tax_rate')::numeric,low_stock_threshold=(p_product->>'low_stock_threshold')::integer,image_url=nullif(p_product->>'image_url','') where company_id=p_company_id and id=pid;
 if newqty<>oldqty then perform private.adjust_stock(p_company_id,pid,newqty-oldqty,p_stock_reason,'Product editor correction',gen_random_uuid());end if;end if;
 if p_unit_cost is not null then
 if p_unit_cost<0 or p_unit_cost::text in ('NaN','Infinity','-Infinity') or p_unit_cost<>round(p_unit_cost,2) then raise exception 'Invalid purchase cost';end if;
 insert into public.financial_product_costs(company_id,product_id,unit_cost,updated_by) values(p_company_id,pid,p_unit_cost,auth.uid()) on conflict(company_id,product_id) do update set unit_cost=excluded.unit_cost,updated_by=auth.uid(),updated_at=now();end if;return pid;
end $$;
create function private.purchase_cost_capture() returns trigger language plpgsql security definer set search_path='' as $$declare i record;beforeqty integer;oldcost numeric;cost numeric;begin
 if new.status='received' and old.status='ordered' then
 for i in select * from jsonb_to_recordset(new.items) x(product_id uuid,quantity integer,unit_price numeric) loop
 select greatest(stock_quantity-i.quantity,0) into beforeqty from public.products where company_id=new.company_id and id=i.product_id;
 select unit_cost into oldcost from public.financial_product_costs where company_id=new.company_id and product_id=i.product_id;
 -- Unknown opening stock cost stays unknown; receiving cannot fabricate its valuation.
 if beforeqty=0 or oldcost is not null then cost:=round((coalesce(oldcost,0)*beforeqty+i.unit_price*i.quantity)/(beforeqty+i.quantity),2);
 insert into public.financial_product_costs(company_id,product_id,unit_cost,updated_by) values(new.company_id,i.product_id,cost,auth.uid()) on conflict(company_id,product_id) do update set unit_cost=excluded.unit_cost,updated_by=auth.uid(),updated_at=now();end if;
 end loop;end if;return new;
end $$;
revoke all on function private.purchase_cost_capture() from public,anon,authenticated;
create trigger purchase_cost_capture after update on public.purchase_orders for each row execute function private.purchase_cost_capture();
create function private.manage_staff(p_company_id uuid,p_user_id uuid,p_role text,p_active boolean) returns void language plpgsql security definer set search_path='' as $$declare currentrole text;begin
 if auth.uid() is null or private.member_role(p_company_id) is distinct from 'director' then raise exception 'Director access required';end if;
 select role into currentrole from public.company_users where company_id=p_company_id and user_id=p_user_id for update;if not found or currentrole='director' or p_user_id=auth.uid() then raise exception 'Director accounts cannot be changed here';end if;
 if p_role not in ('cashier','supervisor') or p_role is null or p_active is null then raise exception 'Invalid staff role';end if;
 if not p_active and exists(select 1 from public.cashier_shifts where company_id=p_company_id and cashier_id=p_user_id and status='open') then raise exception 'Close the staff member shift before disabling access';end if;
 update public.company_users set role=p_role,active=p_active where company_id=p_company_id and user_id=p_user_id;
end $$;
create function private.refund_sale(p_company_id uuid,p_sale_id uuid,p_items jsonb,p_reason text,p_method text,p_request_id uuid) returns uuid language plpgsql security definer set search_path='' as $$declare sa public.sales%rowtype;r record;i public.sale_items%rowtype;rid uuid;sh uuid;prevqty integer;line_net numeric;line_tax numeric;line_total numeric;refund_net numeric:=0;refund_tax numeric:=0;grand numeric:=0;allocated numeric;discountline numeric;qty integer;uc numeric;oc numeric;begin
 if auth.uid() is null or private.member_role(p_company_id) is null or private.member_role(p_company_id) not in ('director','supervisor') then raise exception 'Supervisor or director approval required';end if;
 if p_request_id is null or length(trim(coalesce(p_reason,'')))<3 or p_method is null or p_method not in ('Cash','Airtel Money','MTN Money','Bank/Card') then raise exception 'Enter a reason and payout method';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,93));select id into rid from public.sale_refunds where company_id=p_company_id and approved_by=auth.uid() and request_id=p_request_id;if rid is not null then return rid;end if;
 select * into sa from public.sales where company_id=p_company_id and id=p_sale_id for update;if not found or sa.status<>'completed' then raise exception 'Sale not available';end if;
 if p_method='Cash' then select id into sh from public.cashier_shifts where company_id=p_company_id and cashier_id=auth.uid() and status='open' for update;if sh is null then raise exception 'Open your shift before recording a cash refund';end if;end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 500 or exists(select 1 from jsonb_to_recordset(p_items) x(id uuid,quantity numeric,restock boolean) where id is null or quantity is null or quantity<=0 or quantity<>trunc(quantity) or restock is null) or exists(select 1 from jsonb_to_recordset(p_items) x(id uuid) group by id having count(*)>1) then raise exception 'Invalid return items';end if;
 rid:=gen_random_uuid();insert into public.sale_refunds(id,company_id,sale_id,shift_id,approved_by,approved_name,reason,payment_method,total,tax,net,number,request_id) values(rid,p_company_id,sa.id,sh,auth.uid(),coalesce((select full_name from public.profiles where id=auth.uid()),'Approver'),p_reason,p_method,0,0,0,'RF-'||upper(replace(rid::text,'-','')),p_request_id);
 for r in select * from jsonb_to_recordset(p_items) x(id uuid,quantity integer,restock boolean) order by id loop
 select * into i from public.sale_items where company_id=p_company_id and sale_id=sa.id and id=r.id;if not found then raise exception 'Return item does not belong to this sale';end if;
 select coalesce(sum(quantity),0) into prevqty from public.refund_items where company_id=p_company_id and sale_item_id=i.id;
 if prevqty+r.quantity>i.quantity then raise exception 'Return quantity exceeds unreturned quantity for %',i.product_name;end if;
 -- Allocate sale discount in stable line order, with residual cents on the last line.
 if i.id=(select max(id::text)::uuid from public.sale_items where company_id=p_company_id and sale_id=sa.id) then
 select coalesce(sum(round(unit_price*quantity*(case when sa.subtotal>0 then sa.discount/sa.subtotal else 0 end),2)),0) into allocated from public.sale_items where company_id=p_company_id and sale_id=sa.id and id<>i.id;discountline:=sa.discount-allocated;
 else discountline:=round(i.unit_price*i.quantity*(case when sa.subtotal>0 then sa.discount/sa.subtotal else 0 end),2);end if;
 line_net:=round((i.unit_price*i.quantity-discountline)*(prevqty+r.quantity)/i.quantity,2)-round((i.unit_price*i.quantity-discountline)*prevqty/i.quantity,2);
 line_tax:=round(i.tax_amount*(prevqty+r.quantity)/i.quantity,2)-round(i.tax_amount*prevqty/i.quantity,2);line_total:=line_net+line_tax;
 insert into public.refund_items(company_id,refund_id,sale_item_id,product_id,quantity,restocked,total,tax) values(p_company_id,rid,i.id,i.product_id,r.quantity,r.restock,line_total,line_tax);
 if r.restock then
 select stock_quantity into qty from public.products where company_id=p_company_id and id=i.product_id for update;
 select unit_cost into uc from public.financial_sale_costs where company_id=p_company_id and sale_item_id=i.id;select unit_cost into oc from public.financial_product_costs where company_id=p_company_id and product_id=i.product_id;
 if uc is not null and (qty=0 or oc is not null) then insert into public.financial_product_costs(company_id,product_id,unit_cost,updated_by) values(p_company_id,i.product_id,round((coalesce(oc,0)*qty+uc*r.quantity)/(qty+r.quantity),2),auth.uid()) on conflict(company_id,product_id) do update set unit_cost=excluded.unit_cost,updated_by=auth.uid(),updated_at=now();end if;
 update public.products set stock_quantity=stock_quantity+r.quantity where company_id=p_company_id and id=i.product_id;
 insert into public.stock_movements(company_id,product_id,sale_id,quantity,reason) values(p_company_id,i.product_id,sa.id,r.quantity,'Return '||rid::text);end if;
 refund_net:=refund_net+line_net;refund_tax:=refund_tax+line_tax;grand:=grand+line_total;
 end loop;
 if grand<0 or sa.refunded_total+grand>sa.total then raise exception 'Refund exceeds the original sale';end if;
 update public.sale_refunds set total=grand,tax=refund_tax,net=refund_net where id=rid;update public.sales set refunded_total=refunded_total+grand where id=sa.id;
 if grand>0 then insert into public.cashbook_entries(company_id,created_by,type,category,description,amount,payment_method,request_id) values(p_company_id,auth.uid(),'expense','Customer refund','Refund for '||sa.receipt_number,grand,p_method,rid);end if;return rid;
end $$;
create function public.open_shift(p_company_id uuid,p_cash numeric,p_request_id uuid) returns uuid language sql security invoker set search_path='' as $$select private.open_shift(p_company_id,p_cash,p_request_id)$$;
revoke all on function private.open_shift(uuid,numeric,uuid),public.open_shift(uuid,numeric,uuid) from public,anon;
grant execute on function private.open_shift(uuid,numeric,uuid),public.open_shift(uuid,numeric,uuid) to authenticated;
create function public.shift_action(p_company_id uuid,p_shift_id uuid,p_action text,p_amount numeric,p_reason text,p_request_id uuid) returns void language sql security invoker set search_path='' as $$select private.shift_action(p_company_id,p_shift_id,p_action,p_amount,p_reason,p_request_id)$$;
revoke all on function private.shift_action(uuid,uuid,text,numeric,text,uuid),public.shift_action(uuid,uuid,text,numeric,text,uuid) from public,anon;
grant execute on function private.shift_action(uuid,uuid,text,numeric,text,uuid),public.shift_action(uuid,uuid,text,numeric,text,uuid) to authenticated;
create function public.adjust_stock(p_company_id uuid,p_product_id uuid,p_quantity integer,p_reason text,p_notes text,p_request_id uuid) returns uuid language sql security invoker set search_path='' as $$select private.adjust_stock(p_company_id,p_product_id,p_quantity,p_reason,p_notes,p_request_id)$$;
revoke all on function private.adjust_stock(uuid,uuid,integer,text,text,uuid),public.adjust_stock(uuid,uuid,integer,text,text,uuid) from public,anon;
grant execute on function private.adjust_stock(uuid,uuid,integer,text,text,uuid),public.adjust_stock(uuid,uuid,integer,text,text,uuid) to authenticated;
create function public.save_retail_product(p_company_id uuid,p_product jsonb,p_unit_cost numeric,p_stock_reason text) returns uuid language sql security invoker set search_path='' as $$select private.save_retail_product(p_company_id,p_product,p_unit_cost,p_stock_reason)$$;
revoke all on function private.save_retail_product(uuid,jsonb,numeric,text),public.save_retail_product(uuid,jsonb,numeric,text) from public,anon;
grant execute on function private.save_retail_product(uuid,jsonb,numeric,text),public.save_retail_product(uuid,jsonb,numeric,text) to authenticated;
create function public.manage_staff(p_company_id uuid,p_user_id uuid,p_role text,p_active boolean) returns void language sql security invoker set search_path='' as $$select private.manage_staff(p_company_id,p_user_id,p_role,p_active)$$;
revoke all on function private.manage_staff(uuid,uuid,text,boolean),public.manage_staff(uuid,uuid,text,boolean) from public,anon;
grant execute on function private.manage_staff(uuid,uuid,text,boolean),public.manage_staff(uuid,uuid,text,boolean) to authenticated;
create function public.refund_sale(p_company_id uuid,p_sale_id uuid,p_items jsonb,p_reason text,p_method text,p_request_id uuid) returns uuid language sql security invoker set search_path='' as $$select private.refund_sale(p_company_id,p_sale_id,p_items,p_reason,p_method,p_request_id)$$;
revoke all on function private.refund_sale(uuid,uuid,jsonb,text,text,uuid),public.refund_sale(uuid,uuid,jsonb,text,text,uuid) from public,anon;
grant execute on function private.refund_sale(uuid,uuid,jsonb,text,text,uuid),public.refund_sale(uuid,uuid,jsonb,text,text,uuid) to authenticated;
revoke all on function private.retail_checkout(uuid,jsonb,numeric,jsonb,uuid,jsonb,uuid) from public,anon;
grant execute on function private.retail_checkout(uuid,jsonb,numeric,jsonb,uuid,jsonb,uuid) to authenticated;
create trigger retail_audit after insert or update or delete on public.products for each row execute function private.retail_audit();
create trigger retail_audit after insert or update or delete on public.companies for each row execute function private.retail_audit();
create trigger retail_audit after insert or update or delete on public.company_users for each row execute function private.retail_audit();
create trigger retail_audit after insert or update or delete on public.financial_product_costs for each row execute function private.retail_audit();
create trigger retail_audit after insert or update or delete on public.financial_sale_costs for each row execute function private.retail_audit();
create trigger retail_audit after insert or update or delete on public.financial_balances for each row execute function private.retail_audit();
create trigger retail_audit after insert or update or delete on public.stock_adjustments for each row execute function private.retail_audit();
create trigger retail_audit after insert or update or delete on public.cashier_shifts for each row execute function private.retail_audit();
create trigger retail_audit after insert or update or delete on public.shift_cash_events for each row execute function private.retail_audit();
create trigger retail_audit after insert or update or delete on public.sale_refunds for each row execute function private.retail_audit();
create trigger retail_audit after insert or update or delete on public.quotations for each row execute function private.retail_audit();
create trigger retail_audit after insert or update or delete on public.staff_invitations for each row execute function private.retail_audit();
commit;
