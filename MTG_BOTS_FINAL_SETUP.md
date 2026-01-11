# MTG Bots - Final Setup Summary

**Date:** January 10, 2026  
**Status:** ✅ ALL SYSTEMS OPERATIONAL

## ✅ Setup Complete

### Architecture: Single Cron Job Approach

**One cron job** (`post-mtg-card`) processes **all MTG accounts** automatically.

### MTG Bot Accounts

1. **CuratedMTGShowcase**
   - Bot Type: `showcase` (auto-detected)
   - Filters: Cards with showcase frame effects
   - Status: ✅ Active

2. **CuratedMTGCommander**
   - Bot Type: `commander` (auto-detected)
   - Filters: Cards with EDHREC rank < 1000
   - Status: ✅ Active

3. **CuratedMTGSecretLair**
   - Bot Type: `secret-lair` (auto-detected)
   - Filters: Cards with set code "sld"
   - Status: ✅ Active

### Edge Function

- **Function:** `post-mtg-card` (Consolidated)
- **Version:** 13
- **Status:** ACTIVE
- **Last Updated:** 2026-01-10 22:40:47 UTC

**Features:**
- Processes all due MTG accounts in a single run
- Auto-detects bot type from username
- Strategy pattern for different card filters
- Shared Mastodon posting pipeline

### Cron Job

- **Name:** `post-mtg-card`
- **Schedule:** Every 6 hours (`0 */6 * * *`)
- **URL:** `post-mtg-card` (no account parameter)
- **Behavior:** Processes all accounts that are due (haven't posted in 6+ hours)

### How It Works

1. Cron job runs every 6 hours
2. Calls function without account parameter
3. Function queries database for all MTG accounts due to post
4. Processes each due account sequentially:
   - Detects bot type from username
   - Uses appropriate card fetching strategy
   - Posts to Mastodon
   - Updates `last_posted_at`
5. Returns summary of processed accounts

### Benefits

✅ **Single cron job** - Easy to manage  
✅ **Automatic rotation** - Each account posts independently  
✅ **Easy to scale** - Add new accounts to DB, no cron changes needed  
✅ **Better error handling** - One failure doesn't stop others  
✅ **Consolidated code** - One function, multiple strategies  

### Adding New MTG Bots

To add a new MTG bot:

1. Add account to database:
   ```sql
   INSERT INTO mastodon_accounts (
     account_username,
     mastodon_base_url,
     mastodon_access_token,
     account_type,
     active
   ) VALUES (
     'YourBotName',
     'https://mastodon.social',
     'your-token',
     'mtg',
     true
   );
   ```

2. Add bot type detection in function (if needed):
   - Update `detectBotType()` function
   - Add new strategy class if needed
   - Update `getCardFetchStrategy()` function

3. Deploy function:
   ```bash
   npx supabase functions deploy post-mtg-card
   ```

**No cron job changes needed!** The existing cron job will automatically pick up the new account.

### Verification

All systems tested and working:
- ✅ Function processes multiple accounts
- ✅ Bot type auto-detection working
- ✅ Card fetching strategies working
- ✅ Mastodon posting working
- ✅ Rate limiting working
- ✅ Cron job configured

### Files

- **Function:** `supabase/functions/post-mtg-card/index.ts`
- **Cron SQL:** `setup-mtg-bots-single-cron.sql`
- **Account Setup:** Individual setup files for each bot type

