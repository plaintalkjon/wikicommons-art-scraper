-- Schedule Vincent Van Gogh Edge Function to run 4 times per day
-- This requires pg_cron and pg_net extensions to be enabled

-- First, enable required extensions (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- IMPORTANT: Replace YOUR_ANON_KEY with your actual anon key
-- You can find it in Supabase Dashboard → Settings → API → anon/public key
-- The anon key is safe to use in this context as it's a public key

-- Schedule 4 times per day (every 6 hours starting at midnight UTC)
-- 12:00 AM UTC (midnight)
SELECT cron.schedule(
  'vincent-van-gogh-12am',
  '0 0 * * *',
  $$
  SELECT net.http_post(
    url := 'https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/vincent-van-gogh?PREFIX=vincent-van-gogh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_ANON_KEY'
    )
  ) as request_id;
  $$
);

-- 6:00 AM UTC
SELECT cron.schedule(
  'vincent-van-gogh-6am',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/vincent-van-gogh?PREFIX=vincent-van-gogh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_ANON_KEY'
    )
  ) as request_id;
  $$
);

-- 12:00 PM UTC (noon)
SELECT cron.schedule(
  'vincent-van-gogh-12pm',
  '0 12 * * *',
  $$
  SELECT net.http_post(
    url := 'https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/vincent-van-gogh?PREFIX=vincent-van-gogh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_ANON_KEY'
    )
  ) as request_id;
  $$
);

-- 6:00 PM UTC
SELECT cron.schedule(
  'vincent-van-gogh-6pm',
  '0 18 * * *',
  $$
  SELECT net.http_post(
    url := 'https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/vincent-van-gogh?PREFIX=vincent-van-gogh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_ANON_KEY'
    )
  ) as request_id;
  $$
);

-- To view scheduled jobs:
-- SELECT * FROM cron.job;

-- To unschedule a job:
-- SELECT cron.unschedule('vincent-van-gogh-12am');
