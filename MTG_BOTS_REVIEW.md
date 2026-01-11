# MTG Bots Status Review

**Date:** January 10, 2026

## ✅ Bot Accounts (Database)

Both MTG bot accounts are properly configured:

1. **CuratedMTGShowcase**
   - Type: `mtg`
   - Status: Active ✅
   - Last Posted: 2026-01-10 14:33:05 UTC
   - Created: 2026-01-10 13:05:42 UTC

2. **CuratedMTGCommander**
   - Type: `mtg`
   - Status: Active ✅
   - Last Posted: 2026-01-10 14:29:25 UTC
   - Created: 2026-01-10 14:28:14 UTC

## 🔧 Edge Functions

### Active Functions:

1. **post-mtg-card** (Consolidated Function) ✅
   - Version: 10
   - Status: ACTIVE
   - Last Updated: 2026-01-10 14:33:12 UTC
   - **Purpose:** Unified function supporting multiple bot types
   - **Features:**
     - Supports `showcase` and `commander` bot types
     - Auto-detects bot type from username
     - Strategy pattern for card fetching
     - Shared Mastodon posting pipeline

2. **post-mtg-commander** (Legacy Function) ⚠️
   - Version: 2
   - Status: ACTIVE
   - Last Updated: 2026-01-10 14:29:05 UTC
   - **Status:** Can be deprecated - functionality now in consolidated function

## ⏰ Cron Jobs (Actual Configuration)

### Actual Cron Jobs:

1. **post-mtg-card** ✅
   - Schedule: `0 */6 * * *` (Every 6 hours)
   - Function: `post-mtg-card` (no parameters)
   - **How It Works:**
     - Processes ALL MTG accounts that are due to post
     - Auto-detects bot type from username (showcase, commander, secret-lair, etc.)
     - Each account uses appropriate card fetching strategy
   - **Status:** ✅ Configured and working

**Note:** MTG bots were simplified into ONE cron job. The function handles all MTG account types automatically.

## 📋 Action Items

### ✅ Completed:
- [x] Consolidated function created and deployed
- [x] Showcase bot tested and working
- [x] Commander bot tested and working
- [x] Both accounts active in database

### ✅ Completed:
- [x] Simplified to single MTG cron job
- [x] Function auto-detects bot types from usernames
- [x] All MTG accounts processed by one cron job

## 🔍 Verification Steps

To verify everything is working:

1. **Check Cron Jobs:**
   - Go to Supabase Dashboard → SQL Editor
   - Run: `SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE '%mtg%';`
   - Should see only ONE cron job: `post-mtg-card`

2. **Test Functions:**
   ```bash
   # Test Showcase
   curl -X POST 'https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/post-mtg-card?account=CuratedMTGShowcase&bot_type=showcase' \
     -H 'Authorization: Bearer [ANON_KEY]'
   
   # Test Commander
   curl -X POST 'https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/post-mtg-card?account=CuratedMTGCommander&bot_type=commander' \
     -H 'Authorization: Bearer [ANON_KEY]'
   ```

## 📊 Summary

| Component | Status | Notes |
|-----------|--------|-------|
| Bot Accounts | ✅ Good | Both active, posting successfully |
| Consolidated Function | ✅ Good | Version 10, working correctly |
| MTG Cron Job | ✅ Good | Single unified cron processes all accounts |

## 🎯 Current Setup

**Simplified Architecture:**
- ✅ Single cron job (`post-mtg-card`) processes all MTG accounts
- ✅ Function auto-detects bot type from username
- ✅ No need for separate cron jobs per bot type
- ✅ Easy to add new MTG accounts - just add to database, no cron changes needed

**Monitor:** Check that all MTG bots post successfully on next cron run (every 6 hours)

