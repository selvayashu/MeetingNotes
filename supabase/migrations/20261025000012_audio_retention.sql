-- Audio retention: a person can ask for their recordings to be deleted automatically some days after the meeting.
-- Transcripts, notes and action items are kept; only the audio goes. null = keep audio until deleted by hand.

alter table public.profiles
  add column audio_retention_days integer
    check (audio_retention_days is null or audio_retention_days in (7, 30, 90));

grant update (audio_retention_days) on public.profiles to authenticated;

-- Finished meetings whose audio is past its owner's retention period. Unfinished meetings are never listed:
-- processing still needs their audio. Called by the retention endpoint (service role) only.
create function public.audio_expired(max_rows integer default 100)
returns table (id uuid, user_id uuid, audio_parts jsonb)
language sql stable security definer set search_path = public as $$
  select m.id, m.user_id, m.audio_parts
  from public.meetings m
  join public.profiles p on p.id = m.user_id
  where p.audio_retention_days is not null
    and m.status = 'done'
    and jsonb_array_length(m.audio_parts) > 0
    and m.created_at < now() - make_interval(days => p.audio_retention_days)
  order by m.created_at
  limit greatest(1, least(max_rows, 500))
$$;

revoke all on function public.audio_expired(integer) from public, anon, authenticated;
