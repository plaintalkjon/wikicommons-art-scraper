-- ============================================
-- RLS Status Verification Script
-- ============================================
-- Run this in Supabase SQL Editor to check current RLS status
-- ============================================

-- 1. Check which tables have RLS enabled
SELECT 
  tablename,
  CASE 
    WHEN rowsecurity THEN '✅ Enabled'
    ELSE '❌ Disabled'
  END as rls_status
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename IN (
    'artists', 'arts', 'tags', 'art_tags', 
    'art_sources', 'art_assets', 
    'mastodon_accounts', 'mastodon_account_tags'
  )
ORDER BY tablename;

-- 2. Count policies per table
SELECT 
  tablename,
  COUNT(*) as policy_count,
  STRING_AGG(policyname, ', ' ORDER BY policyname) as policies
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'artists', 'arts', 'tags', 'art_tags', 
    'art_sources', 'art_assets', 
    'mastodon_accounts', 'mastodon_account_tags'
  )
GROUP BY tablename
ORDER BY tablename;

-- 3. Detailed policy information
SELECT 
  tablename,
  policyname,
  cmd as operation,
  roles,
  CASE 
    WHEN qual IS NOT NULL THEN 'Has USING clause'
    ELSE 'No USING clause'
  END as using_clause,
  CASE 
    WHEN with_check IS NOT NULL THEN 'Has WITH CHECK clause'
    ELSE 'No WITH CHECK clause'
  END as with_check_clause
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'artists', 'arts', 'tags', 'art_tags', 
    'art_sources', 'art_assets', 
    'mastodon_accounts', 'mastodon_account_tags'
  )
ORDER BY tablename, policyname;

-- 4. Check for sensitive tables that should be fully protected
SELECT 
  tablename,
  CASE 
    WHEN COUNT(*) = 0 THEN '❌ NO POLICIES - VULNERABLE!'
    WHEN COUNT(*) FILTER (WHERE cmd = 'SELECT' AND roles::text LIKE '%public%' AND qual = 'false') > 0 
      AND COUNT(*) FILTER (WHERE cmd = 'SELECT' AND roles::text LIKE '%authenticated%' AND qual = 'false') > 0
      THEN '✅ Protected (public and authenticated denied)'
    WHEN COUNT(*) FILTER (WHERE cmd = 'SELECT' AND roles::text LIKE '%public%' AND qual = 'false') > 0
      THEN '⚠️  Partially protected (only public denied)'
    ELSE '❌ NOT FULLY PROTECTED'
  END as security_status
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('mastodon_accounts', 'mastodon_account_tags')
GROUP BY tablename
ORDER BY tablename;

-- 5. Summary of what public can access
SELECT 
  'Public Read Access' as check_type,
  tablename,
  CASE 
    WHEN COUNT(*) FILTER (WHERE cmd = 'SELECT' AND roles::text LIKE '%public%' AND qual = 'true') > 0 
      THEN '✅ Can Read'
    ELSE '❌ Cannot Read'
  END as status
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('artists', 'arts', 'tags', 'art_tags', 'art_sources', 'art_assets')
GROUP BY tablename
ORDER BY tablename;

-- 6. Summary of what public can write
SELECT 
  'Public Write Access' as check_type,
  tablename,
  CASE 
    WHEN COUNT(*) FILTER (WHERE cmd IN ('INSERT', 'UPDATE', 'DELETE') AND roles::text LIKE '%public%' AND (qual = 'false' OR with_check = 'false')) > 0 
      THEN '✅ Write Blocked'
    WHEN COUNT(*) FILTER (WHERE cmd IN ('INSERT', 'UPDATE', 'DELETE') AND roles::text LIKE '%public%') = 0
      THEN '✅ Write Blocked (no policies = denied by default)'
    ELSE '❌ Write Allowed - SECURITY RISK!'
  END as status
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('artists', 'arts', 'tags', 'art_tags', 'art_sources', 'art_assets')
GROUP BY tablename
ORDER BY tablename;
