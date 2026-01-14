# ArtStation API Investigation & Codebase Overview

## Codebase Overview

This is a **Wikimedia Commons art scraper** project that:
- Scrapes artwork from various sources (Wikimedia Commons, Google Arts & Culture, Met Museum, etc.)
- Stores artwork metadata and images in **Supabase** (PostgreSQL database + Storage)
- Posts artwork to **Mastodon** via Supabase Edge Functions
- Supports multiple bot types: artist accounts, tag accounts, philosopher accounts, MTG card bots, and Yu-Gi-Oh card bots

## Supabase Architecture

### Configuration
- **Client Setup**: Uses `@supabase/supabase-js` library
- **Environment Variables**:
  - `SUPABASE_URL` - Your Supabase project URL
  - `SUPABASE_SERVICE_ROLE_KEY` - Service role key for admin operations
  - `SUPABASE_BUCKET` - Storage bucket name (default: `Art`)

### Database Schema

Key tables:
- **`artists`** - Artist information (id, name)
- **`arts`** - Artwork metadata (id, title, description, image_url, artist_id)
- **`art_assets`** - Storage paths and metadata for artwork files (art_id, storage_path, public_url, width, height, file_size, mime_type, sha256, last_posted_at)
- **`art_sources`** - Source tracking (art_id, source, source_pageid, source_title, source_url, wikidata_qid)
- **`art_tags`** - Tags for artworks (id, name)
- **`art_tags` junction** - Links artworks to tags (art_id, tag_id)
- **`mastodon_accounts`** - Mastodon bot accounts (id, account_username, mastodon_base_url, mastodon_access_token, account_type, active, last_posted_at, artist_id, tag_id, philosopher_id)
- **`quotes`** - Philosopher quotes (for philosopher bot accounts)
- **`quote_posts`** - Tracks posted quotes

### Supabase Edge Functions

Located in `supabase/functions/`:

1. **`post-art`** - Posts artwork to Mastodon for artist/tag/philosopher accounts
   - Runs via cron job
   - Respects posting intervals (default: 6 hours)
   - Handles multiple account types

2. **`post-mtg-card`** - Posts Magic: The Gathering cards to Mastodon
   - Fetches cards from Scryfall API
   - Supports multiple bot types: showcase, commander, secret-lair
   - Uses YGOPRODeck API for card data

3. **`post-mtg-commander`** - Dedicated commander card posting function

4. **`post-yugioh-card`** - Posts Yu-Gi-Oh cards to Mastodon
   - Fetches staple cards from YGOPRODeck API
   - Posts random cards every 6 hours

### Cron Jobs

Cron jobs are set up in Supabase using PostgreSQL's `pg_cron` extension:
- Schedule format: `'*/15 * * * *'` (every 15 minutes) or `'0 */6 * * *'` (every 6 hours)
- Uses `net.http_post` to call Edge Functions
- Examples in: `create-yugioh-cron.sql`, `create-mtg-commander-cron.sql`, etc.

### Storage

- Images stored in Supabase Storage bucket
- Path format: `Art/{artist-slug}/{slugified-title}.{ext}`
- Supports: jpg, jpeg, png, webp, gif
- Target width: 1280px (configured in `config.ts`)

## ArtStation API Investigation

### **Result: ArtStation does NOT have an official public API**

However, ArtStation exposes several **unofficial JSON endpoints** that can be accessed:

### Available Endpoints

1. **User Following**:
   ```
   https://www.artstation.com/users/[username]/following.json
   ```
   Returns JSON data about users that a specific user is following.

2. **User Likes**:
   ```
   https://www.artstation.com/users/[username]/likes.json
   ```
   Returns JSON data about artworks a user has liked.

3. **Specific Artwork/Project**:
   ```
   https://www.artstation.com/project/[artwork-hash].json
   ```
   Returns detailed JSON data for a specific artwork/project.

### Important Notes

⚠️ **Limitations**:
- These endpoints are **not officially documented** or supported
- No authentication/API key system
- Rate limiting may apply (not documented)
- Endpoints may change without notice
- Must comply with ArtStation's Terms of Service
- Respect content creators' rights

### Alternative Approaches

1. **Web Scraping**: Use tools like Puppeteer or Cheerio (already in your dependencies)
   - Scrape HTML pages and extract data
   - More reliable but slower and requires parsing HTML

2. **Third-Party Tools**: 
   - ArtStationDownloader (community tool)
   - AgentQL (AI-powered data extraction)

3. **RSS Feeds**: ArtStation may have RSS feeds for user galleries (not confirmed)

### Integration Considerations

If you want to integrate ArtStation into this codebase:

1. **Similar Pattern to Existing Sources**:
   - Create a new scraper module (like `src/wikimedia.ts`, `src/googlearts.ts`)
   - Use the JSON endpoints or web scraping
   - Store in existing `arts` and `art_assets` tables
   - Add `artstation` as a source in `art_sources` table

2. **Challenges**:
   - No official API means less reliable
   - May need to handle rate limiting manually
   - HTML parsing if JSON endpoints don't provide all needed data
   - ArtStation uses artwork "hashes" (not sequential IDs) - need to discover these

3. **Recommended Approach**:
   - Start with JSON endpoints for basic data
   - Use web scraping for additional metadata if needed
   - Implement rate limiting (similar to existing `rateLimiter.ts`)
   - Add retry logic (similar to existing `retryUtils.ts`)

## Next Steps

If you want to add ArtStation support:

1. Create `src/artstation.ts` module
2. Implement functions to:
   - Fetch user's projects/artworks
   - Extract artwork metadata from JSON
   - Download images
   - Store in Supabase (reuse existing `db.ts` functions)
3. Add CLI command (like `cli-artstation-scrape.ts`)
4. Optionally create Edge Function for automated posting

Would you like me to implement ArtStation integration following the existing patterns in this codebase?

