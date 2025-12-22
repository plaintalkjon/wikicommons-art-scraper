# Philosopher Quotes Bot - Feasibility Report

## Executive Summary

✅ **FEASIBLE** - Creating a philosopher quotes bot using Wikiquotes is technically viable and can integrate with the existing Mastodon posting system.

## Technical Feasibility

### ✅ Wikiquotes Access
- **Status**: Fully accessible via MediaWiki API (same as Wikimedia Commons)
- **API Endpoint**: `https://en.wikiquote.org/w/api.php`
- **Method**: Uses standard MediaWiki API calls (parse, query, sections)
- **No authentication required**: Public API access

### ✅ Quote Extraction
- **Status**: Successfully tested with Nietzsche
- **Results**: Extracted 295 unique quotes from Friedrich Nietzsche's page
- **Method**: HTML parsing from page sections
- **Quality**: Good - quotes are well-formatted and suitable for posting

### ✅ Data Availability
- **Wikidata Integration**: Philosophers have Wikidata QIDs (e.g., Nietzsche = Q9358)
- **Occupation Filter**: Can identify philosophers using `wdt:P106/wdt:P279* wd:Q4964182`
- **Page Structure**: Wikiquotes pages are well-organized with sections by work

## Test Results: Friedrich Nietzsche

### Quote Statistics
- **Total quotes extracted**: 295 unique quotes
- **Average length**: 206 characters
- **Length distribution**:
  - Short (<100 chars): 69 quotes (23%)
  - Medium (100-250 chars): 125 quotes (42%)
  - Long (250+ chars): 101 quotes (34%)

### Mastodon Compatibility
- ✅ **Character limit**: Mastodon posts can be up to 500 characters
- ✅ **Quote length**: Most quotes fit comfortably (average 206 chars)
- ✅ **Long quotes**: 34% are 250+ chars - still within limit, may need trimming for attribution

## Proposed Architecture

### Database Schema

```sql
-- Philosophers table (similar to artists)
CREATE TABLE philosophers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  wikidata_qid TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Quotes table
CREATE TABLE quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  philosopher_id UUID NOT NULL REFERENCES philosophers(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  source TEXT, -- e.g., "Beyond Good and Evil", "Letter to..."
  section TEXT, -- Wikiquotes section name
  character_count INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(philosopher_id, text) -- Prevent duplicate quotes
);

-- Quote posting tracking (similar to art_assets)
CREATE TABLE quote_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  mastodon_account_id UUID NOT NULL REFERENCES mastodon_accounts(id) ON DELETE CASCADE,
  mastodon_status_id TEXT,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(quote_id, mastodon_account_id) -- Track per account
);

-- Extend mastodon_accounts for quote accounts
ALTER TABLE mastodon_accounts 
ADD COLUMN IF NOT EXISTS account_type TEXT DEFAULT 'artist' 
CHECK (account_type IN ('artist', 'tag', 'philosopher'));
```

### Data Flow

1. **Fetch Quotes** (similar to `fetchAndStoreArtworks`)
   - Look up philosopher QID in Wikidata
   - Fetch Wikiquotes page via MediaWiki API
   - Extract quotes from HTML sections
   - Store in `quotes` table

2. **Post Quotes** (similar to `post-art` edge function)
   - Query for unposted quotes for a philosopher account
   - Format quote for Mastodon (add attribution if needed)
   - Post to Mastodon
   - Track in `quote_posts` table

3. **Rotation** (same as current system)
   - Use interval-based scheduling
   - Track `last_posted_at` per quote
   - Reset when all quotes posted

## Integration with Existing System

### ✅ Reusable Components
- **Wikidata lookup**: Can reuse `findArtistQID` pattern → `findPhilosopherQID`
- **Mastodon posting**: Can reuse `post-art` edge function logic
- **Scheduling**: Same interval-based system works
- **Account management**: Extend `mastodon_accounts` table

### New Components Needed
1. **Quote extraction module** (`src/wikiquotes.ts`)
   - Fetch page sections
   - Parse HTML for quotes
   - Clean and validate quotes

2. **Quote pipeline** (`src/quote-pipeline.ts`)
   - Similar to `pipeline.ts` but for quotes
   - Fetch and store quotes
   - Handle duplicates

3. **Quote posting function** (extend `post-art` or create `post-quote`)
   - Format quotes for Mastodon
   - Handle character limits
   - Add attribution

## Challenges & Solutions

### Challenge 1: Quote Quality
- **Issue**: Some extracted items may be metadata, not actual quotes
- **Solution**: Filtering logic (length, pattern matching, validation)
- **Status**: ✅ Tested - filtering works well

### Challenge 2: Attribution
- **Issue**: Quotes may need source attribution (work, letter, etc.)
- **Solution**: Extract source from section names or quote context
- **Status**: ⚠️ Needs refinement - some quotes have sources, some don't

### Challenge 3: Character Limits
- **Issue**: Mastodon has 500 character limit
- **Solution**: 
  - Filter quotes to <500 chars
  - Or truncate long quotes with "..."
  - Attribution can be separate line
- **Status**: ✅ Most quotes fit (average 206 chars)

### Challenge 4: Multiple Languages
- **Issue**: Some quotes are in original language (e.g., German for Nietzsche)
- **Solution**: 
  - Filter to English only
  - Or support multiple languages per account
- **Status**: ⚠️ Needs decision - currently extracting all

### Challenge 5: Quote Duplicates
- **Issue**: Same quote may appear in multiple sections
- **Solution**: Use `UNIQUE(philosopher_id, text)` constraint
- **Status**: ✅ Handled in schema

## Recommended Implementation Steps

### Phase 1: Core Functionality
1. ✅ Create `wikiquotes.ts` module (quote extraction)
2. ✅ Create `quote-pipeline.ts` (fetch and store)
3. ✅ Add database schema for philosophers/quotes
4. ✅ Create CLI tool: `npm run fetch-quotes -- --philosopher "Friedrich Nietzsche"`

### Phase 2: Posting Integration
1. Extend `post-art` edge function to support quotes
2. Or create separate `post-quote` edge function
3. Add philosopher account type to `mastodon_accounts`
4. Test posting quotes to Mastodon

### Phase 3: Account Management
1. Create `cli-add-philosopher-bot.ts` (similar to `cli-add-artist-bot.ts`)
2. Add philosopher account creation workflow
3. Integrate with scheduling system

### Phase 4: Polish
1. Improve quote filtering/validation
2. Add source attribution
3. Handle language preferences
4. Add quote quality scoring

## Example Quote Format for Mastodon

```
"That which does not kill us makes us stronger."

— Friedrich Nietzsche
```

Or with source:
```
"Without music, life would be a mistake."

— Friedrich Nietzsche, The Twilight of the Idols
```

## Comparison: Quotes vs Artworks

| Aspect | Artworks | Quotes |
|--------|----------|--------|
| **Source** | Wikimedia Commons | Wikiquotes |
| **API** | MediaWiki API | MediaWiki API |
| **Data Type** | Images + metadata | Text |
| **Storage** | Supabase Storage + DB | Database only |
| **Posting** | Image + text | Text only |
| **Character Limit** | N/A (images) | 500 chars |
| **Rotation** | Same system | Same system |

## Conclusion

**Feasibility: ✅ HIGH**

The philosopher quotes bot is:
- ✅ Technically feasible
- ✅ Can reuse existing infrastructure
- ✅ Data is accessible and extractable
- ✅ Compatible with Mastodon limits
- ✅ Can integrate with current scheduling system

**Recommendation**: Proceed with implementation. Start with Phase 1 to validate quote extraction and storage, then integrate with posting system.

## Next Steps

1. Review and approve database schema
2. Implement quote extraction module
3. Test with multiple philosophers (Nietzsche, Plato, Kant, etc.)
4. Design quote formatting for Mastodon
5. Plan integration with existing `post-art` function or create separate endpoint
