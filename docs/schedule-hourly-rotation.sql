-- Interval-based rotation - each account posts on its own schedule
-- The Edge Function now enforces per-account intervals using last_posted_at.
-- Default: interval_hours=6 ⇒ ~4 posts per account per day, regardless of account count.

-- This creates a single cron job that runs every 10 minutes.
-- On each run, the function selects only the accounts that are "due"
-- (last_posted_at is at least interval_hours old, or never posted).

-- Create a single cron job that runs every 10 minutes
DO $$
BEGIN
  PERFORM cron.schedule(
    'auto-post-art-every-10-min',
    '*/10 * * * *',  -- Every 10 minutes
    $cmd$
    SELECT net.http_post(
      url := 'https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/post-art?interval_hours=6&max_accounts=10',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4dGtwd3N4dXB6a3h1aGhtdnZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUxMTY2OTQsImV4cCI6MjA4MDY5MjY5NH0.TpaMU7-7-U7BSyjqPkfiGjpHFB6qVt1dMUxG5KFptR8'
      )
    );
    $cmd$
  );
END $$;

-- You can adjust:
-- - interval_hours   ⇒ how often each account should post (e.g. 4 ⇒ ~6 posts/day, 8 ⇒ ~3 posts/day)
-- - max_accounts     ⇒ upper bound on how many accounts to process per run

-- Notes:
-- - The Edge Function now decides which accounts are due based on last_posted_at.
-- - Default interval_hours=6 ⇒ ~4 posts per account per day, regardless of how many accounts exist.
-- - Cron just keeps the function running regularly (every 10 minutes here).
-- - Each function call completes in seconds (no timeout risk).

-- To verify the schedule:
-- SELECT jobid, jobname, schedule, active
-- FROM cron.job
-- WHERE jobname LIKE 'auto-post-art-%'
-- ORDER BY jobname;

-- To remove old cron jobs first:
-- SELECT cron.unschedule('auto-post-art-12am');
-- SELECT cron.unschedule('auto-post-art-6am');
-- SELECT cron.unschedule('auto-post-art-12pm');
-- SELECT cron.unschedule('auto-post-art-6pm');
-- SELECT cron.unschedule('auto-post-art-hour-00');
-- SELECT cron.unschedule('auto-post-art-hour-01');
-- -- ...unschedule any legacy hourly jobs you previously created
