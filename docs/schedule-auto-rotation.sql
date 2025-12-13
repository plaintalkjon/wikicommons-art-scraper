-- Schedule automatic artist rotation - 4 times per day
-- This single set of cron jobs will automatically cycle through all active artists

-- No artist parameter needed! The function will automatically pick the next artist
-- from the mastodon_accounts table based on who hasn't posted recently.

-- 12:00 AM UTC
SELECT cron.schedule(
  'auto-post-art-12am',
  '0 0 * * *',
  $$
  SELECT net.http_post(
    url := 'https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/post-art',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4dGtwd3N4dXB6a3h1aGhtdnZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUxMTY2OTQsImV4cCI6MjA4MDY5MjY5NH0.TpaMU7-7-U7BSyjqPkfiGjpHFB6qVt1dMUxG5KFptR8'
    )
  ) as request_id;
  $$
);

-- 6:00 AM UTC
SELECT cron.schedule(
  'auto-post-art-6am',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/post-art',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4dGtwd3N4dXB6a3h1aGhtdnZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUxMTY2OTQsImV4cCI6MjA4MDY5MjY5NH0.TpaMU7-7-U7BSyjqPkfiGjpHFB6qVt1dMUxG5KFptR8'
    )
  ) as request_id;
  $$
);

-- 12:00 PM UTC
SELECT cron.schedule(
  'auto-post-art-12pm',
  '0 12 * * *',
  $$
  SELECT net.http_post(
    url := 'https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/post-art',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4dGtwd3N4dXB6a3h1aGhtdnZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUxMTY2OTQsImV4cCI6MjA4MDY5MjY5NH0.TpaMU7-7-U7BSyjqPkfiGjpHFB6qVt1dMUxG5KFptR8'
    )
  ) as request_id;
  $$
);

-- 6:00 PM UTC
SELECT cron.schedule(
  'auto-post-art-6pm',
  '0 18 * * *',
  $$
  SELECT net.http_post(
    url := 'https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/post-art',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4dGtwd3N4dXB6a3h1aGhtdnZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUxMTY2OTQsImV4cCI6MjA4MDY5MjY5NH0.TpaMU7-7-U7BSyjqPkfiGjpHFB6qVt1dMUxG5KFptR8'
    )
  ) as request_id;
  $$
);

-- To verify the schedule:
-- SELECT * FROM cron.job WHERE jobname LIKE 'auto-post-art%';

-- To remove the schedule:
-- SELECT cron.unschedule('auto-post-art-12am');
-- SELECT cron.unschedule('auto-post-art-6am');
-- SELECT cron.unschedule('auto-post-art-12pm');
-- SELECT cron.unschedule('auto-post-art-6pm');

