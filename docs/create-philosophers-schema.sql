-- Database schema for philosopher quotes bot
-- Run this in Supabase SQL Editor

-- ============================================
-- 1. PHILOSOPHERS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS philosophers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  wikidata_qid TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_philosophers_name ON philosophers(name);
CREATE INDEX IF NOT EXISTS idx_philosophers_qid ON philosophers(wikidata_qid) WHERE wikidata_qid IS NOT NULL;

-- ============================================
-- 2. QUOTES TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  philosopher_id UUID NOT NULL REFERENCES philosophers(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  source TEXT, -- e.g., "Beyond Good and Evil", "Letter to..."
  section TEXT, -- Wikiquotes section name
  character_count INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(philosopher_id, text) -- Prevent duplicate quotes
);

CREATE INDEX IF NOT EXISTS idx_quotes_philosopher_id ON quotes(philosopher_id);
CREATE INDEX IF NOT EXISTS idx_quotes_character_count ON quotes(character_count);

-- ============================================
-- 3. QUOTE_POSTS TABLE (Track posting history)
-- ============================================

CREATE TABLE IF NOT EXISTS quote_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  mastodon_account_id UUID NOT NULL REFERENCES mastodon_accounts(id) ON DELETE CASCADE,
  mastodon_status_id TEXT,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(quote_id, mastodon_account_id) -- Track per account
);

CREATE INDEX IF NOT EXISTS idx_quote_posts_quote_id ON quote_posts(quote_id);
CREATE INDEX IF NOT EXISTS idx_quote_posts_account_id ON quote_posts(mastodon_account_id);
CREATE INDEX IF NOT EXISTS idx_quote_posts_posted_at ON quote_posts(posted_at);

-- ============================================
-- 4. EXTEND MASTODON_ACCOUNTS TABLE
-- ============================================

-- Add philosopher_id column (nullable, for philosopher accounts)
ALTER TABLE mastodon_accounts 
ADD COLUMN IF NOT EXISTS philosopher_id UUID REFERENCES philosophers(id) ON DELETE CASCADE;

-- Update account_type check constraint to include 'philosopher'
ALTER TABLE mastodon_accounts
DROP CONSTRAINT IF EXISTS mastodon_accounts_account_type_check;

ALTER TABLE mastodon_accounts
ADD CONSTRAINT mastodon_accounts_account_type_check 
CHECK (
  (account_type = 'artist' AND artist_id IS NOT NULL AND philosopher_id IS NULL) OR
  (account_type = 'tag' AND artist_id IS NULL AND philosopher_id IS NULL) OR
  (account_type = 'philosopher' AND philosopher_id IS NOT NULL AND artist_id IS NULL)
);

-- Add index for philosopher accounts
CREATE INDEX IF NOT EXISTS idx_mastodon_accounts_philosopher_id 
ON mastodon_accounts(philosopher_id) 
WHERE philosopher_id IS NOT NULL;

-- ============================================
-- 5. UPDATE TRIGGERS
-- ============================================

-- Function to update updated_at timestamp for philosophers
CREATE OR REPLACE FUNCTION update_philosophers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for philosophers
DROP TRIGGER IF EXISTS update_philosophers_updated_at ON philosophers;
CREATE TRIGGER update_philosophers_updated_at
  BEFORE UPDATE ON philosophers
  FOR EACH ROW
  EXECUTE FUNCTION update_philosophers_updated_at();

-- ============================================
-- 6. ROW LEVEL SECURITY (RLS)
-- ============================================

-- Philosophers table: public read, service role write
ALTER TABLE philosophers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read philosophers" ON philosophers;
CREATE POLICY "Public can read philosophers"
  ON philosophers
  FOR SELECT
  TO public
  USING (true);

DROP POLICY IF EXISTS "Public cannot modify philosophers" ON philosophers;
CREATE POLICY "Public cannot insert philosophers"
  ON philosophers
  FOR INSERT
  TO public
  WITH CHECK (false);

CREATE POLICY "Public cannot update philosophers"
  ON philosophers
  FOR UPDATE
  TO public
  USING (false)
  WITH CHECK (false);

CREATE POLICY "Public cannot delete philosophers"
  ON philosophers
  FOR DELETE
  TO public
  USING (false);

-- Quotes table: public read, service role write
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read quotes" ON quotes;
CREATE POLICY "Public can read quotes"
  ON quotes
  FOR SELECT
  TO public
  USING (true);

DROP POLICY IF EXISTS "Public cannot modify quotes" ON quotes;
CREATE POLICY "Public cannot insert quotes"
  ON quotes
  FOR INSERT
  TO public
  WITH CHECK (false);

CREATE POLICY "Public cannot update quotes"
  ON quotes
  FOR UPDATE
  TO public
  USING (false)
  WITH CHECK (false);

CREATE POLICY "Public cannot delete quotes"
  ON quotes
  FOR DELETE
  TO public
  USING (false);

-- Quote_posts table: public read, service role write
ALTER TABLE quote_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read quote_posts" ON quote_posts;
CREATE POLICY "Public can read quote_posts"
  ON quote_posts
  FOR SELECT
  TO public
  USING (true);

DROP POLICY IF EXISTS "Public cannot modify quote_posts" ON quote_posts;
CREATE POLICY "Public cannot insert quote_posts"
  ON quote_posts
  FOR INSERT
  TO public
  WITH CHECK (false);

CREATE POLICY "Public cannot update quote_posts"
  ON quote_posts
  FOR UPDATE
  TO public
  USING (false)
  WITH CHECK (false);

CREATE POLICY "Public cannot delete quote_posts"
  ON quote_posts
  FOR DELETE
  TO public
  USING (false);
