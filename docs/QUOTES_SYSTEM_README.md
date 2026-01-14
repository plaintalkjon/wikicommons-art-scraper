# Quotes System - Complete Guide

## System Overview

This is a **generalized quote import and posting system** that supports quotes from philosophers, authors, politicians, scientists, and any other quote-worthy individuals. Quotes are stored in a database and automatically posted to Mastodon via cron jobs.

## Architecture

### Database Tables

1. **`quote_authors`** - Stores quote authors
   - `id` - UUID primary key
   - `name` - Author name (e.g., "Marcus Aurelius")
   - `category` - Type: 'philosopher', 'author', 'politics', etc.
   - `created_at`, `updated_at` - Timestamps

2. **`quotes`** - Stores individual quotes
   - `id` - UUID primary key
   - `text` - Quote text (cleaned, no reference notation)
   - `author_id` - Foreign key to `quote_authors`
   - `source` - Source work (e.g., "Meditations")
   - `character_count` - INTEGER NOT NULL (calculated automatically)
   - `created_at` - Timestamp
   - `posted_at` - Timestamp (null until posted)

3. **`mastodon_accounts`** - Bot accounts for posting
   - `id` - UUID primary key
   - `account_username` - Mastodon username
   - `mastodon_base_url` - Mastodon instance URL
   - `mastodon_access_token` - Access token
   - `account_type` - 'philosopher', 'artist', 'tag', etc.
   - `author_id` - Foreign key to `quote_authors` (for philosopher accounts)
   - `active` - Boolean
   - `last_posted_at` - Timestamp

## Importing Quotes

### Step 1: Run Database Migration (One-Time)

If you haven't already, run `migrate-quotes-to-general.sql` in Supabase SQL Editor to:
- Rename `philosophers` → `quote_authors`
- Rename `philosopher_id` → `author_id`
- Add `category` column
- Add `source` column to quotes
- Update all foreign keys

### Step 2: Import Quotes from Wikiquote

```bash
# Test first (dry run)
npm run wikiquote-scrape -- --philosopher "Marcus Aurelius" --url "https://en.wikiquote.org/wiki/Marcus_Aurelius" --dry-run

# Real import
npm run wikiquote-scrape -- --philosopher "Marcus Aurelius" --url "https://en.wikiquote.org/wiki/Marcus_Aurelius"
```

**What happens:**
1. Fetches Wikiquote page HTML
2. Extracts quotes from "Quotes" → "Meditations" section
3. Cleans quote text (removes reference notation, translation markers, citations)
4. Filters out non-English quotes
5. Deduplicates by reference (keeps first English translation)
6. Creates quote author if doesn't exist (category='philosopher')
7. Inserts quotes with `source="Meditations"` and calculated `character_count`

### Step 3: Verify Import

```sql
-- Check quote count
SELECT COUNT(*) FROM quotes 
WHERE author_id = (SELECT id FROM quote_authors WHERE name = 'Marcus Aurelius');

-- View sample quotes
SELECT text, source, character_count, created_at
FROM quotes 
WHERE author_id = (SELECT id FROM quote_authors WHERE name = 'Marcus Aurelius')
ORDER BY created_at DESC
LIMIT 5;
```

## Posting Quotes to Mastodon

### Setup Mastodon Account

Quotes are posted via the `post-art` Edge Function. To set up a philosopher bot account:

1. **Create quote author** (if not exists):
   ```sql
   INSERT INTO quote_authors (name, category) 
   VALUES ('Marcus Aurelius', 'philosopher');
   ```

2. **Add Mastodon account**:
   ```sql
   INSERT INTO mastodon_accounts (
     account_username,
     mastodon_base_url,
     mastodon_access_token,
     account_type,
     author_id,
     active
   ) VALUES (
     'your-bot-username',
     'https://your-mastodon-instance.com',
     'your-access-token',
     'philosopher',
     (SELECT id FROM quote_authors WHERE name = 'Marcus Aurelius'),
     true
   );
   ```

3. **Cron job** - The `post-art` function runs via cron and automatically posts quotes for philosopher accounts every 6 hours (or configured interval).

## Code Files Reference

### Import System
- **`src/wikiquote.ts`** - Wikiquote scraping logic
- **`src/cli-wikiquote-scrape.ts`** - CLI tool for importing quotes
- **`src/db.ts`** - Database functions (`ensureQuoteAuthor`, `upsertQuote`)

### Posting System
- **`supabase/functions/post-art/index.ts`** - Edge function that posts quotes to Mastodon
- Handles philosopher accounts by querying `quotes` table with `author_id`
- Joins with `quote_authors` to get author name for post formatting

## Data Cleaning

The scraper automatically cleans quote text:

**Removed:**
- Reference notation: "[VIII, 25]" → removed
- Translation markers: "(Hays translation)" → removed
- Citations: `[1]`, `[2]` → removed
- Non-English text: Greek quotes → filtered out

**Result:** Clean quote text with only the actual quote content.

## Important Notes

1. **Character Count Required:** The `character_count` column is NOT NULL. The code automatically calculates it from `text.length`.

2. **Source Field:** Only the `source` field (e.g., "Meditations") is stored. Reference notation and translation info are used for deduplication but not stored.

3. **Author Category:** When importing, authors are created with `category='philosopher'` by default. You can manually update categories later if needed.

4. **Deduplication:** Quotes are deduplicated by `text + author_id + source`. If the same quote text exists for the same author and source, it will be updated rather than inserted.

## Troubleshooting

### "null value in column character_count"
- **Fixed:** Code now calculates `character_count` automatically

### "Could not find the 'author_id' column"
- **Solution:** Run `migrate-quotes-to-general.sql` migration

### "Could not find the 'quote_authors' table"
- **Solution:** Run `migrate-quotes-to-general.sql` migration

### No quotes extracted
- Check Wikiquote page structure matches expected format
- Verify "Quotes" section exists
- Check browser console for HTML parsing issues

## Migration Status

✅ **Completed:**
- Database migration to generalized structure
- Code updated to use `quote_authors` and `author_id`
- Character count calculation implemented
- Reference notation removal implemented
- Translation marker removal implemented

## Future Enhancements

- Support for other works (not just Meditations)
- Support for quotes without reference notation
- More sophisticated English detection
- Support for multiple sources per author
- CLI flag to specify author category

