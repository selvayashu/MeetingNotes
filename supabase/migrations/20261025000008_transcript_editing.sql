-- Transcript editing: users can correct what Whisper heard. The original text is kept so an edit can be undone,
-- and so we can see how much was wrong.

alter table public.transcript_segments
  add column original_text text,        -- Whisper's text, set automatically on the first edit; null = never edited
  add column edited_at timestamptz;

-- When the current summary/decisions/action items were produced. Edits newer than this mean the notes are stale.
alter table public.meeting_notes add column generated_at timestamptz;
update public.meeting_notes set generated_at = created_at where summary <> '';

-- Everything about an edit that matters is decided here, not in the browser.
create function public.track_segment_edit() returns trigger
language plpgsql as $$
begin
  -- Users may only change the words. Times and ownership are fixed.
  new.meeting_id := old.meeting_id;
  new.start_ms := old.start_ms;
  new.end_ms := old.end_ms;

  if new.text is distinct from old.text then
    if btrim(new.text) = '' then
      raise exception 'a transcript line cannot be empty' using errcode = '23514';
    end if;
    if char_length(new.text) > 4000 then
      raise exception 'a transcript line is limited to 4000 characters' using errcode = '23514';
    end if;
    new.original_text := coalesce(old.original_text, old.text);
    if new.text = new.original_text then
      new.original_text := null;   -- restored to what Whisper wrote: no longer "edited"
      new.edited_at := null;
    else
      new.edited_at := now();
    end if;
  else
    new.original_text := old.original_text;   -- the audit fields cannot be set directly
    new.edited_at := old.edited_at;
  end if;
  return new;
end;
$$;

create trigger transcript_segment_edit
  before update on public.transcript_segments
  for each row execute function public.track_segment_edit();

-- Defence in depth: users can update only the words of a line, and only the summary/decisions of the notes.
revoke update on public.transcript_segments from authenticated;
grant update (text) on public.transcript_segments to authenticated;
revoke update on public.meeting_notes from authenticated;
grant update (summary, decisions) on public.meeting_notes to authenticated;

-- The scheduler should also continue a notes-only regeneration for a meeting whose audio was already deleted.
create or replace function public.pending_processing_ids(max_rows integer default 3)
returns table (id uuid)
language sql stable security definer set search_path = public as $$
  select m.id
  from public.meetings m
  join public.profiles p on p.id = m.user_id and p.status = 'approved'
  where m.status in ('uploaded', 'transcribing', 'summarising')
    and (jsonb_array_length(m.audio_parts) > 0 or m.processed_parts > 0)  -- audio present, or already transcribed
    and (m.lock_until is null or m.lock_until < now())
    and m.auto_attempts < 40
    and m.created_at > now() - interval '7 days'
    and (m.status <> 'uploaded' or m.created_at < now() - interval '45 seconds')
  order by m.created_at
  limit greatest(1, least(max_rows, 10))
$$;
revoke all on function public.pending_processing_ids(integer) from public, anon, authenticated;
