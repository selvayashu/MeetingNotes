-- AI usage metering and a daily spend cap.
-- Workers AI bills in "neurons"; the free plan includes 10,000 per day (resetting at 00:00 UTC) for the whole account.
-- Every AI call made while processing a meeting is recorded here, and processing pauses once the day's total reaches
-- a cap an admin can set, so a busy day or a misbehaving client can't run into charges.

create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid references auth.users (id) on delete set null,   -- keep the totals if the user is deleted
  meeting_id uuid,                                              -- no foreign key: history outlives the meeting
  kind text not null check (kind in ('transcribe', 'notes')),
  model text,
  calls integer not null default 1,
  audio_seconds numeric not null default 0,
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  neurons numeric not null default 0,
  estimated boolean not null default false                       -- true when Cloudflare didn't report neurons and we calculated them
);
create index ai_usage_created_idx on public.ai_usage (created_at);
create index ai_usage_user_idx on public.ai_usage (user_id, created_at);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;   -- only the service role and SECURITY DEFINER functions touch it

-- Settings (visible only to the database owner and the functions below).
insert into public.app_config (key, value) values
  ('ai_daily_neuron_cap', '8000'),     -- 0 turns the cap off
  ('ai_free_neurons', '10000')         -- the free allowance, used only to estimate overage cost on the admin page
on conflict (key) do nothing;

create function public.utc_day_start() returns timestamptz
language sql stable as $$ select date_trunc('day', now() at time zone 'utc') at time zone 'utc' $$;

-- Used by the Pages Function (service role) before doing AI work.
create function public.ai_cap_status() returns table (used numeric, cap numeric, reached boolean)
language sql stable security definer set search_path = public as $$
  with c as (select coalesce((select value::numeric from public.app_config where key = 'ai_daily_neuron_cap'), 8000) as cap),
       u as (select coalesce(sum(neurons), 0) as used from public.ai_usage where created_at >= public.utc_day_start())
  select u.used, c.cap, (c.cap > 0 and u.used >= c.cap) from c, u
$$;
revoke all on function public.ai_cap_status() from public, anon, authenticated;
revoke all on function public.utc_day_start() from public, anon;

-- The scheduler must not start new work once the day's cap is reached.
create or replace function public.kick_processing() returns integer
language plpgsql security definer set search_path = public as $$
declare
  target_url text;
  cron_secret text;
  m record;
  kicked integer := 0;
begin
  if (select reached from public.ai_cap_status()) then
    return 0;
  end if;
  select value into target_url from public.app_config where key = 'process_url';
  select decrypted_secret into cron_secret from vault.decrypted_secrets where name = 'meetnotes_cron_secret';
  if target_url is null or cron_secret is null then
    return 0;
  end if;

  for m in select id from public.pending_processing_ids(3) loop
    update public.meetings set auto_attempts = auto_attempts + 1 where id = m.id;
    perform net.http_post(
      url := target_url,
      body := jsonb_build_object('meetingId', m.id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', cron_secret),
      timeout_milliseconds := 110000
    );
    kicked := kicked + 1;
  end loop;
  return kicked;
end;
$$;
revoke all on function public.kick_processing() from public, anon, authenticated;

-- ---------- admin-only views of the data ----------

create function public.admin_ai_overview()
returns table (used numeric, cap numeric, reached boolean, free_allowance numeric, day_start timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  return query
    select s.used, s.cap, s.reached,
           coalesce((select value::numeric from public.app_config where key = 'ai_free_neurons'), 10000),
           public.utc_day_start()
    from public.ai_cap_status() s;
end;
$$;

create function public.admin_usage_daily(days integer default 14)
returns table (day date, neurons numeric, audio_minutes numeric, meetings bigint, calls bigint)
language plpgsql security definer set search_path = public as $$
declare n integer := greatest(1, least(coalesce(days, 14), 90));
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  return query
    select d::date,
           coalesce(sum(u.neurons), 0),
           coalesce(round(sum(u.audio_seconds) / 60.0, 1), 0),
           count(distinct u.meeting_id),
           coalesce(sum(u.calls), 0)::bigint
    from generate_series((now() at time zone 'utc')::date - (n - 1), (now() at time zone 'utc')::date, interval '1 day') d
    left join public.ai_usage u on (u.created_at at time zone 'utc')::date = d::date
    group by d order by d desc;
end;
$$;

create function public.admin_usage_by_user(days integer default 7)
returns table (user_id uuid, email text, full_name text, neurons numeric, audio_minutes numeric, meetings bigint)
language plpgsql security definer set search_path = public, auth as $$
declare n integer := greatest(1, least(coalesce(days, 7), 90));
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  return query
    select u.user_id, usr.email::text, p.full_name,
           sum(u.neurons), round(sum(u.audio_seconds) / 60.0, 1), count(distinct u.meeting_id)
    from public.ai_usage u
    left join auth.users usr on usr.id = u.user_id
    left join public.profiles p on p.id = u.user_id
    where u.created_at >= (public.utc_day_start() - make_interval(days => n - 1))
    group by u.user_id, usr.email, p.full_name
    order by sum(u.neurons) desc
    limit 50;
end;
$$;

create function public.admin_set_ai_cap(new_cap integer) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  if new_cap is null or new_cap < 0 or new_cap > 1000000 then
    raise exception 'cap must be between 0 and 1,000,000 (0 turns it off)' using errcode = '22023';
  end if;
  insert into public.app_config (key, value) values ('ai_daily_neuron_cap', new_cap::text)
    on conflict (key) do update set value = excluded.value;
end;
$$;

revoke all on function public.admin_ai_overview(), public.admin_usage_daily(integer),
  public.admin_usage_by_user(integer), public.admin_set_ai_cap(integer) from public, anon;
grant execute on function public.admin_ai_overview(), public.admin_usage_daily(integer),
  public.admin_usage_by_user(integer), public.admin_set_ai_cap(integer) to authenticated;
