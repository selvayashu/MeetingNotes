-- Recording consent: the app asks the person recording to confirm, per recording, that everyone who can be
-- heard has been told and agrees (or that they are otherwise allowed to record). That confirmation is stored on
-- the meeting as an audit trail. It is the user's own attestation, not proof of anyone else's consent.

alter table public.meetings
  add column consent_confirmed boolean not null default false,
  add column consent_confirmed_at timestamptz,
  add column consent_version text;   -- which wording of the confirmation was shown, e.g. 'v1'

-- The time is set by the database, and none of the three fields can change after the meeting is created.
create function public.stamp_recording_consent() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.consent_confirmed_at := case when new.consent_confirmed then now() end;
    new.consent_version := case when new.consent_confirmed then new.consent_version end;
  else
    new.consent_confirmed := old.consent_confirmed;
    new.consent_confirmed_at := old.consent_confirmed_at;
    new.consent_version := old.consent_version;
  end if;
  return new;
end;
$$;

create trigger meetings_recording_consent
  before insert or update on public.meetings
  for each row execute function public.stamp_recording_consent();
