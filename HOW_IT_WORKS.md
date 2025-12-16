# How the Multi-Account System Works

## Overview

The edge function automatically uses the `mastodon_accounts` table to get credentials for each artist. You just add artists to the table, and it works automatically!

## Flow

1. **Function is called** (via schedule or manual trigger)
2. **Determines artist name** (defaults to "Vincent van Gogh" for this function)
3. **Looks up credentials** from `mastodon_accounts` table:
   - Queries `artists` table to get artist ID
   - Queries `mastodon_accounts` table for that artist
   - Gets `mastodon_base_url` and `mastodon_access_token`
4. **Uses those credentials** to post to Mastodon
5. **Falls back** to environment variables if no database entry exists

## Adding New Artists

To add a new artist bot:

1. **Add the artist account to the database:**
   ```sql
   INSERT INTO mastodon_accounts (artist_id, mastodon_base_url, mastodon_access_token, account_username)
   SELECT 
     id,
     'https://mastodon.social',
     'your_token_here',
     '@artistname@mastodon.social'
   FROM artists
   WHERE name = 'Artist Name';
   ```

2. **That's it!** The function will automatically use the correct token.

## Current Setup

The `vincent-van-gogh` function:
- Defaults to artist: "Vincent van Gogh"
- Looks up credentials from database
- Uses `@CuratedVanGogh@mastodon.social` account

## Future: Generic Function

You could create a generic `post-art` function that:
- Takes `?artist=Artist Name` parameter
- Works for any artist in the database
- No need for separate functions per artist

This would be even more scalable!


