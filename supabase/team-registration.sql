begin;
alter table public.companies add column if not exists tpin text;
alter table public.companies add column if not exists registration_number text;
alter table public.companies add column if not exists logo_url text;
create table public.staff_invitations(id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),email text not null,full_name text not null,role text not null check(role in ('cashier','supervisor')),invited_by uuid not null references auth.users(id),user_id uuid references auth.users(id),status text not null default 'sending' check(status in ('sending','pending','accepted','failed')),error_message text,created_at timestamptz not null default now(),accepted_at timestamptz);
create unique index one_open_staff_invite on public.staff_invitations(company_id,lower(email)) where status in ('sending','pending');
create index staff_invite_company on public.staff_invitations(company_id,created_at desc);
alter table public.staff_invitations enable row level security;
revoke all on public.staff_invitations from anon,authenticated;
grant select on public.staff_invitations to authenticated;
create policy invitation_director_read on public.staff_invitations for select to authenticated using(private.member_role(company_id)='director');
create policy company_director_update on public.companies for update to authenticated using(private.member_role(id)='director') with check(private.member_role(id)='director');
grant update(name,address,phone,email,currency,tpin,registration_number,logo_url) on public.companies to authenticated;
create function public.accept_my_staff_invites() returns void language plpgsql security definer set search_path='' as $$ begin if auth.uid() is null then raise exception 'Unauthorized';end if;update public.staff_invitations set status='accepted',accepted_at=now() where user_id=auth.uid() and status='pending';end $$;
revoke all on function public.accept_my_staff_invites() from public,anon;
grant execute on function public.accept_my_staff_invites() to authenticated;
create function public.list_store_staff(p_company_id uuid) returns table(user_id uuid,full_name text,email text,role text,active boolean,joined_at timestamptz)
language plpgsql stable security definer set search_path='' as $$ begin
if auth.uid() is null or private.member_role(p_company_id) is distinct from 'director' then raise exception 'Unauthorized access';end if;
return query select cu.user_id,coalesce(p.full_name,u.raw_user_meta_data->>'full_name',u.email)::text,u.email::text,cu.role,cu.active,u.last_sign_in_at from public.company_users cu join auth.users u on u.id=cu.user_id left join public.profiles p on p.id=u.id where cu.company_id=p_company_id order by cu.role,u.email;
end $$;
revoke all on function public.list_store_staff(uuid) from public,anon;
grant execute on function public.list_store_staff(uuid) to authenticated;
-- Company creation always assigns the authenticated creator as director of their NEW company.
-- Existing staff memberships/invitations block this path; no role from user metadata is trusted.
create function public.register_director_company() returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); details jsonb; cid uuid; user_email text; fname text;
begin
 if uid is null then raise exception 'Sign in first';end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,19));
 if exists(select 1 from public.company_users where user_id=uid) then raise exception 'This account already belongs to a store. Staff cannot self-register as directors.';end if;
 select raw_user_meta_data->'director_registration',email into details,user_email from auth.users where id=uid and email_confirmed_at is not null;
 if details is null or jsonb_typeof(details)<>'object' then raise exception 'Confirmed director registration is required';end if;
 if exists(select 1 from public.staff_invitations where lower(email)=lower(user_email) and status in ('sending','pending','accepted')) then raise exception 'Invited staff must activate their invitation';end if;
 if length(trim(coalesce(details->>'company_name','')))<2 or length(trim(coalesce(details->>'full_name','')))<2 or trim(coalesce(details->>'tpin',''))='' or trim(coalesce(details->>'registration_number',''))='' or trim(coalesce(details->>'phone',''))='' or trim(coalesce(details->>'address',''))='' then raise exception 'Complete the required company details';end if;
 if details->>'currency' not in ('ZMW','USD','ZAR','EUR','GBP') or details->>'currency' is null then raise exception 'Invalid currency';end if;
 insert into public.companies(name,tpin,registration_number,phone,address,email,currency,logo_url) values(trim(details->>'company_name'),trim(details->>'tpin'),trim(details->>'registration_number'),trim(details->>'phone'),trim(details->>'address'),user_email,details->>'currency',nullif(details->>'logo_url','')) returning id into cid;
 insert into public.profiles(id,full_name) values(uid,trim(details->>'full_name')) on conflict(id) do update set full_name=excluded.full_name;
 insert into public.company_users(company_id,user_id,role,active) values(cid,uid,'director',true);
 return cid;
end $$;
revoke all on function public.register_director_company() from public,anon;
grant execute on function public.register_director_company() to authenticated;
commit;
