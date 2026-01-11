-- Verify MTG Bot Setup
-- Run this to check everything is configured correctly

-- 1. Check account exists
SELECT 
  id,
  account_username,
  account_type,
  active,
  last_posted_at,
  created_at
FROM mastodon_accounts
WHERE account_type = 'mtg';

-- 2. Check cron job exists
SELECT 
  jobid,
  jobname,
  schedule,
  active,
  database
FROM cron.job
WHERE jobname = 'post-mtg-card';

-- 3. Check recent cron job runs (if any)
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
WHERE jobid = 49  -- Your schedule ID
ORDER BY start_time DESC
LIMIT 5;

