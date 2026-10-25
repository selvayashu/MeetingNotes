-- Admin approval: new sign-ups start as "pending" and can use nothing until an admin approves them.
-- Enforcement lives in the database (restrictive RLS) and in /api/process-meeting, not just the UI.

alter table public.profiles
  add column status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  add column is_admin boolean not null default false,
  add column decided_at timestamptz;

-- Accounts that already exist when this migration runs keep working.
update public.profiles set status = 'approved', decided_at = now();

-- Emails listed here become approved admins automatically on sign-up (bootstraps the first admin).
-- RLS is on with no policies, so only the service role / postgres can read or change it.
create table public.admin_emails (email text primary key check (email = lower(email)));
alter table public.admin_emails enable row level security;
revoke all on public.admin_emails from anon, authenticated;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  is_boot_admin boolean := exists (select 1 from public.admin_emails a where a.email = lower(new.email));
begin
  insert into public.profiles (id, full_name, status, is_admin, decided_at)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    case when is_boot_admin then 'approved' else 'pending' end,
    is_boot_admin,
    case when is_boot_admin then now() end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- SECURITY DEFINER so policies can ask "is this user approved?" without being blocked by profiles' own RLS.
create function public.is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and status = 'approved')
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and status = 'approved' and is_admin
  )
$$;

-- Profiles: users may read their own row and edit only their preferences. They can no longer
-- insert, delete, or touch status / is_admin (the old "for all" policy allowed that).
drop policy "profiles: own row" on public.profiles;
create policy "profiles: read own" on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy "profiles: update own" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
revoke insert, update, delete on public.profiles from authenticated;
grant update (full_name, preferred_language, delete_audio_after_notes) on public.profiles to authenticated;

-- RESTRICTIVE policies are AND-ed with the existing per-user policies: owning a row is not enough,
-- the owner must also be approved.
create policy "require approval" on public.meetings as restrictive for all to authenticated
  using (public.is_approved()) with check (public.is_approved());
create policy "require approval" on public.transcript_segments as restrictive for all to authenticated
  using (public.is_approved()) with check (public.is_approved());
create policy "require approval" on public.meeting_notes as restrictive for all to authenticated
  using (public.is_approved()) with check (public.is_approved());
create policy "require approval" on public.action_items as restrictive for all to authenticated
  using (public.is_approved()) with check (public.is_approved());
create policy "recordings: require approval" on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'recordings' or public.is_approved())
  with check (bucket_id <> 'recordings' or public.is_approved());

-- Admin operations go through functions that check is_admin() themselves.
create function public.admin_list_users()
returns table (id uuid, email text, full_name text, status text, is_admin boolean,
               created_at timestamptz, decided_at timestamptz)
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
    select p.id, u.email::text, p.full_name, p.status, p.is_admin, p.created_at, p.decided_at
    from public.profiles p join auth.users u on u.id = p.id
    order by (p.status = 'pending') desc, p.created_at desc;
end;
$$;

create function public.admin_set_status(target uuid, new_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if new_status not in ('pending', 'approved', 'rejected') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  if target = (select auth.uid()) then
    raise exception 'you cannot change your own status' using errcode = '22023';
  end if;
  update public.profiles set status = new_status, decided_at = now() where id = target;
end;
$$;

revoke all on function public.is_approved(), public.is_admin(), public.admin_list_users(),
  public.admin_set_status(uuid, text) from public, anon;
grant execute on function public.is_approved(), public.is_admin(), public.admin_list_users(),
  public.admin_set_status(uuid, text) to authenticated;
