# Code Cleanup Plan

## Files to Delete

### Obsolete SQL Scripts (Replaced by Hourly Rotation)
These were replaced by `schedule-hourly-rotation.sql`:
- `docs/schedule-auto-rotation.sql` ❌
- `docs/schedule-staggered-posts.sql` ❌
- `docs/schedule-split-accounts.sql` ❌
- `docs/verify-auto-rotation-schedule.sql` ❌
- `docs/verify-staggered-schedule.sql` ❌
- `docs/fix-timeout-issue.sql` ❌ (temporary fix, no longer needed)
- `docs/update-to-4-posts-per-day.sql` ❌ (one-time update, already applied)

### Obsolete SQL Scripts (One-Time Setups - Already Applied)
These were one-time migrations that are already done:
- `docs/add-vincent-van-gogh-account.sql` ❌
- `docs/add-thomas-cole-schedule.sql` ❌
- `docs/add-courbet-schedule.sql` ❌
- `docs/add-last-posted-column.sql` ❌ (if already applied)
- `docs/add-art-assets-last-posted.sql` ❌ (if already applied)
- `setup-schedule.sql` ❌ (old initial setup)
- `setup-multi-artist-schedule.sql` ❌ (old approach)
- `verify-schedule.sql` ❌ (old verification)

### Obsolete SQL Scripts (Replaced by v2)
- `docs/add-tag-account-support.sql` ❌ (replaced by add-tag-account-support-v2.sql)
- `docs/setup-comprehensive-rls.sql` ❌ (has syntax errors, replaced by setup-comprehensive-rls-corrected.sql)
- `docs/create-mastodon-accounts-table.sql` ❌ (duplicate of mastodon-accounts-schema.sql)

### Obsolete Edge Functions (Replaced by Generic post-art)
- `supabase/functions/vincent-van-gogh/` ❌ (entire directory)
- `supabase/functions/mastodon-post/` ❌ (entire directory - replaced by post-art)

### Obsolete Documentation
- `docs/ADD_BAROQUE_TAG_ACCOUNT.md` ❌ (replaced by ADD_BAROQUE_TAG_ACCOUNT_V2.md)

### Obsolete Deploy Scripts
- `deploy-vincent-van-gogh.sh` ❌
- `deploy-function.sh` ❌ (if it's for mastodon-post)

### Obsolete Migrations
- `supabase/migrations/20241211000000_schedule_vincent_van_gogh.sql` ❌

### Obsolete CLI Scripts
- `src/cli-update-titles.ts` ❌ (deprecated, replaced by cli-clean-titles.ts)
- `src/cli-apply-rls.ts` ❌ (removed - just prints SQL, user can read file directly)

## Files to Keep

### Active SQL Scripts
- `docs/schedule-hourly-rotation.sql` ✅ (CURRENT system)
- `docs/add-tag-account-support-v2.sql` ✅ (current migration)
- `docs/setup-comprehensive-rls-corrected.sql` ✅ (current RLS setup - corrected version)
- `docs/mastodon-accounts-schema.sql` ✅ (base table creation - reference)
- `docs/check-cron-status.sql` ✅ (useful diagnostic)
- `docs/check-http-responses.sql` ✅ (useful diagnostic)
- `docs/schema.sql` ✅ (database schema reference)

### Active CLI Scripts
- `src/cli.ts` ✅ (main fetch)
- `src/cli-retry.ts` ✅ (retry failures)
- `src/cli-fetch-specific.ts` ✅ (fetch specific artwork)
- `src/cli-add-artist-bot.ts` ✅ (add artist bot accounts)
- `src/cli-add-tag-bot.ts` ✅ (add tag bot accounts)
- `src/cli-clean-titles.ts` ✅ (clean titles)
- `src/cli-tag-existing.ts` ✅ (tag existing artworks)
- `src/cli-delete.ts` ✅ (delete art)

### Active Edge Functions
- `supabase/functions/post-art/` ✅ (CURRENT generic function)

### Active Deploy Scripts
- `deploy-post-art.sh` ✅ (current deployment)

## Documentation to Review/Update
These might reference obsolete files:
- `docs/AUTO_ROTATION_SETUP.md` - might reference old scripts
- `docs/FIX_CRON_TIMEOUT.md` - might reference old scripts
- `GENERIC_FUNCTION_GUIDE.md` - mentions migration from vincent-van-gogh
- Various other .md files that might reference old approaches


