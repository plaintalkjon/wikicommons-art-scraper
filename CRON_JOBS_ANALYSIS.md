# Cron Jobs Analysis - Actual State

## Current Status

**Actual Setup:** There are **TWO** cron jobs configured:
1. `post-art-task` - Handles all art posting (artist, tag, philosopher accounts)
2. `post-mtg-card` - Handles all MTG accounts (unified, auto-detects bot types)

## Actual Cron Jobs

### 1. post-art-task ✅
- **Purpose**: Posts artwork to Mastodon for artist, tag, and philosopher accounts
- **Function**: `post-art` (Edge Function)
- **Schedule**: Configured in Supabase dashboard
- **Status**: ✅ Active

### 2. post-mtg-card ✅
- **Purpose**: Posts MTG cards to Mastodon for ALL MTG bot accounts
- **Function**: `post-mtg-card` (Edge Function, no parameters)
- **Schedule**: `0 */6 * * *` (every 6 hours)
- **How It Works**:
  - Queries database for ALL MTG accounts that are due to post
  - Auto-detects bot type from username (showcase, commander, secret-lair, etc.)
  - Processes each account sequentially with appropriate strategy
- **Status**: ✅ Active

## Documentation Updates Made

### ✅ Resolved Issues

1. **MTG Cron Jobs Simplified**
   - **Old Documentation**: Referenced multiple cron jobs (post-mtg-card, post-mtg-commander, post-mtg-secret-lair)
   - **Actual Setup**: Single unified cron job (`post-mtg-card`) processes all MTG accounts
   - **Status**: ✅ Documentation updated to match reality

2. **Architecture Clarified**
   - **How It Works**: Function auto-detects bot type from username
   - **No Parameters Needed**: Cron job calls function without parameters
   - **Scalable**: Add new MTG accounts to database, no cron changes needed
   - **Status**: ✅ Documentation updated

### 📝 Files Updated

- ✅ `MTG_BOTS_FINAL_STATUS.md` - Updated cron job section
- ✅ `MTG_BOTS_REVIEW.md` - Updated to reflect single cron job
- ✅ `CRON_JOBS_ANALYSIS.md` - This file (updated with actual state)
- ✅ `CRON_JOBS_CURRENT_STATE.md` - New file documenting current setup

## Verification Query

To verify cron jobs, run in Supabase SQL Editor:

```sql
SELECT 
  jobid,
  jobname,
  schedule,
  active,
  command::text as command_text
FROM cron.job
ORDER BY jobname;
```

Expected results:
- `post-art-task` - Active
- `post-mtg-card` - Active

## Summary

✅ **Documentation Updated**: All documentation now reflects the actual setup  
✅ **Two Cron Jobs**: `post-art-task` and `post-mtg-card`  
✅ **Simplified Architecture**: MTG bots use single unified cron job  
✅ **Auto-Detection**: Bot types detected from usernames automatically  

## Historical Files

The following SQL files reference the old multi-cron setup and are kept for reference:
- `create-mtg-commander-cron.sql` - Old approach (separate cron)
- `create-mtg-secret-lair-cron.sql` - Old approach (separate cron)  
- `setup-mtg-commander-bot-final.sql` - Old approach (separate cron)
- `fix-cron-jobs.sql` - May reference old setup

**Note:** Current setup uses single unified cron job. These files are historical.

