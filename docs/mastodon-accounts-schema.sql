-- Schema for managing multiple Mastodon accounts per artist
-- Each artist can have their own Mastodon bot account
-- SECURED: Only accessible via service role key (RLS enabled)

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
CREATE TRIGGER update_mastodon_accounts_updated_at
  BEFORE UPDATE ON mastodon_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_mastodon_accounts_updated_at();

-- SECURITY: Enable Row Level Security (RLS)
ALTER TABLE mastodon_accounts ENABLE ROW LEVEL SECURITY;

-- SECURITY: Deny all access by default (even for authenticated users)
-- Only service role (used by edge functions) can access
CREATE POLICY "Deny all public access to mastodon_accounts"
  ON mastodon_accounts
  FOR ALL
  TO public
  USING (false);

-- SECURITY: Allow service role to access (for edge functions)
-- Service role bypasses RLS by default, but this makes it explicit
-- Note: Service role key automatically bypasses RLS, so this is just for clarity

-- Example: Insert account for Vincent van Gogh
-- INSERT INTO mastodon_accounts (artist_id, mastodon_base_url, mastodon_access_token, account_username)
-- SELECT 
--   id,
--   'https://mastodon.social',
--   'your_access_token_here',
--   '@vangogh@mastodon.social'
-- FROM artists
-- WHERE name = 'Vincent van Gogh';


