-- Calls the send-reminders Edge Function every 5 minutes.
-- The project URL is read from Vault, where it is stored once during setup
-- (see docs/CONFIGURAZIONE.md), so this file works for any project.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'send-reminders',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/send-reminders',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  )
  $$
);

-- Keep the de-duplication table small: a reminder key only matters for a few days.
select cron.schedule(
  'cleanup-sent-reminders',
  '17 3 * * *',
  $$ delete from public.sent_reminders where sent_at < now() - interval '7 days' $$
);
