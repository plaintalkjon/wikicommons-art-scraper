-- Create and secure the mastodon_accounts table
-- Run this in Supabase SQL Editor

-- Create the table
CREATE TABLE IF NOT EXISTS mastodon_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id UUID NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  mastodon_base_url TEXT NOT NULL DEFAULT 'https://mastodon.social',
  mastodon_access_token TEXT NOT NULL,
  account_username TEXT, -- Optional: for reference (e.g., "@vangogh@mastodon.social")
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(artist_id) -- One account per artist
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_mastodon_accounts_artist_id ON mastodon_accounts(artist_id);
CREATE INDEX IF NOT EXISTS idx_mastodon_accounts_active ON mastodon_accounts(active) WHERE active = true;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_mastodon_accounts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS update_mastodon_accounts_updated_at ON mastodon_accounts;
CREATE TRIGGER update_mastodon_accounts_updated_at
  BEFORE UPDATE ON mastodon_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_mastodon_accounts_updated_at();

-- ============================================
-- SECURITY: Row Level Security (RLS)
-- ============================================

-- Enable RLS on the table
ALTER TABLE mastodon_accounts ENABLE ROW LEVEL SECURITY;

-- Deny all access to public/anonymous users
-- This ensures no one can read tokens via the API
CREATE POLICY "Deny all public access to mastodon_accounts"
  ON mastodon_accounts
  FOR ALL
  TO public
  USING (false);

-- Note: Service role key (used by edge functions) automatically bypasses RLS
-- This means:
-- ✅ Edge functions CAN access (they use service role key)
-- ✅ Public API users CANNOT access (blocked by RLS)
-- ✅ Authenticated users CANNOT access (blocked by RLS)
-- ✅ Only direct SQL queries with service role can access

-- ============================================
-- Verification
-- ============================================

-- Verify RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' AND tablename = 'mastodon_accounts';

-- View policies (should show the deny policy)
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename = 'mastodon_accounts';

