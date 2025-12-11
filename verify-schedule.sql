-- Verify your scheduled jobs
SELECT 
  jobid,
  jobname,
  schedule,
  command,
  nodename,
  nodeport,
  database,
  username,
  active
FROM cron.job 
WHERE jobname LIKE 'vincent-van-gogh%'
ORDER BY jobname;
