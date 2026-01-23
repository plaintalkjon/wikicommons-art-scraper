-- Update George Orwell author name to "1984"
-- Run this in Supabase SQL Editor

-- Step 1: Update the author name
UPDATE quote_authors
SET name = '1984'
WHERE name = 'George Orwell';

-- Step 2: Verify the update
SELECT 
  id,
  name,
  category,
  created_at
FROM quote_authors
WHERE name = '1984';

-- Step 3: Check how many quotes are associated
SELECT 
  COUNT(*) as quote_count
FROM quotes
WHERE author_id = (SELECT id FROM quote_authors WHERE name = '1984');
