# Quotes System Generalization Plan

## Current Structure (Philosopher-Specific)

- **`philosophers`** table - Stores philosopher information
- **`quotes`** table - Has `philosopher_id` foreign key
- **`mastodon_accounts`** table - Has `philosopher_id` field for philosopher bot accounts

## Proposed Structure (General)

### Tables

1. **`quote_authors`** (renamed from `philosophers`)
   - `id` - UUID (primary key)
   - `name` - Author name (e.g., "Marcus Aurelius", "Mark Twain", "Abraham Lincoln")
   - `category` - Type of author: `'philosopher'`, `'author'`, `'politics'`, `'scientist'`, `'artist'`, etc.
   - `created_at` - Timestamp
   - `updated_at` - Timestamp

2. **`quotes`** (updated)
   - `id` - UUID (primary key)
   - `text` - Quote text
   - `author_id` - Foreign key to `quote_authors` (renamed from `philosopher_id`)
   - `source` - Source work (e.g., "Meditations", "Huckleberry Finn", "Gettysburg Address")
   - `created_at` - Timestamp
   - `posted_at` - Timestamp (null until posted)

3. **`mastodon_accounts`** (updated)
   - Keep `philosopher_id` for backward compatibility (or migrate to `author_id`)
   - Add `author_id` - Foreign key to `quote_authors`
   - `account_type` - Can be `'philosopher'`, `'author'`, `'politics'`, etc. (or keep as `'philosopher'` and use category from quote_authors)

## Migration Strategy

### Option A: Additive (Safer - Backward Compatible)
- Add `author_id` column to `mastodon_accounts`
- Keep `philosopher_id` for existing data
- Copy `philosopher_id` → `author_id` for existing records
- Update code to use `author_id` going forward

### Option B: Full Migration (Cleaner)
- Rename `philosopher_id` → `author_id` everywhere
- Update all code references
- More disruptive but cleaner long-term

## Code Changes Needed

1. **`src/db.ts`**
   - Rename `ensurePhilosopher()` → `ensureQuoteAuthor()`
   - Update `upsertQuote()` to use `author_id` instead of `philosopher_id`
   - Add `category` parameter to author creation

2. **`src/cli-wikiquote-scrape.ts`**
   - Change `--philosopher` flag to `--author` (or keep both for compatibility)
   - Update to use `author_id` and specify category

3. **`supabase/functions/post-art/index.ts`**
   - Update philosopher account handling to use `author_id`
   - Update queries to use `quote_authors` table
   - Can still filter by category if needed

## Benefits

✅ **More flexible** - Can quote anyone, not just philosophers  
✅ **Better organization** - Category field allows filtering by type  
✅ **Future-proof** - Easy to add new quote author types  
✅ **Consistent naming** - `author_id` is clearer than `philosopher_id`

## Example Usage

```sql
-- Add a philosopher
INSERT INTO quote_authors (name, category) 
VALUES ('Marcus Aurelius', 'philosopher');

-- Add an author
INSERT INTO quote_authors (name, category) 
VALUES ('Mark Twain', 'author');

-- Add a president
INSERT INTO quote_authors (name, category) 
VALUES ('Abraham Lincoln', 'president');

-- Query quotes by category
SELECT q.*, a.name, a.category 
FROM quotes q
JOIN quote_authors a ON q.author_id = a.id
WHERE a.category = 'philosopher';
```

## Migration Steps

1. Run `migrate-quotes-to-general.sql` in Supabase SQL Editor
2. Update code to use new table/column names
3. Test with existing philosopher quotes
4. Add new quote author types as needed

