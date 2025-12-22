# Code Bloat Removal Report

## Summary

After reviewing the codebase, here are files and code that can be removed to reduce bloat:

## Files to Remove

### 1. Unused CLI Script
- **`src/cli-apply-rls.ts`** ❌
  - **Reason**: Just prints SQL file contents - user can read the file directly
  - **Impact**: No functionality lost, just convenience wrapper
  - **Action**: Delete file

### 2. Obsolete Documentation
- **`docs/ADD_BAROQUE_TAG_ACCOUNT.md`** ❌
  - **Reason**: Replaced by `docs/ADD_BAROQUE_TAG_ACCOUNT_V2.md` (multi-tag version)
  - **Impact**: Old single-tag approach, no longer used
  - **Action**: Delete file

- **`docs/setup-comprehensive-rls.sql`** ❌
  - **Reason**: Has syntax errors (FOR ALL with USING/WITH CHECK), replaced by `setup-comprehensive-rls-corrected.sql`
  - **Impact**: Broken SQL that shouldn't be used
  - **Action**: Delete file (keep only corrected version)

### 3. Duplicate SQL Files
- **`docs/create-mastodon-accounts-table.sql`** vs **`docs/mastodon-accounts-schema.sql`** 
  - **Reason**: Both create the same table with nearly identical content
  - **Impact**: Redundant - keep one as reference
  - **Action**: Keep `mastodon-accounts-schema.sql` (more complete), delete `create-mastodon-accounts-table.sql`

### 4. One-Time Migration SQL (Already Applied)
These are one-time migrations that have already been applied to the database:

- **`docs/add-last-posted-column.sql`** ⚠️
  - **Reason**: One-time migration, already applied
  - **Impact**: Safe to remove if confirmed applied
  - **Action**: Archive or delete (verify first)

- **`docs/add-art-assets-last-posted.sql`** ⚠️
  - **Reason**: One-time migration, already applied
  - **Impact**: Safe to remove if confirmed applied
  - **Action**: Archive or delete (verify first)

### 5. Potentially Obsolete Documentation
These may overlap or be outdated:

- **`docs/FIX_CRON_TIMEOUT.md`** ⚠️
  - **Reason**: Temporary fix documentation, may be obsolete
  - **Action**: Review - if issue is resolved, can remove

- **`docs/AUTO_ROTATION_SETUP.md`** vs **`docs/HOURLY_ROTATION_SETUP.md`** ⚠️
  - **Reason**: May overlap - check if both are needed
  - **Action**: Review and consolidate if duplicate

- **`MULTI_ACCOUNT_SETUP.md`** vs **`MULTI_TOKEN_SOLUTION.md`** vs **`MULTI_ARTIST_SCHEDULING.md`** ⚠️
  - **Reason**: May have overlapping content
  - **Action**: Review and consolidate if duplicate

- **`DEPLOY_INSTRUCTIONS.md`** vs **`DEPLOY_EDGE_FUNCTION.md`** ⚠️
  - **Reason**: May overlap
  - **Action**: Review and consolidate if duplicate

## Files to Keep (Important)

### Active SQL Scripts
- ✅ `docs/schedule-hourly-rotation.sql` - Current scheduling system
- ✅ `docs/add-tag-account-support-v2.sql` - Current tag account migration
- ✅ `docs/setup-comprehensive-rls-corrected.sql` - Corrected RLS setup
- ✅ `docs/mastodon-accounts-schema.sql` - Table schema reference
- ✅ `docs/check-cron-status.sql` - Diagnostic tool
- ✅ `docs/check-http-responses.sql` - Diagnostic tool
- ✅ `docs/verify-rls-status.sql` - RLS verification
- ✅ `docs/schema.sql` - Database schema reference

### Active CLI Scripts
- ✅ All scripts in `src/` except `cli-apply-rls.ts`

### Active Documentation
- ✅ `docs/SECURITY_REVIEW.md` - Security documentation
- ✅ `docs/APPLY_RLS.md` - RLS application guide
- ✅ `docs/ADD_BAROQUE_TAG_ACCOUNT_V2.md` - Current tag account guide
- ✅ `HOW_IT_WORKS.md` - System overview
- ✅ `ADD_ARTIST_BOT_GUIDE.md` - Active guide

## Recommended Actions

### Immediate Removals (Safe)
1. Delete `src/cli-apply-rls.ts`
2. Delete `docs/ADD_BAROQUE_TAG_ACCOUNT.md` (obsolete)
3. Delete `docs/setup-comprehensive-rls.sql` (has errors)
4. Delete `docs/create-mastodon-accounts-table.sql` (duplicate)

### Review Before Removing
1. Check if `docs/add-last-posted-column.sql` was applied
2. Check if `docs/add-art-assets-last-posted.sql` was applied
3. Review documentation files for overlap and consolidate

### Documentation Consolidation
Consider creating a single `SETUP.md` or `GUIDE.md` that consolidates:
- Setup instructions
- Deployment instructions
- Account management
- Scheduling setup

## Estimated Space Savings

- **Files to delete**: ~5-7 files
- **Estimated reduction**: ~50-100 KB
- **Maintenance benefit**: Reduced confusion, clearer codebase

## Notes

- **Failure files** (`failures/*.json`) - Keep these for retry functionality
- **Test files** - Keep `test-post-art.sh` and `test-width-threshold.js` for testing
- **Supabase temp files** - `.temp/` directory is auto-generated, can ignore
