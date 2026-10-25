-- Background processing: let the database keep unfinished meetings moving after the user closes the tab.
-- This migration only adds the pieces; migration 7 turns on the schedule.

-- How many times the scheduler has already poked a meeting; capped so a stuck one is not retried forever.
alter table public.meetings add column auto_attempts integer not null default 0;

-- Private key/value settings (e.g. the URL of /api/process-meeting). RLS on with no policies and no grants:
-- readable only by the database owner and by SECURITY DEFINER functions below.
create table public.app_config (key text primary key, value text not null);
alter table public.app_config enable row level security;
revoke all on public.app_config from anon, authenticated;

-- Meetings that still need work and that nobody is working on right now.
create function public.pending_processing_ids(max_rows integer default 3)
returns table (id uuid)
language sql stable security definer set search_path = public as $$
  select m.id
  from public.meetings m
  join public.profiles p on p.id = m.user_id and p.status = 'approved'   -- never work for unapproved users
  where m.status in ('uploaded', 'transcribing', 'summarising')           -- 'failed' waits for a manual Retry
    and jsonb_array_length(m.audio_parts) > 0
    and (m.lock_until is null or m.lock_until < now())                    -- not currently being processed
    and m.auto_attempts < 40
    and m.created_at > now() - interval '7 days'
    -- give the user's open tab a head start with a fresh upload; the scheduler is the safety net
    and (m.status <> 'uploaded' or m.created_at < now() - interval '45 seconds')
  order by m.created_at
  limit greatest(1, least(max_rows, 10))
$$;

revoke all on function public.pending_processing_ids(integer) from public, anon, authenticated;
