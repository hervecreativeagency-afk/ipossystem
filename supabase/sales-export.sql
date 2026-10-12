create or replace function public.director_sales_export_page(p_company_id uuid,p_from timestamptz,p_to timestamptz,p_kind text,p_offset integer default 0) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare result jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.company_users where company_id=p_company_id and user_id=auth.uid() and role='director' and active) then raise exception 'Only the director can export company sales';end if;
 if p_from is null or p_to is null or p_from>=p_to or p_offset<0 then raise exception 'Invalid export date range';end if;
 if p_kind='sales' then select coalesce(jsonb_agg(to_jsonb(t)),'[]') into result from (select s.* from public.sales s where s.company_id=p_company_id and s.created_at>=p_from and s.created_at<p_to order by s.created_at,s.id limit 500 offset p_offset)t;
 elsif p_kind='payments' then select coalesce(jsonb_agg(to_jsonb(t)),'[]') into result from (select p.id,p.sale_id,p.method,p.amount,s.currency,s.change,s.status from public.payments p join public.sales s on s.id=p.sale_id and s.company_id=p.company_id where p.company_id=p_company_id and s.created_at>=p_from and s.created_at<p_to order by p.id limit 500 offset p_offset)t;
 elsif p_kind='refunds' then select coalesce(jsonb_agg(to_jsonb(t)),'[]') into result from (select r.*,s.currency,s.receipt_number from public.sale_refunds r join public.sales s on s.id=r.sale_id and s.company_id=r.company_id where r.company_id=p_company_id and r.created_at>=p_from and r.created_at<p_to order by r.created_at,r.id limit 500 offset p_offset)t;
 else raise exception 'Invalid export type';end if;
 return result;
end $$;
revoke all on function public.director_sales_export_page(uuid,timestamptz,timestamptz,text,integer) from public,anon;
grant execute on function public.director_sales_export_page(uuid,timestamptz,timestamptz,text,integer) to authenticated;
