-- Update MTG Card Cron Job to Run More Frequently
-- This enables faster retry on failures while maintaining posting interval
-- 
-- Benefits:
-- - Cron runs every 15 minutes (instead of 6 hours)
-- - Function still respects 6-hour posting interval per account (via last_posted_at)
-- - If a post fails, retry happens in 15 minutes instead of waiting 6 hours
-- - More resilient to transient failures

-- Remove existing cron job
SELECT cron.unschedule('post-mtg-card');

-- Create new cron job that runs every 15 minutes
-- The function will check last_posted_at and only post accounts that are due
SELECT cron.schedule(
  'post-mtg-card',
  '*/15 * * * *',  -- Every 15 minutes
  $$
  SELECT net.http_post(
    url := 'https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/post-mtg-card?interval_hours=6',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4dGtwd3N4dXB6a3h1aGhtdnZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUxMTY2OTQsImV4cCI6MjA4MDY5MjY5NH0.TpaMU7-7-U7BSyjqPkfiGjpHFB6qVt1dMUxG5KFptR8'
    )
  ) AS request_id;
  $$
);

-- Alternative schedules (uncomment one if you prefer):
-- '*/10 * * * *'  -- Every 10 minutes (more frequent, faster retry)
-- '*/20 * * * *'  -- Every 20 minutes (less frequent, still good retry)

