-- Hindi transcripts get an automatic spelling clean-up after Whisper (see functions/lib/fixText.ts).
-- The corrected text goes in `text`; Whisper's own words are kept here for lines that were changed (null = untouched).
-- Only the server writes it: users can already update just `text` (migration 8).
alter table public.transcript_segments add column asr_text text;
