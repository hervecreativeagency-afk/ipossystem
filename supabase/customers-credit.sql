-- Customers, balances owed and credit ("pay later") sales.
-- Additive: new tables, a nullable sales.customer_id, a new payment method
-- 'Customer credit', and in-place patches to checkout/refund functions.
-- Credit is sold by directors/supervisors only. Repayments go to the cashbook
-- (category 'Customer repayment'), not the cashier shift.

-- ---------------------------------------------------------------- tables
create table public.customers(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name text not null check (length(trim(name)) between 1 and 150),
  phone text check (phone is null or length(phone) <= 40),
  email text check (email is null or length(email) <= 200),
  notes text check (notes is null or length(notes) <= 1000),
  credit_limit numeric(12,2) check (credit_limit is null or credit_limit >= 0),
  balance numeric(12,2) not null default 0,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id)
);
create index customers_company_name_idx on public.customers(company_id, lower(name));
create unique index customers_company_phone_key on public.customers(company_id, (regexp_replace(phone, '\D', '', 'g')))
  where phone is not null and active and length(regexp_replace(phone, '\D', '', 'g')) >= 6;

create table public.customer_ledger(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  customer_id uuid not null,
  entry_type text not null check (entry_type in ('credit_sale','repayment','refund','adjustment')),
  amount numeric(12,2) not null check (amount <> 0),           -- + increases what the customer owes
  balance_after numeric(12,2) not null,
  sale_id uuid,
  refund_id uuid,
  payment_method text check (payment_method is null or payment_method in ('Cash','Airtel Money','MTN Money','Bank/Card')),
  note text check (note is null or length(note) <= 300),
  created_by uuid not null references auth.users(id),
  created_by_name text,
  request_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (company_id, customer_id) references public.customers(company_id, id),
  foreign key (company_id, sale_id) references public.sales(company_id, id),
  unique (company_id, entry_type, created_by, request_id)
);
create index customer_ledger_customer_idx on public.customer_ledger(company_id, customer_id, created_at desc);

alter table public.sales add column customer_id uuid;
alter table public.sales add constraint sales_customer_fkey foreign key (company_id, customer_id) references public.customers(company_id, id);
create index sales_customer_idx on public.sales(company_id, customer_id) where customer_id is not null;

alter table public.payments drop constraint payments_method_check;
alter table public.payments add constraint payments_method_check check (method in ('Cash','Airtel Money','MTN Money','Bank/Card','Customer credit'));
alter table public.sale_refunds drop constraint sale_refunds_payment_method_check;
alter table public.sale_refunds add constraint sale_refunds_payment_method_check check (payment_method in ('Cash','Airtel Money','MTN Money','Bank/Card','Customer credit'));

-- ---------------------------------------------------------------- access
alter table public.customers enable row level security;
alter table public.customer_ledger enable row level security;
revoke all on public.customers, public.customer_ledger from anon, authenticated;
grant select on public.customers, public.customer_ledger to authenticated;
create policy customer_read on public.customers for select to authenticated
  using (private.member_role(company_id) is not null);
create policy customer_ledger_read on public.customer_ledger for select to authenticated
  using (private.member_role(company_id) in ('director','supervisor'));

create trigger retail_audit after insert or update or delete on public.customers for each row execute function private.retail_audit();
create trigger retail_audit after insert or update or delete on public.customer_ledger for each row execute function private.retail_audit();

-- ---------------------------------------------------------------- save customer
create function private.save_customer(p_company_id uuid, p_customer jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare role text := private.member_role(p_company_id); cid uuid; cur public.customers%rowtype;
  v_name text := nullif(trim(p_customer->>'name'), '');
  v_phone text := nullif(trim(p_customer->>'phone'), '');
  v_email text := nullif(trim(p_customer->>'email'), '');
  v_notes text := nullif(trim(p_customer->>'notes'), '');
  v_limit numeric := nullif(p_customer->>'credit_limit', '')::numeric;
begin
  if auth.uid() is null or role is null then raise exception 'Unauthorized access'; end if;
  if v_name is null then raise exception 'Enter the customer''s name'; end if;
  if v_limit is not null and (v_limit < 0 or v_limit <> round(v_limit, 2) or v_limit > 9999999999.99) then raise exception 'Enter a valid credit limit'; end if;
  cid := nullif(p_customer->>'id', '')::uuid;
  begin
    if cid is null then
      if p_customer ? 'credit_limit' and v_limit is not null and role <> 'director' then raise exception 'Only a director can set a credit limit'; end if;
      insert into public.customers(company_id, name, phone, email, notes, credit_limit, created_by)
      values (p_company_id, v_name, v_phone, v_email, v_notes, case when role = 'director' then v_limit end, auth.uid())
      returning id into cid;
    else
      select * into cur from public.customers where company_id = p_company_id and id = cid for update;
      if not found then raise exception 'Customer not found'; end if;
      if role <> 'director' and ((p_customer ? 'credit_limit' and v_limit is distinct from cur.credit_limit)
          or (p_customer ? 'active' and (p_customer->>'active')::boolean is distinct from cur.active)) then
        raise exception 'Only a director can change credit limits or remove customers';
      end if;
      if p_customer ? 'active' and not (p_customer->>'active')::boolean and cur.balance <> 0 then
        raise exception 'This customer still has a balance. Settle it before removing them.';
      end if;
      update public.customers set name = v_name, phone = v_phone, email = v_email, notes = v_notes,
        credit_limit = case when p_customer ? 'credit_limit' then v_limit else credit_limit end,
        active = case when p_customer ? 'active' then (p_customer->>'active')::boolean else active end,
        updated_at = now()
      where company_id = p_company_id and id = cid;
    end if;
  exception when unique_violation then
    raise exception 'A customer with this phone number already exists';
  end;
  return cid;
end $$;

-- ---------------------------------------------------------------- repayment
create function private.record_customer_payment(p_company_id uuid, p_customer_id uuid, p_amount numeric, p_method text, p_note text, p_request_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare lid uuid; cust public.customers%rowtype; nb numeric; who text;
begin
  if auth.uid() is null or private.member_role(p_company_id) is null or private.member_role(p_company_id) not in ('director','supervisor') then
    raise exception 'Only a director or supervisor can record customer payments'; end if;
  if p_request_id is null then raise exception 'Request ID required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || p_request_id::text, 71));
  select id into lid from public.customer_ledger where company_id = p_company_id and entry_type = 'repayment' and created_by = auth.uid() and request_id = p_request_id;
  if lid is not null then return lid; end if;
  if p_amount is null or p_amount <= 0 or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount <> round(p_amount, 2) then raise exception 'Enter a valid amount'; end if;
  if p_method is null or p_method not in ('Cash','Airtel Money','MTN Money','Bank/Card') then raise exception 'Choose how the customer paid'; end if;
  if length(coalesce(p_note, '')) > 300 then raise exception 'Note is too long'; end if;
  select * into cust from public.customers where company_id = p_company_id and id = p_customer_id for update;
  if not found then raise exception 'Customer not found'; end if;
  if p_amount > cust.balance then raise exception 'Payment is more than the % owed', to_char(cust.balance, 'FM999,999,999,990.00'); end if;
  nb := cust.balance - p_amount;
  select coalesce(full_name, 'Staff') into who from public.profiles where id = auth.uid();
  update public.customers set balance = nb, updated_at = now() where id = cust.id;
  insert into public.customer_ledger(company_id, customer_id, entry_type, amount, balance_after, payment_method, note, created_by, created_by_name, request_id)
  values (p_company_id, cust.id, 'repayment', -p_amount, nb, p_method, nullif(trim(p_note), ''), auth.uid(), who, p_request_id)
  returning id into lid;
  insert into public.cashbook_entries(company_id, created_by, type, category, description, amount, payment_method, request_id)
  values (p_company_id, auth.uid(), 'income', 'Customer repayment', 'Payment from ' || cust.name, p_amount, p_method, p_request_id);
  return lid;
end $$;

-- ---------------------------------------------------------------- refund to account
create function private.refund_to_account(p_company_id uuid, p_sale_id uuid, p_refund_id uuid, p_amount numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare cust public.customers%rowtype; nb numeric; who text;
begin
  select c.* into cust from public.customers c join public.sales s on s.company_id = c.company_id and s.customer_id = c.id
   where s.company_id = p_company_id and s.id = p_sale_id for update of c;
  if not found then raise exception 'This sale has no saved customer. Refund by cash or mobile money instead.'; end if;
  if p_amount > cust.balance then raise exception 'Refund is more than the % this customer owes. Refund the rest by cash or mobile money.', to_char(cust.balance, 'FM999,999,999,990.00'); end if;
  nb := cust.balance - p_amount;
  select coalesce(full_name, 'Staff') into who from public.profiles where id = auth.uid();
  update public.customers set balance = nb, updated_at = now() where id = cust.id;
  insert into public.customer_ledger(company_id, customer_id, entry_type, amount, balance_after, sale_id, refund_id, created_by, created_by_name, request_id)
  values (p_company_id, cust.id, 'refund', -p_amount, nb, p_sale_id, p_refund_id, auth.uid(), who, p_refund_id);
end $$;

-- ---------------------------------------------------------------- checkout
-- Allow the 'Customer credit' method (directors/supervisors only) and up to 5 payment rows.
do $patch$
declare d text := pg_get_functiondef('private.checkout_core(uuid,jsonb,numeric,jsonb,uuid)'::regprocedure); n text;
begin
  n := replace(d, 'jsonb_array_length(p_payments)>4', 'jsonb_array_length(p_payments)>5');
  n := replace(n, 'pay.method not in (''Cash'',''Airtel Money'',''MTN Money'',''Bank/Card'')',
    'pay.method not in (''Cash'',''Airtel Money'',''MTN Money'',''Bank/Card'',''Customer credit'') or (pay.method=''Customer credit'' and private.member_role(p_company_id) not in (''director'',''supervisor''))');
  if n = d or position('Customer credit' in n) = 0 or position('>5' in n) = 0 then raise exception 'checkout_core patch did not apply'; end if;
  execute n;
end $patch$;

create or replace function private.retail_checkout(p_company_id uuid, p_items jsonb, p_discount numeric, p_payments jsonb, p_request_id uuid, p_customer jsonb, p_quotation_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare sid uuid; sh uuid; q public.quotations%rowtype; cid uuid; cust public.customers%rowtype; credit numeric := 0; tot numeric; nb numeric; who text;
begin
  if auth.uid() is null or private.member_role(p_company_id) is null then raise exception 'Unauthorized access'; end if;
  if p_request_id is null then raise exception 'Request ID required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || auth.uid()::text || p_request_id::text, 0));
  select id into sid from public.sales where company_id = p_company_id and cashier_id = auth.uid() and request_id = p_request_id;
  if sid is not null then return sid; end if;
  select id into sh from public.cashier_shifts where company_id = p_company_id and cashier_id = auth.uid() and status = 'open' for update;
  if sh is null then raise exception 'Open a cashier shift before checkout'; end if;
  if length(coalesce(p_customer->>'name', '')) > 150 or length(coalesce(p_customer->>'phone', '')) > 40 then raise exception 'Customer details are too long'; end if;

  cid := nullif(p_customer->>'id', '')::uuid;
  if jsonb_typeof(p_payments) = 'array' then
    select coalesce(sum((x->>'amount')::numeric), 0) into credit from jsonb_array_elements(p_payments) x where x->>'method' = 'Customer credit';
  end if;
  if credit > 0 then
    if private.member_role(p_company_id) not in ('director','supervisor') then raise exception 'Only a director or supervisor can sell on credit'; end if;
    if cid is null then raise exception 'Choose a saved customer for a credit sale'; end if;
  end if;
  if cid is not null then
    select * into cust from public.customers where company_id = p_company_id and id = cid for update;
    if not found or not cust.active then raise exception 'Customer not found'; end if;
    if credit > 0 and cust.credit_limit is not null and cust.balance + credit > cust.credit_limit then
      raise exception '% would owe more than their credit limit of %', cust.name, to_char(cust.credit_limit, 'FM999,999,999,990.00');
    end if;
  end if;

  if p_quotation_id is not null then
    if private.member_role(p_company_id) not in ('director','supervisor') then raise exception 'Quotation access restricted'; end if;
    select * into q from public.quotations where company_id = p_company_id and id = p_quotation_id for update;
    if not found or q.status <> 'accepted' then raise exception 'Quotation must be accepted and not already converted'; end if;
    if q.valid_until < (now() at time zone 'Africa/Lusaka')::date then raise exception 'Quotation expired'; end if;
    if (select jsonb_agg(jsonb_build_object('id', x.product_id, 'q', x.quantity) order by x.product_id) from jsonb_to_recordset(p_items) x(product_id uuid, quantity numeric))
       is distinct from (select jsonb_agg(jsonb_build_object('id', x.product_id, 'q', x.quantity) order by x.product_id) from jsonb_to_recordset(q.items) x(product_id uuid, quantity numeric)) then
      raise exception 'Quotation items changed; start a regular sale instead'; end if;
  end if;

  sid := private.checkout_core(p_company_id, p_items, p_discount, p_payments, p_request_id);
  update public.sales set shift_id = sh, customer_id = cid,
    customer_name = coalesce(nullif(trim(p_customer->>'name'), ''), cust.name),
    customer_phone = coalesce(nullif(trim(p_customer->>'phone'), ''), cust.phone)
  where id = sid;

  if credit > 0 then
    select total into tot from public.sales where id = sid;
    if credit > tot then raise exception 'Credit cannot be more than the sale total'; end if;
    nb := cust.balance + credit;
    select coalesce(full_name, 'Staff') into who from public.profiles where id = auth.uid();
    update public.customers set balance = nb, updated_at = now() where id = cid;
    insert into public.customer_ledger(company_id, customer_id, entry_type, amount, balance_after, sale_id, created_by, created_by_name, request_id)
    values (p_company_id, cid, 'credit_sale', credit, nb, sid, auth.uid(), who, p_request_id);
  end if;

  if p_quotation_id is not null then update public.quotations set status = 'converted', converted_sale_id = sid where id = q.id; end if;
  return sid;
end $$;

-- ---------------------------------------------------------------- refunds
-- Allow refunding a credit sale back to the customer's account (reduces what they owe, no cash out).
do $patch$
declare d text := pg_get_functiondef('private.refund_sale(uuid,uuid,jsonb,text,text,uuid)'::regprocedure); n text;
begin
  n := replace(d, 'p_method not in (''Cash'',''Airtel Money'',''MTN Money'',''Bank/Card'')', 'p_method not in (''Cash'',''Airtel Money'',''MTN Money'',''Bank/Card'',''Customer credit'')');
  n := replace(n, 'if grand>0 then insert into public.cashbook_entries(',
    'if grand>0 and p_method=''Customer credit'' then perform private.refund_to_account(p_company_id,sa.id,rid,grand); elsif grand>0 then insert into public.cashbook_entries(');
  if n = d or position('refund_to_account' in n) = 0 or position('''Bank/Card'',''Customer credit''' in n) = 0 then raise exception 'refund_sale patch did not apply'; end if;
  execute n;
end $patch$;

-- ---------------------------------------------------------------- API wrappers
create function public.save_customer(p_company_id uuid, p_customer jsonb) returns uuid
language sql security invoker set search_path = '' as $$ select private.save_customer(p_company_id, p_customer) $$;
create function public.record_customer_payment(p_company_id uuid, p_customer_id uuid, p_amount numeric, p_method text, p_note text, p_request_id uuid) returns uuid
language sql security invoker set search_path = '' as $$ select private.record_customer_payment(p_company_id, p_customer_id, p_amount, p_method, p_note, p_request_id) $$;

revoke all on function private.save_customer(uuid, jsonb), private.record_customer_payment(uuid, uuid, numeric, text, text, uuid), private.refund_to_account(uuid, uuid, uuid, numeric),
  public.save_customer(uuid, jsonb), public.record_customer_payment(uuid, uuid, numeric, text, text, uuid) from public, anon;
grant execute on function private.save_customer(uuid, jsonb), private.record_customer_payment(uuid, uuid, numeric, text, text, uuid),
  public.save_customer(uuid, jsonb), public.record_customer_payment(uuid, uuid, numeric, text, text, uuid) to authenticated;
