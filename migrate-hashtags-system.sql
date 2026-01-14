-- Migration: Add hashtags system for quote accounts
-- This allows assigning multiple hashtags to each account (e.g., Marcus Aurelius: #philosophy #stoicism)
-- Run this in Supabase SQL Editor

-- Step 1: Create hashtags table
-- Stores hashtag definitions (e.g., 'philosophy', 'stoicism', 'literature')
-- All hashtags are stored in lowercase
CREATE TABLE IF NOT EXISTS hashtags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE, -- e.g., 'philosophy', 'stoicism' (without #, lowercase)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index on name for fast lookups
CREATE INDEX IF NOT EXISTS idx_hashtags_name ON hashtags(name);

-- Step 2: Create junction table linking accounts to hashtags
-- Allows multiple hashtags per account
CREATE TABLE IF NOT EXISTS mastodon_account_hashtags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mastodon_account_id UUID NOT NULL REFERENCES mastodon_accounts(id) ON DELETE CASCADE,
  hashtag_id UUID NOT NULL REFERENCES hashtags(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(mastodon_account_id, hashtag_id) -- Prevent duplicate associations
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_mastodon_account_hashtags_account ON mastodon_account_hashtags(mastodon_account_id);
CREATE INDEX IF NOT EXISTS idx_mastodon_account_hashtags_hashtag ON mastodon_account_hashtags(hashtag_id);

-- Step 3: Insert common hashtags (all lowercase)
INSERT INTO hashtags (name) VALUES
  ('philosophy'),
  ('stoicism'),
  ('literature'),
  ('politics'),
  ('science'),
  ('art'),
  ('wisdom'),
  ('quotes'),
  ('magicthegathering'),
  ('yugioh')
ON CONFLICT (name) DO NOTHING;

-- Step 4: Assign hashtags to all existing accounts based on their account_type

-- 4a: Quote accounts - assign hashtags based on their author's category
INSERT INTO mastodon_account_hashtags (mastodon_account_id, hashtag_id)
SELECT DISTINCT
  ma.id as mastodon_account_id,
  h.id as hashtag_id
FROM mastodon_accounts ma
INNER JOIN quote_authors qa ON ma.author_id = qa.id
INNER JOIN hashtags h ON (
  CASE qa.category
    WHEN 'philosopher' THEN h.name = 'philosophy'
    WHEN 'author' THEN h.name = 'literature'
    WHEN 'politics' THEN h.name = 'politics'
    WHEN 'scientist' THEN h.name = 'science'
    WHEN 'artist' THEN h.name = 'art'
    ELSE h.name = 'quotes'
  END
)
WHERE ma.account_type = 'quote'
  AND ma.author_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM mastodon_account_hashtags mah
    WHERE mah.mastodon_account_id = ma.id
      AND mah.hashtag_id = h.id
  );

-- 4b: Artist accounts - assign #art hashtag
INSERT INTO mastodon_account_hashtags (mastodon_account_id, hashtag_id)
SELECT DISTINCT
  ma.id as mastodon_account_id,
  h.id as hashtag_id
FROM mastodon_accounts ma
INNER JOIN hashtags h ON h.name = 'art'
WHERE ma.account_type = 'artist'
  AND NOT EXISTS (
    SELECT 1 FROM mastodon_account_hashtags mah
    WHERE mah.mastodon_account_id = ma.id
      AND mah.hashtag_id = h.id
  );

-- 4c: Tag accounts - assign #art hashtag
INSERT INTO mastodon_account_hashtags (mastodon_account_id, hashtag_id)
SELECT DISTINCT
  ma.id as mastodon_account_id,
  h.id as hashtag_id
FROM mastodon_accounts ma
INNER JOIN hashtags h ON h.name = 'art'
WHERE ma.account_type = 'tag'
  AND NOT EXISTS (
    SELECT 1 FROM mastodon_account_hashtags mah
    WHERE mah.mastodon_account_id = ma.id
      AND mah.hashtag_id = h.id
  );

-- 4d: MTG accounts - assign #magicthegathering hashtag
INSERT INTO mastodon_account_hashtags (mastodon_account_id, hashtag_id)
SELECT DISTINCT
  ma.id as mastodon_account_id,
  h.id as hashtag_id
FROM mastodon_accounts ma
INNER JOIN hashtags h ON h.name = 'magicthegathering'
WHERE ma.account_type = 'mtg'
  AND NOT EXISTS (
    SELECT 1 FROM mastodon_account_hashtags mah
    WHERE mah.mastodon_account_id = ma.id
      AND mah.hashtag_id = h.id
  );

-- 4e: Yu-Gi-Oh accounts - assign #yugioh hashtag
INSERT INTO mastodon_account_hashtags (mastodon_account_id, hashtag_id)
SELECT DISTINCT
  ma.id as mastodon_account_id,
  h.id as hashtag_id
FROM mastodon_accounts ma
INNER JOIN hashtags h ON h.name = 'yugioh'
WHERE ma.account_type = 'yugioh'
  AND NOT EXISTS (
    SELECT 1 FROM mastodon_account_hashtags mah
    WHERE mah.mastodon_account_id = ma.id
      AND mah.hashtag_id = h.id
  );

-- Step 5: Enable Row Level Security (RLS)

-- Enable RLS on hashtags table
ALTER TABLE hashtags ENABLE ROW LEVEL SECURITY;

-- Policy: Service role has full access to hashtags (for Edge Functions and CLI)
CREATE POLICY "Service role can manage hashtags"
  ON hashtags
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Policy: Public read access to hashtags (hashtags are not sensitive)
CREATE POLICY "Public can read hashtags"
  ON hashtags
  FOR SELECT
  TO public
  USING (true);

-- Enable RLS on mastodon_account_hashtags junction table
ALTER TABLE mastodon_account_hashtags ENABLE ROW LEVEL SECURITY;

-- Policy: Service role has full access to account-hashtag associations
CREATE POLICY "Service role can manage account hashtags"
  ON mastodon_account_hashtags
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Policy: Authenticated users can read account-hashtag associations (for viewing)
CREATE POLICY "Authenticated users can read account hashtags"
  ON mastodon_account_hashtags
  FOR SELECT
  TO authenticated
  USING (true);

-- Step 6: Verify the migration
-- Show all accounts with their assigned hashtags
SELECT 
  ma.account_type,
  ma.account_username,
  qa.name as author_name,
  STRING_AGG(h.name, ', ' ORDER BY h.name) as hashtags
FROM mastodon_accounts ma
LEFT JOIN quote_authors qa ON ma.author_id = qa.id
LEFT JOIN mastodon_account_hashtags mah ON ma.id = mah.mastodon_account_id
LEFT JOIN hashtags h ON mah.hashtag_id = h.id
GROUP BY ma.id, ma.account_type, ma.account_username, qa.name
ORDER BY ma.account_type, ma.account_username;

