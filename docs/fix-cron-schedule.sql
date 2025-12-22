-- Fix Cron Job Schedule
-- This script will:
-- 1. Remove the old hourly cron job (if it exists)
-- 2. Create the new every-10-minutes cron job

-- Step 1: Check what cron jobs exist
SELECT 
  jobid,
  jobname,
  schedule,
  active
FROM cron.job 
WHERE jobname LIKE 'auto-post-art%'
ORDER BY jobname;

-- Step 2: Remove ALL old cron jobs (they might have different names)
-- Run these one by one to see which ones exist:

-- Remove hourly jobs (if they exist)
SELECT cron.unschedule('auto-post-art-12am');
SELECT cron.unschedule('auto-post-art-6am');
SELECT cron.unschedule('auto-post-art-12pm');
SELECT cron.unschedule('auto-post-art-6pm');

-- Remove any other variations
SELECT cron.unschedule('auto-post-art-every-10-min');
SELECT cron.unschedule('auto-post-art-hour-00');
SELECT cron.unschedule('auto-post-art-hour-01');
SELECT cron.unschedule('auto-post-art-hour-02');
SELECT cron.unschedule('auto-post-art-hour-03');
SELECT cron.unschedule('auto-post-art-hour-04');
SELECT cron.unschedule('auto-post-art-hour-05');
SELECT cron.unschedule('auto-post-art-hour-06');
SELECT cron.unschedule('auto-post-art-hour-07');
SELECT cron.unschedule('auto-post-art-hour-08');
SELECT cron.unschedule('auto-post-art-hour-09');
SELECT cron.unschedule('auto-post-art-hour-10');
SELECT cron.unschedule('auto-post-art-hour-11');
SELECT cron.unschedule('auto-post-art-hour-12');
SELECT cron.unschedule('auto-post-art-hour-13');
SELECT cron.unschedule('auto-post-art-hour-14');
SELECT cron.unschedule('auto-post-art-hour-15');
SELECT cron.unschedule('auto-post-art-hour-16');
SELECT cron.unschedule('auto-post-art-hour-17');
SELECT cron.unschedule('auto-post-art-hour-18');
SELECT cron.unschedule('auto-post-art-hour-19');
SELECT cron.unschedule('auto-post-art-hour-20');
SELECT cron.unschedule('auto-post-art-hour-21');
SELECT cron.unschedule('auto-post-art-hour-22');
SELECT cron.unschedule('auto-post-art-hour-23');

-- Step 3: Create the new every-10-minutes cron job
DO $$
BEGIN
  -- Remove if exists first
  PERFORM cron.unschedule('auto-post-art-every-10-min');
  
  -- Create new job
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
  
  RAISE NOTICE 'Cron job created: auto-post-art-every-10-min (runs every 10 minutes)';
END $$;

-- Step 4: Verify the new cron job
SELECT 
  jobid,
  jobname,
  schedule,
  active,
  nodename
FROM cron.job 
WHERE jobname = 'auto-post-art-every-10-min';

-- Expected result:
-- jobname: auto-post-art-every-10-min
-- schedule: */10 * * * *
-- active: true
