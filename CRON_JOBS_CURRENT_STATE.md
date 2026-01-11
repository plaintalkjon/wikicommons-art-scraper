# Current Cron Jobs State

**Last Updated:** Based on actual Supabase configuration

## Active Cron Jobs

There are currently **TWO** cron jobs configured:

### 1. post-art-task
- **Purpose:** Posts artwork to Mastodon for artist, tag, and philosopher accounts
- **Function:** `post-art` (Edge Function)
- **Schedule:** Configured in Supabase dashboard
- **How It Works:**
  - Queries database for all active accounts (artist, tag, philosopher types)
  - Processes accounts that are due to post based on `last_posted_at` timestamps
  - Each account posts independently every N hours (default: 6 hours)
  - Handles multiple account types with different content strategies

### 2. post-mtg-card
- **Purpose:** Posts MTG cards to Mastodon for all MTG bot accounts
- **Function:** `post-mtg-card` (Edge Function)
- **Schedule:** `0 */6 * * *` (Every 6 hours)
- **How It Works:**
  - Queries database for ALL MTG accounts that are due to post
  - Processes each account sequentially
  - Auto-detects bot type from username:
    - `CuratedMTGShowcase` → showcase strategy
    - `CuratedMTGCommander` → commander strategy
    - `CuratedMTGSecretLair` → secret-lair strategy
  - Each account uses appropriate card fetching strategy
  - No need for separate cron jobs per bot type

## Key Points

✅ **Simplified Architecture:** MTG bots consolidated into one cron job  
✅ **Auto-Detection:** Bot types detected from usernames automatically  
✅ **Scalable:** Add new MTG accounts to database, no cron changes needed  
✅ **Efficient:** All due accounts processed in single cron run  

## Verification

To verify cron jobs, run in Supabase SQL Editor:

```sql
SELECT 
  jobid,
  jobname,
  schedule,
  active,
  command::text
FROM cron.job
ORDER BY jobname;
```

Expected results:
- `post-art-task` - Active
- `post-mtg-card` - Active

## Documentation Files Updated

- ✅ `MTG_BOTS_FINAL_STATUS.md` - Updated to reflect single cron job
- ✅ `MTG_BOTS_REVIEW.md` - Updated to reflect simplified setup
- ✅ `CRON_JOBS_CURRENT_STATE.md` - This file (new)

## Outdated Documentation

The following files reference the old multi-cron setup and should be considered historical:
- `create-mtg-commander-cron.sql` - Old approach (separate cron)
- `create-mtg-secret-lair-cron.sql` - Old approach (separate cron)
- `setup-mtg-commander-bot-final.sql` - Old approach (separate cron)
- `fix-cron-jobs.sql` - May reference old setup

**Note:** These files are kept for reference but the current setup uses a single unified cron job.

