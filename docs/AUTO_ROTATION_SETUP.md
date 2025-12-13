# Automatic Artist Rotation Setup

## Overview

The `post-art` edge function now supports **automatic artist rotation**! Instead of creating separate cron jobs for each artist, you can:

1. **Add artists to the `mastodon_accounts` table** (using `npm run add-artist-bot`)
2. **Set up just 4 cron jobs** (one for each time slot: 12am, 6am, 12pm, 6pm)
3. **The function automatically cycles through all active artists**

## How It Works

- When called **without** the `?artist=` parameter, the function:
  1. Queries `mastodon_accounts` for all active accounts
  2. Picks the artist with the oldest `last_posted_at` (or NULL if never posted)
  3. Posts their artwork
  4. Updates `last_posted_at` timestamp
  5. Next time, it picks the next artist in rotation

- When called **with** `?artist=Artist Name`, it works as before (backward compatible)

## Setup Steps

### Step 1: Add the `last_posted_at` Column

Run this SQL in Supabase SQL Editor:

```sql
-- File: docs/add-last-posted-column.sql
ALTER TABLE mastodon_accounts 
ADD COLUMN IF NOT EXISTS last_posted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_mastodon_accounts_last_posted 
ON mastodon_accounts(last_posted_at) 
WHERE active = true;
```

### Step 2: Deploy the Updated Function

The function has already been deployed, but if you need to redeploy:

```bash
./deploy-post-art.sh
```

### Step 3: Set Up the Schedule

Run this SQL in Supabase SQL Editor:

```sql
-- File: docs/schedule-auto-rotation.sql
-- (Already includes your anon key)
```

This creates 4 cron jobs that call the function without an artist parameter.

### Step 4: Test It

```bash
# Test without artist parameter (auto-select)
curl -X POST "https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/post-art" \
  -H "Authorization: Bearer YOUR_ANON_KEY"

# Test with specific artist (still works!)
curl -X POST "https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/post-art?artist=Vincent%20van%20Gogh" \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

## Benefits

✅ **Scalable**: Add new artists without creating new cron jobs  
✅ **Fair rotation**: Each artist gets equal posting time  
✅ **Simple**: Just 4 cron jobs total, regardless of artist count  
✅ **Backward compatible**: `?artist=` parameter still works  

## Adding New Artists

Just use the helper script:

```bash
npm run add-artist-bot -- --artist "Artist Name" --token "token" --username "@user@instance"
```

No need to create new cron jobs! The existing 4 jobs will automatically include the new artist in rotation.

## Removing Artists

To temporarily disable an artist without deleting:

```sql
UPDATE mastodon_accounts 
SET active = false 
WHERE artist_id = (SELECT id FROM artists WHERE name = 'Artist Name');
```

To re-enable:

```sql
UPDATE mastodon_accounts 
SET active = true 
WHERE artist_id = (SELECT id FROM artists WHERE name = 'Artist Name');
```

## Viewing Rotation Status

```sql
-- See all artists and their last posted time
SELECT 
  a.name as artist_name,
  ma.account_username,
  ma.active,
  ma.last_posted_at
FROM mastodon_accounts ma
JOIN artists a ON a.id = ma.artist_id
ORDER BY ma.last_posted_at NULLS FIRST;
```

