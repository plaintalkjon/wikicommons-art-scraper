-- Check cron job status
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

-- Check recent cron job runs (if available)
-- Note: This might not be available depending on Supabase version
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
  end_time
FROM cron.job_run_details
WHERE jobid IN (
  SELECT jobid FROM cron.job WHERE jobname LIKE 'auto-post-art%'
)
ORDER BY start_time DESC
LIMIT 20;


