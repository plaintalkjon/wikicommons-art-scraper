-- IMMEDIATE FIX: Remove old hourly cron and create correct 10-minute cron
-- Run this entire script in Supabase SQL Editor

-- Step 1: Find and remove ALL existing cron jobs
DO $$
DECLARE
  job_record RECORD;
BEGIN
  -- Get all cron jobs matching the pattern
  FOR job_record IN 
    SELECT jobid, jobname 
    FROM cron.job 
    WHERE jobname LIKE 'auto-post-art%'
  LOOP
    RAISE NOTICE 'Removing cron job: % (jobid: %)', job_record.jobname, job_record.jobid;
    PERFORM cron.unschedule(job_record.jobname);
  END LOOP;
END $$;

-- Step 2: Verify all are removed
SELECT 
  jobid,
  jobname,
  schedule,
  active
FROM cron.job 
WHERE jobname LIKE 'auto-post-art%';

-- Step 3: Create the correct 10-minute cron job
DO $$
BEGIN
  PERFORM cron.schedule(
    'auto-post-art-every-10-min',
    '*/10 * * * *',  -- Every 10 minutes (at :00, :10, :20, :30, :40, :50)
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
  
  RAISE NOTICE '✅ Created cron job: auto-post-art-every-10-min (runs every 10 minutes)';
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

-- Expected output:
-- jobname: auto-post-art-every-10-min
-- schedule: */10 * * * *
-- active: true
