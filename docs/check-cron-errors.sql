-- Check cron job status and recent runs
-- Run this in Supabase SQL Editor

-- 1. Check if cron job exists and is active
SELECT 
  jobid,
  jobname,
  schedule,
  active,
  nodename,
  database,
  username
FROM cron.job 
WHERE jobname LIKE 'auto-post-art%'
ORDER BY jobname;

-- 2. Check recent cron job runs (last 20)
SELECT 
  jobid,
  runid,
  job_pid,
  database,
  username,
  command,
  status,
  return_message,
  start_time,
  end_time,
  EXTRACT(EPOCH FROM (end_time - start_time)) as duration_seconds
FROM cron.job_run_details
WHERE jobid IN (
  SELECT jobid FROM cron.job WHERE jobname LIKE 'auto-post-art%'
)
ORDER BY start_time DESC
LIMIT 20;

-- 3. Check for any errors in return_message
SELECT 
  runid,
  start_time,
  status,
  return_message
FROM cron.job_run_details
WHERE jobid IN (
  SELECT jobid FROM cron.job WHERE jobname LIKE 'auto-post-art%'
)
AND (status = 'failed' OR return_message LIKE '%error%' OR return_message LIKE '%Error%')
ORDER BY start_time DESC
LIMIT 10;
