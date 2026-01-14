# Wikiquote Quote Import Guide

## Overview

This system imports quotes from Wikiquote pages and stores them in a generalized quote authors database. It supports philosophers, authors, politicians, scientists, and any other quote-worthy individuals.

## Quick Start

### 1. Prerequisites

**Database Migration Required:**
- Run `migrate-quotes-to-general.sql` in Supabase SQL Editor first
- This migrates from philosopher-specific to general quote authors structure

**Required Database Tables:**
- `quote_authors` - Stores quote authors (philosophers, authors, politicians, etc.)
- `quotes` - Stores individual quotes with `author_id`, `source`, `character_count`

### 2. Import Quotes

```bash
# Dry run (test without database changes)
npm run wikiquote-scrape -- --philosopher "Marcus Aurelius" --url "https://en.wikiquote.org/wiki/Marcus_Aurelius" --dry-run

# Real import
npm run wikiquote-scrape -- --philosopher "Marcus Aurelius" --url "https://en.wikiquote.org/wiki/Marcus_Aurelius"
```

**Note:** The `--philosopher` flag name is legacy - it works for any quote author type. The author will be created with `category = 'philosopher'` by default.

## Database Schema

### quote_authors Table
```sql
CREATE TABLE quote_authors (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT DEFAULT 'philosopher', -- 'philosopher', 'author', 'politics', etc.
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### quotes Table
```sql
CREATE TABLE quotes (
  id UUID PRIMARY KEY,
  text TEXT NOT NULL,
  author_id UUID REFERENCES quote_authors(id), -- Links to quote author
  source TEXT, -- e.g., "Meditations", "Huckleberry Finn"
  character_count INTEGER NOT NULL, -- REQUIRED: Length of quote text
  created_at TIMESTAMP DEFAULT NOW(),
  posted_at TIMESTAMP NULL -- Set when quote is posted to Mastodon
);
```

**Important:** The `character_count` column is **REQUIRED** and must be provided. The code automatically calculates it from `text.length`.

## How It Works

### 1. Fetching
- Downloads Wikiquote page HTML using axios
- Parses with Cheerio (HTML parser)

### 2. Section Detection
- Finds "Quotes" section (h2 heading)
- Stops before "Disputed", "Misattributed", or "Quotes about" sections
- Locates "Meditations" subsection (or other source works)

### 3. Quote Extraction
- Processes list items (`<li>`) in the content area
- Extracts quote text and reference notation (e.g., "I, 1", "II, 3")
- Handles nested list structures
- Supports references in format "* I, 1" at end of text

### 4. Cleaning
- **Removes reference notation** - "[VIII, 25]" is stripped from quote text
- **Removes translation markers** - "(Hays translation)" is removed from text
- **Removes citations** - `[1]`, `[2]`, etc. are filtered out
- **Normalizes whitespace** - Multiple spaces become single space
- **Removes non-English text** - Greek/original text is filtered out

### 5. Filtering
- Checks if quote is English (heuristic-based detection)
- Skips non-English quotes (Greek, etc.)
- Skips empty or very short quotes (< 10 characters)

### 6. Deduplication
- Groups quotes by reference notation (e.g., "I, 1")
- Keeps **first English translation** per reference
- Skips if already have English version

### 7. Storage
- Ensures quote author exists in `quote_authors` table (creates if needed)
- Calculates `character_count` from text length
- Upserts quotes (inserts new or updates existing by text + author_id + source)
- Tracks inserted vs updated counts

## Code Files

### Core Files

1. **`src/wikiquote.ts`**
   - `fetchQuotesFromWikiquote(url)` - Fetches and parses quotes from Wikiquote URL
   - `deduplicateQuotes(quotes)` - Removes duplicate quotes by reference
   - `isEnglish(text)` - Checks if text is primarily English
   - Helper functions for cleaning and parsing

2. **`src/db.ts`**
   - `ensureQuoteAuthor(name, category)` - Creates quote author if doesn't exist
   - `upsertQuote({ text, authorId, source })` - Inserts/updates quote with character_count

3. **`src/cli-wikiquote-scrape.ts`**
   - CLI tool to run the scraper
   - Supports `--dry-run` flag for testing

### Edge Function

**`supabase/functions/post-art/index.ts`**
- Posts quotes to Mastodon for philosopher bot accounts
- Uses `author_id` to link to `quote_authors` table
- Joins with `quote_authors` to get author name for formatting

## Usage Examples

### Import Marcus Aurelius Quotes
```bash
npm run wikiquote-scrape -- --philosopher "Marcus Aurelius" --url "https://en.wikiquote.org/wiki/Marcus_Aurelius"
```

### Verify Imported Quotes
```sql
-- Check quote count
SELECT COUNT(*) FROM quotes 
WHERE author_id = (SELECT id FROM quote_authors WHERE name = 'Marcus Aurelius');

-- View quotes with source
SELECT text, source, character_count 
FROM quotes 
WHERE author_id = (SELECT id FROM quote_authors WHERE name = 'Marcus Aurelius')
ORDER BY created_at DESC
LIMIT 10;
```

### Add Other Quote Author Types
```typescript
// In code, you can specify category:
const authorId = await ensureQuoteAuthor("Mark Twain", "author");
const authorId = await ensureQuoteAuthor("Abraham Lincoln", "politics");
```

## Data Cleaning Rules

The scraper automatically:
- ✅ Removes reference notation like "[VIII, 25]" from quote text
- ✅ Removes translation markers like "(Hays translation)" from quote text
- ✅ Removes citations like `[1]`, `[2]` from quote text
- ✅ Filters out non-English quotes (Greek, etc.)
- ✅ Normalizes whitespace
- ✅ Deduplicates by reference (keeps first English translation)

**Result:** Clean quote text with no metadata mixed in.

## Current Limitations

- **Focused on Meditations structure** - Currently extracts from "Meditations" subsection
- **English detection is heuristic** - May have false positives/negatives
- **Requires specific HTML structure** - May need adjustment for other Wikiquote pages
- **Reference notation required** - Quotes must have reference like "I, 1" to be extracted

## Troubleshooting

### Error: "null value in column character_count"
- **Solution:** Already fixed - code now calculates `character_count` automatically

### Error: "Could not find the 'author_id' column"
- **Solution:** Run `migrate-quotes-to-general.sql` migration first

### Error: "Could not find the 'quote_authors' table"
- **Solution:** Run `migrate-quotes-to-general.sql` migration first

### No quotes extracted
- Check if Wikiquote page structure matches expected format
- Verify "Quotes" section exists
- Check if "Meditations" subsection exists (or adjust code for other works)

## Migration Status

✅ **Completed:**
- Database migration to `quote_authors` and `author_id`
- Code updated to use new structure
- Character count calculation added
- Reference notation removal implemented
- Translation marker removal implemented

## Future Enhancements

- Support for other works (not just Meditations)
- Support for quotes without reference notation
- More sophisticated English detection
- Better handling of quotes with mixed languages
- Support for multiple sources per author

