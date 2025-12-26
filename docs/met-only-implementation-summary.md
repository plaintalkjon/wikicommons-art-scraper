# Met-Only Scraping Implementation Summary

## What Was Created

### 1. Enhanced Tag Extraction (`src/metmuseum.ts`)
- **New function**: `extractAllMetTags(object: MetObject): string[]`
- Extracts tags from: `department`, `classification`, `culture`, `period`, `medium`, and `tags` array
- Returns normalized, deduplicated tag strings

### 2. Department API Module (`src/metmuseum-department.ts`)
- **`getDepartments()`** - List all Met departments
- **`getObjectIDsByDepartment(departmentId)`** - Get object IDs for a department (may be blocked by bot protection)
- **`getAllObjectIDs()`** - Get all object IDs (fallback when search is blocked)
- **`filterObjectIDsByDepartment()`** - Filter objects by department name (slower but works when search is blocked)

### 3. Met-Only Pipeline (`src/pipeline-met-only.ts`)
- **`fetchAndStoreFromMetOnly()`** - Process Met objects without requiring Wikidata QIDs
- Uses only Met API metadata for tags
- Deduplicates by Met Object ID and title+artist
- Handles image downloads, storage uploads, and database records

### 4. CLI Script (`src/cli-scrape-met-department.ts`)
- Scrapes Met Museum by department/category
- Supports department name or ID
- Options: `--limit`, `--dry-run`, `--max-uploads`
- Handles bot protection with fallback methods

### 5. Documentation
- **`docs/met-only-scraping.md`** - Complete usage guide
- **`docs/met-only-implementation-summary.md`** - This file

## Supabase Schema Requirements

### ✅ No Changes Needed (Already Compatible)

The existing schema already supports Met-only scraping:

#### `art_sources` Table
- **`wikidata_qid`** - Already nullable (can be `NULL` for Met-only sources)
- **`source_pageid`** - Stores Met object ID (integer)
- **`source`** - Set to `'metmuseum'`
- **`source_title`** - Stores artwork title
- **`source_url`** - Stores Met object URL

#### Other Tables
- **`tags`** - No changes needed
- **`art_tags`** - No changes needed
- **`arts`** - No changes needed
- **`artists`** - No changes needed
- **`art_assets`** - No changes needed

### Verification Query

Run this to verify `wikidata_qid` is nullable:

```sql
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'art_sources' 
  AND column_name = 'wikidata_qid';
```

**Expected result**: `is_nullable = 'YES'`

### If `wikidata_qid` is NOT Nullable

If the query shows `is_nullable = 'NO'`, make it nullable:

```sql
ALTER TABLE art_sources 
ALTER COLUMN wikidata_qid DROP NOT NULL;
```

## Usage Examples

### Basic Scraping
```bash
npm run scrape-met-department -- --department "European Paintings"
```

### With Options
```bash
# Limit to 100 objects
npm run scrape-met-department -- --department "European Paintings" --limit 100

# Dry run (test without uploading)
npm run scrape-met-department -- --department "European Paintings" --dry-run

# Limit uploads
npm run scrape-met-department -- --department "European Paintings" --max-uploads 50
```

### By Department ID
```bash
npm run scrape-met-department -- --departmentId 11
```

## Key Differences from Wikidata-Based Scraping

| Aspect | Wikidata-Based | Met-Only |
|--------|---------------|----------|
| **Tags** | Wikidata + Met tags | Met tags only |
| **QID Required** | ✅ Yes | ❌ No |
| **Deduplication** | QID-based (reliable) | Object ID + title (less reliable) |
| **Tag Types** | Genre, movement, date + subject | Subject, department, medium |
| **Speed** | Slower (Wikidata queries) | Faster (no Wikidata) |
| **Bot Protection** | Less likely | More likely |

## Tag Sources

Met-only scraping extracts tags from:

1. **`department`** - e.g., "European Paintings"
2. **`classification`** - e.g., "Paintings"
3. **`culture`** - e.g., "French"
4. **`period`** - e.g., "Modern"
5. **`medium`** - e.g., "Oil on canvas"
6. **`tags`** - Array of tag objects with terms

All tags are normalized (lowercased, trimmed, deduplicated).

## Limitations

1. **Bot Protection**: Met API search endpoint may return 403. Script tries fallback but it's slower.

2. **Cross-Source Deduplication**: Without Wikidata QIDs, can't reliably detect if a Met artwork matches a Wikimedia artwork.

3. **Tag Quality**: Met tags are subject-focused; Wikidata provides style/movement/date info.

4. **Artist Matching**: Uses `artistDisplayName` from Met API, which may not match Wikidata names exactly.

## Next Steps

1. **Verify Schema**: Run the verification query above
2. **Test Script**: Try a dry run with a small department
3. **Monitor Bot Protection**: Watch for 403 errors and adjust delays if needed
4. **Review Tags**: Check that extracted tags are useful for your use case

## Files Modified/Created

### New Files
- `src/metmuseum-department.ts` - Department API functions
- `src/pipeline-met-only.ts` - Met-only processing pipeline
- `src/cli-scrape-met-department.ts` - CLI script
- `docs/met-only-scraping.md` - Usage documentation
- `docs/met-only-implementation-summary.md` - This file

### Modified Files
- `src/metmuseum.ts` - Added `extractAllMetTags()` function
- `src/failureTracker.ts` - Added `source` field to `FailedUpload` interface
- `package.json` - Added `scrape-met-department` script
