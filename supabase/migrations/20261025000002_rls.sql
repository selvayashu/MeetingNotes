-- Row Level Security on every table. Child tables are checked through the parent meeting.

alter table public.profiles enable row level security;
alter table public.meetings enable row level security;
alter table public.transcript_segments enable row level security;
alter table public.meeting_notes enable row level security;
alter table public.action_items enable row level security;

create policy "profiles: own row" on public.profiles
  for all to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "meetings: own rows" on public.meetings
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "transcript_segments: via meeting" on public.transcript_segments
  for all to authenticated
  using (exists (select 1 from public.meetings m
                 where m.id = meeting_id and m.user_id = (select auth.uid())))
  with check (exists (select 1 from public.meetings m
                      where m.id = meeting_id and m.user_id = (select auth.uid())));

create policy "meeting_notes: via meeting" on public.meeting_notes
  for all to authenticated
  using (exists (select 1 from public.meetings m
                 where m.id = meeting_id and m.user_id = (select auth.uid())))
  with check (exists (select 1 from public.meetings m
                      where m.id = meeting_id and m.user_id = (select auth.uid())));

create policy "action_items: via meeting" on public.action_items
  for all to authenticated
  using (exists (select 1 from public.meetings m
                 where m.id = meeting_id and m.user_id = (select auth.uid())))
  with check (exists (select 1 from public.meetings m
                      where m.id = meeting_id and m.user_id = (select auth.uid())));

-- Anonymous visitors get nothing; the service role (Pages Function) bypasses RLS.
revoke all on public.profiles, public.meetings, public.transcript_segments,
  public.meeting_notes, public.action_items from anon;
