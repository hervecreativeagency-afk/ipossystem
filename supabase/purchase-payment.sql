begin;
create function private.pay_purchase(p_company_id uuid,p_purchase_id uuid,p_payment_method text) returns void language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();po public.purchase_orders%rowtype;
begin
 if uid is null or private.member_role(p_company_id) is null or private.member_role(p_company_id) not in ('director','supervisor') then raise exception 'Unauthorized access';end if;
 if p_payment_method is null or p_payment_method not in ('Cash','Airtel Money','MTN Money','Bank/Card') then raise exception 'Invalid payment method';end if;
 select * into po from public.purchase_orders where company_id=p_company_id and id=p_purchase_id for update;if not found or po.status<>'received' then raise exception 'Receive the purchase before recording payment';end if;if po.paid then return;end if;
 if po.total>0 then insert into public.cashbook_entries(company_id,created_by,type,category,description,amount,payment_method,purchase_id,request_id) values(p_company_id,uid,'expense','Stock purchases','Payment for '||po.number,po.total,p_payment_method,po.id,po.id);end if;
 update public.purchase_orders set paid=true where id=po.id;
end $$;
create function public.pay_purchase(p_company_id uuid,p_purchase_id uuid,p_payment_method text) returns void language sql security invoker set search_path='' as $$select private.pay_purchase(p_company_id,p_purchase_id,p_payment_method)$$;
revoke all on function private.pay_purchase(uuid,uuid,text),public.pay_purchase(uuid,uuid,text) from public,anon;
grant execute on function private.pay_purchase(uuid,uuid,text),public.pay_purchase(uuid,uuid,text) to authenticated;
commit;
