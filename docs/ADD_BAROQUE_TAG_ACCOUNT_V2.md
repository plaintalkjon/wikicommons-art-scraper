# Adding Baroque Tag Account (Multi-Tag Version)

## Overview

This version uses a junction table (`mastodon_account_tags`) to allow multiple tags per account. This makes it easy to add new tags to an account without code changes.

## Step 1: Run Database Migration

Run this SQL in your Supabase SQL Editor:

```sql
-- Run the contents of: docs/add-tag-account-support-v2.sql
```

This creates:
- `mastodon_account_tags` junction table (many-to-many relationship)
- Support for multiple tags per account
- Proper indexes and RLS policies

## Step 2: Add Baroque Account with Multiple Tags

Add the Baroque account with all related tags:

```bash
npm run add-tag-bot -- --tags "baroque,flemish baroque painting,baroque painting,baroque art,italian baroque painting,baroque sculpture,baroque painting of spain" --token "No-HI9BxIageDPbBMoWPS2-UDo7I0IddN9uUzIL8o2c" --username "@CuratedBaroque@mastodon.social"
```

This will:
- Create the account
- Add all 7 Baroque-related tags to the account
- The edge function will automatically query artworks with ANY of these tags

## Step 3: Deploy Updated Edge Function

Deploy the updated function:

```bash
./deploy-post-art.sh
```

## Adding More Tags Later

To add more tags to an existing account, you can:

1. **Via SQL:**
```sql
-- Get the account ID
SELECT id FROM mastodon_accounts WHERE account_username = '@CuratedBaroque@mastodon.social';

-- Add a new tag
INSERT INTO mastodon_account_tags (mastodon_account_id, tag_id)
SELECT 
  (SELECT id FROM mastodon_accounts WHERE account_username = '@CuratedBaroque@mastodon.social'),
  (SELECT id FROM tags WHERE name = 'new baroque tag')
ON CONFLICT (mastodon_account_id, tag_id) DO NOTHING;
```

2. **Update the CLI script** to support adding tags to existing accounts (future enhancement)

## How It Works

- The account queries artworks that have ANY of the tags in `mastodon_account_tags`
- No code changes needed when adding new tags - just insert into the junction table
- The system automatically tracks posting history and resets when all artworks are posted
- Posts 1 artwork every 6 hours (4 times per day) as part of the cron rotation

## Verification

Check the account and its tags:

```sql
SELECT 
  ma.id,
  ma.account_type,
  ma.account_username,
  ma.active,
  array_agg(t.name) as tags
FROM mastodon_accounts ma
LEFT JOIN mastodon_account_tags mat ON ma.id = mat.mastodon_account_id
LEFT JOIN tags t ON mat.tag_id = t.id
WHERE ma.account_username = '@CuratedBaroque@mastodon.social'
GROUP BY ma.id, ma.account_type, ma.account_username, ma.active;
```


