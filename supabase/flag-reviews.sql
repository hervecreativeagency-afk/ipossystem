-- Mistake & fraud checks: the owner's decision on each flag.
--
-- Flags themselves are worked out in the app from sales, refunds, shifts and
-- stock adjustments (src/flag-utils.js). This table only remembers what the
-- director decided about each one, so every device sees the same list.
-- flag_key is stable, e.g. 'short:<shift id>' or 'discount:<sale id>'.

create table public.flag_reviews(
  company_id uuid not null references public.companies(id),
  flag_key text not null check (length(flag_key) between 3 and 200),
  status text not null check (status in ('open', 'investigating', 'ok')),
  note text check (note is null or length(note) <= 500),
  reviewed_by uuid not null,
  reviewed_name text,
  reviewed_at timestamptz not null default now(),
  primary key (company_id, flag_key)
);

alter table public.flag_reviews enable row level security;
revoke all on public.flag_reviews from anon, authenticated;
grant select on public.flag_reviews to authenticated;
create policy flag_review_read on public.flag_reviews for select to authenticated using (private.member_role(company_id) = 'director');

create function private.review_flag(p_company_id uuid, p_flag_key text, p_status text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or private.member_role(p_company_id) is distinct from 'director' then raise exception 'Only a director can review checks'; end if;
  if p_status not in ('open', 'investigating', 'ok') then raise exception 'Unknown status'; end if;
  insert into public.flag_reviews(company_id, flag_key, status, note, reviewed_by, reviewed_name)
  values (p_company_id, p_flag_key, p_status, nullif(trim(p_note), ''), auth.uid(),
          (select nullif(trim(full_name), '') from public.profiles where id = auth.uid()))
  on conflict (company_id, flag_key) do update
    set status = excluded.status, note = excluded.note, reviewed_by = excluded.reviewed_by,
        reviewed_name = excluded.reviewed_name, reviewed_at = now();
end $$;

create function public.review_flag(p_company_id uuid, p_flag_key text, p_status text, p_note text) returns void
language sql set search_path = '' as $$ select private.review_flag(p_company_id, p_flag_key, p_status, p_note) $$;

revoke all on function private.review_flag(uuid, text, text, text) from public, anon;
grant execute on function private.review_flag(uuid, text, text, text) to authenticated;
revoke all on function public.review_flag(uuid, text, text, text) from public, anon;
grant execute on function public.review_flag(uuid, text, text, text) to authenticated;
