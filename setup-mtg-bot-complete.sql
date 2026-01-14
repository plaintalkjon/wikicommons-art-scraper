-- Complete MTG Bot Setup Script
-- This script:
-- 1. Updates the account_type constraint to include 'mtg'
-- 2. Adds the MTG account
-- 3. Creates the cron job

-- Step 1: Update the check constraint to allow 'mtg' account type
-- First, drop the existing constraint
ALTER TABLE mastodon_accounts 
DROP CONSTRAINT IF EXISTS mastodon_accounts_account_type_check;

-- Add the new constraint that includes 'mtg'
ALTER TABLE mastodon_accounts 
ADD CONSTRAINT mastodon_accounts_account_type_check 
CHECK (account_type IN ('artist', 'tag', 'quote', 'mtg', 'yugioh'));

-- Step 2: Add the MTG account (delete existing first if it exists, then insert)
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

-- Step 3: Create the cron job (replace YOUR_PROJECT and YOUR_ANON_KEY)
-- Note: Uncomment and replace the values below, then run this section separately
/*
SELECT cron.schedule(
  'post-mtg-card',
  '0 */6 * * *',  -- Every 6 hours (4 times per day)
  $$
  SELECT net.http_post(
    url := 'https://YOUR_PROJECT.supabase.co/functions/v1/post-mtg-card',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_ANON_KEY'
    )
  ) AS request_id;
  $$
);
*/

