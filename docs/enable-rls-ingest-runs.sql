-- ============================================
-- Enable Row Level Security (RLS) for ingest_runs table
-- ============================================
-- 
-- This table appears to be an internal tracking table for ingestion runs.
-- Since it's in the public schema, RLS must be enabled to satisfy Supabase security requirements.
-- 
-- Security Model:
-- - Deny all public access (read and write)
-- - Service role can access (bypasses RLS automatically)
-- ============================================

-- Enable RLS on ingest_runs table
ALTER TABLE public.ingest_runs ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Deny all public access to ingest_runs" ON public.ingest_runs;
DROP POLICY IF EXISTS "Deny all authenticated access to ingest_runs" ON public.ingest_runs;

-- Deny ALL access (read and write) for public users
CREATE POLICY "Deny all public access to ingest_runs"
  ON public.ingest_runs
  FOR ALL
  TO public
  USING (false)
  WITH CHECK (false);

-- Also explicitly deny for authenticated users (not just public)
-- This ensures even logged-in users can't access internal tracking data
CREATE POLICY "Deny all authenticated access to ingest_runs"
  ON public.ingest_runs
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- ============================================
-- VERIFICATION
-- ============================================

-- Verify RLS is enabled
SELECT 
  schemaname,
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename = 'ingest_runs';

-- Check RLS policies
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
  AND tablename = 'ingest_runs'
ORDER BY policyname;

-- ============================================
-- NOTES
-- ============================================
--
-- Service Role Key:
-- - Automatically bypasses RLS
-- - Can read/write ingest_runs table
-- - Used by your CLI scripts and edge functions
--
-- Public/Anonymous Users:
-- - Cannot access ingest_runs table (read or write)
--
-- Authenticated Users:
-- - Cannot access ingest_runs table (read or write)
--
-- This is appropriate for an internal tracking table that should
-- only be accessible via the service role key.
