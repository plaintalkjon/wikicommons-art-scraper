-- Add last_posted_at column to mastodon_accounts table for automatic rotation
-- Run this in Supabase SQL Editor

ALTER TABLE mastodon_accounts 
ADD COLUMN IF NOT EXISTS last_posted_at TIMESTAMPTZ;

-- Create index for efficient queries (ordering by last_posted_at)
CREATE INDEX IF NOT EXISTS idx_mastodon_accounts_last_posted 
ON mastodon_accounts(last_posted_at) 
WHERE active = true;

-- Optional: Set initial values for existing accounts to NULL (they'll be picked first)
-- UPDATE mastodon_accounts SET last_posted_at = NULL WHERE last_posted_at IS NULL;


