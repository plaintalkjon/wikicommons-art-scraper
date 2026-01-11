-- Update MTG Showcase Cron Job to explicitly specify account
-- Copy and paste this into Supabase SQL Editor

-- Delete the old cron job
SELECT cron.unschedule('post-mtg-card');

-- Create new cron job with explicit account parameter
SELECT cron.schedule(
  'post-mtg-card',
  '0 */6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/post-mtg-card?account=CuratedMTGShowcase&bot_type=showcase',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4dGtwd3N4dXB6a3h1aGhtdnZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUxMTY2OTQsImV4cCI6MjA4MDY5MjY5NH0.TpaMU7-7-U7BSyjqPkfiGjpHFB6qVt1dMUxG5KFptR8'
    )
  ) AS request_id;
  $$
);
