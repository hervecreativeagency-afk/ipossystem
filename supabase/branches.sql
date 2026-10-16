-- More than one branch: separate stock per shop, transfers between them
-- (send, then receive), a home branch per staff member, and a combined view.
--
-- Design: every stock change in iPOS already writes a stock_movements row
-- (sales, refunds, adjustments, purchases, product edits). A trigger on that
-- table applies each movement to the right branch's count in branch_stock and
-- refuses to let a branch go below zero. products.stock_quantity stays the
-- company total (= sum of branch stock; stock in transit is not counted).
--
-- Which branch? sale -> the cashier's open shift; refund -> the sale's branch;
-- purchase delivery -> the purchase order's branch; otherwise the branch the
-- app asked for (set via the *_at functions below), else the user's home
-- branch, else the main branch. Existing functions keep working unchanged, so
-- the current app behaves exactly as before with the single "Main shop".

-- ---------------------------------------------------------------- tables
create table public.branches(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name text not null check (length(trim(name)) between 1 and 80),
  address text check (address is null or length(address) <= 300),
  phone text check (phone is null or length(phone) <= 40),
  is_main boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, id)
);
create unique index branches_one_main on public.branches(company_id) where is_main;
create unique index branches_name_key on public.branches(company_id, lower(trim(name))) where active;

create table public.branch_stock(
  company_id uuid not null,
  branch_id uuid not null,
  product_id uuid not null,
  quantity integer not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (branch_id, product_id),
  foreign key (company_id, branch_id) references public.branches(company_id, id),
  foreign key (company_id, product_id) references public.products(company_id, id)
);
create index branch_stock_product_idx on public.branch_stock(company_id, product_id);

create table public.stock_transfers(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  number text not null unique,
  from_branch_id uuid not null,
  to_branch_id uuid not null,
  items jsonb not null,               -- [{product_id, name, sku, quantity, received}]
  status text not null default 'sent' check (status in ('sent','received','cancelled')),
  notes text check (notes is null or length(notes) <= 300),
  receive_notes text check (receive_notes is null or length(receive_notes) <= 300),
  sent_by uuid not null references auth.users(id),
  sent_by_name text,
  sent_at timestamptz not null default now(),
  received_by uuid references auth.users(id),
  received_by_name text,
  received_at timestamptz,
  request_id uuid not null,
  check (from_branch_id <> to_branch_id),
  unique (company_id, id),
  unique (company_id, sent_by, request_id),
  foreign key (company_id, from_branch_id) references public.branches(company_id, id),
  foreign key (company_id, to_branch_id) references public.branches(company_id, id)
);
create index stock_transfers_company_idx on public.stock_transfers(company_id, sent_at desc);

alter table public.company_users add column branch_id uuid;      -- home branch; null = all branches
alter table public.cashier_shifts add column branch_id uuid;
alter table public.sales add column branch_id uuid;
alter table public.stock_movements add column branch_id uuid;
alter table public.stock_adjustments add column branch_id uuid;
alter table public.purchase_orders add column branch_id uuid;
alter table public.company_users add constraint company_users_branch_fkey foreign key (company_id, branch_id) references public.branches(company_id, id);
alter table public.cashier_shifts add constraint cashier_shifts_branch_fkey foreign key (company_id, branch_id) references public.branches(company_id, id);
alter table public.sales add constraint sales_branch_fkey foreign key (company_id, branch_id) references public.branches(company_id, id);
alter table public.stock_movements add constraint stock_movements_branch_fkey foreign key (company_id, branch_id) references public.branches(company_id, id);
alter table public.stock_adjustments add constraint stock_adjustments_branch_fkey foreign key (company_id, branch_id) references public.branches(company_id, id);
alter table public.purchase_orders add constraint purchase_orders_branch_fkey foreign key (company_id, branch_id) references public.branches(company_id, id);
create index sales_branch_idx on public.sales(company_id, branch_id, created_at desc);

-- ---------------------------------------------------------------- existing data -> "Main shop"
insert into public.branches(company_id, name, is_main) select id, 'Main shop', true from public.companies;
insert into public.branch_stock(company_id, branch_id, product_id, quantity)
  select p.company_id, b.id, p.id, p.stock_quantity from public.products p join public.branches b on b.company_id = p.company_id and b.is_main;
update public.cashier_shifts t set branch_id = b.id from public.branches b where b.company_id = t.company_id and b.is_main;
update public.sales t set branch_id = b.id from public.branches b where b.company_id = t.company_id and b.is_main;
update public.stock_movements t set branch_id = b.id from public.branches b where b.company_id = t.company_id and b.is_main;
update public.stock_adjustments t set branch_id = b.id from public.branches b where b.company_id = t.company_id and b.is_main;
update public.purchase_orders t set branch_id = b.id from public.branches b where b.company_id = t.company_id and b.is_main;
update public.company_users t set branch_id = b.id from public.branches b where b.company_id = t.company_id and b.is_main and t.role in ('cashier','supervisor');

-- ---------------------------------------------------------------- helpers
create function private.main_branch(p_company_id uuid) returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.branches where company_id = p_company_id and is_main $$;

create function private.home_branch(p_company_id uuid) returns uuid language sql stable security definer set search_path = '' as $$
  select branch_id from public.company_users where company_id = p_company_id and user_id = auth.uid() and active $$;

-- Can the signed-in user work at this branch? Home branch, or any branch when they have none (owners).
create function private.can_use_branch(p_company_id uuid, p_branch_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select private.member_role(p_company_id) is not null
     and exists (select 1 from public.branches where company_id = p_company_id and id = p_branch_id and active)
     and coalesce(private.home_branch(p_company_id) = p_branch_id, true) $$;

-- Remember which branch this request works at (for the rest of the transaction).
create function private.use_branch(p_company_id uuid, p_branch_id uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_branch_id is null or not private.can_use_branch(p_company_id, p_branch_id) then raise exception 'You cannot work at this branch'; end if;
  perform set_config('ipos.branch_id', p_branch_id::text, true);
end $$;

create function private.resolve_branch(p_company_id uuid) returns uuid language plpgsql stable security definer set search_path = '' as $$
declare b uuid; s text := nullif(current_setting('ipos.branch_id', true), '');
begin
  if s is not null then
    select id into b from public.branches where company_id = p_company_id and id = s::uuid;
    if b is not null then return b; end if;
  end if;
  return coalesce(private.home_branch(p_company_id), private.main_branch(p_company_id));
end $$;

-- ---------------------------------------------------------------- triggers
create function private.company_main_branch() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.branches(company_id, name, is_main) values (new.id, 'Main shop', true) on conflict do nothing;
  return new;
end $$;
create trigger company_main_branch after insert on public.companies for each row execute function private.company_main_branch();

create function private.member_default_branch() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.branch_id is null and new.role <> 'director' then new.branch_id := private.main_branch(new.company_id); end if;
  return new;
end $$;
create trigger member_default_branch before insert on public.company_users for each row execute function private.member_default_branch();

create function private.row_branch() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.branch_id is null then new.branch_id := private.resolve_branch(new.company_id); end if;
  return new;
end $$;
create trigger row_branch before insert on public.cashier_shifts for each row execute function private.row_branch();
create trigger row_branch before insert on public.stock_adjustments for each row execute function private.row_branch();
create trigger row_branch before insert on public.purchase_orders for each row execute function private.row_branch();

create function private.sale_branch() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.branch_id is null then
    select branch_id into new.branch_id from public.cashier_shifts
      where company_id = new.company_id and cashier_id = new.cashier_id and status = 'open' order by opened_at desc limit 1;
    new.branch_id := coalesce(new.branch_id, private.resolve_branch(new.company_id));
  end if;
  return new;
end $$;
create trigger sale_branch before insert on public.sales for each row execute function private.sale_branch();

-- Applies every stock movement to its branch; a branch can never go below zero.
create function private.apply_branch_movement() returns trigger language plpgsql security definer set search_path = '' as $$
declare have integer; pname text; bname text;
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
  return new;
end $$;
create trigger apply_branch_movement before insert on public.stock_movements for each row execute function private.apply_branch_movement();

-- ---------------------------------------------------------------- access
alter table public.branches enable row level security;
alter table public.branch_stock enable row level security;
alter table public.stock_transfers enable row level security;
revoke all on public.branches, public.branch_stock, public.stock_transfers from anon, authenticated;
grant select on public.branches, public.branch_stock, public.stock_transfers to authenticated;
create policy branch_read on public.branches for select to authenticated using (private.member_role(company_id) is not null);
create policy branch_stock_read on public.branch_stock for select to authenticated using (private.member_role(company_id) is not null);
create policy transfer_read on public.stock_transfers for select to authenticated using (
  private.member_role(company_id) in ('director','supervisor')
  and (private.home_branch(company_id) is null or private.home_branch(company_id) in (from_branch_id, to_branch_id)));

create trigger retail_audit after insert or update or delete on public.branches for each row execute function private.retail_audit();
create trigger retail_audit after insert or update or delete on public.stock_transfers for each row execute function private.retail_audit();

-- ---------------------------------------------------------------- branches (owner)
create function private.save_branch(p_company_id uuid, p_branch jsonb) returns uuid language plpgsql security definer set search_path = '' as $$
declare bid uuid := nullif(p_branch->>'id', '')::uuid; cur public.branches%rowtype;
  v_name text := nullif(trim(p_branch->>'name'), ''); v_active boolean := coalesce((p_branch->>'active')::boolean, true);
begin
  if auth.uid() is null or private.member_role(p_company_id) is distinct from 'director' then raise exception 'Only a director can manage branches'; end if;
  if v_name is null or length(v_name) > 80 then raise exception 'Enter a branch name'; end if;
  begin
    if bid is null then
      insert into public.branches(company_id, name, address, phone) values (p_company_id, v_name, nullif(trim(p_branch->>'address'), ''), nullif(trim(p_branch->>'phone'), '')) returning id into bid;
    else
      select * into cur from public.branches where company_id = p_company_id and id = bid for update;
      if not found then raise exception 'Branch not found'; end if;
      if not v_active and cur.active then
        if cur.is_main then raise exception 'The main branch cannot be closed'; end if;
        if exists (select 1 from public.branch_stock where branch_id = bid and quantity > 0) then raise exception 'Move or adjust this branch''s stock to zero before closing it'; end if;
        if exists (select 1 from public.cashier_shifts where branch_id = bid and status = 'open') then raise exception 'Close the open shifts at this branch first'; end if;
        if exists (select 1 from public.stock_transfers where company_id = p_company_id and status = 'sent' and bid in (from_branch_id, to_branch_id)) then raise exception 'Finish the transfers in transit for this branch first'; end if;
        if exists (select 1 from public.company_users where company_id = p_company_id and branch_id = bid and active) then raise exception 'Move this branch''s staff to another branch first'; end if;
      end if;
      update public.branches set name = v_name, address = nullif(trim(p_branch->>'address'), ''), phone = nullif(trim(p_branch->>'phone'), ''), active = v_active where id = bid;
    end if;
  exception when unique_violation then raise exception 'A branch with this name already exists';
  end;
  return bid;
end $$;

create function private.set_staff_branch(p_company_id uuid, p_user_id uuid, p_branch_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare r text;
begin
  if auth.uid() is null or private.member_role(p_company_id) is distinct from 'director' then raise exception 'Only a director can assign branches'; end if;
  select role into r from public.company_users where company_id = p_company_id and user_id = p_user_id;
  if r is null then raise exception 'Staff member not found'; end if;
  if p_branch_id is null and r = 'cashier' then raise exception 'A cashier must belong to one branch'; end if;
  if p_branch_id is not null and not exists (select 1 from public.branches where company_id = p_company_id and id = p_branch_id and active) then raise exception 'Choose an open branch'; end if;
  if exists (select 1 from public.cashier_shifts where company_id = p_company_id and cashier_id = p_user_id and status = 'open' and branch_id is distinct from p_branch_id) and p_branch_id is not null then
    raise exception 'This person has an open shift at another branch. Close it first.';
  end if;
  update public.company_users set branch_id = p_branch_id where company_id = p_company_id and user_id = p_user_id;
end $$;

create function private.list_staff_branches(p_company_id uuid) returns table(user_id uuid, branch_id uuid) language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or private.member_role(p_company_id) is distinct from 'director' then raise exception 'Unauthorized access'; end if;
  return query select cu.user_id, cu.branch_id from public.company_users cu where cu.company_id = p_company_id;
end $$;

-- ---------------------------------------------------------------- transfers
create function private.send_transfer(p_company_id uuid, p_from uuid, p_to uuid, p_items jsonb, p_notes text, p_request_id uuid) returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); tid uuid; item record; prod public.products%rowtype; lines jsonb := '[]'; num text; who text; toname text;
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
    insert into public.stock_movements(company_id, product_id, quantity, reason, branch_id) values (p_company_id, prod.id, -item.quantity, 'Transfer ' || num || ' to ' || toname, p_from);
    update public.products set stock_quantity = stock_quantity - item.quantity where id = prod.id;
    lines := lines || jsonb_build_array(jsonb_build_object('product_id', prod.id, 'name', prod.name, 'sku', prod.sku, 'quantity', item.quantity));
  end loop;
  insert into public.stock_transfers(id, company_id, number, from_branch_id, to_branch_id, items, notes, sent_by, sent_by_name, request_id)
  values (tid, p_company_id, num, p_from, p_to, lines, nullif(trim(p_notes), ''), uid, who, p_request_id);
  return tid;
end $$;

-- p_received: optional [{product_id, quantity}] when less arrived than was sent.
create function private.receive_transfer(p_company_id uuid, p_transfer_id uuid, p_received jsonb, p_notes text) returns void language plpgsql security definer set search_path = '' as $$
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
  for it in select * from jsonb_array_elements(t.items) loop
    got := (it->>'quantity')::integer;
    if p_received is not null and jsonb_typeof(p_received) = 'array' then
      select coalesce(max((x->>'quantity')::numeric)::integer, got) into got from jsonb_array_elements(p_received) x where x->>'product_id' = it->>'product_id';
      if got is null or got < 0 or got > (it->>'quantity')::integer then raise exception 'Received quantity for % must be between 0 and %', it->>'name', it->>'quantity'; end if;
    end if;
    if got > 0 then
      insert into public.stock_movements(company_id, product_id, quantity, reason, branch_id) values (p_company_id, (it->>'product_id')::uuid, got, 'Transfer ' || t.number || ' from ' || fromname, t.to_branch_id);
      update public.products set stock_quantity = stock_quantity + got where company_id = p_company_id and id = (it->>'product_id')::uuid;
    end if;
    lines := lines || jsonb_build_array(it || jsonb_build_object('received', got));
  end loop;
  update public.stock_transfers set status = 'received', items = lines, received_by = uid, received_by_name = who, received_at = now(), receive_notes = nullif(trim(p_notes), '') where id = t.id;
end $$;

create function private.cancel_transfer(p_company_id uuid, p_transfer_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare t public.stock_transfers%rowtype; it jsonb;
begin
  if auth.uid() is null or private.member_role(p_company_id) not in ('director','supervisor') then raise exception 'Unauthorized access'; end if;
  select * into t from public.stock_transfers where company_id = p_company_id and id = p_transfer_id for update;
  if not found then raise exception 'Transfer not found'; end if;
  if t.status <> 'sent' then raise exception 'Only a transfer that has not been received can be cancelled'; end if;
  if not private.can_use_branch(p_company_id, t.from_branch_id) then raise exception 'Only the sending branch can cancel this transfer'; end if;
  for it in select * from jsonb_array_elements(t.items) loop
    insert into public.stock_movements(company_id, product_id, quantity, reason, branch_id) values (p_company_id, (it->>'product_id')::uuid, (it->>'quantity')::integer, 'Transfer ' || t.number || ' cancelled', t.from_branch_id);
    update public.products set stock_quantity = stock_quantity + (it->>'quantity')::integer where company_id = p_company_id and id = (it->>'product_id')::uuid;
  end loop;
  update public.stock_transfers set status = 'cancelled' where id = t.id;
end $$;

-- ---------------------------------------------------------------- combined view (owner)
create function private.branch_summary(p_company_id uuid) returns table(
  branch_id uuid, name text, is_main boolean, sales_today numeric, sales_today_count bigint, sales_week numeric,
  stock_units bigint, stock_value numeric, low_stock bigint, out_of_stock bigint, open_shifts bigint, staff bigint, transfers_in bigint, transfers_out bigint)
language plpgsql stable security definer set search_path = '' as $$
declare today timestamptz := ((now() at time zone 'Africa/Lusaka')::date)::timestamp at time zone 'Africa/Lusaka';
begin
  if auth.uid() is null or private.member_role(p_company_id) not in ('director','supervisor') then raise exception 'Unauthorized access'; end if;
  return query
  select b.id, b.name, b.is_main,
    coalesce((select sum(s.total) - coalesce((select sum(r.total) from public.sale_refunds r join public.sales s2 on s2.id = r.sale_id where s2.branch_id = b.id and r.created_at >= today), 0) from public.sales s where s.branch_id = b.id and s.created_at >= today), 0),
    (select count(*) from public.sales s where s.branch_id = b.id and s.created_at >= today),
    coalesce((select sum(s.total) from public.sales s where s.branch_id = b.id and s.created_at >= today - interval '6 days'), 0),
    coalesce((select sum(bs.quantity) from public.branch_stock bs where bs.branch_id = b.id), 0)::bigint,
    coalesce((select sum(bs.quantity * p.selling_price) from public.branch_stock bs join public.products p on p.id = bs.product_id where bs.branch_id = b.id), 0),
    (select count(*) from public.products p left join public.branch_stock bs on bs.product_id = p.id and bs.branch_id = b.id where p.company_id = p_company_id and coalesce(bs.quantity, 0) > 0 and coalesce(bs.quantity, 0) <= p.low_stock_threshold),
    (select count(*) from public.products p left join public.branch_stock bs on bs.product_id = p.id and bs.branch_id = b.id where p.company_id = p_company_id and coalesce(bs.quantity, 0) = 0),
    (select count(*) from public.cashier_shifts cs where cs.branch_id = b.id and cs.status = 'open'),
    (select count(*) from public.company_users cu where cu.company_id = p_company_id and cu.branch_id = b.id and cu.active),
    (select count(*) from public.stock_transfers t where t.to_branch_id = b.id and t.status = 'sent'),
    (select count(*) from public.stock_transfers t where t.from_branch_id = b.id and t.status = 'sent')
  from public.branches b
  where b.company_id = p_company_id and b.active
    and (private.home_branch(p_company_id) is null or private.home_branch(p_company_id) = b.id)
  order by b.is_main desc, b.name;
end $$;

-- ---------------------------------------------------------------- branch-aware versions of existing actions
create function private.open_shift_at(p_company_id uuid, p_branch_id uuid, p_cash numeric, p_request_id uuid) returns uuid language plpgsql security definer set search_path = '' as $$
begin perform private.use_branch(p_company_id, p_branch_id); return private.open_shift(p_company_id, p_cash, p_request_id); end $$;

create function private.adjust_stock_at(p_company_id uuid, p_branch_id uuid, p_product_id uuid, p_quantity integer, p_reason text, p_notes text, p_request_id uuid) returns uuid language plpgsql security definer set search_path = '' as $$
begin perform private.use_branch(p_company_id, p_branch_id); return private.adjust_stock(p_company_id, p_product_id, p_quantity, p_reason, p_notes, p_request_id); end $$;

create function private.create_purchase_at(p_company_id uuid, p_branch_id uuid, p_supplier_id uuid, p_items jsonb, p_notes text, p_request_id uuid) returns uuid language plpgsql security definer set search_path = '' as $$
begin perform private.use_branch(p_company_id, p_branch_id); return private.create_purchase(p_company_id, p_supplier_id, p_items, p_notes, p_request_id); end $$;

-- In the product editor, "stock" means stock at this branch; convert it to the company total the original expects.
create function private.save_retail_product_at(p_company_id uuid, p_branch_id uuid, p_product jsonb, p_unit_cost numeric, p_stock_reason text) returns uuid language plpgsql security definer set search_path = '' as $$
declare pid uuid := nullif(p_product->>'id', '')::uuid; total integer; here integer; wanted integer := (p_product->>'stock_quantity')::integer;
begin
  perform private.use_branch(p_company_id, p_branch_id);
  if pid is not null and wanted is not null then
    select stock_quantity into total from public.products where company_id = p_company_id and id = pid;
    select coalesce((select quantity from public.branch_stock where branch_id = p_branch_id and product_id = pid), 0) into here;
    if total is not null then p_product := jsonb_set(p_product, '{stock_quantity}', to_jsonb(total - here + wanted)); end if;
  end if;
  return private.save_retail_product(p_company_id, p_product, p_unit_cost, p_stock_reason);
end $$;

-- Deliveries go to the branch on the purchase order (signature unchanged for the current app).
create or replace function public.receive_purchase(p_company_id uuid, p_purchase_id uuid, p_paid boolean, p_payment_method text) returns void language plpgsql set search_path = '' as $$
declare b uuid;
begin
  select branch_id into b from public.purchase_orders where company_id = p_company_id and id = p_purchase_id;
  if b is not null then
    if not private.can_use_branch(p_company_id, b) then raise exception 'This delivery is for another branch'; end if;
    perform set_config('ipos.branch_id', b::text, true);
  end if;
  perform private.receive_purchase(p_company_id, p_purchase_id, p_paid, p_payment_method);
end $$;

-- ---------------------------------------------------------------- API wrappers
create function public.save_branch(p_company_id uuid, p_branch jsonb) returns uuid language sql set search_path = '' as $$ select private.save_branch(p_company_id, p_branch) $$;
create function public.set_staff_branch(p_company_id uuid, p_user_id uuid, p_branch_id uuid) returns void language sql set search_path = '' as $$ select private.set_staff_branch(p_company_id, p_user_id, p_branch_id) $$;
create function public.list_staff_branches(p_company_id uuid) returns table(user_id uuid, branch_id uuid) language sql stable set search_path = '' as $$ select * from private.list_staff_branches(p_company_id) $$;
create function public.send_transfer(p_company_id uuid, p_from uuid, p_to uuid, p_items jsonb, p_notes text, p_request_id uuid) returns uuid language sql set search_path = '' as $$ select private.send_transfer(p_company_id, p_from, p_to, p_items, p_notes, p_request_id) $$;
create function public.receive_transfer(p_company_id uuid, p_transfer_id uuid, p_received jsonb, p_notes text) returns void language sql set search_path = '' as $$ select private.receive_transfer(p_company_id, p_transfer_id, p_received, p_notes) $$;
create function public.cancel_transfer(p_company_id uuid, p_transfer_id uuid) returns void language sql set search_path = '' as $$ select private.cancel_transfer(p_company_id, p_transfer_id) $$;
create function public.branch_summary(p_company_id uuid) returns table(branch_id uuid, name text, is_main boolean, sales_today numeric, sales_today_count bigint, sales_week numeric, stock_units bigint, stock_value numeric, low_stock bigint, out_of_stock bigint, open_shifts bigint, staff bigint, transfers_in bigint, transfers_out bigint)
  language sql stable set search_path = '' as $$ select * from private.branch_summary(p_company_id) $$;
create function public.open_shift_at(p_company_id uuid, p_branch_id uuid, p_cash numeric, p_request_id uuid) returns uuid language sql set search_path = '' as $$ select private.open_shift_at(p_company_id, p_branch_id, p_cash, p_request_id) $$;
create function public.adjust_stock_at(p_company_id uuid, p_branch_id uuid, p_product_id uuid, p_quantity integer, p_reason text, p_notes text, p_request_id uuid) returns uuid language sql set search_path = '' as $$ select private.adjust_stock_at(p_company_id, p_branch_id, p_product_id, p_quantity, p_reason, p_notes, p_request_id) $$;
create function public.create_purchase_at(p_company_id uuid, p_branch_id uuid, p_supplier_id uuid, p_items jsonb, p_notes text, p_request_id uuid) returns uuid language sql set search_path = '' as $$ select private.create_purchase_at(p_company_id, p_branch_id, p_supplier_id, p_items, p_notes, p_request_id) $$;
create function public.save_retail_product_at(p_company_id uuid, p_branch_id uuid, p_product jsonb, p_unit_cost numeric, p_stock_reason text) returns uuid language sql set search_path = '' as $$ select private.save_retail_product_at(p_company_id, p_branch_id, p_product, p_unit_cost, p_stock_reason) $$;

do $grants$
declare f text;
begin
  foreach f in array array[
    'private.main_branch(uuid)', 'private.home_branch(uuid)', 'private.can_use_branch(uuid,uuid)', 'private.use_branch(uuid,uuid)', 'private.resolve_branch(uuid)',
    'private.save_branch(uuid,jsonb)', 'private.set_staff_branch(uuid,uuid,uuid)', 'private.list_staff_branches(uuid)',
    'private.send_transfer(uuid,uuid,uuid,jsonb,text,uuid)', 'private.receive_transfer(uuid,uuid,jsonb,text)', 'private.cancel_transfer(uuid,uuid)', 'private.branch_summary(uuid)',
    'private.open_shift_at(uuid,uuid,numeric,uuid)', 'private.adjust_stock_at(uuid,uuid,uuid,integer,text,text,uuid)', 'private.create_purchase_at(uuid,uuid,uuid,jsonb,text,uuid)', 'private.save_retail_product_at(uuid,uuid,jsonb,numeric,text)',
    'public.save_branch(uuid,jsonb)', 'public.set_staff_branch(uuid,uuid,uuid)', 'public.list_staff_branches(uuid)',
    'public.send_transfer(uuid,uuid,uuid,jsonb,text,uuid)', 'public.receive_transfer(uuid,uuid,jsonb,text)', 'public.cancel_transfer(uuid,uuid)', 'public.branch_summary(uuid)',
    'public.open_shift_at(uuid,uuid,numeric,uuid)', 'public.adjust_stock_at(uuid,uuid,uuid,integer,text,text,uuid)', 'public.create_purchase_at(uuid,uuid,uuid,jsonb,text,uuid)', 'public.save_retail_product_at(uuid,uuid,jsonb,numeric,text)',
    'public.receive_purchase(uuid,uuid,boolean,text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  -- trigger functions are not callable from the API
  foreach f in array array['private.company_main_branch()', 'private.member_default_branch()', 'private.row_branch()', 'private.sale_branch()', 'private.apply_branch_movement()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $grants$;
