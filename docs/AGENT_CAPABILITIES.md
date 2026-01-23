# Agent Capabilities & Quick Start Guide

## Overview

This is a **Mastodon bot system** that automatically posts content (artwork, quotes, trading cards) to multiple Mastodon accounts on a schedule. The system uses Supabase Edge Functions, PostgreSQL database, and various CLI tools.

## Key Capabilities

### 1. **Deploy Edge Functions**
- ✅ **You CAN deploy Edge Functions directly**
- Use: `npx supabase functions deploy <function-name>`
- Project is already linked: `lxtkpwsxupzkxuhhmvvz`
- Available functions:
  - `post-art` - Posts artwork and quotes
  - `post-mtg-card` - Posts Magic: The Gathering cards
  - `post-mtg-commander` - Posts MTG commander cards
  - `post-yugioh-card` - Posts Yu-Gi-Oh cards
  - `post-art-health-check` - Health monitoring

### 2. **Run Database Migrations**
- SQL files in root directory (e.g., `migrate-hashtags-system.sql`)
- Run directly in Supabase SQL Editor
- Always check for RLS policies when creating new tables

### 3. **Use CLI Tools**
- All CLI tools are in `src/` directory
- **Must build first**: `npm run build` (compiles TypeScript to `dist/`)
- Run with: `npm run <script-name>`
- Key scripts in `package.json`
- CLI tools use Node.js (not Deno like Edge Functions)

### 4. **Modify Code**
- Edge Functions: `supabase/functions/<function-name>/index.ts`
  - Uses **Deno runtime** (not Node.js)
  - Imports use URLs: `https://deno.land/std@...` or `https://esm.sh/...`
- CLI Tools: `src/cli-*.ts`
  - Uses **Node.js runtime**
  - Standard npm imports
- TypeScript project with `tsconfig.json`

## System Architecture

### Database Tables

**Core Tables:**
- `mastodon_accounts` - Bot account credentials and metadata
- `arts` - Artwork records
- `artists` - Artist information
- `art_assets` - Storage paths for artwork images
- `art_tags` - Junction table for artwork tags
- `tags` - Tag definitions
- `quotes` - Quote text and metadata
- `quote_authors` - Quote author information
- `quote_posts` - Tracks which quotes were posted to which accounts
- `hashtags` - Hashtag definitions
- `mastodon_account_hashtags` - Junction table linking accounts to hashtags

**Account Types:**
- `artist` - Posts artwork from specific artists
- `tag` - Posts artwork tagged with specific tags
- `quote` - Posts quotes from quote authors
- `mtg` - Posts Magic: The Gathering cards
- `yugioh` - Posts Yu-Gi-Oh cards

### Edge Functions

**post-art/index.ts** - Main posting function:
- Handles artist, tag, and quote accounts
- Fetches hashtags from `mastodon_account_hashtags` junction table
- Posts images to Mastodon with hashtags
- Uses cron scheduling (checks `last_posted_at` timestamps)
- **Character limit**: 500 chars for Mastodon posts (quotes checked during selection)

**post-mtg-card/index.ts** - MTG card posting:
- Handles all MTG account types (showcase, commander, secret-lair)
- Auto-detects bot type from username
- Fetches hashtags (uses `#magicthegathering` by default)
- Downloads card images from Scryfall API

**post-yugioh-card/index.ts** - Yu-Gi-Oh card posting:
- Fetches random staple cards
- Fetches hashtags (uses `#yugioh` by default)
- Downloads card images from Yu-Gi-Oh API

**Key Functions (post-art):**
- `fetchAccountHashtags()` - Fetches all hashtags for an account (all account types)
- `formatQuote()` - Formats quote text with hashtags
- `normalizeMastodonUrl()` - Normalizes Mastodon URLs
- `buildMastodonHandle()` - Builds @username@domain format

**Environment Variables:**
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key (full database access)
- Automatically available in Edge Functions (no manual setup needed)

### Hashtag System

- **Hashtags are stored in lowercase** (no `display_name` column)
- **Multiple hashtags per account** via `mastodon_account_hashtags` junction table
- **Fetching**: Uses individual queries in a loop (not `.in()` to avoid issues)
- **Format**: `"Quote text"\n\n#hashtag1 #hashtag2`
- **Fallback**: If no hashtags assigned, uses category-based hashtag

### Posting Flow

1. **Cron Job** (PostgreSQL `cron` extension) triggers Edge Function via HTTP POST
2. Function queries accounts due to post (`last_posted_at` check)
3. For each account:
   - Fetches content (artwork/quote/card)
   - Fetches hashtags from database (all account types use hashtags)
   - Formats post text (with hashtags)
   - Uploads media to Mastodon (if image-based)
   - Waits for media processing (if needed)
   - Creates status post
   - Updates `last_posted_at` timestamp

### Cron Jobs

- **PostgreSQL cron extension** (not traditional system cron)
- Cron jobs are SQL scripts that call Edge Functions via HTTP POST
- Located in SQL files: `create-*-cron.sql`, `fix-*-cron-jobs.sql`
- Can be queried: `SELECT * FROM cron.job`
- Functions respect `last_posted_at` timestamps (interval-based scheduling)
- Each account posts independently every N hours (default: 6 hours)

**Active Cron Jobs:**
- `post-art-task` - Handles artist, tag, and quote accounts
- `post-mtg-card` - Handles all MTG accounts (auto-detects bot type)
- `post-yugioh-card` - Handles Yu-Gi-Oh accounts

## Common Tasks

### Add Hashtags to Account
```bash
npm run manage-hashtags -- --account username --add philosophy stoicism
```

### Deploy Edge Function
```bash
npx supabase functions deploy post-art
```

### Run Database Migration
1. Open SQL file (e.g., `migrate-hashtags-system.sql`)
2. Copy contents
3. Paste into Supabase SQL Editor
4. Run

### Check Account Hashtags
```bash
npm run manage-hashtags -- --account username --list
```

### Verify Database State
```bash
npm run debug-hashtags
```

### Trigger Function Manually (Testing)
```bash
curl -X POST \
  'https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/post-art' \
  -H 'Authorization: Bearer <anon-key>'
```

### Check Cron Jobs
Run in Supabase SQL Editor:
```sql
SELECT jobid, jobname, schedule, active 
FROM cron.job 
ORDER BY jobname;
```

### View Edge Function Logs
1. Go to Supabase Dashboard → Edge Functions → `post-art`
2. Click "Logs" tab
3. Filter by execution ID or timestamp

## Important Patterns

### 1. **Hashtag Fetching**
Always fetch hashtags individually in a loop:
```typescript
for (const hashtagId of hashtagIds) {
  const { data } = await supabase
    .from("hashtags")
    .select("name")
    .eq("id", hashtagId)
    .single();
  // Process...
}
```

### 2. **RLS Policies**
Always add RLS policies when creating new tables:
- Service role: Full access
- Public/Authenticated: Read access (where appropriate)

### 3. **Logging**
Use consistent log prefixes:
- `🚀 CRON` - Cron/Edge Function logs
- `🃏 MTG BOT` - MTG-specific logs
- `🚀 CRON HASHTAG` - Hashtag-related logs
- `🚀 CRON DEBUG` - Debug information

### 4. **Error Handling**
- Always check for errors in Supabase queries
- Log errors with full context
- Use fallbacks for backward compatibility

### 5. **Hashtags for All Account Types**
- **All account types** now use hashtags from database:
  - Artist accounts → `#art` (default)
  - Tag accounts → `#art` (default)
  - Quote accounts → Category-based or assigned hashtags
  - MTG accounts → `#magicthegathering` (default)
  - Yu-Gi-Oh accounts → `#yugioh` (default)
- Always fetch hashtags using `fetchAccountHashtags()` function
- Fallback to default hashtag if none assigned

### 6. **Media Uploads**
- Upload media first, get `media_id`
- Wait for processing (check `state` field)
- Only create status post after media is processed
- Handle `failed` state gracefully

## Deployment Workflow

1. **Make Code Changes**
   - Edit files in `supabase/functions/` or `src/`
   - Test locally if possible

2. **Deploy Edge Functions**
   ```bash
   npx supabase functions deploy <function-name>
   ```
   - Verify deployment: Check Supabase Dashboard → Edge Functions
   - Deployment shows success message with function URL

3. **Run Database Migrations**
   - Copy SQL to Supabase SQL Editor
   - Run and verify
   - Check for errors in SQL Editor output

4. **Test**
   - Check Edge Function logs (Dashboard → Functions → Logs)
   - Verify database state (use CLI tools or SQL queries)
   - Test manually with curl (see Quick Reference)
   - Wait for next cron run or trigger manually

## File Locations

- **Edge Functions**: `supabase/functions/<name>/index.ts`
- **CLI Tools**: `src/cli-*.ts`
- **SQL Migrations**: Root directory `*.sql`
- **Documentation**: `docs/*.md`
- **Package Scripts**: `package.json` → `scripts`

## Quick Reference

### Supabase CLI Commands
```bash
npx supabase functions deploy <name>    # Deploy function
npx supabase projects list              # List projects
npx supabase status                     # Check status (requires Docker)
```

### NPM Scripts
```bash
npm run build                           # Build TypeScript
npm run manage-hashtags -- --help       # Hashtag management
npm run debug-hashtags                 # Debug hashtags
npm run add-mastodon-account -- --help  # Add account
```

### Database Queries
- Always use Supabase client: `createClient(url, key)`
- Use service role key for Edge Functions
- Check for errors before processing data
- Use `.single()` when expecting one result
- Use `.in()` for multiple IDs (but fetch hashtags individually)

### Manual Function Testing
```bash
# Test post-art function
curl -X POST 'https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/post-art?max_accounts=1' \
  -H 'Authorization: Bearer <anon-key>'

# Test with specific account
curl -X POST 'https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/post-art?account=username' \
  -H 'Authorization: Bearer <anon-key>'
```

## Troubleshooting

### Hashtags Not Appearing
1. Check database: `npm run debug-hashtags`
2. Check Edge Function logs for hashtag fetch errors
3. Verify RLS policies allow service role access

### Function Not Deploying
- Check project is linked: `npx supabase projects list`
- Verify function file exists: `supabase/functions/<name>/index.ts`

### Database Errors
- Check RLS policies
- Verify foreign key constraints
- Check for missing indexes

### Function Not Posting
- Check `last_posted_at` timestamps (accounts may not be due)
- Verify account is `active = true`
- Check Edge Function logs for errors
- Verify cron job is active: `SELECT * FROM cron.job WHERE jobname = 'post-art-task'`
- Function may process multiple accounts per run (check `max_accounts` parameter)

### Adding New Account Types
1. Update constraint in `mastodon_accounts` table:
   ```sql
   ALTER TABLE mastodon_accounts 
   DROP CONSTRAINT mastodon_accounts_account_type_check;
   
   ALTER TABLE mastodon_accounts 
   ADD CONSTRAINT mastodon_accounts_account_type_check 
   CHECK (account_type IN ('artist', 'tag', 'quote', 'mtg', 'yugioh', 'newtype'));
   ```
2. Update Edge Function code to handle new type
3. Add default hashtags for new type in migration

### Media Upload Fails
- Check Mastodon access token is valid
- Verify Mastodon instance URL is correct
- Check media file size limits
- Wait for media processing before posting status

## Best Practices

1. **Always deploy after code changes** - Don't assume manual deployment
2. **Add RLS policies** - Security first
3. **Use consistent logging** - Makes debugging easier
4. **Test with CLI tools** - Before relying on cron
5. **Document changes** - Update relevant docs
6. **Use fallbacks** - Maintain backward compatibility
7. **Build CLI tools first** - Run `npm run build` before using CLI scripts
8. **Check logs after deployment** - Verify function is working correctly
9. **Test manually** - Use curl to trigger functions for testing
10. **Fetch hashtags individually** - Avoid `.in()` queries for reliability

## Key Insights

- **You can deploy Edge Functions directly** - Use `npx supabase functions deploy`
- **Hashtags use individual queries** - Avoid `.in()` for reliability (critical!)
- **Project is pre-linked** - No need to link again
- **All hashtags lowercase** - No display names
- **Multiple hashtags supported** - Via junction table
- **Cron uses `last_posted_at`** - Check timestamps for scheduling
- **All account types use hashtags** - Not just quote accounts
- **Cron jobs are SQL-based** - PostgreSQL cron extension, not system cron
- **Functions can be triggered manually** - Use curl for testing
- **Character limit: 500 chars** - Mastodon post limit, checked during quote selection
- **Media must be processed** - Wait for `state = 'processed'` before posting
- **CLI tools need building** - Run `npm run build` first

## Common Gotchas

1. **Hashtags only showing one** - Use individual queries, not `.in()` (critical fix!)
2. **Function not deploying** - Check file exists and project is linked
3. **Accounts not posting** - Check `last_posted_at` and `active` status
4. **Media upload fails** - Check token validity and wait for processing
5. **CLI script errors** - Run `npm run build` first
6. **RLS blocking queries** - Ensure service role has access
7. **Edge Function uses Deno** - Different import syntax than Node.js
8. **Quote accounts are text-only** - No media uploads, just text posts
9. **Artist/tag accounts post images** - Require media upload workflow
10. **Cron jobs are SQL-based** - Created/managed via SQL scripts, not CLI

---

**Last Updated**: 2026-01-18
**Project Reference**: lxtkpwsxupzkxuhhmvvz
**Supabase Project**: Curator (lxtkpwsxupzkxuhhmvvz)
