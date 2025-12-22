# Security Review - Row Level Security (RLS)

## Overview

This document reviews the Row Level Security (RLS) setup for the Wikimedia Commons Art Scraper project to ensure safe public access while protecting sensitive data.

## Current Status

### ✅ What's Protected

1. **Sensitive Tables (Fully Protected)**
   - `mastodon_accounts` - Contains Mastodon access tokens
   - `mastodon_account_tags` - Junction table for tag accounts
   - **Status**: No public or authenticated access (only service role)

2. **Non-Sensitive Tables (Read-Only for Public)**
   - `artists` - Artist information
   - `arts` - Artwork information
   - `tags` - Tag information
   - `art_tags` - Artwork-tag relationships
   - `art_sources` - Source information (Wikimedia Commons URLs)
   - `art_assets` - Storage paths and image metadata
   - **Status**: Public can read, but cannot write

### ⚠️ Issues Found

1. **Policy Syntax Error in Original File**
   - The original `setup-comprehensive-rls.sql` uses `FOR ALL` with both `USING` and `WITH CHECK`
   - PostgreSQL doesn't support this syntax correctly
   - **Solution**: Created `setup-comprehensive-rls-corrected.sql` with proper separate policies for SELECT, INSERT, UPDATE, DELETE

2. **Missing Explicit Deny for Authenticated Users**
   - Sensitive tables should explicitly deny authenticated users (not just public)
   - **Solution**: Added explicit policies for `authenticated` role on sensitive tables

## Recommended Actions

### Step 1: Apply Corrected RLS Policies

Run the corrected SQL file in your Supabase SQL Editor:

```sql
-- Run: docs/setup-comprehensive-rls-corrected.sql
```

This will:
- Enable RLS on all tables
- Create proper read-only policies for public on non-sensitive tables
- Create explicit deny policies for all write operations
- Fully protect sensitive tables from both public and authenticated users

### Step 2: Verify RLS is Enabled

Run this query to verify RLS is enabled on all tables:

```sql
SELECT 
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
```

All tables should show `rls_enabled = true`.

### Step 3: Test Public Access

Test that public users can read non-sensitive data but cannot write:

```bash
# Test 1: Public can read artists (should work)
curl -H "apikey: YOUR_ANON_KEY" \
  "https://YOUR_PROJECT.supabase.co/rest/v1/artists?select=*&limit=5"

# Test 2: Public cannot write (should fail with 403)
curl -X POST \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -d '{"name": "Test Artist"}' \
  "https://YOUR_PROJECT.supabase.co/rest/v1/artists"

# Test 3: Public cannot read tokens (should return empty or 403)
curl -H "apikey: YOUR_ANON_KEY" \
  "https://YOUR_PROJECT.supabase.co/rest/v1/mastodon_accounts?select=*"
```

### Step 4: Verify Service Role Still Works

Your CLI scripts and edge functions use the service role key, which automatically bypasses RLS. Test that your scripts still work:

```bash
# This should still work (uses service role key)
npm run fetch -- --artist "Vincent van Gogh"
```

## Security Model Summary

### Public Access (Anon Key)
- ✅ **Can Read**: artists, arts, tags, art_tags, art_sources, art_assets
- ❌ **Cannot Read**: mastodon_accounts, mastodon_account_tags
- ❌ **Cannot Write**: anything

### Authenticated Users (If Added Later)
- ✅ **Can Read**: artists, arts, tags, art_tags, art_sources, art_assets
- ❌ **Cannot Read**: mastodon_accounts, mastodon_account_tags
- ❌ **Cannot Write**: anything (unless you add specific policies later)

### Service Role (Your Scripts & Edge Functions)
- ✅ **Can Read**: everything
- ✅ **Can Write**: everything
- **Note**: Service role automatically bypasses RLS, so no policies needed

## Sensitive Data Protection

### Mastodon Access Tokens
- **Location**: `mastodon_accounts.mastodon_access_token`
- **Protection**: Fully blocked from public and authenticated users
- **Access**: Only via service role (edge functions)

### Account Information
- **Location**: `mastodon_accounts` table (usernames, base URLs, etc.)
- **Protection**: Fully blocked from public and authenticated users
- **Access**: Only via service role

## Additional Security Recommendations

1. **Never Expose Service Role Key**
   - Keep it in environment variables only
   - Never commit it to git
   - Use `.env` file (already in `.gitignore`)

2. **Monitor Access Logs**
   - Check Supabase logs regularly for unauthorized access attempts
   - Set up alerts for unusual patterns

3. **Rotate Tokens Periodically**
   - Update Mastodon tokens in the database periodically
   - Consider using Supabase Vault for even more security (optional)

4. **Storage Bucket Security**
   - Ensure storage bucket is configured for public read access to images
   - But prevent public write access
   - Review storage policies separately

5. **Edge Function Security**
   - Edge functions should only use service role key
   - Never expose service role key in client-side code
   - Use environment variables in Supabase dashboard

## Testing Checklist

Before going live, verify:

- [ ] RLS is enabled on all tables
- [ ] Public can read non-sensitive tables
- [ ] Public cannot write to any table
- [ ] Public cannot read sensitive tables
- [ ] Service role can still read/write everything
- [ ] Edge functions still work correctly
- [ ] CLI scripts still work correctly

## Files

- **Corrected RLS Setup**: `docs/setup-comprehensive-rls-corrected.sql`
- **Original (Has Issues)**: `docs/setup-comprehensive-rls.sql` (use corrected version instead)
- **Testing Guide**: `docs/test-rls-policies.md`
- **Security Notes**: `SECURITY_NOTES.md`

## Questions or Issues?

If you encounter any issues:
1. Check Supabase logs for error messages
2. Verify policies are created correctly using the verification queries
3. Test with both anon key and service role key to confirm behavior
4. Review PostgreSQL RLS documentation if needed
