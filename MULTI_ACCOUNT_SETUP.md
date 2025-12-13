# Multi-Account Mastodon Token Management

## Overview

This system allows you to manage multiple Mastodon bot accounts, one per artist. Each artist can have their own Mastodon instance and access token.

## Database Schema

A `mastodon_accounts` table stores the credentials:
- `artist_id` - Links to the artist
- `mastodon_base_url` - The Mastodon instance URL (default: https://mastodon.social)
- `mastodon_access_token` - The access token for that account
- `account_username` - Optional reference (e.g., "@vangogh@mastodon.social")
- `active` - Whether this account is currently active

## Setup Steps

### 1. Create the Database Table

Run the SQL in `docs/mastodon-accounts-schema.sql` in your Supabase SQL Editor.

### 2. Add Accounts for Artists

For each artist bot account, insert a record:

```sql
-- Example: Vincent van Gogh
INSERT INTO mastodon_accounts (artist_id, mastodon_base_url, mastodon_access_token, account_username)
SELECT 
  id,
  'https://mastodon.social',
  'your_vincent_van_gogh_token_here',
  '@vangogh@mastodon.social'
FROM artists
WHERE name = 'Vincent van Gogh';

-- Example: Rembrandt (different instance)
INSERT INTO mastodon_accounts (artist_id, mastodon_base_url, mastodon_access_token, account_username)
SELECT 
  id,
  'https://mastodon.art',
  'your_rembrandt_token_here',
  '@rembrandt@mastodon.art'
FROM artists
WHERE name = 'Rembrandt van Rijn';
```

### 3. Update Edge Functions

The edge functions will automatically look up the token from the database based on the artist.

## Security Considerations

**Option A: Database Storage (Current)**
- ✅ Simple to manage
- ✅ Easy to update via SQL
- ⚠️ Tokens stored in plain text in database (but only accessible with service role key)

**Option B: Supabase Vault (More Secure)**
- ✅ Encrypted at rest
- ✅ Better for production
- ⚠️ Requires vault extension
- ⚠️ Slightly more complex to update

For most use cases, database storage is fine since:
- Only accessible with service role key
- Edge functions run in secure environment
- Easy to rotate tokens

## Token Rotation

To update a token:

```sql
UPDATE mastodon_accounts
SET mastodon_access_token = 'new_token_here',
    updated_at = NOW()
WHERE artist_id = (SELECT id FROM artists WHERE name = 'Vincent van Gogh');
```

## Deactivating Accounts

To temporarily disable an account:

```sql
UPDATE mastodon_accounts
SET active = false
WHERE artist_id = (SELECT id FROM artists WHERE name = 'Vincent van Gogh');
```

