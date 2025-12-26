# Met Museum Only Scraping (No Wikidata Required)

This document describes the Met-only scraping system that processes artworks from The Metropolitan Museum of Art without requiring Wikidata QIDs.

## Overview

The Met-only scraping system:
- Uses **only** Met API metadata for tags and processing
- Does **not** require Wikidata QIDs
- Extracts tags from: department, classification, culture, period, medium, and tags array
- Processes artworks by department/category

## Usage

### Scrape by Department Name
```bash
npm run scrape-met-department -- --department "European Paintings"
```

### Scrape by Department ID
```bash
npm run scrape-met-department -- --departmentId 11
```

### Limit Number of Objects
```bash
npm run scrape-met-department -- --department "European Paintings" --limit 100
```

### Dry Run (Test Without Uploading)
```bash
npm run scrape-met-department -- --department "European Paintings" --dry-run
```

### Limit Uploads
```bash
npm run scrape-met-department -- --department "European Paintings" --max-uploads 50
```

## Available Departments

To see all available departments:
```bash
# The script will list departments if you provide an invalid name
npm run scrape-met-department -- --department "Invalid Name"
```

Common departments:
- **European Paintings** (ID: 11)
- **American Paintings and Sculpture** (ID: 1)
- **Modern and Contemporary Art** (ID: 21)
- **Drawings and Prints** (ID: 9)
- **Asian Art** (ID: 6)

## Tag Extraction

The system extracts tags from the following Met object fields:

1. **department** - e.g., "European Paintings"
2. **classification** - e.g., "Paintings"
3. **culture** - e.g., "French"
4. **period** - e.g., "Modern"
5. **medium** - e.g., "Oil on canvas"
6. **tags** - Array of tag objects with `term`, `AAT_URL`, `Wikidata_URL`

All tags are:
- Lowercased
- Trimmed
- Deduplicated

## Deduplication

Artworks are deduplicated by:
1. **Met Object ID** (`source_pageid` in `art_sources` table)
2. **Title + Artist** (fallback)

Note: Without Wikidata QIDs, cross-source deduplication (Met vs Wikimedia) is less reliable and relies on title matching.

## Supabase Schema Requirements

### Current Schema (No Changes Needed)

The existing schema already supports Met-only scraping:

#### `art_sources` Table
- `wikidata_qid` - **Already nullable** (can be NULL for Met-only sources)
- `source_pageid` - Stores Met object ID (integer)
- `source` - Set to `'metmuseum'`
- `source_title` - Stores artwork title
- `source_url` - Stores Met object URL

#### `tags` Table
- No changes needed - stores normalized tag strings

#### `art_tags` Table
- No changes needed - links artworks to tags

#### `arts` Table
- No changes needed - stores artwork metadata

### Verification

To verify your schema supports Met-only scraping:

```sql
-- Check that wikidata_qid is nullable
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'art_sources' 
  AND column_name = 'wikidata_qid';

-- Should return: is_nullable = 'YES'
```

If `wikidata_qid` is NOT nullable, you'll need to make it nullable:

```sql
ALTER TABLE art_sources 
ALTER COLUMN wikidata_qid DROP NOT NULL;
```

## Differences from Wikidata-Based Scraping

| Feature | Wikidata-Based | Met-Only |
|---------|---------------|----------|
| **Tags Source** | Wikidata + Met tags | Met tags only |
| **QID Required** | Yes | No |
| **Cross-Source Deduplication** | QID-based (reliable) | Title-based (less reliable) |
| **Tag Quality** | Genre, movement, date + subject | Subject matter, department, medium |
| **Processing Speed** | Slower (Wikidata queries) | Faster (no Wikidata queries) |
| **Bot Protection** | Less likely (fewer API calls) | More likely (direct Met API) |

## Error Handling

The script handles:
- **403 Forbidden** - Bot protection (tries fallback method)
- **404 Not Found** - Object doesn't exist (skipped)
- **Rate Limits** - Automatic retries with exponential backoff
- **Missing Images** - Objects without `primaryImage` are skipped
- **Small Images** - Images < 1280px (width or height) are skipped

## Limitations

1. **Bot Protection**: The Met API search endpoint may be blocked (403). The script tries a fallback method but it's slower.

2. **No Cross-Source Deduplication**: Without Wikidata QIDs, we can't reliably detect if a Met artwork is the same as a Wikimedia artwork.

3. **Tag Quality**: Met tags are subject-focused (what the artwork depicts), while Wikidata provides style/movement/date information.

4. **Artist Matching**: Artists are matched by `artistDisplayName` from Met API, which may not match Wikidata artist names exactly.

## Future Enhancements

Potential improvements:
- Add artist name normalization/matching
- Implement fuzzy title matching for better deduplication
- Cache department mappings to avoid repeated API calls
- Add progress persistence (resume interrupted scrapes)
- Support filtering by additional criteria (date range, medium, etc.)
