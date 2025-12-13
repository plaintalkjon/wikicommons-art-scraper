-- Schedule multiple artists to post 4 times per day each
-- This requires pg_cron and pg_net extensions to be enabled
-- Replace YOUR_ANON_KEY with your actual anon key

-- First, enable required extensions (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- IMPORTANT: Replace YOUR_ANON_KEY with your actual anon key
-- You can find it in Supabase Dashboard → Settings → API → anon/public key

-- ============================================
-- Vincent van Gogh - 4 times per day
-- ============================================
SELECT cron.schedule(
  'vincent-van-gogh-12am',
  '0 0 * * *',
  $$
  SELECT net.http_post(
    url := 'https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/post-art?artist=Vincent van Gogh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_ANON_KEY'
    )
  ) as request_id;
  $$
);

SELECT cron.schedule(
  'vincent-van-gogh-6am',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/post-art?artist=Vincent van Gogh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_ANON_KEY'
    )
  ) as request_id;
  $$
);

SELECT cron.schedule(
  'vincent-van-gogh-12pm',
  '0 12 * * *',
  $$
  SELECT net.http_post(
    url := 'https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/post-art?artist=Vincent van Gogh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_ANON_KEY'
    )
  ) as request_id;
  $$
);

SELECT cron.schedule(
  'vincent-van-gogh-6pm',
  '0 18 * * *',
  $$
  SELECT net.http_post(
    url := 'https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/post-art?artist=Vincent van Gogh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_ANON_KEY'
    )
  ) as request_id;
  $$
);

-- ============================================
-- To add more artists, copy the pattern above:
-- ============================================
-- Example for Rembrandt:
-- SELECT cron.schedule(
--   'rembrandt-12am',
--   '0 0 * * *',
--   $$
--   SELECT net.http_post(
--     url := 'https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/post-art?artist=Rembrandt van Rijn',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'Authorization', 'Bearer YOUR_ANON_KEY'
--     )
--   ) as request_id;
--   $$
-- );
-- (Repeat for 6am, 12pm, 6pm)

-- ============================================
-- Verification
-- ============================================

-- View all scheduled jobs
SELECT jobid, jobname, schedule, command
FROM cron.job
WHERE jobname LIKE '%12am' OR jobname LIKE '%6am' OR jobname LIKE '%12pm' OR jobname LIKE '%6pm'
ORDER BY jobname;

-- To unschedule a job:
-- SELECT cron.unschedule('vincent-van-gogh-12am');

