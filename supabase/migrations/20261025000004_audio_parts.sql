-- Recordings are stored as one or more self-contained audio parts (~5 min each for
-- in-browser recordings) so transcription can run in bounded steps.
-- audio_parts: [{ "path": "<uid>/<meeting>/000.webm", "duration_seconds": 300, "mime": "audio/webm" }, ...]
alter table public.meetings
  add column audio_parts jsonb not null default '[]'::jsonb,
  add column processed_parts integer not null default 0,
  add column processing_started_at timestamptz,
  -- Short-lived lock so two concurrent /api/process-meeting calls can't work on the same meeting.
  add column lock_until timestamptz;

-- Used for the per-user daily rate limit in /api/process-meeting.
create index meetings_user_processing_idx
  on public.meetings (user_id, processing_started_at)
  where processing_started_at is not null;

-- Processing state belongs to the Pages Function (service role). A table-level UPDATE grant
-- would make column revokes a no-op, so revoke it and re-grant only user-editable columns.
revoke update on public.meetings from authenticated;
grant update (title, meeting_date, language, notes_language) on public.meetings to authenticated;
