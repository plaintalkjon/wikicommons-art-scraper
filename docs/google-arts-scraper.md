# Google Arts & Culture Scraper

This scraper allows you to import artwork images that you've already downloaded from artsandculture.google.com, along with their metadata.

## Prerequisites

1. **Downloaded Images**: You should have a folder containing the artwork images downloaded from Google Arts & Culture
2. **CSV Mapping File**: A CSV file that maps each image filename to its original Google Arts & Culture URL

## CSV File Format

Your existing CSV file has a comprehensive format with color analysis data. The scraper automatically extracts the required information:

**Required columns:**
- `filename`: The image filename (e.g., `2936.jpg`)
- `page`: The Google Arts & Culture URL

**Optional columns (automatically used for tagging):**
- `color`: Dominant color (BLUE, BROWN, ORANGE, etc.)
- Color analysis data (BGR/HSV/LAB means and standard deviations)

**Example from your CSV:**
```csv
filename,image,page,color,index
2936.jpg,"https://lh3.googleusercontent.com/ci/...=w218-c-h218-fcrop64=1,00001473ffffc2a5-rw-v1",https://artsandculture.google.com/asset/the-lovers-marc-chagall/jQEveVgIzd6-Og,BLUE,2936
10356.jpg,"https://lh3.googleusercontent.com/ci/...=w218-c-h218-fcrop64=1,208b0000e3d1ffff-rw-v1",https://artsandculture.google.com/asset/a-spiritualistic-s%C3%A9ance-kunnas-v%C3%A4in%C3%B6/BAG6lhZPN6IXzQ,BROWN,10356
```

## Directory Structure

The scraper expects this structure in your project:

```
downloads/
├── GoogleImages/           # Symlink to your actual images directory (15,057+ JPG files)
│   ├── 0.jpg
│   ├── 10000.jpg
│   ├── 2936.jpg
│   └── ... (numbered JPG filenames)
└── GoogleImages.csv        # CSV with 16,311 artwork entries
```

**Setup:** The scraper creates a symlink from `downloads/GoogleImages/` to your actual images directory.

## Your Dataset

- **Images:** 15,057 JPG files with numeric filenames (0.jpg, 10000.jpg, etc.)
- **CSV Records:** 16,311 entries with comprehensive metadata
- **Coverage:** URLs to Google Arts & Culture pages for metadata scraping

## Usage

### Basic Import
```bash
npm run googlearts-import -- --csv downloads/GoogleImages.csv --images downloads/GoogleImages
```

### Dry Run (Recommended First)
```bash
npm run googlearts-import -- --csv downloads/GoogleImages.csv --images downloads/GoogleImages --dry-run
```

### Limited Import (for testing)
```bash
npm run googlearts-import -- --csv downloads/GoogleImages.csv --images downloads/GoogleImages --limit 5
```

### Force Re-scraping Existing Artworks
```bash
npm run googlearts-import -- --csv downloads/GoogleImages.csv --images downloads/GoogleImages --force-rescrape
```

## Command Line Options

- `--csv <path>`: Path to the CSV file mapping filenames to URLs (required)
- `--images <path>`: Path to the directory containing the image files (required)
- `--dry-run`: Show what would be done without actually uploading
- `--limit <number>`: Limit the number of artworks to process
- `--skip-missing`: Skip artworks where the image file doesn't exist (default: true)
- `--force-rescrape`: Re-scrape and update existing artworks instead of skipping them

## What the Scraper Does

1. **Reads the CSV file** to get the list of artworks and their URLs
2. **Scrapes metadata** from each Google Arts & Culture page:
   - Artwork title
   - Artist name
   - Tags (automatically generated from content)
   - Description
   - Creation date
   - Medium/materials
   - Dimensions
   - Museum/collection information
3. **Uploads images** to Supabase storage with proper metadata
4. **Creates database records** for artworks, artists, and tags
5. **Links artworks to their sources** for future reference

## Generated Tags

The scraper automatically generates relevant tags based on the scraped content:

- **Medium**: Oil painting, watercolor, sculpture, etc.
- **Style**: Impressionist, Renaissance, Baroque, etc.
- **Period**: Medieval, 19th century, 20th century, contemporary
- **Museum**: Tagged with museum names
- **Keywords**: Extracted from titles and descriptions

## Error Handling

- **Missing Images**: Artworks without corresponding image files are skipped (unless `--skip-missing false`)
- **Scraping Failures**: If a page can't be scraped, that artwork is skipped
- **Duplicate Detection**: Existing artworks (by source URL) are skipped unless `--force-rescrape` is used
- **Rate Limiting**: Built-in rate limiting to avoid overwhelming the Google Arts & Culture servers

## Troubleshooting

### Common Issues

1. **404 Errors**: The URLs in your CSV might be incorrect or expired
2. **Missing Images**: Ensure image files exist in the specified directory
3. **CSV Format**: Make sure your CSV has the correct column headers (`filename`, `sourceUrl`)

### Finding Correct URLs

To get the correct URLs for your downloaded images:

1. Visit artsandculture.google.com
2. Search for the artwork
3. Copy the URL from your browser's address bar
4. Ensure the URL follows the format: `https://artsandculture.google.com/asset/[artwork-name]/[id]`

## Example Output

```
Google Arts & Culture import:
  CSV: downloads/GoogleImages.csv
  Images: downloads/GoogleImages
  Limit: unlimited
  Dry run: false
  Skip missing images: true
  Force rescrape: false

Step 1: Scraping metadata from Google Arts & Culture...
Found 150 records in CSV
Scraping: mona-lisa.jpg -> https://artsandculture.google.com/asset/mona-lisa/ABC123
✓ Scraped: "Mona Lisa" by Leonardo da Vinci
Scraping: starry-night.jpg -> https://artsandculture.google.com/asset/starry-night/DEF456
✓ Scraped: "The Starry Night" by Vincent van Gogh
...
✓ Scraped metadata for 147 artworks

Step 2: Processing artworks...

[1/147] Processing: mona-lisa.jpg
  ✓ Uploaded "Mona Lisa" by Leonardo da Vinci

[2/147] Processing: starry-night.jpg
  ✓ Uploaded "The Starry Night" by Vincent van Gogh
...

============================================================
SUMMARY
============================================================
Total artworks in CSV: 6
Attempted: 6
Uploaded: 0 (dry run)
Skipped: 6
Errors: 0
Missing images: 0
```
