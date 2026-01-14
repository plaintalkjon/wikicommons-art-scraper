-- Add new columns to quotes table for Wikiquote scraper
-- Run this in Supabase SQL Editor

-- Add source column (e.g., "Meditations", "Epistle of Marcus Aurelius", etc.)
ALTER TABLE quotes 
ADD COLUMN IF NOT EXISTS source TEXT;

-- Create index on source for filtering/sorting by source
CREATE INDEX IF NOT EXISTS idx_quotes_source 
ON quotes(philosopher_id, source) 
WHERE source IS NOT NULL;

-- Verify columns were added
SELECT 
  column_name, 
  data_type, 
  is_nullable
FROM information_schema.columns
WHERE table_name = 'quotes'
  AND column_name IN ('source')
ORDER BY column_name;

