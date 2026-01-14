# Full Migration Checklist: Philosophers → Quote Authors

## Overview
Migrating from philosopher-specific structure to general quote authors system that supports philosophers, authors, politicians, scientists, etc.

## Migration Steps

### 1. Run SQL Migration
Run `migrate-quotes-to-general.sql` in Supabase SQL Editor. This will:
- ✅ Rename `philosophers` table → `quote_authors`
- ✅ Add `category` column to `quote_authors` (default: 'philosopher')
- ✅ Rename `philosopher_id` → `author_id` in `quotes` table
- ✅ Rename `philosopher_id` → `author_id` in `mastodon_accounts` table
- ✅ Update all foreign key constraints
- ✅ Create necessary indexes

### 2. Code Changes (Already Done)
- ✅ `src/db.ts` - Updated `ensurePhilosopher()` → `ensureQuoteAuthor()`
- ✅ `src/db.ts` - Updated `upsertQuote()` to use `author_id`
- ✅ `src/cli-wikiquote-scrape.ts` - Updated to use `author_id` and `ensureQuoteAuthor()`
- ✅ `supabase/functions/post-art/index.ts` - Updated philosopher account handling

### 3. Verify Migration
After running SQL, verify:
```sql
-- Check tables exist
SELECT table_name FROM information_schema.tables 
WHERE table_name IN ('quote_authors', 'quotes', 'mastodon_accounts');

-- Check columns
SELECT table_name, column_name 
FROM information_schema.columns
WHERE table_name IN ('quote_authors', 'quotes', 'mastodon_accounts')
  AND column_name IN ('author_id', 'category', 'philosopher_id')
ORDER BY table_name, column_name;

-- Should show:
-- quote_authors: category
-- quotes: author_id
-- mastodon_accounts: author_id
-- NO philosopher_id columns should exist
```

### 4. Update Existing Mastodon Accounts
If you have existing philosopher bot accounts, they should automatically work after migration since `philosopher_id` will be renamed to `author_id`. But verify:

```sql
-- Check philosopher accounts
SELECT id, account_username, account_type, author_id
FROM mastodon_accounts
WHERE account_type = 'philosopher';
```

### 5. Test Import
After migration, test the scraper:
```bash
npm run wikiquote-scrape -- --philosopher "Marcus Aurelius" --url "https://en.wikiquote.org/wiki/Marcus_Aurelius" --dry-run
```

## New Structure

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
  author_id UUID REFERENCES quote_authors(id), -- Was philosopher_id
  source TEXT, -- e.g., "Meditations", "Huckleberry Finn"
  created_at TIMESTAMP DEFAULT NOW(),
  posted_at TIMESTAMP NULL
);
```

### mastodon_accounts Table
```sql
-- author_id column (was philosopher_id)
-- Links to quote_authors table
```

## Future Usage Examples

### Add a Philosopher
```typescript
const authorId = await ensureQuoteAuthor("Marcus Aurelius", "philosopher");
```

### Add an Author
```typescript
const authorId = await ensureQuoteAuthor("Mark Twain", "author");
```

### Add a Politician
```typescript
const authorId = await ensureQuoteAuthor("Abraham Lincoln", "politics");
```

### Query by Category
```sql
SELECT q.*, a.name, a.category
FROM quotes q
JOIN quote_authors a ON q.author_id = a.id
WHERE a.category = 'philosopher';
```

## Rollback Plan (if needed)

If you need to rollback:
1. Rename `quote_authors` → `philosophers`
2. Rename `author_id` → `philosopher_id` in both tables
3. Remove `category` column
4. Revert code changes

But this migration is designed to be one-way for simplicity.

