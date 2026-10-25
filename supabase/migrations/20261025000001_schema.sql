-- MeetNotes core schema

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  preferred_language text not null default 'en' check (preferred_language in ('en', 'hi', 'ta')),
  delete_audio_after_notes boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'Untitled meeting',
  meeting_date timestamptz not null default now(),
  language text not null default 'auto' check (language in ('en', 'hi', 'ta', 'auto')),
  notes_language text not null default 'en' check (notes_language in ('en', 'hi', 'ta', 'auto')),
  duration_seconds integer check (duration_seconds >= 0),
  audio_path text,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'transcribing', 'summarising', 'done', 'failed')),
  error_message text,
  created_at timestamptz not null default now()
);
create index meetings_user_date_idx on public.meetings (user_id, meeting_date desc);

create table public.transcript_segments (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  start_ms integer not null,
  end_ms integer not null,
  speaker_label text,
  text text not null
);
create index transcript_segments_meeting_idx on public.transcript_segments (meeting_id, start_ms);

create table public.meeting_notes (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null unique references public.meetings (id) on delete cascade,
  summary text not null default '',
  decisions jsonb not null default '[]'::jsonb,
  raw_llm_output jsonb,
  created_at timestamptz not null default now()
);

create table public.action_items (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  task text not null,
  owner text,
  due_date date,
  is_done boolean not null default false
);
create index action_items_meeting_idx on public.action_items (meeting_id);

-- Create a profile automatically when a user signs up (email OTP or Google).
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
