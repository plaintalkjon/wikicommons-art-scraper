-- Check Current Cron Jobs Configuration
-- Run this in Supabase SQL Editor to see what cron jobs are currently active

-- List all cron jobs
SELECT 
  jobid,
  schedule,
  command,
  nodename,
  nodeport,
  database,
  username,
  active,
  jobname
FROM cron.job
WHERE jobname LIKE '%mtg%' OR jobname LIKE '%yugioh%' OR jobname LIKE '%pokemon%'
ORDER BY jobname;

-- Check specific cron jobs
SELECT 
  jobname,
  schedule,
  active,
  command::text
FROM cron.job
WHERE jobname IN ('post-mtg-card', 'post-mtg-commander', 'post-mtg-secret-lair', 'post-yugioh-card')
ORDER BY jobname;

