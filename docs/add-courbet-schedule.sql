-- Schedule Gustave Courbet to post 4 times per day
-- Replace YOUR_ANON_KEY with your actual anon key

-- 12:00 AM UTC
SELECT cron.schedule(
  'gustave-courbet-12am',
  '0 0 * * *',
  $$
  SELECT net.http_post(
    url := 'https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/post-art?artist=Gustave%20Courbet',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_ANON_KEY'
    )
  ) as request_id;
  $$
);

-- 6:00 AM UTC
SELECT cron.schedule(
  'gustave-courbet-6am',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/post-art?artist=Gustave%20Courbet',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_ANON_KEY'
    )
  ) as request_id;
  $$
);

-- 12:00 PM UTC
SELECT cron.schedule(
  'gustave-courbet-12pm',
  '0 12 * * *',
  $$
  SELECT net.http_post(
    url := 'https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/post-art?artist=Gustave%20Courbet',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_ANON_KEY'
    )
  ) as request_id;
  $$
);

-- 6:00 PM UTC
SELECT cron.schedule(
  'gustave-courbet-6pm',
  '0 18 * * *',
  $$
  SELECT net.http_post(
    url := 'https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/post-art?artist=Gustave%20Courbet',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_ANON_KEY'
    )
  ) as request_id;
  $$
);

