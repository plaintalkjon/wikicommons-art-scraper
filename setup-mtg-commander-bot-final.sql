-- Complete MTG Commander Bot Setup - Ready to Run
-- Copy and paste this entire script into Supabase SQL Editor

-- Step 1: Add the MTG Commander account (using 'mtg' account type)
DELETE FROM mastodon_accounts 
WHERE account_username = 'CuratedMTGCommander' AND account_type = 'mtg';

INSERT INTO mastodon_accounts (
  account_username,
  mastodon_base_url,
  mastodon_access_token,
  account_type,
  active
) VALUES (
  'CuratedMTGCommander',
  'https://mastodon.social',
  'bbeApdC33VGFLXRAQI177myrYGjk9pU4EOS5UTqv2Lk',
  'mtg',
  true
);

-- Step 3: Create cron job (runs every 6 hours = 4 times per day)
SELECT cron.schedule(
  'post-mtg-commander',
  '0 */6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/post-mtg-commander',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4dGtwd3N4dXB6a3h1aGhtdnZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUxMTY2OTQsImV4cCI6MjA4MDY5MjY5NH0.TpaMU7-7-U7BSyjqPkfiGjpHFB6qVt1dMUxG5KFptR8'
    )
  ) AS request_id;
  $$
);

