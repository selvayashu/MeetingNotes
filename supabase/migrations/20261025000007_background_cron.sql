-- Turns on background processing: every minute, ask the site to continue any unfinished meeting.
-- Needs the "process_url" row in app_config and the "meetnotes_cron_secret" secret in Vault (see README);
-- without them kick_processing() does nothing, so this migration is safe to apply first.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create or replace function public.kick_processing() returns integer
language plpgsql security definer set search_path = public as $$
declare
  target_url text;
  cron_secret text;
  m record;
  kicked integer := 0;
begin
  select value into target_url from public.app_config where key = 'process_url';
  select decrypted_secret into cron_secret from vault.decrypted_secrets where name = 'meetnotes_cron_secret';
  if target_url is null or cron_secret is null then
    return 0;
  end if;

  for m in select id from public.pending_processing_ids(3) loop
    update public.meetings set auto_attempts = auto_attempts + 1 where id = m.id;
    -- Asynchronous: pg_net sends the request in the background. Each call may run up to ~60 s on the site.
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

-- Idempotent schedule: replace any earlier job of the same name.
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'meetnotes-process-pending';
  perform cron.schedule('meetnotes-process-pending', '* * * * *', 'select public.kick_processing()');
end $$;
