-- Expiry dates (stock batches) and product variants.
--
-- Variants: each variant (e.g. "T-shirt – Red / L") stays an ordinary product
-- row with its own SKU, barcode, price and stock, so selling, branches,
-- transfers and reordering work unchanged. Rows of one product share a
-- variant_group_id; variant_base is the shared name, variant_label the option.
--
-- Expiry: stock_batches holds dated stock per branch. Dated stock is added
-- when an expiry date is given (delivery, stock added, a new product's starting
-- stock, or tagging stock already on the shelf). Whenever a branch's stock
-- falls below the total of its dated batches, the soonest-expiring batches are
-- used up first. Stock without a date is assumed to sell first. Transfers carry
-- the dates of the batches they take to the receiving branch.

-- ---------------------------------------------------------------- variants
alter table public.products add column variant_group_id uuid;
alter table public.products add column variant_base text check (variant_base is null or length(variant_base) between 1 and 150);
alter table public.products add column variant_label text check (variant_label is null or length(variant_label) between 1 and 100);
create index products_variant_group_idx on public.products(company_id, variant_group_id) where variant_group_id is not null;

create function private.link_variant(p_company_id uuid, p_product_id uuid, p_group_id uuid, p_base text, p_label text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or private.member_role(p_company_id) not in ('director','supervisor') then raise exception 'Only a director or supervisor can change variants'; end if;
  if p_group_id is not null and (nullif(trim(p_base), '') is null or nullif(trim(p_label), '') is null) then raise exception 'Enter the product name and the variant (e.g. Red / Large)'; end if;
  update public.products set variant_group_id = p_group_id,
    variant_base = case when p_group_id is null then null else trim(p_base) end,
    variant_label = case when p_group_id is null then null else trim(p_label) end
  where company_id = p_company_id and id = p_product_id;
  if not found then raise exception 'Product not found'; end if;
end $$;

-- ---------------------------------------------------------------- expiry batches
create table public.stock_batches(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  branch_id uuid not null,
  product_id uuid not null,
  expiry_date date not null,
  quantity integer not null check (quantity >= 0),          -- still on the shelf
  received_quantity integer not null check (received_quantity > 0),
  source text check (source is null or length(source) <= 200),
  written_off integer not null default 0 check (written_off >= 0),
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, branch_id) references public.branches(company_id, id),
  foreign key (company_id, product_id) references public.products(company_id, id)
);
create index stock_batches_lookup_idx on public.stock_batches(branch_id, product_id, expiry_date) where quantity > 0;
create index stock_batches_company_idx on public.stock_batches(company_id, expiry_date) where quantity > 0;

alter table public.stock_batches enable row level security;
revoke all on public.stock_batches from anon, authenticated;
grant select on public.stock_batches to authenticated;
create policy stock_batch_read on public.stock_batches for select to authenticated using (private.member_role(company_id) is not null);
create trigger retail_audit after insert or update or delete on public.stock_batches for each row execute function private.retail_audit();

-- Use up dated batches (soonest expiry first) until they fit within the branch's stock.
-- What was used is remembered for this transaction (ipos.consumed) so transfers can carry it.
create function private.trim_batches(p_company_id uuid, p_branch_id uuid, p_product_id uuid, p_stock integer) returns void
language plpgsql security definer set search_path = '' as $$
declare total integer; need integer; b record; take integer; used jsonb := '[]'; prev jsonb;
begin
  select coalesce(sum(quantity), 0) into total from public.stock_batches where branch_id = p_branch_id and product_id = p_product_id and quantity > 0;
  need := total - greatest(p_stock, 0);
  if need <= 0 then return; end if;
  for b in select id, quantity, expiry_date from public.stock_batches
           where branch_id = p_branch_id and product_id = p_product_id and quantity > 0
           order by expiry_date, created_at for update loop
    take := least(b.quantity, need);
    update public.stock_batches set quantity = quantity - take where id = b.id;
    used := used || jsonb_build_array(jsonb_build_object('expiry_date', b.expiry_date, 'quantity', take));
    need := need - take;
    exit when need = 0;
  end loop;
  prev := coalesce(nullif(current_setting('ipos.consumed', true), ''), '{}')::jsonb;
  perform set_config('ipos.consumed', (prev || jsonb_build_object(p_product_id::text, coalesce(prev->(p_product_id::text), '[]'::jsonb) || used))::text, true);
end $$;

create or replace function private.apply_branch_movement() returns trigger language plpgsql security definer set search_path = '' as $$
declare have integer; pname text; bname text; exp date;
begin
  if new.branch_id is null then
    if new.sale_id is not null then select branch_id into new.branch_id from public.sales where id = new.sale_id; end if;
    new.branch_id := coalesce(new.branch_id, private.resolve_branch(new.company_id));
  end if;
  insert into public.branch_stock(company_id, branch_id, product_id, quantity) values (new.company_id, new.branch_id, new.product_id, 0) on conflict do nothing;
  select quantity into have from public.branch_stock where branch_id = new.branch_id and product_id = new.product_id for update;
  if have + new.quantity < 0 then
    select name into pname from public.products where id = new.product_id;
    select name into bname from public.branches where id = new.branch_id;
    raise exception 'Not enough % at %: only % in stock there', pname, bname, have;
  end if;
  update public.branch_stock set quantity = quantity + new.quantity, updated_at = now() where branch_id = new.branch_id and product_id = new.product_id;
  if new.quantity > 0 then
    exp := private.pending_expiry(new.product_id);
    if exp is not null then
      insert into public.stock_batches(company_id, branch_id, product_id, expiry_date, quantity, received_quantity, source)
      values (new.company_id, new.branch_id, new.product_id, exp, new.quantity, new.quantity, left(new.reason, 200));
    end if;
  else
    perform private.trim_batches(new.company_id, new.branch_id, new.product_id, have + new.quantity);
  end if;
  return new;
end $$;

-- Puts dated stock onto a branch, spreading `qty` over [{expiry_date, quantity}] soonest first.
create function private.add_batches(p_company_id uuid, p_branch_id uuid, p_product_id uuid, p_batches jsonb, p_qty integer, p_source text) returns void
language plpgsql security definer set search_path = '' as $$
declare b jsonb; left_qty integer := p_qty; take integer;
begin
  if p_batches is null or jsonb_typeof(p_batches) <> 'array' or p_qty <= 0 then return; end if;
  for b in select x from jsonb_array_elements(p_batches) x order by (x->>'expiry_date')::date loop
    exit when left_qty <= 0;
    take := least(left_qty, (b->>'quantity')::integer);
    if take > 0 then
      insert into public.stock_batches(company_id, branch_id, product_id, expiry_date, quantity, received_quantity, source)
      values (p_company_id, p_branch_id, p_product_id, (b->>'expiry_date')::date, take, take, left(p_source, 200));
      left_qty := left_qty - take;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- transfers carry expiry dates
create or replace function private.send_transfer(p_company_id uuid, p_from uuid, p_to uuid, p_items jsonb, p_notes text, p_request_id uuid) returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); tid uuid; item record; prod public.products%rowtype; lines jsonb := '[]'; num text; who text; toname text; used jsonb;
begin
  if uid is null or private.member_role(p_company_id) not in ('director','supervisor') then raise exception 'Only a director or supervisor can send stock'; end if;
  if p_request_id is null then raise exception 'Request ID required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || uid::text || p_request_id::text, 77));
  select id into tid from public.stock_transfers where company_id = p_company_id and sent_by = uid and request_id = p_request_id;
  if tid is not null then return tid; end if;
  if not private.can_use_branch(p_company_id, p_from) then raise exception 'You cannot send stock from this branch'; end if;
  select name into toname from public.branches where company_id = p_company_id and id = p_to and active;
  if toname is null or p_to = p_from then raise exception 'Choose another open branch to send to'; end if;
  if p_notes is not null and length(p_notes) > 300 then raise exception 'Notes are too long'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 200 then raise exception 'Add products to the transfer'; end if;
  if exists (select 1 from jsonb_to_recordset(p_items) x(product_id uuid, quantity numeric) where product_id is null or quantity is null or quantity <= 0 or quantity <> trunc(quantity) or quantity > 1000000) then raise exception 'Enter whole quantities above zero'; end if;
  if exists (select 1 from jsonb_to_recordset(p_items) x(product_id uuid) group by product_id having count(*) > 1) then raise exception 'A product can only appear once per transfer'; end if;
  tid := gen_random_uuid(); num := 'TR-' || upper(left(replace(tid::text, '-', ''), 10));
  select coalesce(full_name, 'Staff') into who from public.profiles where id = uid;
  for item in select x.product_id, x.quantity::integer as quantity from jsonb_to_recordset(p_items) x(product_id uuid, quantity numeric) order by x.product_id loop
    select * into prod from public.products where company_id = p_company_id and id = item.product_id for update;
    if not found then raise exception 'Product not found in this store'; end if;
    perform set_config('ipos.consumed', '', true);
    insert into public.stock_movements(company_id, product_id, quantity, reason, branch_id) values (p_company_id, prod.id, -item.quantity, 'Transfer ' || num || ' to ' || toname, p_from);
    update public.products set stock_quantity = stock_quantity - item.quantity where id = prod.id;
    used := coalesce(nullif(current_setting('ipos.consumed', true), ''), '{}')::jsonb->(prod.id::text);
    lines := lines || jsonb_build_array(jsonb_build_object('product_id', prod.id, 'name', prod.name, 'sku', prod.sku, 'quantity', item.quantity)
             || case when used is not null and jsonb_array_length(used) > 0 then jsonb_build_object('batches', used) else '{}'::jsonb end);
  end loop;
  perform set_config('ipos.consumed', '', true);
  insert into public.stock_transfers(id, company_id, number, from_branch_id, to_branch_id, items, notes, sent_by, sent_by_name, request_id)
  values (tid, p_company_id, num, p_from, p_to, lines, nullif(trim(p_notes), ''), uid, who, p_request_id);
  return tid;
end $$;

create or replace function private.receive_transfer(p_company_id uuid, p_transfer_id uuid, p_received jsonb, p_notes text) returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); t public.stock_transfers%rowtype; it jsonb; got integer; lines jsonb := '[]'; who text; fromname text;
begin
  if uid is null or private.member_role(p_company_id) not in ('director','supervisor') then raise exception 'Only a director or supervisor can receive stock'; end if;
  select * into t from public.stock_transfers where company_id = p_company_id and id = p_transfer_id for update;
  if not found then raise exception 'Transfer not found'; end if;
  if t.status <> 'sent' then raise exception 'This transfer was already %', t.status; end if;
  if not private.can_use_branch(p_company_id, t.to_branch_id) then raise exception 'Only the receiving branch can confirm this transfer'; end if;
  if p_notes is not null and length(p_notes) > 300 then raise exception 'Notes are too long'; end if;
  select name into fromname from public.branches where id = t.from_branch_id;
  select coalesce(full_name, 'Staff') into who from public.profiles where id = uid;
  perform set_config('ipos.expiries', '', true);  -- dates come from the transfer itself
  for it in select * from jsonb_array_elements(t.items) loop
    got := (it->>'quantity')::integer;
    if p_received is not null and jsonb_typeof(p_received) = 'array' then
      select coalesce(max((x->>'quantity')::numeric)::integer, got) into got from jsonb_array_elements(p_received) x where x->>'product_id' = it->>'product_id';
      if got is null or got < 0 or got > (it->>'quantity')::integer then raise exception 'Received quantity for % must be between 0 and %', it->>'name', it->>'quantity'; end if;
    end if;
    if got > 0 then
      insert into public.stock_movements(company_id, product_id, quantity, reason, branch_id) values (p_company_id, (it->>'product_id')::uuid, got, 'Transfer ' || t.number || ' from ' || fromname, t.to_branch_id);
      update public.products set stock_quantity = stock_quantity + got where company_id = p_company_id and id = (it->>'product_id')::uuid;
      perform private.add_batches(p_company_id, t.to_branch_id, (it->>'product_id')::uuid, it->'batches', got, 'Transfer ' || t.number || ' from ' || fromname);
    end if;
    lines := lines || jsonb_build_array(it || jsonb_build_object('received', got));
  end loop;
  update public.stock_transfers set status = 'received', items = lines, received_by = uid, received_by_name = who, received_at = now(), receive_notes = nullif(trim(p_notes), '') where id = t.id;
end $$;

create or replace function private.cancel_transfer(p_company_id uuid, p_transfer_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare t public.stock_transfers%rowtype; it jsonb;
begin
  if auth.uid() is null or private.member_role(p_company_id) not in ('director','supervisor') then raise exception 'Unauthorized access'; end if;
  select * into t from public.stock_transfers where company_id = p_company_id and id = p_transfer_id for update;
  if not found then raise exception 'Transfer not found'; end if;
  if t.status <> 'sent' then raise exception 'Only a transfer that has not been received can be cancelled'; end if;
  if not private.can_use_branch(p_company_id, t.from_branch_id) then raise exception 'Only the sending branch can cancel this transfer'; end if;
  perform set_config('ipos.expiries', '', true);  -- dates come from the transfer itself
  for it in select * from jsonb_array_elements(t.items) loop
    insert into public.stock_movements(company_id, product_id, quantity, reason, branch_id) values (p_company_id, (it->>'product_id')::uuid, (it->>'quantity')::integer, 'Transfer ' || t.number || ' cancelled', t.from_branch_id);
    update public.products set stock_quantity = stock_quantity + (it->>'quantity')::integer where company_id = p_company_id and id = (it->>'product_id')::uuid;
    perform private.add_batches(p_company_id, t.from_branch_id, (it->>'product_id')::uuid, it->'batches', (it->>'quantity')::integer, 'Transfer ' || t.number || ' cancelled');
  end loop;
  update public.stock_transfers set status = 'cancelled' where id = t.id;
end $$;

-- ---------------------------------------------------------------- recording expiry dates
create function private.check_expiry(p_date date) returns void language plpgsql immutable set search_path = '' as $$
begin
  if p_date is not null and (p_date < date '2000-01-01' or p_date > date '2100-12-31') then raise exception 'Enter a real expiry date'; end if;
end $$;

-- Delivery received, with an expiry date per product: {"<product_id>": "YYYY-MM-DD"}.
create function private.receive_purchase_expiry(p_company_id uuid, p_purchase_id uuid, p_paid boolean, p_payment_method text, p_expiries jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare k text;
begin
  if p_expiries is not null and jsonb_typeof(p_expiries) = 'object' then
    for k in select jsonb_object_keys(p_expiries) loop perform private.check_expiry(nullif(p_expiries->>k, '')::date); end loop;
    perform set_config('ipos.expiries', p_expiries::text, true);
  end if;
  perform public.receive_purchase(p_company_id, p_purchase_id, p_paid, p_payment_method);
  perform set_config('ipos.expiries', '', true);  -- the dates belong to this delivery only
end $$;

-- Stock added at a branch with an expiry date.
create function private.adjust_stock_expiry(p_company_id uuid, p_branch_id uuid, p_product_id uuid, p_quantity integer, p_reason text, p_notes text, p_request_id uuid, p_expiry date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare aid uuid;
begin
  perform private.check_expiry(p_expiry);
  if p_expiry is not null then perform set_config('ipos.expiries', jsonb_build_object(p_product_id::text, p_expiry)::text, true); end if;
  aid := private.adjust_stock_at(p_company_id, p_branch_id, p_product_id, p_quantity, p_reason, p_notes, p_request_id);
  perform set_config('ipos.expiries', '', true);  -- the date belongs to this stock only
  return aid;
end $$;

-- Product editor: optional "expiry_date" for the starting stock / stock added.
create or replace function private.save_retail_product_at(p_company_id uuid, p_branch_id uuid, p_product jsonb, p_unit_cost numeric, p_stock_reason text) returns uuid language plpgsql security definer set search_path = '' as $$
declare pid uuid := nullif(p_product->>'id', '')::uuid; total integer; here integer; wanted integer := (p_product->>'stock_quantity')::integer; exp date := nullif(p_product->>'expiry_date', '')::date; newid uuid;
begin
  perform private.use_branch(p_company_id, p_branch_id);
  perform private.check_expiry(exp);
  if pid is not null and wanted is not null then
    select stock_quantity into total from public.products where company_id = p_company_id and id = pid;
    select coalesce((select quantity from public.branch_stock where branch_id = p_branch_id and product_id = pid), 0) into here;
    if total is not null then p_product := jsonb_set(p_product, '{stock_quantity}', to_jsonb(total - here + wanted)); end if;
    if exp is not null then perform set_config('ipos.expiries', jsonb_build_object(pid::text, exp)::text, true); end if;
  elsif exp is not null then
    perform set_config('ipos.expiries', '{"*": "' || exp::text || '"}', true);  -- new product: id not known yet
  end if;
  newid := private.save_retail_product(p_company_id, p_product, p_unit_cost, p_stock_reason);
  perform set_config('ipos.expiries', '', true);
  return newid;
end $$;

-- Expiry date the app attached to this request (ipos.expiries = {"<product_id>": "YYYY-MM-DD"});
-- "*" applies to any product (a brand-new product's starting stock, whose id isn't known yet).
create function private.pending_expiry(p_product_id uuid) returns date language plpgsql stable set search_path = '' as $$
declare s text := nullif(current_setting('ipos.expiries', true), ''); j jsonb;
begin
  if s is null then return null; end if;
  j := s::jsonb;
  return nullif(coalesce(j->>(p_product_id::text), j->>'*'), '')::date;
exception when others then return null;
end $$;

-- Give stock already on the shelf an expiry date (no stock change).
create function private.tag_stock_expiry(p_company_id uuid, p_branch_id uuid, p_product_id uuid, p_quantity integer, p_expiry date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare onhand integer; dated integer; bid uuid;
begin
  if auth.uid() is null or private.member_role(p_company_id) not in ('director','supervisor') then raise exception 'Only a director or supervisor can record expiry dates'; end if;
  if not private.can_use_branch(p_company_id, p_branch_id) then raise exception 'You cannot work at this branch'; end if;
  if p_expiry is null then raise exception 'Enter the expiry date'; end if;
  perform private.check_expiry(p_expiry);
  if p_quantity is null or p_quantity <= 0 then raise exception 'Enter how many have this expiry date'; end if;
  select coalesce((select quantity from public.branch_stock where branch_id = p_branch_id and product_id = p_product_id for update), 0) into onhand;
  select coalesce(sum(quantity), 0) into dated from public.stock_batches where branch_id = p_branch_id and product_id = p_product_id and quantity > 0;
  if p_quantity > onhand - dated then raise exception 'Only % in stock here without an expiry date', greatest(onhand - dated, 0); end if;
  insert into public.stock_batches(company_id, branch_id, product_id, expiry_date, quantity, received_quantity, source)
  values (p_company_id, p_branch_id, p_product_id, p_expiry, p_quantity, p_quantity, 'Expiry recorded for stock on hand') returning id into bid;
  return bid;
end $$;

-- Remove a batch from stock (expired, damaged).
create function private.write_off_batch(p_company_id uuid, p_batch_id uuid, p_notes text, p_request_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare b public.stock_batches%rowtype; aid uuid;
begin
  if auth.uid() is null or private.member_role(p_company_id) not in ('director','supervisor') then raise exception 'Only a director or supervisor can write off stock'; end if;
  select * into b from public.stock_batches where company_id = p_company_id and id = p_batch_id for update;
  if not found then raise exception 'Batch not found'; end if;
  if b.quantity <= 0 then raise exception 'Nothing left in this batch'; end if;
  perform private.use_branch(p_company_id, b.branch_id);
  update public.stock_batches set written_off = written_off + quantity, quantity = 0 where id = b.id;
  aid := private.adjust_stock(p_company_id, b.product_id, -b.quantity, 'Expired', coalesce(nullif(trim(p_notes), ''), 'Expired ' || to_char(b.expiry_date, 'DD Mon YYYY')), p_request_id);
  return aid;
end $$;

-- ---------------------------------------------------------------- API wrappers
create function public.link_variant(p_company_id uuid, p_product_id uuid, p_group_id uuid, p_base text, p_label text) returns void language sql set search_path = '' as $$ select private.link_variant(p_company_id, p_product_id, p_group_id, p_base, p_label) $$;
create function public.receive_purchase_expiry(p_company_id uuid, p_purchase_id uuid, p_paid boolean, p_payment_method text, p_expiries jsonb) returns void language sql set search_path = '' as $$ select private.receive_purchase_expiry(p_company_id, p_purchase_id, p_paid, p_payment_method, p_expiries) $$;
create function public.adjust_stock_expiry(p_company_id uuid, p_branch_id uuid, p_product_id uuid, p_quantity integer, p_reason text, p_notes text, p_request_id uuid, p_expiry date) returns uuid language sql set search_path = '' as $$ select private.adjust_stock_expiry(p_company_id, p_branch_id, p_product_id, p_quantity, p_reason, p_notes, p_request_id, p_expiry) $$;
create function public.tag_stock_expiry(p_company_id uuid, p_branch_id uuid, p_product_id uuid, p_quantity integer, p_expiry date) returns uuid language sql set search_path = '' as $$ select private.tag_stock_expiry(p_company_id, p_branch_id, p_product_id, p_quantity, p_expiry) $$;
create function public.write_off_batch(p_company_id uuid, p_batch_id uuid, p_notes text, p_request_id uuid) returns uuid language sql set search_path = '' as $$ select private.write_off_batch(p_company_id, p_batch_id, p_notes, p_request_id) $$;

do $grants$
declare f text;
begin
  foreach f in array array[
    'private.link_variant(uuid,uuid,uuid,text,text)', 'private.receive_purchase_expiry(uuid,uuid,boolean,text,jsonb)', 'private.adjust_stock_expiry(uuid,uuid,uuid,integer,text,text,uuid,date)',
    'private.tag_stock_expiry(uuid,uuid,uuid,integer,date)', 'private.write_off_batch(uuid,uuid,text,uuid)', 'private.check_expiry(date)', 'private.pending_expiry(uuid)',
    'public.link_variant(uuid,uuid,uuid,text,text)', 'public.receive_purchase_expiry(uuid,uuid,boolean,text,jsonb)', 'public.adjust_stock_expiry(uuid,uuid,uuid,integer,text,text,uuid,date)',
    'public.tag_stock_expiry(uuid,uuid,uuid,integer,date)', 'public.write_off_batch(uuid,uuid,text,uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array['private.trim_batches(uuid,uuid,uuid,integer)', 'private.add_batches(uuid,uuid,uuid,jsonb,integer,text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $grants$;
