create or replace function private.refund_sale(p_company_id uuid,p_sale_id uuid,p_items jsonb,p_reason text,p_method text,p_request_id uuid) returns uuid language plpgsql security definer set search_path='' as $$declare sa public.sales%rowtype;r record;i public.sale_items%rowtype;rid uuid;sh uuid;prevqty integer;line_net numeric;line_tax numeric;line_total numeric;refund_net numeric:=0;refund_tax numeric:=0;grand numeric:=0;allocated numeric;discountline numeric;qty integer;uc numeric;oc numeric;begin
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
