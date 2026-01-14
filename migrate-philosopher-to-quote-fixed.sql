-- Migration: Rename account_type from 'philosopher' to 'quote'
-- This makes the account type more general to reflect the generalized quotes system
-- Run this in Supabase SQL Editor
--
-- IMPORTANT: This migration must be done in steps because we can't add a constraint
-- that excludes existing data. We'll:
-- 1. Drop the constraint temporarily
-- 2. Update the accounts
-- 3. Re-add the constraint with the new allowed values

-- Step 1: Drop the existing constraint (allows us to update accounts)
ALTER TABLE mastodon_accounts 
DROP CONSTRAINT IF EXISTS mastodon_accounts_account_type_check;

-- Step 2: Update all existing accounts with account_type='philosopher' to account_type='quote'
-- This must happen BEFORE we add the new constraint
UPDATE mastodon_accounts
SET account_type = 'quote'
WHERE account_type = 'philosopher';

-- Step 3: Now add the new constraint that allows 'quote' instead of 'philosopher'
ALTER TABLE mastodon_accounts 
ADD CONSTRAINT mastodon_accounts_account_type_check 
CHECK (account_type IN ('artist', 'tag', 'quote', 'mtg', 'yugioh'));

-- Step 4: Verify the changes
SELECT 
  account_type,
  COUNT(*) as count
FROM mastodon_accounts
GROUP BY account_type
ORDER BY account_type;

-- Step 5: Show accounts that were updated
SELECT 
  id,
  account_username,
  account_type,
  author_id,
  active
FROM mastodon_accounts
WHERE account_type = 'quote'
ORDER BY account_username;

