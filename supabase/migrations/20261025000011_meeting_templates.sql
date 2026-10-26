-- Meeting types ("templates"): the person picks what kind of meeting it was, and the notes are written with that
-- focus (a stand-up is summarised per person, a client call around commitments, and so on).

alter table public.meetings
  add column template text not null default 'general'
    check (template in ('general', 'standup', 'one_on_one', 'client_call', 'interview', 'brainstorm'));

-- The owner can change it later (then ask for the notes to be rewritten). Processing columns stay server-only.
grant update (template) on public.meetings to authenticated;

-- Which type the current notes were written with, so the app can tell when the type was changed afterwards.
-- null = written before templates existed (general). Only the server writes it.
alter table public.meeting_notes add column notes_template text;
