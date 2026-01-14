# Quotes System - Quick Reference for Future Agents

## TL;DR - Importing Quotes

```bash
# 1. Ensure migration is run (one-time)
# Run migrate-quotes-to-general.sql in Supabase SQL Editor

# 2. Import quotes
npm run wikiquote-scrape -- --philosopher "Marcus Aurelius" --url "https://en.wikiquote.org/wiki/Marcus_Aurelius"
```

## Key Database Structure

- **`quote_authors`** table (was `philosophers`)
  - `id`, `name`, `category` ('philosopher', 'author', etc.)
  
- **`quotes`** table
  - `id`, `text`, `author_id` (was `philosopher_id`), `source`, `character_count` (REQUIRED, auto-calculated)

## Important Code Files

- `src/wikiquote.ts` - Scraping logic
- `src/cli-wikiquote-scrape.ts` - CLI import tool
- `src/db.ts` - `ensureQuoteAuthor()`, `upsertQuote()`
- `supabase/functions/post-art/index.ts` - Posts quotes to Mastodon

## Data Cleaning

Quote text is cleaned before storage:
- ✅ Reference notation removed: "[VIII, 25]" → removed
- ✅ Translation markers removed: "(Hays translation)" → removed
- ✅ Citations removed: `[1]`, `[2]` → removed
- ✅ Non-English filtered out

**Only `source` field is stored** (e.g., "Meditations"). Reference/translation info used for deduplication only.

## Common Issues

1. **"null value in column character_count"** → Fixed: auto-calculated
2. **"Could not find author_id column"** → Run `migrate-quotes-to-general.sql`
3. **No quotes extracted** → Check Wikiquote page structure

## Migration Status

✅ Complete - System uses generalized `quote_authors` structure

## Full Documentation

- `WIQUOTE_IMPORT_GUIDE.md` - Complete import guide
- `QUOTES_SYSTEM_README.md` - Full system overview
- `WIQUOTE_IMPLEMENTATION.md` - Technical implementation details

