# Cron System Documentation

## Overview

The cron system uses the `post-art` Edge Function deployed in Supabase. It automatically rotates through all active Mastodon accounts (artist, tag, and philosopher accounts) and posts content on a schedule.

## How It Works

### Edge Function: `post-art`

**Location**: `supabase/functions/post-art/index.ts` (deployed to Supabase)

**Endpoint**: `https://{project}.supabase.co/functions/v1/post-art`

### Rotation Mechanism

The system uses **interval-based scheduling** where each account posts independently every N hours:

1. **Default Interval**: 6 hours (`interval_hours=6`)
   - This means each account posts 4 times per day (24 hours / 6 hours = 4 posts)
   - The interval is independent of the total number of accounts

2. **Account Selection Logic**:
   - Gets all active accounts from `mastodon_accounts` table
   - For each account, calculates when it's next due to post:
     - Uses `last_posted_at` if available, otherwise uses `created_at`
     - Next due time = reference time + interval hours
   - Filters to accounts where `nextDueMs <= now`
   - Sorts by oldest reference time first (never-posted accounts come first)
   - Processes up to `max_accounts` (default: 10) per cron run

3. **Account Types Supported**:
   - **Artist accounts**: Posts artworks from a specific artist
   - **Tag accounts**: Posts artworks that match any of the account's tags (via `mastodon_account_tags` junction table)
   - **Philosopher accounts**: Posts quotes from a specific philosopher

### Cron Schedule

The Supabase cron job calls the function on a schedule (exact schedule configured in Supabase dashboard). The function itself determines which accounts are due based on their `last_posted_at` timestamps.

### Posting Logic

#### For Artist Accounts:
1. Gets next artwork from `art_assets` for that artist
2. Prioritizes artworks with `last_posted_at = NULL` (never posted)
3. Then prioritizes oldest `last_posted_at` (least recently posted)
4. Downloads image from Supabase Storage
5. Uploads to Mastodon
6. Creates status post with **#art hashtag** (for artist accounts)
7. Updates `art_assets.last_posted_at` for the specific artwork
8. Updates `mastodon_accounts.last_posted_at` for the account

#### For Tag Accounts:
1. Gets all tag IDs associated with the account from `mastodon_account_tags`
2. Finds artworks that have any of those tags
3. Prioritizes artworks with `last_posted_at = NULL` (never posted)
4. Then prioritizes oldest `last_posted_at`
5. Downloads image from Supabase Storage
6. Uploads to Mastodon
7. Creates status post:
   - **Text content**: Artist name (if available from the artwork)
   - **If artist has a Mastodon bot**: Appends link in format `@username@domain`
   - **Note**: The deployed version includes logic to get artist name from artwork and check for artist bot accounts
8. Updates `art_assets.last_posted_at` for the specific artwork
9. Updates `mastodon_accounts.last_posted_at` for the account

#### For Philosopher Accounts:
1. Gets next quote from `quotes` table for that philosopher
2. Prioritizes quotes with `posted_at = NULL` (never posted)
3. Then prioritizes oldest `posted_at`
4. Formats quote text
5. Posts to Mastodon
6. Records post in `quote_posts` table
7. Updates `mastodon_accounts.last_posted_at` for the account

### Reset Logic

When all artworks/quotes for an account have been posted (no NULL `last_posted_at`):
- The system automatically resets all `last_posted_at` to NULL
- This allows the account to cycle through all content again
- Reset happens automatically when `allPosted = true` is detected

### Manual Invocation

The function can be called manually with query parameters:

- **Single artist**: `?artist=Artist Name` - Posts for that specific artist only
- **Manual pagination**: `?offset=0&limit=5` - Processes specific accounts by position
- **Custom interval**: `?interval_hours=4&max_accounts=5` - Override default interval and max accounts

### Database Tables Used

- `mastodon_accounts`: Stores account credentials and `last_posted_at` timestamps
- `art_assets`: Stores artwork files with `last_posted_at` for tracking which artworks have been posted
- `art_tags`: Links artworks to tags (used by tag accounts)
- `mastodon_account_tags`: Junction table linking tag accounts to their tags
- `arts`: Artwork metadata
- `artists`: Artist information
- `quotes`: Philosopher quotes (for philosopher accounts)
- `quote_posts`: Tracks which quotes have been posted to which accounts

### Key Features

1. **Independent Intervals**: Each account posts every N hours independently, regardless of how many accounts exist
2. **Automatic Reset**: When all content is posted, automatically resets to start over
3. **Prioritizes Unposted**: Always posts never-posted content before reposting
4. **Handles Missing Files**: If a storage file is missing, marks it as posted and tries the next artwork (up to 5 attempts)
5. **No Delays Between Accounts**: The cron schedule handles spacing, so the function processes all due accounts immediately

## Current Configuration

Based on the code:
- **Default interval**: 6 hours (4 posts per account per day)
- **Default max accounts per run**: 10
- **Storage bucket**: `Art` (configurable via `BUCKET` env var)
- **Image extensions supported**: jpg, jpeg, png, webp, gif

## Post Text Content

### Artist Accounts
- **Text**: `#art` (hashtag only)

### Tag Accounts  
- **Text**: Artist name (if available from the artwork)
- **If artist has a Mastodon bot**: Appends link in format `@username@domain` (domain extracted from URL, no protocol)
- **Always includes**: `#art` hashtag at the end
- The system looks up the artist name from the artwork's storage path by querying:
  1. `art_assets` → `art_id`
  2. `arts` → `artist_id`  
  3. `artists` → `name`
- Then checks if that artist has an active Mastodon account of type 'artist'
- If found, constructs the Mastodon mention in format `@username@domain` (domain without protocol)
- Format example: `Artist Name\n\n@username@domain\n\n#art`

### Philosopher Accounts
- **Text**: Formatted quote text with philosopher name

## Notes

- The exact cron schedule is configured in the Supabase dashboard (not in code)
- The function is stateless - it determines what to post based on database timestamps
- Multiple accounts can post in the same cron run if they're all due
- The system scales automatically as more accounts are added
- **Note**: The deployed version in Supabase may have additional features not present in the local git history (e.g., enhanced tag account text with artist bot links)






















