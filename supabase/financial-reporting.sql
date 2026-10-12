begin;
create table public.financial_product_costs(id uuid primary key default gen_random_uuid(),company_id uuid not null,product_id uuid not null,unit_cost numeric(14,2) not null check(unit_cost>=0 and unit_cost::text not in ('NaN','Infinity','-Infinity')),updated_by uuid not null references auth.users(id),updated_at timestamptz not null default now(),unique(company_id,product_id),foreign key(company_id,product_id) references public.products(company_id,id));
alter table public.sale_items add constraint sale_items_company_id_id_key unique(company_id,id);
create table public.financial_sale_costs(id uuid primary key default gen_random_uuid(),company_id uuid not null,sale_item_id uuid not null,unit_cost numeric(14,2) not null check(unit_cost>=0 and unit_cost::text not in ('NaN','Infinity','-Infinity')),source text not null check(source in ('sale_snapshot','director_entry')),updated_by uuid not null references auth.users(id),updated_at timestamptz not null default now(),unique(company_id,sale_item_id),foreign key(company_id,sale_item_id) references public.sale_items(company_id,id));
create table public.financial_balances(id uuid primary key default gen_random_uuid(),company_id uuid not null unique references public.companies(id),opening_date date not null,opening_cash numeric(14,2) not null,other_assets numeric(14,2) not null default 0 check(other_assets>=0),other_liabilities numeric(14,2) not null default 0 check(other_liabilities>=0),updated_by uuid not null references auth.users(id),updated_at timestamptz not null default now(),check(opening_cash::text not in ('NaN','Infinity','-Infinity') and other_assets::text not in ('NaN','Infinity','-Infinity') and other_liabilities::text not in ('NaN','Infinity','-Infinity')));
alter table public.financial_product_costs enable row level security;
alter table public.financial_sale_costs enable row level security;
alter table public.financial_balances enable row level security;
revoke all on public.financial_product_costs,public.financial_sale_costs,public.financial_balances from anon,authenticated;
grant select on public.financial_product_costs,public.financial_sale_costs,public.financial_balances to authenticated;
create policy director_read on public.financial_product_costs for select to authenticated using(private.member_role(company_id)='director');
create policy director_read on public.financial_sale_costs for select to authenticated using(private.member_role(company_id)='director');
create policy director_read on public.financial_balances for select to authenticated using(private.member_role(company_id)='director');
create function private.capture_sale_cost() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or private.member_role(new.company_id) is null then raise exception 'Unauthorized sale cost capture';end if;
 insert into public.financial_sale_costs(company_id,sale_item_id,unit_cost,source,updated_by)
 select new.company_id,new.id,c.unit_cost,'sale_snapshot',auth.uid() from public.financial_product_costs c where c.company_id=new.company_id and c.product_id=new.product_id;
 return new;
end $$;
revoke all on function private.capture_sale_cost() from public,anon,authenticated;
create trigger capture_sale_cost after insert on public.sale_items for each row execute function private.capture_sale_cost();
create function private.save_financial_data(p_company_id uuid,p_products jsonb,p_sale_items jsonb,p_balance jsonb) returns void language plpgsql security definer set search_path='' as $$
declare r record;uid uuid:=auth.uid();od date;oc numeric;oa numeric;ol numeric;
begin
 if uid is null or private.member_role(p_company_id) is distinct from 'director' then raise exception 'Director access required';end if;
 if jsonb_typeof(p_products) is distinct from 'array' or jsonb_typeof(p_sale_items) is distinct from 'array' or jsonb_array_length(p_products)>10000 or jsonb_array_length(p_sale_items)>10000 then raise exception 'Invalid cost entries';end if;
 for r in select * from jsonb_to_recordset(p_products) as x(id uuid,unit_cost numeric) loop
 if r.id is null or r.unit_cost is null or r.unit_cost<0 or r.unit_cost::text in ('NaN','Infinity','-Infinity') or r.unit_cost<>round(r.unit_cost,2) or not exists(select 1 from public.products where company_id=p_company_id and id=r.id) then raise exception 'Invalid product cost';end if;
 insert into public.financial_product_costs(company_id,product_id,unit_cost,updated_by) values(p_company_id,r.id,r.unit_cost,uid) on conflict(company_id,product_id) do update set unit_cost=excluded.unit_cost,updated_by=uid,updated_at=now();
 end loop;
 for r in select * from jsonb_to_recordset(p_sale_items) as x(id uuid,unit_cost numeric) loop
 if r.id is null or r.unit_cost is null or r.unit_cost<0 or r.unit_cost::text in ('NaN','Infinity','-Infinity') or r.unit_cost<>round(r.unit_cost,2) or not exists(select 1 from public.sale_items where company_id=p_company_id and id=r.id) then raise exception 'Invalid historical sale cost';end if;
 insert into public.financial_sale_costs(company_id,sale_item_id,unit_cost,source,updated_by) values(p_company_id,r.id,r.unit_cost,'director_entry',uid) on conflict(company_id,sale_item_id) do update set unit_cost=excluded.unit_cost,source='director_entry',updated_by=uid,updated_at=now();
 end loop;
 if p_balance is not null and p_balance<>'null'::jsonb then
 od:=(p_balance->>'opening_date')::date;oc:=(p_balance->>'opening_cash')::numeric;oa:=(p_balance->>'other_assets')::numeric;ol:=(p_balance->>'other_liabilities')::numeric;
 if od is null or od>(now() at time zone 'Africa/Lusaka')::date or oc is null or oa is null or ol is null or oa<0 or ol<0 or oc::text in ('NaN','Infinity','-Infinity') or oa::text in ('NaN','Infinity','-Infinity') or ol::text in ('NaN','Infinity','-Infinity') or oc<>round(oc,2) or oa<>round(oa,2) or ol<>round(ol,2) then raise exception 'Invalid opening balance';end if;
 insert into public.financial_balances(company_id,opening_date,opening_cash,other_assets,other_liabilities,updated_by) values(p_company_id,od,oc,oa,ol,uid) on conflict(company_id) do update set opening_date=od,opening_cash=oc,other_assets=oa,other_liabilities=ol,updated_by=uid,updated_at=now();
 end if;
end $$;
create function public.save_financial_data(p_company_id uuid,p_products jsonb,p_sale_items jsonb,p_balance jsonb) returns void language sql security invoker set search_path='' as $$select private.save_financial_data(p_company_id,p_products,p_sale_items,p_balance)$$;
revoke all on function private.save_financial_data(uuid,jsonb,jsonb,jsonb),public.save_financial_data(uuid,jsonb,jsonb,jsonb) from public,anon;
grant execute on function private.save_financial_data(uuid,jsonb,jsonb,jsonb),public.save_financial_data(uuid,jsonb,jsonb,jsonb) to authenticated;
commit;
