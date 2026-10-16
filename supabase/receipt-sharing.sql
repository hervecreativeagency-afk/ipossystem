-- WhatsApp / SMS receipts and a marketing contact list (with consent).
-- Additive: new nullable/defaulted columns on customers, a receipt_shares log,
-- and two functions. Nothing existing is changed or removed.
--
-- Sending a receipt saves the number as a customer (matched on the last 9
-- digits, so 0977…, 977… and +260977… are one person) and links the sale.
-- Customers only join the marketing list when staff tick that they agreed
-- (Zambia Data Protection Act 2021: consent for direct marketing). The time and
-- staff member are recorded; opting out is always allowed.

alter table public.customers add column marketing_opt_in boolean not null default false;
alter table public.customers add column marketing_opt_in_at timestamptz;
alter table public.customers add column marketing_opt_in_by uuid references auth.users(id);
alter table public.customers add column last_receipt_at timestamptz;

create table public.receipt_shares(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  sale_id uuid not null,
  customer_id uuid,
  channel text not null check (channel in ('whatsapp','sms')),
  phone text not null check (length(phone) between 6 and 40),
  shared_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (company_id, sale_id) references public.sales(company_id, id),
  foreign key (company_id, customer_id) references public.customers(company_id, id)
);
create index receipt_shares_sale_idx on public.receipt_shares(company_id, sale_id);
create index customers_marketing_idx on public.customers(company_id) where marketing_opt_in and active;

alter table public.receipt_shares enable row level security;
revoke all on public.receipt_shares from anon, authenticated;
grant select on public.receipt_shares to authenticated;
create policy receipt_shares_read on public.receipt_shares for select to authenticated
  using (private.member_role(company_id) in ('director','supervisor') or shared_by = auth.uid());

-- ---------------------------------------------------------------- record a sent receipt
create function private.record_receipt_share(p_company_id uuid, p_sale_id uuid, p_channel text, p_phone text, p_name text, p_opt_in boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare role text := private.member_role(p_company_id); s public.sales%rowtype; cid uuid; cust public.customers%rowtype;
  v_phone text := nullif(trim(p_phone), ''); v_digits text; v_name text := nullif(trim(p_name), '');
begin
  if auth.uid() is null or role is null then raise exception 'Unauthorized access'; end if;
  if p_channel is null or p_channel not in ('whatsapp','sms') then raise exception 'Choose WhatsApp or SMS'; end if;
  v_digits := regexp_replace(coalesce(v_phone, ''), '\D', '', 'g');
  if length(v_digits) < 9 or length(v_digits) > 15 or length(v_phone) > 40 then raise exception 'Enter a valid phone number'; end if;
  if v_name is not null and length(v_name) > 150 then raise exception 'Customer name is too long'; end if;

  select * into s from public.sales where company_id = p_company_id and id = p_sale_id;
  if not found then raise exception 'Sale not found'; end if;
  if role = 'cashier' and s.cashier_id <> auth.uid() then raise exception 'You can only send receipts for your own sales'; end if;

  -- Same person if the last 9 digits match (Zambian numbers with or without 0 / +260).
  cid := s.customer_id;
  if cid is not null then
    select * into cust from public.customers where company_id = p_company_id and id = cid;
    if right(regexp_replace(coalesce(cust.phone, ''), '\D', '', 'g'), 9) is distinct from right(v_digits, 9) and cust.phone is not null then
      cid := null;  -- receipt sent to a different number than the saved customer
    end if;
  end if;
  if cid is null then
    select id into cid from public.customers
    where company_id = p_company_id and active and phone is not null
      and right(regexp_replace(phone, '\D', '', 'g'), 9) = right(v_digits, 9)
    order by created_at limit 1;
  end if;
  if cid is null then
    begin
      insert into public.customers(company_id, name, phone, created_by)
      values (p_company_id, coalesce(v_name, nullif(trim(s.customer_name), ''), 'Customer ' || right(v_digits, 4)), v_phone, auth.uid())
      returning id into cid;
    exception when unique_violation then
      select id into cid from public.customers where company_id = p_company_id and active
        and regexp_replace(phone, '\D', '', 'g') = v_digits limit 1;
    end;
  end if;

  update public.customers set
    phone = coalesce(phone, v_phone),
    last_receipt_at = now(),
    marketing_opt_in = marketing_opt_in or coalesce(p_opt_in, false),
    marketing_opt_in_at = case when coalesce(p_opt_in, false) and not marketing_opt_in then now() else marketing_opt_in_at end,
    marketing_opt_in_by = case when coalesce(p_opt_in, false) and not marketing_opt_in then auth.uid() else marketing_opt_in_by end,
    updated_at = now()
  where company_id = p_company_id and id = cid;

  -- Link the sale to the customer for purchase history (only if not linked yet).
  update public.sales set customer_id = cid,
    customer_phone = coalesce(customer_phone, v_phone),
    customer_name = coalesce(customer_name, (select name from public.customers where id = cid))
  where company_id = p_company_id and id = p_sale_id and customer_id is null;

  insert into public.receipt_shares(company_id, sale_id, customer_id, channel, phone, shared_by)
  values (p_company_id, p_sale_id, cid, p_channel, v_phone, auth.uid());
  return cid;
end $$;

-- ---------------------------------------------------------------- opt in / out
create function private.set_customer_marketing(p_company_id uuid, p_customer_id uuid, p_opt_in boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or private.member_role(p_company_id) is null then raise exception 'Unauthorized access'; end if;
  if p_opt_in is null then raise exception 'Choose yes or no'; end if;
  update public.customers set
    marketing_opt_in = p_opt_in,
    marketing_opt_in_at = case when p_opt_in and not marketing_opt_in then now() when not p_opt_in then null else marketing_opt_in_at end,
    marketing_opt_in_by = case when p_opt_in and not marketing_opt_in then auth.uid() when not p_opt_in then null else marketing_opt_in_by end,
    updated_at = now()
  where company_id = p_company_id and id = p_customer_id;
  if not found then raise exception 'Customer not found'; end if;
end $$;

-- ---------------------------------------------------------------- API wrappers
create function public.record_receipt_share(p_company_id uuid, p_sale_id uuid, p_channel text, p_phone text, p_name text, p_opt_in boolean)
returns uuid language sql security invoker set search_path = '' as $$ select private.record_receipt_share(p_company_id, p_sale_id, p_channel, p_phone, p_name, p_opt_in) $$;
create function public.set_customer_marketing(p_company_id uuid, p_customer_id uuid, p_opt_in boolean)
returns void language sql security invoker set search_path = '' as $$ select private.set_customer_marketing(p_company_id, p_customer_id, p_opt_in) $$;

revoke all on function private.record_receipt_share(uuid, uuid, text, text, text, boolean), private.set_customer_marketing(uuid, uuid, boolean),
  public.record_receipt_share(uuid, uuid, text, text, text, boolean), public.set_customer_marketing(uuid, uuid, boolean) from public, anon;
grant execute on function private.record_receipt_share(uuid, uuid, text, text, text, boolean), private.set_customer_marketing(uuid, uuid, boolean),
  public.record_receipt_share(uuid, uuid, text, text, text, boolean), public.set_customer_marketing(uuid, uuid, boolean) to authenticated;
