# WikiData-Powered Google Arts Scraper

This scraper uses WikiData's structured API to get reliable metadata for artworks, avoiding the rate limiting and scraping issues of the Google Arts website.

## How It Works

1. **URL Parsing**: Extracts search terms from Google Arts URLs like `artsandculture.google.com/asset/the-lovers-marc-chagall/...`
2. **WikiData Search**: Uses WikiData's search API to find matching artworks
3. **Entity Details**: Retrieves structured metadata including title, artist, date, description, genres, materials, etc.
4. **Image Upload**: Uploads existing images with the retrieved metadata to Supabase

## Advantages Over Scraping Google Arts

- ✅ **No Rate Limiting**: WikiData API is generous with requests
- ✅ **Structured Data**: Rich, reliable metadata from WikiData
- ✅ **No Scraping**: No need to parse HTML or handle website changes
- ✅ **Comprehensive**: Includes genres, materials, locations, descriptions
- ✅ **Reliable**: WikiData has quality-controlled information

## Current Status

The core WikiData integration is working:

```bash
# Test the WikiData search functionality
npm run wikidata-googlearts -- --test

# Import artworks (limited test run)
npm run wikidata-googlearts -- --csv google-arts-remaining.csv --images /path/to/images --limit 5
```

### What Works
- WikiData search API integration
- Entity details retrieval
- Structured metadata extraction
- Image upload to Supabase
- Confidence scoring for matches

### Current Challenges
1. **URL to WikiData Mapping**: Google Arts URLs use different titles than WikiData canonical titles
2. **Artist Extraction**: Need better parsing of artist names from URL slugs
3. **Known Artwork Database**: Need to build a comprehensive mapping of popular artworks

## Example Output

```
🔄 WikiData-Powered Google Arts Import
📁 CSV: google-arts-remaining.csv
🖼️  Images: downloads/GoogleImages
🎯 Limit: 5
📚 Data Source: WikiData API

🎨 Processing: 2936.jpg
  🔍 WikiData search: "lovers marc chagall"
  📚 Found mapped artwork: The Lovers
  🏆 Best match: "The Lovers" by Marc Chagall (score: 95, confidence: high)
  📚 WikiData: "The Lovers" by Marc Chagall (Q4311775)
  📅 Date: 1914-01-01T00:00:00Z
  📝 Description: painting by Marc Chagall...
  ✅ Imported: "The Lovers" by Marc Chagall (high confidence)
```

## Configuration Options

- `--csv <file>`: CSV file with filename and Google Arts URL columns
- `--images <dir>`: Directory containing the downloaded images
- `--limit <n>`: Limit number of artworks to process
- `--min-confidence <level>`: Minimum confidence level (high/medium/low/none)
- `--test`: Run API tests without importing

## Data Quality

WikiData provides rich metadata including:
- Title and artist
- Creation date
- Description
- Genres and styles
- Materials and techniques
- Location/institution
- Dimensions (when available)
- External links

## Next Steps

1. **Build Artwork Mapping Database**: Create comprehensive mapping of Google Arts URLs to WikiData QIDs
2. **Improve Artist Detection**: Better URL parsing to identify artists
3. **Batch Processing**: Handle large collections efficiently
4. **Fallback Strategies**: Multiple search approaches for unmatched artworks
5. **Quality Validation**: Review imported data for accuracy

## Usage

```bash
# Test the functionality
npm run wikidata-googlearts -- --test

# Import first 10 artworks
npm run wikidata-googlearts -- --csv google-arts-remaining.csv --images downloads/GoogleImages --limit 10

# Import only high-confidence matches
npm run wikidata-googlearts -- --csv google-arts-remaining.csv --images downloads/GoogleImages --min-confidence high
```

This approach provides a much more reliable and scalable solution than scraping Google Arts directly, with access to high-quality structured metadata.

