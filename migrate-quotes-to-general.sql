-- Migration: Make quotes system more general (support philosophers, authors, presidents, etc.)
-- Run this in Supabase SQL Editor

-- Step 1: Rename philosophers table to quote_authors (more general)
ALTER TABLE IF EXISTS philosophers RENAME TO quote_authors;

-- Step 2: Add category/type column to quote_authors to distinguish types
-- Categories: 'philosopher', 'author', 'politics', 'scientist', 'artist', etc.
ALTER TABLE quote_authors 
ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'philosopher';

-- Create index on category for filtering
CREATE INDEX IF NOT EXISTS idx_quote_authors_category 
ON quote_authors(category) 
WHERE category IS NOT NULL;

-- Step 3: Rename philosopher_id to author_id in quotes table
-- First, drop the foreign key constraint if it exists
DO $$
BEGIN
  -- Try to drop the constraint if it exists
  ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_philosopher_id_fkey;
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

-- Rename the column
ALTER TABLE quotes 
RENAME COLUMN philosopher_id TO author_id;

-- Recreate foreign key with new column name
ALTER TABLE quotes
ADD CONSTRAINT quotes_author_id_fkey 
FOREIGN KEY (author_id) 
REFERENCES quote_authors(id) 
ON DELETE CASCADE;

-- Update index to use new column name
DROP INDEX IF EXISTS idx_quotes_source;
CREATE INDEX IF NOT EXISTS idx_quotes_source 
ON quotes(author_id, source) 
WHERE source IS NOT NULL;

-- Step 4: Update mastodon_accounts table - FULL MIGRATION
-- Rename philosopher_id to author_id
ALTER TABLE mastodon_accounts 
RENAME COLUMN philosopher_id TO author_id;

-- Update foreign key constraint if it exists
DO $$
BEGIN
  ALTER TABLE mastodon_accounts DROP CONSTRAINT IF EXISTS mastodon_accounts_philosopher_id_fkey;
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

-- Recreate foreign key with new column name
ALTER TABLE mastodon_accounts
ADD CONSTRAINT mastodon_accounts_author_id_fkey 
FOREIGN KEY (author_id) 
REFERENCES quote_authors(id) 
ON DELETE SET NULL;

-- Create index on author_id
CREATE INDEX IF NOT EXISTS idx_mastodon_accounts_author_id 
ON mastodon_accounts(author_id) 
WHERE author_id IS NOT NULL;

-- Step 6: Verify the changes
SELECT 
  table_name,
  column_name,
  data_type
FROM information_schema.columns
WHERE table_name IN ('quote_authors', 'quotes', 'mastodon_accounts')
  AND column_name IN ('category', 'author_id')
ORDER BY table_name, column_name;

-- Step 7: Show sample data
SELECT 
  'quote_authors' as table_name,
  COUNT(*) as total_rows,
  COUNT(DISTINCT category) as unique_categories
FROM quote_authors
UNION ALL
SELECT 
  'quotes' as table_name,
  COUNT(*) as total_rows,
  COUNT(DISTINCT author_id) as unique_authors
FROM quotes
UNION ALL
SELECT 
  'mastodon_accounts' as table_name,
  COUNT(*) as total_rows,
  COUNT(DISTINCT author_id) as unique_authors
FROM mastodon_accounts
WHERE author_id IS NOT NULL;

