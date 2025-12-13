# Updating Artwork Titles - Guide

## The Problem

Current titles in the database are often filenames like:
- `Vulcano y el Fuego, Pedro Pablo Rubens.jpg`
- `Bomen - s0078V1962 - Van Gogh Museum.jpg`
- `File:John Singer Sargent - Carnation, Lily, Lily, Rose - Google Art Project.jpg`

## The Solution

We already have Wikidata item IDs stored in the `art_sources` table. We can fetch proper titles from Wikidata and update the database.

## Difficulty: **Moderate** ⚙️

**Why it's moderate:**
- ✅ We already have the Wikidata IDs (no need to look them up)
- ✅ Wikidata API is reliable and well-documented
- ⚠️ Need to handle rate limiting (Wikidata has limits)
- ⚠️ Some artworks might not have Wikidata entries
- ⚠️ Need to be careful not to overwrite good titles

## What I've Created

1. **`src/cli-update-titles.ts`** - Script to update titles
2. **`src/wikidata.ts`** - Added `fetchWikidataItemTitle()` function
3. **`package.json`** - Added `npm run update-titles` command

## How to Use

### Option 1: Run the Update Script (Recommended)

```bash
npm run update-titles
```

This will:
- Find all artworks with Wikidata sources
- Fetch proper titles from Wikidata
- Update titles that are clearly filenames or poorly formatted
- Skip titles that are already good
- Process in batches with rate limiting

### Option 2: Post Without Titles

Your edge function already posts images without titles (image-only posts). So titles aren't critical for posting functionality. They're mainly useful for:
- Database organization
- Future features (search, display, etc.)
- Better data quality

## What Gets Updated

The script will update titles that:
- Contain file extensions (`.jpg`, `.jpeg`, `.png`, `.tiff`)
- Start with `File:`
- Contain museum codes (like `s0078V1962`)
- Contain "Google Art Project" or similar

It will **skip** titles that:
- Already match the Wikidata title
- Are shorter/more concise than Wikidata title
- Don't look like filenames

## Example Results

**Before:**
- `Vulcano y el Fuego, Pedro Pablo Rubens.jpg`
- `Bomen - s0078V1962 - Van Gogh Museum.jpg`
- `File:John Singer Sargent - Carnation, Lily, Lily, Rose - Google Art Project.jpg`

**After:**
- `Vulcan and the Forge of Vulcan` (or similar proper title)
- `Trees` (or similar)
- `Carnation, Lily, Lily, Rose` (or similar)

## Time Estimate

For ~1000-2000 artworks:
- **Processing time:** ~10-20 minutes (with rate limiting)
- **Success rate:** ~70-90% (some may not have Wikidata entries)

## Recommendation

**Try it!** The script is safe - it only updates titles that are clearly filenames. You can run it and see the results. If you don't like it, you can always restore from a backup or manually fix titles.

Or, if you prefer, just **post without titles** - your Mastodon posts work fine without them.

