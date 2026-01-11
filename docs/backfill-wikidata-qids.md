# Backfilling Wikidata QIDs for Existing Artworks

## Feasibility: **MODERATE** (2-3 hours of work)

## What We Have

### Met Museum Sources
- `source_pageid`: Met object ID (e.g., `437394`)
- Can query Wikidata using **P3634** (Met Museum object ID property)

### Wikimedia Sources  
- `source_pageid`: Wikimedia page ID (e.g., `123456`)
- `source_title`: Commons file title (e.g., `"File:The Starry Night.jpg"`)
- Can query Wikidata using:
  - **P476** (Commons category) - might not be reliable
  - **P18** (image property) - matches Commons file URLs
  - **P373** (Commons category) - alternative

## Approach

### Step 1: Query Existing Records
```sql
-- Get all art_sources without QIDs
SELECT 
  id,
  art_id,
  source,
  source_pageid,
  source_title,
  source_url
FROM art_sources
WHERE wikidata_qid IS NULL
ORDER BY source, id;
```

### Step 2: Backfill by Source Type

#### For Met Museum Sources
```sparql
# Query Wikidata for QID by Met object ID
SELECT ?item WHERE {
  ?item wdt:P3634 ?metId .  # Met object ID property
  FILTER(?metId = 437394)   # Your source_pageid
}
LIMIT 1
```

**Success Rate:** ~90-95% (most Met objects are in Wikidata)

#### For Wikimedia Sources
```sparql
# Option 1: Query by Commons file title (P476 or P373)
SELECT ?item WHERE {
  ?item wdt:P476 ?commonsCategory .
  # Or try P18 (image) and match URL
}

# Option 2: Query by matching Commons file in P18
SELECT ?item ?image WHERE {
  ?item wdt:P18 ?image .
  FILTER(CONTAINS(?image, "File:The_Starry_Night"))
}
```

**Success Rate:** ~70-80% (some Commons files might not have Wikidata items)

## Implementation Plan

### Script Structure
1. **Query database** for all `art_sources` without QIDs
2. **Group by source type** (wikimedia vs metmuseum)
3. **Batch process** (respect rate limits):
   - Met: Query by P3634 (Met object ID)
   - Wikimedia: Query by Commons file title/URL
4. **Update database** with found QIDs
5. **Log failures** for manual review

### Estimated Time
- **Development:** 1-2 hours
- **Testing:** 30 minutes
- **Running:** Depends on number of records (could be 30min - 2 hours)

### Challenges
1. **Rate Limits:** Wikidata SPARQL has rate limits (need delays)
2. **Matching Accuracy:** Wikimedia file titles might not match exactly
3. **Missing Data:** Some artworks might not have Wikidata entries
4. **Batch Size:** Need to process in batches to avoid timeouts

## Code Outline

```typescript
// src/cli-backfill-qids.ts

async function backfillMetQIDs(metObjectIds: number[]): Promise<Map<number, string>> {
  // Query Wikidata for each Met object ID using P3634
  // Returns Map<metObjectId, wikidataQID>
}

async function backfillWikimediaQIDs(commonsTitles: string[]): Promise<Map<string, string>> {
  // Query Wikidata for each Commons file title
  // Returns Map<commonsTitle, wikidataQID>
}

async function main() {
  // 1. Get all art_sources without QIDs
  // 2. Group by source type
  // 3. Backfill Met sources
  // 4. Backfill Wikimedia sources
  // 5. Update database
  // 6. Report results
}
```

## Recommendation

**Yes, it's feasible!** The backfill would:
- ✅ Work well for Met sources (high success rate)
- ⚠️ Work moderately for Wikimedia (some manual review needed)
- ✅ Be a one-time operation
- ✅ Improve deduplication for all existing artworks

**Effort:** 2-3 hours total (development + testing + execution)



















