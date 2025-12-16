-- ============================================
-- Comprehensive Row Level Security (RLS) Setup
-- ============================================
-- 
-- Goal: 
-- - Public users can READ non-sensitive data (for contributions/feedback)
-- - Only service role (you) can WRITE/EDIT anything
-- - Sensitive tables (mastodon_accounts, mastodon_account_tags) are fully protected
--
-- ============================================
-- 1. ARTISTS TABLE
-- ============================================

ALTER TABLE artists ENABLE ROW LEVEL SECURITY;

-- Allow public to read artists
CREATE POLICY "Public can read artists"
  ON artists
  FOR SELECT
  TO public
  USING (true);

-- Deny all write operations for public
CREATE POLICY "Public cannot modify artists"
  ON artists
  FOR ALL
  TO public
  USING (false)
  WITH CHECK (false);

-- Note: Service role (used by your scripts/edge functions) bypasses RLS automatically

-- ============================================
-- 2. ARTS TABLE (Artworks)
-- ============================================

ALTER TABLE arts ENABLE ROW LEVEL SECURITY;

-- Allow public to read artworks
CREATE POLICY "Public can read arts"
  ON arts
  FOR SELECT
  TO public
  USING (true);

-- Deny all write operations for public
CREATE POLICY "Public cannot modify arts"
  ON arts
  FOR ALL
  TO public
  USING (false)
  WITH CHECK (false);

-- ============================================
-- 3. TAGS TABLE
-- ============================================

ALTER TABLE tags ENABLE ROW LEVEL SECURITY;

-- Allow public to read tags
CREATE POLICY "Public can read tags"
  ON tags
  FOR SELECT
  TO public
  USING (true);

-- Deny all write operations for public
CREATE POLICY "Public cannot modify tags"
  ON tags
  FOR ALL
  TO public
  USING (false)
  WITH CHECK (false);

-- ============================================
-- 4. ART_TAGS TABLE (Junction: Artworks <-> Tags)
-- ============================================

ALTER TABLE art_tags ENABLE ROW LEVEL SECURITY;

-- Allow public to read art-tag relationships
CREATE POLICY "Public can read art_tags"
  ON art_tags
  FOR SELECT
  TO public
  USING (true);

-- Deny all write operations for public
CREATE POLICY "Public cannot modify art_tags"
  ON art_tags
  FOR ALL
  TO public
  USING (false)
  WITH CHECK (false);

-- ============================================
-- 5. ART_SOURCES TABLE
-- ============================================

ALTER TABLE art_sources ENABLE ROW LEVEL SECURITY;

-- Allow public to read sources
CREATE POLICY "Public can read art_sources"
  ON art_sources
  FOR SELECT
  TO public
  USING (true);

-- Deny all write operations for public
CREATE POLICY "Public cannot modify art_sources"
  ON art_sources
  FOR ALL
  TO public
  USING (false)
  WITH CHECK (false);

-- ============================================
-- 6. ART_ASSETS TABLE
-- ============================================

ALTER TABLE art_assets ENABLE ROW LEVEL SECURITY;

-- Allow public to read assets (includes storage paths, but that's okay for public images)
CREATE POLICY "Public can read art_assets"
  ON art_assets
  FOR SELECT
  TO public
  USING (true);

-- Deny all write operations for public
CREATE POLICY "Public cannot modify art_assets"
  ON art_assets
  FOR ALL
  TO public
  USING (false)
  WITH CHECK (false);

-- ============================================
-- 7. MASTODON_ACCOUNTS TABLE (SENSITIVE - Already Protected)
-- ============================================

-- This table should already have RLS enabled from previous setup
-- Verify and ensure it's fully protected

ALTER TABLE mastodon_accounts ENABLE ROW LEVEL SECURITY;

-- Drop existing policy if it exists and recreate to be explicit
DROP POLICY IF EXISTS "Deny all public access to mastodon_accounts" ON mastodon_accounts;

-- Deny ALL access (read and write) for public
CREATE POLICY "Deny all public access to mastodon_accounts"
  ON mastodon_accounts
  FOR ALL
  TO public
  USING (false)
  WITH CHECK (false);

-- Also explicitly deny for authenticated users (not just public)
-- This ensures even logged-in users can't access tokens
CREATE POLICY "Deny all authenticated access to mastodon_accounts"
  ON mastodon_accounts
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- ============================================
-- 8. MASTODON_ACCOUNT_TAGS TABLE (SENSITIVE - Already Protected)
-- ============================================

-- This table should already have RLS enabled from tag account migration
-- Verify and ensure it's fully protected

ALTER TABLE mastodon_account_tags ENABLE ROW LEVEL SECURITY;

-- Drop existing policy if it exists
DROP POLICY IF EXISTS "Deny all public access to mastodon_account_tags" ON mastodon_account_tags;

-- Deny ALL access (read and write) for public
CREATE POLICY "Deny all public access to mastodon_account_tags"
  ON mastodon_account_tags
  FOR ALL
  TO public
  USING (false)
  WITH CHECK (false);

-- Also explicitly deny for authenticated users
CREATE POLICY "Deny all authenticated access to mastodon_account_tags"
  ON mastodon_account_tags
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- Check which tables have RLS enabled
SELECT 
  schemaname,
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename IN (
    'artists', 'arts', 'tags', 'art_tags', 
    'art_sources', 'art_assets', 
    'mastodon_accounts', 'mastodon_account_tags'
  )
ORDER BY tablename;

-- Check all RLS policies
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'artists', 'arts', 'tags', 'art_tags', 
    'art_sources', 'art_assets', 
    'mastodon_accounts', 'mastodon_account_tags'
  )
ORDER BY tablename, policyname;

-- ============================================
-- NOTES
-- ============================================
--
-- Service Role Key:
-- - Automatically bypasses RLS
-- - Used by your CLI scripts and edge functions
-- - Can read/write everything
--
-- Public/Anonymous Users:
-- - Can READ: artists, arts, tags, art_tags, art_sources, art_assets
-- - Cannot READ: mastodon_accounts, mastodon_account_tags
-- - Cannot WRITE: anything
--
-- Authenticated Users (if you add them later):
-- - Currently same as public (read-only on non-sensitive tables)
-- - Cannot access sensitive tables
-- - Cannot write anything
--
-- To allow authenticated users to write in the future:
-- - Create policies like: "Authenticated users can insert arts" with appropriate conditions
-- - For now, only service role can write (which is what you want)


