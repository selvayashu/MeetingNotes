-- Daily at 03:17 UTC, ask the site to delete audio that is past its owner's retention period.
-- Needs the "retention_url" row in app_config and the same Vault secret as background processing;
-- without them it does nothing, so this migration is safe to apply first.

create or replace function public.kick_retention() returns integer
language plpgsql security definer set search_path = public as $$
declare
  target_url text;
  cron_secret text;
begin
  select value into target_url from public.app_config where key = 'retention_url';
  select decrypted_secret into cron_secret from vault.decrypted_secrets where name = 'meetnotes_cron_secret';
  if target_url is null or cron_secret is null then
    return 0;
  end if;
  perform net.http_post(
    url := target_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', cron_secret),
    timeout_milliseconds := 110000
  );
  return 1;
end;
$$;

revoke all on function public.kick_retention() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'meetnotes-audio-retention';
  perform cron.schedule('meetnotes-audio-retention', '17 3 * * *', 'select public.kick_retention()');
end $$;
