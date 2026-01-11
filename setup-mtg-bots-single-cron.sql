-- Single Cron Job for All MTG Bots
-- This replaces individual cron jobs - processes all MTG accounts automatically
-- Copy and paste this into Supabase SQL Editor

-- Delete old individual cron jobs if they exist
SELECT cron.unschedule('post-mtg-card');
SELECT cron.unschedule('post-mtg-commander');
SELECT cron.unschedule('post-mtg-secret-lair');

-- Create single cron job that processes all MTG accounts
SELECT cron.schedule(
  'post-mtg-card',
  '0 */6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/post-mtg-card',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4dGtwd3N4dXB6a3h1aGhtdnZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUxMTY2OTQsImV4cCI6MjA4MDY5MjY5NH0.TpaMU7-7-U7BSyjqPkfiGjpHFB6qVt1dMUxG5KFptR8'
    )
  ) AS request_id;
  $$
);

