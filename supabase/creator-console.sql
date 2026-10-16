-- Creator console: platform-wide crashes, visits, who is online, feedback, shops and users.
--
-- iPOS reports small background events (src/telemetry.js → /api/track, which adds the
-- approximate location from the connection). Shops never read these tables; there are
-- no row policies on them at all. The separate Creator console reads everything through
-- creator_* functions that only work for an allow-listed, email-verified creator account.

create table private.platform_creators(
  email text primary key check (email = lower(email))
);
insert into private.platform_creators(email) values ('dafredmukunah@gmail.com');

create function private.is_creator() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from auth.users u join private.platform_creators c on c.email = lower(u.email)
    where u.id = auth.uid() and u.email_confirmed_at is not null
  )
$$;

-- ---------------------------------------------------------------- what iPOS reports
create table public.app_events(
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('visit', 'error')),
  user_id uuid,
  company_id uuid,
  role text,
  page text check (length(page) <= 200),
  message text check (length(message) <= 500),
  detail text check (length(detail) <= 4000),
  device text check (length(device) <= 40),
  browser text check (length(browser) <= 60),
  os text check (length(os) <= 60),
  app_version text check (length(app_version) <= 40),
  country text check (length(country) <= 2),
  region text check (length(region) <= 80),
  city text check (length(city) <= 80),
  lat numeric(8,4), lon numeric(8,4)
);
create index app_events_time_idx on public.app_events(created_at desc);
create index app_events_kind_idx on public.app_events(kind, created_at desc);

create table public.app_presence(
  user_id uuid primary key,
  company_id uuid,
  role text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  page text check (length(page) <= 200),
  device text, browser text, os text, app_version text,
  connection text check (connection in ('online', 'offline')),   -- 'offline' = selling offline, reported when it reconnects
  pending_sales integer not null default 0 check (pending_sales >= 0),
  country text, region text, city text, lat numeric(8,4), lon numeric(8,4)
);

create table public.app_feedback(
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null,
  company_id uuid,
  role text,
  page text check (length(page) <= 200),
  rating smallint check (rating between 1 and 3),     -- 1 unhappy, 2 okay, 3 happy
  message text not null check (length(trim(message)) between 2 and 2000),
  device text,
  status text not null default 'new' check (status in ('new', 'read', 'done'))
);
create index app_feedback_time_idx on public.app_feedback(created_at desc);

alter table public.app_events enable row level security;
alter table public.app_presence enable row level security;
alter table public.app_feedback enable row level security;
revoke all on public.app_events, public.app_presence, public.app_feedback from anon, authenticated;

-- One event (visit or crash). Works signed out too (login page crashes and visits).
create function public.record_app_event(p_kind text, p_company_id uuid, p_page text, p_message text, p_detail text,
  p_device text, p_browser text, p_os text, p_version text, p_country text, p_region text, p_city text, p_lat numeric, p_lon numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); r text; lim integer := case when auth.uid() is null then 300 else 60 end;
begin
  if p_kind not in ('visit', 'error') then raise exception 'Unknown event'; end if;
  -- Keep a misbehaving device from flooding the table.
  if (select count(*) from public.app_events where created_at > now() - interval '10 minutes'
        and ((uid is not null and user_id = uid) or (uid is null and user_id is null and kind = p_kind))) > lim then
    return;
  end if;
  if uid is not null and p_company_id is not null then r := private.member_role(p_company_id); end if;
  insert into public.app_events(kind, user_id, company_id, role, page, message, detail, device, browser, os, app_version, country, region, city, lat, lon)
  values (p_kind, uid, case when r is not null then p_company_id end, r, left(p_page, 200), left(p_message, 500), left(p_detail, 4000),
          left(p_device, 40), left(p_browser, 60), left(p_os, 60), left(p_version, 40), upper(left(p_country, 2)), left(p_region, 80), left(p_city, 80),
          case when p_lat between -90 and 90 then p_lat end, case when p_lon between -180 and 180 then p_lon end);
end $$;

-- "I'm here" every minute while iPOS is open, and once on reconnecting after working offline.
create function private.app_heartbeat(p_company_id uuid, p_page text, p_device text, p_browser text, p_os text, p_version text,
  p_connection text, p_pending integer, p_country text, p_region text, p_city text, p_lat numeric, p_lon numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare r text;
begin
  if auth.uid() is null then return; end if;
  if p_company_id is not null then r := private.member_role(p_company_id); end if;
  insert into public.app_presence as p(user_id, company_id, role, page, device, browser, os, app_version, connection, pending_sales, country, region, city, lat, lon)
  values (auth.uid(), case when r is not null then p_company_id end, r, left(p_page, 200), left(p_device, 40), left(p_browser, 60), left(p_os, 60), left(p_version, 40),
          case when p_connection = 'offline' then 'offline' else 'online' end, greatest(0, coalesce(p_pending, 0)),
          upper(left(p_country, 2)), left(p_region, 80), left(p_city, 80),
          case when p_lat between -90 and 90 then p_lat end, case when p_lon between -180 and 180 then p_lon end)
  on conflict (user_id) do update set company_id = excluded.company_id, role = excluded.role, last_seen = now(), page = excluded.page,
    device = excluded.device, browser = excluded.browser, os = excluded.os, app_version = excluded.app_version, connection = excluded.connection,
    pending_sales = excluded.pending_sales,
    country = coalesce(excluded.country, p.country), region = coalesce(excluded.region, p.region), city = coalesce(excluded.city, p.city),
    lat = coalesce(excluded.lat, p.lat), lon = coalesce(excluded.lon, p.lon);
end $$;

create function private.submit_feedback(p_company_id uuid, p_page text, p_rating integer, p_message text, p_device text)
returns void language plpgsql security definer set search_path = '' as $$
declare r text;
begin
  if auth.uid() is null then raise exception 'Sign in to send feedback'; end if;
  if length(trim(coalesce(p_message, ''))) < 2 then raise exception 'Write a short message first'; end if;
  if (select count(*) from public.app_feedback where user_id = auth.uid() and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Thanks! You have sent a lot of feedback this hour — please try again later.';
  end if;
  if p_company_id is not null then r := private.member_role(p_company_id); end if;
  insert into public.app_feedback(user_id, company_id, role, page, rating, message, device)
  values (auth.uid(), case when r is not null then p_company_id end, r, left(p_page, 200), case when p_rating between 1 and 3 then p_rating end, left(trim(p_message), 2000), left(p_device, 40));
end $$;

-- ---------------------------------------------------------------- creator reports
create function private.creator_guard() returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_creator() then raise exception 'Not allowed'; end if;
end $$;

create function private.creator_check() returns boolean language sql stable security definer set search_path = '' as $$ select private.is_creator() $$;

create function private.creator_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.creator_guard();
  return jsonb_build_object(
    'shops', coalesce((select jsonb_agg(s order by s->>'created_at' desc) from (
      select jsonb_build_object(
        'id', c.id, 'name', c.name, 'currency', c.currency,
        'created_at', (select min(u.created_at) from public.company_users cu join auth.users u on u.id = cu.user_id where cu.company_id = c.id and cu.role = 'director'),
        'owner_email', (select u.email from public.company_users cu join auth.users u on u.id = cu.user_id where cu.company_id = c.id and cu.role = 'director' order by u.created_at limit 1),
        'owner_verified', (select u.email_confirmed_at is not null from public.company_users cu join auth.users u on u.id = cu.user_id where cu.company_id = c.id and cu.role = 'director' order by u.created_at limit 1),
        'last_sign_in', (select max(u.last_sign_in_at) from public.company_users cu join auth.users u on u.id = cu.user_id where cu.company_id = c.id),
        'staff', (select count(*) from public.company_users cu where cu.company_id = c.id and cu.active),
        'branches', (select count(*) from public.branches b where b.company_id = c.id),
        'products', (select count(*) from public.products p where p.company_id = c.id),
        'sales_30d', (select count(*) from public.sales x where x.company_id = c.id and x.created_at > now() - interval '30 days'),
        'revenue_30d', (select coalesce(sum(x.total), 0) from public.sales x where x.company_id = c.id and x.created_at > now() - interval '30 days'),
        'last_sale', (select max(x.created_at) from public.sales x where x.company_id = c.id)
      ) s from public.companies c) t), '[]'::jsonb),
    'users', coalesce((select jsonb_agg(x order by x->>'created_at' desc) from (
      select jsonb_build_object(
        'id', u.id, 'email', u.email, 'name', (select full_name from public.profiles p where p.id = u.id),
        'verified', u.email_confirmed_at is not null, 'created_at', u.created_at, 'last_sign_in', u.last_sign_in_at,
        'shops', coalesce((select jsonb_agg(jsonb_build_object('name', c.name, 'role', cu.role, 'active', cu.active)) from public.company_users cu join public.companies c on c.id = cu.company_id where cu.user_id = u.id), '[]'::jsonb)
      ) x from auth.users u) t), '[]'::jsonb)
  );
end $$;

create function private.creator_events(p_days integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.creator_guard();
  return coalesce((select jsonb_agg(to_jsonb(e) || jsonb_build_object(
      'email', (select u.email from auth.users u where u.id = e.user_id),
      'shop', (select c.name from public.companies c where c.id = e.company_id)) order by e.created_at desc)
    from (select * from public.app_events where created_at > now() - make_interval(days => least(greatest(p_days, 1), 90)) order by created_at desc limit 10000) e), '[]'::jsonb);
end $$;

create function private.creator_presence() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.creator_guard();
  return coalesce((select jsonb_agg(to_jsonb(p) || jsonb_build_object(
      'email', u.email, 'name', (select full_name from public.profiles f where f.id = p.user_id),
      'shop', (select c.name from public.companies c where c.id = p.company_id)) order by p.last_seen desc)
    from public.app_presence p left join auth.users u on u.id = p.user_id), '[]'::jsonb);
end $$;

create function private.creator_feedback() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.creator_guard();
  return coalesce((select jsonb_agg(to_jsonb(f) || jsonb_build_object(
      'email', (select u.email from auth.users u where u.id = f.user_id),
      'name', (select full_name from public.profiles p where p.id = f.user_id),
      'shop', (select c.name from public.companies c where c.id = f.company_id)) order by f.created_at desc)
    from (select * from public.app_feedback order by created_at desc limit 1000) f), '[]'::jsonb);
end $$;

create function private.creator_set_feedback(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.creator_guard();
  if p_status not in ('new', 'read', 'done') then raise exception 'Unknown status'; end if;
  update public.app_feedback set status = p_status where id = p_id;
end $$;

-- ---------------------------------------------------------------- API wrappers
create function public.app_heartbeat(p_company_id uuid, p_page text, p_device text, p_browser text, p_os text, p_version text, p_connection text, p_pending integer, p_country text, p_region text, p_city text, p_lat numeric, p_lon numeric)
returns void language sql set search_path = '' as $$ select private.app_heartbeat(p_company_id, p_page, p_device, p_browser, p_os, p_version, p_connection, p_pending, p_country, p_region, p_city, p_lat, p_lon) $$;
create function public.submit_feedback(p_company_id uuid, p_page text, p_rating integer, p_message text, p_device text)
returns void language sql set search_path = '' as $$ select private.submit_feedback(p_company_id, p_page, p_rating, p_message, p_device) $$;
create function public.creator_check() returns boolean language sql stable set search_path = '' as $$ select private.creator_check() $$;
create function public.creator_overview() returns jsonb language sql stable set search_path = '' as $$ select private.creator_overview() $$;
create function public.creator_events(p_days integer) returns jsonb language sql stable set search_path = '' as $$ select private.creator_events(p_days) $$;
create function public.creator_presence() returns jsonb language sql stable set search_path = '' as $$ select private.creator_presence() $$;
create function public.creator_feedback() returns jsonb language sql stable set search_path = '' as $$ select private.creator_feedback() $$;
create function public.creator_set_feedback(p_id uuid, p_status text) returns void language sql set search_path = '' as $$ select private.creator_set_feedback(p_id, p_status) $$;

do $grants$
declare f text;
begin
  foreach f in array array[
    'private.app_heartbeat(uuid,text,text,text,text,text,text,integer,text,text,text,numeric,numeric)', 'private.submit_feedback(uuid,text,integer,text,text)',
    'private.creator_check()', 'private.creator_overview()', 'private.creator_events(integer)', 'private.creator_presence()', 'private.creator_feedback()', 'private.creator_set_feedback(uuid,text)',
    'public.app_heartbeat(uuid,text,text,text,text,text,text,integer,text,text,text,numeric,numeric)', 'public.submit_feedback(uuid,text,integer,text,text)',
    'public.creator_check()', 'public.creator_overview()', 'public.creator_events(integer)', 'public.creator_presence()', 'public.creator_feedback()', 'public.creator_set_feedback(uuid,text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array['private.is_creator()', 'private.creator_guard()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  revoke all on function public.record_app_event(text,uuid,text,text,text,text,text,text,text,text,text,text,numeric,numeric) from public;
  grant execute on function public.record_app_event(text,uuid,text,text,text,text,text,text,text,text,text,text,numeric,numeric) to anon, authenticated;
end $grants$;
