# Cron Jobs Issue - Explanation and Fix

## 🔍 Problem Identified

### Issue 1: Multiple Conflicting MTG Cron Jobs
You have multiple cron jobs that are conflicting:

1. **`post-mtg-card`** - Calls function without parameters (processes ALL MTG accounts)
2. **`post-mtg-commander`** - Calls function with `?bot_type=commander` (but STILL processes ALL MTG accounts)
3. **`post-mtg-secret-lair`** - Calls function with `?bot_type=secret-lair` (but STILL processes ALL MTG accounts)

**The Problem:** The `bot_type` parameter only affects which card fetching strategy is used, NOT which accounts are processed. When the function runs without an `account` parameter, it queries the database for ALL MTG accounts that are due to post. This means:

- All three cron jobs try to process the same accounts
- This causes race conditions
- Accounts might get posted multiple times
- Or accounts might be skipped due to timing conflicts

### Issue 2: No Yu-Gi-Oh Cron Job
The Yu-Gi-Oh bot function exists and works, but there's no cron job set up to run it automatically.

## ✅ Solution

### Correct Architecture

**Single Cron Job Per Bot Type:**
- **MTG:** One cron job (`post-mtg-card`) that processes ALL MTG accounts
- **Yu-Gi-Oh:** One cron job (`post-yugioh-card`) that processes ALL Yu-Gi-Oh accounts

**How It Works:**
1. Cron job calls function WITHOUT account parameter
2. Function queries database for all accounts of that type that are due to post
3. Function processes each account sequentially
4. Each account uses its appropriate strategy (auto-detected from username)

### Why This Works Better

✅ **No Conflicts:** Only one cron job per bot type  
✅ **Automatic:** Add new accounts to DB, no cron changes needed  
✅ **Efficient:** Processes all due accounts in one run  
✅ **Safe:** Built-in rate limiting and duplicate prevention  

## 🔧 Fix Steps

1. **Run `fix-cron-jobs.sql`** in Supabase SQL Editor
   - Removes all duplicate/conflicting cron jobs
   - Sets up correct single cron jobs for MTG and Yu-Gi-Oh

2. **Verify with `check-cron-jobs.sql`**
   - Shows current cron job configuration
   - Confirms only the correct jobs are active

3. **Monitor Function Logs**
   - Check Supabase Dashboard → Edge Functions → Logs
   - Verify accounts are posting correctly

## 📋 Expected Cron Jobs After Fix

After running the fix script, you should have exactly **2 cron jobs**:

1. **`post-mtg-card`**
   - Schedule: Every 6 hours (`0 */6 * * *`)
   - URL: `post-mtg-card` (no parameters)
   - Processes: All MTG accounts (showcase, commander, secret-lair)

2. **`post-yugioh-card`**
   - Schedule: Every 6 hours (`0 */6 * * *`)
   - URL: `post-yugioh-card` (no parameters)
   - Processes: All Yu-Gi-Oh accounts

## 🎯 How Accounts Are Processed

### MTG Accounts
- Function queries: `account_type = 'mtg'` AND `active = true`
- Bot type auto-detected from username:
  - `CuratedMTGShowcase` → showcase strategy
  - `CuratedMTGCommander` → commander strategy
  - `CuratedMTGSecretLair` → secret-lair strategy

### Yu-Gi-Oh Accounts
- Function queries: `account_type = 'yugioh'` AND `active = true`
- All accounts use the same staple card strategy

## ⚠️ Important Notes

- **Don't create multiple cron jobs** for the same bot type
- **Don't use `bot_type` parameter** in cron URLs (it's only for manual testing)
- **Single cron job per type** is the correct pattern
- The function handles all the logic internally

