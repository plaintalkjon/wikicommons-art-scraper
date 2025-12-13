# Multi-Token Management Solution

## Overview

I've implemented a **database-driven approach** to manage multiple Mastodon access tokens, one per artist. This is the most scalable and maintainable solution.

## Architecture

### Database Table: `mastodon_accounts`

Stores Mastodon credentials per artist:
- `artist_id` - Links to the artist (one account per artist)
- `mastodon_base_url` - The Mastodon instance URL
- `mastodon_access_token` - The access token
- `account_username` - Optional reference (e.g., "@vangogh@mastodon.social")
- `active` - Enable/disable accounts

### Edge Function Updates

The `vincent-van-gogh` function now:
1. Looks up Mastodon credentials from the database based on artist name
2. Falls back to environment variables if no database entry exists (backward compatible)
3. Uses the correct token for each artist automatically

## Setup Steps

### 1. Create the Database Table

Run this SQL in Supabase SQL Editor:

```sql
-- See docs/mastodon-accounts-schema.sql for full schema
CREATE TABLE IF NOT EXISTS mastodon_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id UUID NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  mastodon_base_url TEXT NOT NULL DEFAULT 'https://mastodon.social',
  mastodon_access_token TEXT NOT NULL,
  account_username TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(artist_id)
);
```

### 2. Add Accounts for Each Artist

```sql
-- Example: Vincent van Gogh
INSERT INTO mastodon_accounts (artist_id, mastodon_base_url, mastodon_access_token, account_username)
SELECT 
  id,
  'https://mastodon.social',
  'your_vincent_token_here',
  '@vangogh@mastodon.social'
FROM artists
WHERE name = 'Vincent van Gogh';

-- Example: Rembrandt (could be on different instance)
INSERT INTO mastodon_accounts (artist_id, mastodon_base_url, mastodon_access_token, account_username)
SELECT 
  id,
  'https://mastodon.art',
  'your_rembrandt_token_here',
  '@rembrandt@mastodon.art'
FROM artists
WHERE name = 'Rembrandt van Rijn';
```

### 3. Deploy Updated Function

```bash
/tmp/supabase functions deploy vincent-van-gogh
```

## Benefits

✅ **Scalable** - Add as many artists as you want  
✅ **Flexible** - Each artist can use different Mastodon instances  
✅ **Secure** - Tokens stored in database (only accessible with service role key)  
✅ **Maintainable** - Easy to update tokens via SQL  
✅ **Backward Compatible** - Falls back to env vars if database lookup fails  

## Token Management

### Update a Token
```sql
UPDATE mastodon_accounts
SET mastodon_access_token = 'new_token_here',
    updated_at = NOW()
WHERE artist_id = (SELECT id FROM artists WHERE name = 'Vincent van Gogh');
```

### Disable an Account
```sql
UPDATE mastodon_accounts
SET active = false
WHERE artist_id = (SELECT id FROM artists WHERE name = 'Vincent van Gogh');
```

### View All Accounts
```sql
SELECT 
  a.name as artist_name,
  m.mastodon_base_url,
  m.account_username,
  m.active,
  m.updated_at
FROM mastodon_accounts m
JOIN artists a ON m.artist_id = a.id
ORDER BY a.name;
```

## How It Works

1. Function receives request (or runs on schedule)
2. Determines artist name (from function name or query param)
3. Queries `mastodon_accounts` table for that artist
4. Uses the token from database (or falls back to env vars)
5. Posts to Mastodon with the correct account

## Future: Generic Function

You could create a generic `post-art` function that:
- Takes `?artist=Artist Name` as parameter
- Looks up credentials automatically
- Works for any artist

This would eliminate the need for separate functions per artist!

