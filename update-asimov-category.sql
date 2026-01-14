-- Update Isaac Asimov's category from 'philosopher' to 'author'
-- Run this in Supabase SQL Editor

UPDATE quote_authors
SET category = 'author'
WHERE name = 'Isaac Asimov';

-- Verify the update
SELECT 
  id,
  name,
  category,
  created_at
FROM quote_authors
WHERE name = 'Isaac Asimov';

