-- Create Health Check Cron Job for post-art accounts
-- This cron job runs every 10 minutes and logs accounts that haven't posted in 6+ hours
-- It helps monitor the health of the posting system with frequent checks
--
-- The health check function:
-- - Queries all active accounts (artist, tag, quote, mtg, yugioh)
-- - Identifies accounts that haven't posted in the specified interval (default: 6 hours)
-- - Logs detailed information about overdue accounts
-- - Helps diagnose posting issues quickly

-- Remove existing health check cron job if it exists (ignore error if it doesn't)
DO $$
BEGIN
  PERFORM cron.unschedule('post-art-health-check');
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

-- Create health check cron job
-- Runs every 10 minutes for frequent monitoring
SELECT cron.schedule(
  'post-art-health-check',
  '*/10 * * * *',  -- Every 10 minutes
  $$
  SELECT net.http_post(
    url := 'https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/post-art-health-check?interval_hours=6',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4dGtwd3N4dXB6a3h1aGhtdnZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUxMTY2OTQsImV4cCI6MjA4MDY5MjY5NH0.TpaMU7-7-U7BSyjqPkfiGjpHFB6qVt1dMUxG5KFptR8'
    )
  ) AS request_id;
  $$
);

-- Alternative schedules (uncomment one if you prefer):
-- '*/5 * * * *'   -- Every 5 minutes (very frequent monitoring)
-- '*/15 * * * *'  -- Every 15 minutes (moderate monitoring)
-- '*/30 * * * *'  -- Every 30 minutes (less frequent)
-- '0 */6 * * *'   -- Every 6 hours (same as posting interval)

-- Verification: Check that the cron job was created
-- Run this query separately to verify:
-- SELECT jobname, schedule, active, command::text FROM cron.job WHERE jobname = 'post-art-health-check';

