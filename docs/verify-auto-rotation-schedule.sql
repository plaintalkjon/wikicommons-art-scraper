-- Verify that all 4 auto-rotation cron jobs were created
-- Run this in Supabase SQL Editor

SELECT 
  jobid,
  schedule,
  jobname,
  active,
  command
FROM cron.job 
WHERE jobname LIKE 'auto-post-art%'
ORDER BY jobname;

-- Expected result: 4 rows
-- - auto-post-art-12am
-- - auto-post-art-6am
-- - auto-post-art-12pm
-- - auto-post-art-6pm

