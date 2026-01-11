-- Complete MTG Bot Setup - Ready to Run
-- Copy and paste this entire script into Supabase SQL Editor

-- Step 1: Update constraint to allow 'mtg' account type
ALTER TABLE mastodon_accounts 
DROP CONSTRAINT IF EXISTS mastodon_accounts_account_type_check;

ALTER TABLE mastodon_accounts 
ADD CONSTRAINT mastodon_accounts_account_type_check 
CHECK (account_type IN ('artist', 'tag', 'philosopher', 'mtg'));

-- Step 2: Add the MTG account
DELETE FROM mastodon_accounts 
WHERE account_username = 'CuratedMTGShowcase' AND account_type = 'mtg';

INSERT INTO mastodon_accounts (
  account_username,
  mastodon_base_url,
  mastodon_access_token,
  account_type,
  active
) VALUES (
  'CuratedMTGShowcase',
  'https://mastodon.social',
  'T7SK9fhzMZQ49ptyqfoQyhBv9m0o4vaTv5O9R3-ZOBc',
  'mtg',
  true
);

-- Step 3: Create cron job (runs every 6 hours = 4 times per day)
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

