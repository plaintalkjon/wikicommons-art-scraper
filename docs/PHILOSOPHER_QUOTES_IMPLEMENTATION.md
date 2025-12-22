# Philosopher Quotes Bot - Implementation Complete

## ✅ Implementation Status

All code has been implemented! The philosopher quotes bot is ready to use once the database schema is applied.

## What Was Implemented

### 1. Database Schema ✅
- **File**: `docs/create-philosophers-schema.sql`
- Creates `philosophers`, `quotes`, and `quote_posts` tables
- Extends `mastodon_accounts` to support `philosopher` account type
- Includes RLS policies for public read access

### 2. Quote Extraction Module ✅
- **File**: `src/wikiquotes.ts`
- Fetches quotes from Wikiquotes via MediaWiki API
- Extracts quotes from HTML sections
- Filters quotes to fit Mastodon's 500 character limit
- Finds philosopher QIDs in Wikidata

### 3. Quote Pipeline ✅
- **File**: `src/quote-pipeline.ts`
- Fetches and stores quotes in database
- Handles duplicates and validation
- Skips quotes that are too long (>500 chars)

### 4. CLI Tools ✅
- **`npm run fetch-quotes`**: Fetch quotes for a philosopher
  ```bash
  npm run fetch-quotes -- --philosopher "Friedrich Nietzsche"
  ```
- **`npm run add-philosopher-bot`**: Add a philosopher bot account
  ```bash
  npm run add-philosopher-bot -- --philosopher "Friedrich Nietzsche" --token "access_token" --username "@NietzscheQuotes@mastodon.social"
  ```

### 5. Edge Function Integration ✅
- **File**: `supabase/functions/post-art/index.ts`
- Extended to support philosopher accounts
- Added `postForPhilosopher()` function
- Quotes are posted as text-only (no images)
- Tracks posting history in `quote_posts` table
- Resets when all quotes have been posted

## Next Steps

### Step 1: Apply Database Schema

Run the SQL schema in Supabase SQL Editor:

```sql
-- Run: docs/create-philosophers-schema.sql
```

This will create:
- `philosophers` table
- `quotes` table
- `quote_posts` table
- Extend `mastodon_accounts` table
- Set up RLS policies

### Step 2: Fetch Quotes for Nietzsche

Once the schema is applied, fetch quotes:

```bash
npm run fetch-quotes -- --philosopher "Friedrich Nietzsche"
```

This will:
- Look up Nietzsche's Wikidata QID (Q9358)
- Fetch quotes from Wikiquotes
- Store them in the database
- Skip quotes longer than 500 characters

### Step 3: Add Philosopher Bot Account

Add a Mastodon account for Nietzsche:

```bash
npm run add-philosopher-bot -- \
  --philosopher "Friedrich Nietzsche" \
  --token "your_access_token" \
  --username "@NietzscheQuotes@mastodon.social"
```

### Step 4: Deploy Updated Edge Function

Deploy the updated `post-art` function:

```bash
./deploy-post-art.sh
```

### Step 5: Test Posting

The account will automatically be included in the interval-based rotation. Test manually:

```bash
curl -X POST \
  "https://YOUR_PROJECT.supabase.co/functions/v1/post-art?philosopher=Friedrich%20Nietzsche" \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

Or let the cron job handle it automatically (runs every 10 minutes).

## How It Works

### Quote Fetching
1. Looks up philosopher in Wikidata (occupation: philosopher)
2. Fetches Wikiquotes page via MediaWiki API
3. Extracts quotes from HTML sections
4. Filters to quotes ≤500 characters (Mastodon limit)
5. Stores in database with philosopher association

### Quote Posting
1. Selects next unposted quote (or oldest if all posted)
2. Formats quote with attribution: `"Quote text"\n\n— Philosopher Name`
3. Posts to Mastodon (text-only, no media)
4. Records in `quote_posts` table
5. Resets when all quotes posted

### Rotation
- Uses same interval-based system as artist/tag accounts
- Default: 4 posts per day per account (every 6 hours)
- Automatically includes philosopher accounts in rotation

## Example Quote Format

```
"That which does not kill us makes us stronger."

— Friedrich Nietzsche
```

If source is available:
```
"Without music, life would be a mistake."

— Friedrich Nietzsche, The Twilight of the Idols
```

## Database Schema Overview

### philosophers
- `id` (UUID)
- `name` (TEXT, unique)
- `wikidata_qid` (TEXT)
- `created_at`, `updated_at`

### quotes
- `id` (UUID)
- `philosopher_id` (UUID, FK)
- `text` (TEXT)
- `source` (TEXT, optional)
- `section` (TEXT, optional)
- `character_count` (INTEGER)
- Unique constraint: `(philosopher_id, text)`

### quote_posts
- `id` (UUID)
- `quote_id` (UUID, FK)
- `mastodon_account_id` (UUID, FK)
- `mastodon_status_id` (TEXT)
- `posted_at` (TIMESTAMPTZ)
- Unique constraint: `(quote_id, mastodon_account_id)`

### mastodon_accounts (extended)
- Added `philosopher_id` column
- Updated `account_type` check to include `'philosopher'`

## Testing

### Test Quote Fetching (Dry Run)
```bash
npm run fetch-quotes -- --philosopher "Friedrich Nietzsche" --dry-run
```

### Test Quote Fetching (Store)
```bash
npm run fetch-quotes -- --philosopher "Friedrich Nietzsche"
```

### Verify Quotes in Database
```sql
SELECT COUNT(*) FROM quotes WHERE philosopher_id = (
  SELECT id FROM philosophers WHERE name = 'Friedrich Nietzsche'
);
```

## Notes

- **Quote Length**: Quotes longer than 500 characters are automatically skipped
- **No Images**: Philosopher quotes are text-only (unlike artwork posts)
- **Attribution**: Quotes include philosopher name, optionally with source
- **Rotation**: Same scheduling system as artist/tag accounts
- **Reset**: When all quotes posted, history resets and starts over

## Future Enhancements

- Add source attribution extraction from Wikiquotes sections
- Support multiple languages per philosopher
- Add quote quality scoring
- Support quote categories/themes
- Add quote search/filtering
