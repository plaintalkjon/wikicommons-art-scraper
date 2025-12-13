# Generic post-art Function Guide

## Overview

The `post-art` function is a **generic edge function** that works for **any artist**. Just pass the artist name as a parameter, and it automatically:
- Looks up the artist's Mastodon credentials from the database
- Finds their artwork
- Posts with the correct account

## Deployment

```bash
./deploy-post-art.sh
```

Or manually:
```bash
/tmp/supabase functions deploy post-art
```

## Usage

### Manual Test
```bash
curl "https://YOUR_PROJECT.supabase.co/functions/v1/post-art?artist=Vincent van Gogh" \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

### Parameters
- `artist` (required) - The artist name exactly as it appears in your `artists` table
- `path` (optional) - Direct path to a specific image
- `use_db` (optional) - Use database query instead of storage listing (default: true)

## Scheduling Multiple Artists

### Step 1: Add Artist Accounts to Database

For each artist, add their Mastodon account:
```sql
INSERT INTO mastodon_accounts (artist_id, mastodon_base_url, mastodon_access_token, account_username)
SELECT 
  id,
  'https://mastodon.social',
  'their_token_here',
  '@artistname@mastodon.social'
FROM artists
WHERE name = 'Artist Name';
```

### Step 2: Schedule the Function

Use `setup-multi-artist-schedule.sql` to schedule each artist 4 times per day.

**For 3 artists, you'll have:**
- 12 total cron jobs (4 per artist × 3 artists)
- Each artist posts 4 times per day
- Total: 12 posts per day

### Example: Adding Rembrandt

```sql
-- Rembrandt - 4 times per day
SELECT cron.schedule(
  'rembrandt-12am',
  '0 0 * * *',
  $$
  SELECT net.http_post(
    url := 'https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/post-art?artist=Rembrandt van Rijn',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_ANON_KEY'
    )
  ) as request_id;
  $$
);

-- Repeat for 6am, 12pm, 6pm with job names: rembrandt-6am, rembrandt-12pm, rembrandt-6pm
```

## Benefits

✅ **One function for all artists** - No need to create separate functions  
✅ **Automatic credential lookup** - Just add to database table  
✅ **Easy to add new artists** - Just add account + 4 cron jobs  
✅ **Scalable** - Works for unlimited artists  

## Migration from vincent-van-gogh Function

You can:
1. Keep both functions (vincent-van-gogh still works)
2. Or migrate: Update cron jobs to use `post-art?artist=Vincent van Gogh` instead
3. Eventually remove vincent-van-gogh function once migrated

## Answer to Your Question

**Yes!** If you add 2 more artists and schedule them:
- Each artist posts **4 times per day**
- Total: **12 posts per day** (4 × 3 artists)
- All using the same generic function!

