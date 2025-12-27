# art_sources Table Review

## Current Schema (Intended)

- `source_pageid`: Should store **numeric IDs only**
  - Wikimedia: Page ID (integer, e.g., `123456`)
  - Met Museum: Object ID (integer, e.g., `437394`)
  
- `wikidata_qid`: Should store **Wikidata QIDs only**
  - Format: String starting with "Q" (e.g., `"Q123456"`)
  - Used for cross-source deduplication

## Diagnostic Queries

### 1. Check if source_pageid contains QIDs (should be empty)

```sql
-- Find any source_pageid values that look like QIDs (start with 'Q' or are just numbers that might be QIDs)
SELECT 
  id,
  art_id,
  source,
  source_pageid,
  source_title,
  wikidata_qid
FROM art_sources
WHERE 
  source_pageid::text LIKE 'Q%'  -- If source_pageid is text and contains Q
  OR (source_pageid::text ~ '^[0-9]+$' AND LENGTH(source_pageid::text) > 6)  -- Very long numbers might be QIDs
ORDER BY source, source_pageid;
```

### 2. Check data types and sample data

```sql
-- Check column types and sample data
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'art_sources'
ORDER BY ordinal_position;

-- Sample data by source
SELECT 
  source,
  COUNT(*) as count,
  MIN(source_pageid) as min_pageid,
  MAX(source_pageid) as max_pageid,
  COUNT(DISTINCT wikidata_qid) as unique_qids
FROM art_sources
GROUP BY source;
```

### 3. Find records with QIDs in wrong place

```sql
-- Find records where wikidata_qid might be in source_pageid
SELECT 
  id,
  art_id,
  source,
  source_pageid,
  wikidata_qid,
  source_title
FROM art_sources
WHERE 
  (source_pageid::text LIKE 'Q%' OR source_pageid::text ~ '^Q[0-9]+$')
  AND (wikidata_qid IS NULL OR wikidata_qid != source_pageid::text);
```

## Migration Script (if needed)

If you find QIDs stored in `source_pageid`, run this migration:

```sql
-- Step 1: Move QIDs from source_pageid to wikidata_qid
UPDATE art_sources
SET 
  wikidata_qid = source_pageid::text,
  source_pageid = NULL
WHERE 
  source_pageid::text LIKE 'Q%'  -- Looks like a QID
  AND (wikidata_qid IS NULL OR wikidata_qid = '');

-- Step 2: Verify the migration
SELECT 
  source,
  COUNT(*) as total,
  COUNT(CASE WHEN source_pageid::text LIKE 'Q%' THEN 1 END) as qids_in_pageid,
  COUNT(CASE WHEN wikidata_qid IS NOT NULL THEN 1 END) as qids_in_wikidata_qid
FROM art_sources
GROUP BY source;
```

## Expected Data Distribution

### Wikimedia Sources
- `source_pageid`: Numeric page IDs (e.g., `123456`, `789012`)
- `wikidata_qid`: Wikidata QIDs (e.g., `"Q123456"`, `"Q789012"`)

### Met Museum Sources  
- `source_pageid`: Numeric object IDs (e.g., `437394`, `436523`)
- `wikidata_qid`: Wikidata QIDs (e.g., `"Q19911561"`, `"Q123456"`)

## Code Review Summary

✅ **Current code is correct:**
- `sourcePageId` parameter is typed as `number` (line 125 in `src/db.ts`)
- Wikimedia stores `image.pageid` (numeric) in `source_pageid`
- Met Museum stores `object.objectID` (numeric) in `source_pageid`
- Wikidata QIDs are stored in `wikidata_qid` column (separate)

⚠️ **Potential issues:**
- If `source_pageid` column is TEXT/VARCHAR in database, numeric IDs will be stored as strings (this is fine)
- If old code stored QIDs in `source_pageid`, they need to be migrated
- Database schema might need `wikidata_qid` column added (see previous conversation)


