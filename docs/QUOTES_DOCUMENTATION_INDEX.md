# Quotes System Documentation Index

## Quick Start (New Agents Start Here)

**`QUOTES_QUICK_REFERENCE.md`** - 2-minute overview for getting started

## Complete Guides

1. **`WIQUOTE_IMPORT_GUIDE.md`** - Step-by-step guide for importing quotes from Wikiquote
   - Prerequisites and migration steps
   - Import commands
   - Database schema details
   - Troubleshooting

2. **`QUOTES_SYSTEM_README.md`** - Complete system overview
   - Architecture and database structure
   - Import process
   - Mastodon posting setup
   - Code files reference

3. **`WIQUOTE_IMPLEMENTATION.md`** - Technical implementation details
   - How the scraper works
   - Data cleaning rules
   - Code structure

## Reference Documents

- **`WIQUOTE_STRUCTURE_ANALYSIS.md`** - Analysis of Wikiquote HTML structure
- **`WIQUOTE_EXAMPLES.md`** - Example raw and cleaned quote data
- **`QUOTES_GENERALIZATION_PLAN.md`** - Migration plan (historical, migration complete)
- **`MIGRATION_CHECKLIST.md`** - Step-by-step migration checklist (in root directory)

## Key Points for Future Agents

### Database Structure
- Uses **`quote_authors`** table (not `philosophers`)
- Uses **`author_id`** column (not `philosopher_id`)
- **`character_count`** is REQUIRED and auto-calculated
- Only **`source`** field is stored (reference/translation info removed from text)

### Import Command
```bash
npm run wikiquote-scrape -- --philosopher "Marcus Aurelius" --url "https://en.wikiquote.org/wiki/Marcus_Aurelius"
```

### Migration Status
✅ **Complete** - System fully migrated to generalized structure

### Common Issues
- "Could not find author_id" → Run `migrate-quotes-to-general.sql`
- "null value in character_count" → Already fixed (auto-calculated)

## File Locations

- **Migration SQL**: `migrate-quotes-to-general.sql` (root directory)
- **Scraper Code**: `src/wikiquote.ts`
- **CLI Tool**: `src/cli-wikiquote-scrape.ts`
- **Database Functions**: `src/db.ts` (`ensureQuoteAuthor`, `upsertQuote`)
- **Edge Function**: `supabase/functions/post-art/index.ts`

