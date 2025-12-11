-- Schedule the vincent-van-gogh edge function to run 4 times per day
-- Times: 6:00 AM, 12:00 PM, 6:00 PM, 12:00 AM UTC

-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Get the project URL and anon key from environment
-- Note: Replace these with your actual values or use Supabase's built-in functions
DO $$
DECLARE
  function_url TEXT := 'https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/vincent-van-gogh';
  anon_key TEXT := current_setting('app.settings.anon_key', true);
BEGIN
  -- Schedule 4 times per day (every 6 hours)
  -- 6:00 AM UTC
  PERFORM cron.schedule(
    'vincent-van-gogh-6am',
    '0 6 * * *',
    $$
    SELECT net.http_post(
      url := 'https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/vincent-van-gogh?PREFIX=vincent-van-gogh',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.anon_key', true)
      )
    );
    $$
  );

  -- 12:00 PM UTC
  PERFORM cron.schedule(
    'vincent-van-gogh-12pm',
    '0 12 * * *',
    $$
    SELECT net.http_post(
      url := 'https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/vincent-van-gogh?PREFIX=vincent-van-gogh',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.anon_key', true)
      )
    );
    $$
  );

  -- 6:00 PM UTC
  PERFORM cron.schedule(
    'vincent-van-gogh-6pm',
    '0 18 * * *',
    $$
    SELECT net.http_post(
      url := 'https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/vincent-van-gogh?PREFIX=vincent-van-gogh',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.anon_key', true)
      )
    );
    $$
  );

  -- 12:00 AM UTC
  PERFORM cron.schedule(
    'vincent-van-gogh-12am',
    '0 0 * * *',
    $$
    SELECT net.http_post(
      url := 'https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/vincent-van-gogh?PREFIX=vincent-van-gogh',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.anon_key', true)
      )
    );
    $$
  );
END $$;
