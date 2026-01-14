# Wikiquote Scraper Implementation

## Overview

A scraper for extracting quotes from Wikiquote pages. The system uses a **generalized quote authors structure** that supports philosophers, authors, politicians, scientists, and any other quote-worthy individuals.

**Key Features:**
- Extracts quotes from the "Quotes" → "Meditations" section (or other works)
- Filters out non-English quotes (removes Greek/original text)
- Deduplicates by reference notation (keeps first English translation)
- Stores quotes with `source` field (e.g., "Meditations")
- Automatically calculates `character_count` (required field)
- Skips disputed/misattributed sections automatically
- Removes reference notation and translation markers from quote text

## Files Created

1. **`src/wikiquote.ts`** - Core scraping logic
   - `fetchQuotesFromWikiquote()` - Fetches and parses quotes from a Wikiquote URL
   - `deduplicateQuotes()` - Removes duplicate quotes by reference
   - `isEnglish()` - Checks if text is primarily English
   - Helper functions for cleaning and parsing

2. **`src/cli-wikiquote-scrape.ts`** - CLI tool to run the scraper
   - Command-line interface
   - Dry-run mode for testing
   - Database integration

3. **`src/db.ts`** (updated) - Database functions
   - `upsertQuote()` - Insert/update quotes with character_count calculation
   - `ensureQuoteAuthor()` - Create quote author if doesn't exist (supports category)

## Usage

### Basic Usage

```bash
npm run wikiquote-scrape -- --philosopher "Marcus Aurelius" --url "https://en.wikiquote.org/wiki/Marcus_Aurelius"
```

### Dry Run (Test Without Database)

```bash
npm run wikiquote-scrape -- --philosopher "Marcus Aurelius" --url "https://en.wikiquote.org/wiki/Marcus_Aurelius" --dry-run
```

## Database Schema

**IMPORTANT:** You must run `migrate-quotes-to-general.sql` before using this scraper. This migrates from philosopher-specific to general quote authors structure.

### quote_authors Table
- `id` - UUID (primary key)
- `name` - Author name (e.g., "Marcus Aurelius", "Mark Twain")
- `category` - Type: `'philosopher'`, `'author'`, `'politics'`, etc. (default: 'philosopher')
- `created_at` - Timestamp
- `updated_at` - Timestamp

### quotes Table

**Required fields:**
- `id` - UUID (auto-generated)
- `text` - Quote text (cleaned, English only, no reference notation)
- `author_id` - Foreign key to `quote_authors` table (was `philosopher_id`)
- `character_count` - INTEGER NOT NULL (automatically calculated from text length)
- `created_at` - Timestamp (auto-generated)
- `posted_at` - Timestamp (null until posted)

**Optional fields:**
- `source` - Source work (e.g., "Meditations", "Huckleberry Finn")

**Note:** The scraper extracts reference notation (e.g., "I, 1") and translation info internally for deduplication, but **only stores `source`** in the database. Reference notation and translation markers are removed from the quote text.

## How It Works

### 1. Fetching
- Downloads the Wikiquote page HTML
- Parses with Cheerio (same as other scrapers in codebase)

### 2. Section Detection
- Finds "Quotes" section (h2 heading)
- Stops before "Disputed", "Misattributed", or "Quotes about" sections
- Locates "Meditations" subsection

### 3. Quote Extraction
- Processes each Book (I through XII)
- Extracts quote text and reference notation (e.g., "I, 1")
- Handles nested list structures
- Supports references in format "* I, 1" at end of text

### 4. Cleaning
- Removes citations (`[1]`, `[2]`, etc.)
- Extracts translation names (e.g., "Hays translation")
- Normalizes whitespace
- Removes Greek/original text

### 5. Filtering
- Checks if quote is English (heuristic-based)
- Skips non-English quotes
- Skips empty or very short quotes

### 6. Deduplication
- Groups quotes by reference notation
- Keeps first English translation per reference
- Skips if already have English version

### 7. Storage
- Ensures quote author exists in `quote_authors` table (creates if needed with category='philosopher')
- Calculates `character_count` from text length (required field)
- Upserts quotes (inserts new or updates existing by text + author_id + source)
- Tracks inserted vs updated counts

## Example Output

```
============================================================
Wikiquote Scraper
============================================================
Philosopher: Marcus Aurelius
URL: https://en.wikiquote.org/wiki/Marcus_Aurelius
Dry run: NO
============================================================

📥 Step 1: Fetching quotes from Wikiquote...
✓ Found Quotes section
✓ Found Meditations subsection
  📖 Processing Book I
  📖 Processing Book II
  ...
✓ Extracted 150 raw quotes

🔄 Step 2: Deduplicating quotes...
✓ After deduplication: 120 unique quotes

👤 Step 3: Ensuring quote author exists in database...
✓ Author ID: abc123-def456-...

💾 Step 4: Inserting quotes into database...
  ✓ Inserted quote [I, 1]: Of my grandfather Verus I have learned to be gentle...
  ✓ Inserted quote [I, 3]: Her reverence for the divine, her generosity...
  ...

============================================================
Summary:
  Inserted: 120
  Updated: 0
  Errors: 0
  Total: 120
============================================================
```

## Features

✅ **English-only filtering** - Removes Greek and other non-English text  
✅ **Smart deduplication** - Keeps first English translation per reference  
✅ **Translation tracking** - Stores translator name if specified  
✅ **Reference parsing** - Extracts book and section numbers  
✅ **Junk filtering** - Automatically skips disputed/misattributed sections  
✅ **Dry-run mode** - Test without modifying database  
✅ **Idempotent** - Safe to run multiple times (upserts by reference)

## Limitations

- Currently focused on "Meditations" structure
- English detection is heuristic-based (may have false positives/negatives)
- Requires specific HTML structure (may need adjustment for other philosophers)
- Reference notation must follow pattern "I, 1", "II, 3", etc.

## Future Enhancements

- Support for other works (not just Meditations)
- Support for other philosophers (not just Marcus Aurelius)
- More sophisticated English detection
- Better handling of quotes with mixed languages
- Support for quotes without reference notation

## Testing

To test the scraper:

1. **Dry run first:**
   ```bash
   npm run wikiquote-scrape -- --philosopher "Marcus Aurelius" --url "https://en.wikiquote.org/wiki/Marcus_Aurelius" --dry-run
   ```

2. **Check output** - Review the quotes that would be inserted

3. **Run for real:**
   ```bash
   npm run wikiquote-scrape -- --philosopher "Marcus Aurelius" --url "https://en.wikiquote.org/wiki/Marcus_Aurelius"
   ```

4. **Verify in database:**
   ```sql
   SELECT text, source, character_count 
   FROM quotes 
   WHERE author_id = (SELECT id FROM quote_authors WHERE name = 'Marcus Aurelius')
   ORDER BY created_at DESC
   LIMIT 10;
   ```

