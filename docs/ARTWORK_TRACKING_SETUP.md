# Artwork Posting Tracking System

## Overview

The system now tracks which artworks have been posted to avoid repeats. Once all artworks for an artist have been posted, the system automatically resets and starts over.

## How It Works

1. **Tracking**: Each artwork asset in `art_assets` has a `last_posted_at` timestamp
2. **Selection**: The system prioritizes artworks that:
   - Have never been posted (`last_posted_at` is NULL) - picked first
   - Have the oldest `last_posted_at` - picked after all unposted are done
3. **Reset**: When all artworks have been posted (no NULL values), the system resets all `last_posted_at` to NULL and starts over
4. **New Artworks**: When you add new artworks to an existing artist, they automatically have `last_posted_at = NULL`, so they'll be picked first

## Setup

### Step 1: Add the Tracking Column

Run this SQL in Supabase SQL Editor:

```sql
-- File: docs/add-art-assets-last-posted.sql
ALTER TABLE art_assets 
ADD COLUMN IF NOT EXISTS last_posted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_art_assets_last_posted 
ON art_assets(last_posted_at) 
WHERE last_posted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_art_assets_unposted 
ON art_assets(art_id) 
WHERE last_posted_at IS NULL;
```

### Step 2: Deploy the Updated Function

The function has already been deployed, but if you need to redeploy:

```bash
./deploy-post-art.sh
```

## Behavior

### Normal Operation

- Each time the function runs, it picks the artwork with the oldest `last_posted_at` (or NULL if never posted)
- After posting, it updates that artwork's `last_posted_at` timestamp
- This ensures all artworks are posted before any repeats

### Reset Behavior

- When all artworks have been posted (no NULL `last_posted_at` values), the system:
  1. Detects this condition
  2. Resets all `last_posted_at` to NULL for that artist
  3. Continues posting (now all artworks are "unposted" again)

### Adding New Artworks

- When you add new artworks to an existing artist:
  - They automatically have `last_posted_at = NULL`
  - They'll be prioritized and picked first
  - The system continues working normally - no manual intervention needed

## Verification

### Check Posting Status

```sql
-- See which artworks have been posted and when
SELECT 
  a.name as artist_name,
  aa.storage_path,
  aa.last_posted_at,
  CASE 
    WHEN aa.last_posted_at IS NULL THEN 'Never posted'
    ELSE 'Posted'
  END as status
FROM art_assets aa
JOIN arts ar ON ar.id = aa.art_id
JOIN artists a ON a.id = ar.artist_id
WHERE a.name = 'Vincent van Gogh'
ORDER BY aa.last_posted_at NULLS FIRST
LIMIT 20;
```

### Check Unposted Count

```sql
-- Count unposted artworks per artist
SELECT 
  a.name as artist_name,
  COUNT(*) FILTER (WHERE aa.last_posted_at IS NULL) as unposted_count,
  COUNT(*) as total_artworks
FROM artists a
JOIN arts ar ON ar.artist_id = a.id
JOIN art_assets aa ON aa.art_id = ar.id
GROUP BY a.name
ORDER BY a.name;
```

### Manual Reset (if needed)

```sql
-- Reset all artworks for a specific artist
UPDATE art_assets
SET last_posted_at = NULL
WHERE art_id IN (
  SELECT id FROM arts WHERE artist_id = (
    SELECT id FROM artists WHERE name = 'Vincent van Gogh'
  )
);
```

## Benefits

✅ **No repeats** - Each artwork is posted before any repeats  
✅ **Automatic reset** - System resets when all artworks are posted  
✅ **New artwork support** - New artworks are automatically prioritized  
✅ **Fair rotation** - All artworks get equal posting time  
✅ **Scalable** - Works with any number of artworks per artist  
