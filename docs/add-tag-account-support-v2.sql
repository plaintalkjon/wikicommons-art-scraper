-- Add support for tag-based accounts with multiple tags per account
-- This allows accounts to post artworks based on multiple tags (e.g., all Baroque variants)

-- First, make artist_id nullable (tag accounts won't have an artist_id)
ALTER TABLE mastodon_accounts 
ALTER COLUMN artist_id DROP NOT NULL;

-- Drop the unique constraint on artist_id (since tag accounts won't have one)
ALTER TABLE mastodon_accounts 
DROP CONSTRAINT IF EXISTS mastodon_accounts_artist_id_key;

-- Add tag_id column (nullable - for backward compatibility, but we'll use junction table for multi-tag)
ALTER TABLE mastodon_accounts 
ADD COLUMN IF NOT EXISTS tag_id UUID REFERENCES tags(id) ON DELETE CASCADE;

-- Add account_type column
ALTER TABLE mastodon_accounts
ADD COLUMN IF NOT EXISTS account_type TEXT DEFAULT 'artist' CHECK (account_type IN ('artist', 'tag'));

-- Update existing accounts to be 'artist' type
UPDATE mastodon_accounts 
SET account_type = 'artist' 
WHERE account_type IS NULL;

-- Create junction table for multiple tags per account
CREATE TABLE IF NOT EXISTS mastodon_account_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mastodon_account_id UUID NOT NULL REFERENCES mastodon_accounts(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(mastodon_account_id, tag_id) -- Prevent duplicate tag assignments
);

-- Add indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_mastodon_account_tags_account_id 
ON mastodon_account_tags(mastodon_account_id);

CREATE INDEX IF NOT EXISTS idx_mastodon_account_tags_tag_id 
ON mastodon_account_tags(tag_id);

-- Add index for tag-based lookups on mastodon_accounts
CREATE INDEX IF NOT EXISTS idx_mastodon_accounts_tag_id 
ON mastodon_accounts(tag_id) 
WHERE tag_id IS NOT NULL;

-- Add constraint: account must have either artist_id OR be a tag account (with tags in junction table)
-- Note: We'll enforce this at the application level since junction table makes it complex
ALTER TABLE mastodon_accounts
DROP CONSTRAINT IF EXISTS mastodon_accounts_account_type_check;

-- RLS for mastodon_account_tags (same security as mastodon_accounts)
ALTER TABLE mastodon_account_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Deny all public access to mastodon_account_tags"
  ON mastodon_account_tags
  FOR ALL
  TO public
  USING (false);


