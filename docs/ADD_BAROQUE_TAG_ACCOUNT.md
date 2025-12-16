# Adding Baroque Tag Account

## Step 1: Run Database Migration

First, you need to add support for tag-based accounts in the database. Run this SQL in your Supabase SQL Editor:

```sql
-- Run the contents of: docs/add-tag-account-support.sql
```

Or run it directly:

```sql
-- Make artist_id nullable (tag accounts won't have an artist_id)
ALTER TABLE mastodon_accounts 
ALTER COLUMN artist_id DROP NOT NULL;

-- Drop the unique constraint on artist_id
ALTER TABLE mastodon_accounts 
DROP CONSTRAINT IF EXISTS mastodon_accounts_artist_id_key;

-- Add tag_id column
ALTER TABLE mastodon_accounts 
ADD COLUMN IF NOT EXISTS tag_id UUID REFERENCES tags(id) ON DELETE CASCADE;

-- Add account_type column
ALTER TABLE mastodon_accounts
ADD COLUMN IF NOT EXISTS account_type TEXT DEFAULT 'artist' CHECK (account_type IN ('artist', 'tag'));

-- Update existing accounts
UPDATE mastodon_accounts 
SET account_type = 'artist' 
WHERE account_type IS NULL;

-- Add index for tag-based lookups
CREATE INDEX IF NOT EXISTS idx_mastodon_accounts_tag_id 
ON mastodon_accounts(tag_id) 
WHERE tag_id IS NOT NULL;

-- Add constraint: account must have either artist_id OR tag_id
ALTER TABLE mastodon_accounts
DROP CONSTRAINT IF EXISTS mastodon_accounts_account_type_check;

ALTER TABLE mastodon_accounts
ADD CONSTRAINT mastodon_accounts_account_type_check 
CHECK (
  (account_type = 'artist' AND artist_id IS NOT NULL AND tag_id IS NULL) OR
  (account_type = 'tag' AND tag_id IS NOT NULL AND artist_id IS NULL)
);
```

## Step 2: Add Baroque Tag Account

After running the migration, add the Baroque account:

```bash
npm run add-tag-bot -- --tag "baroque" --token "No-HI9BxIageDPbBMoWPS2-UDo7I0IddN9uUzIL8o2c" --username "@CuratedBaroque@mastodon.social"
```

Or manually via SQL:

```sql
INSERT INTO mastodon_accounts (tag_id, account_type, mastodon_base_url, mastodon_access_token, account_username, active)
SELECT id, 'tag', 'https://mastodon.social', 'No-HI9BxIageDPbBMoWPS2-UDo7I0IddN9uUzIL8o2c', '@CuratedBaroque@mastodon.social', true
FROM tags WHERE name = 'baroque';
```

## Step 3: Deploy Updated Edge Function

The edge function has been updated to support tag accounts. Deploy it:

```bash
./deploy-post-art.sh
```

Or manually using Supabase CLI.

## How It Works

- The Baroque account will automatically combine all Baroque-related tags:
  - `baroque`
  - `flemish baroque painting`
  - `baroque painting`
  - `baroque art`
  - `italian baroque painting`
  - `baroque sculpture`
  - `baroque painting of spain`

- The account will post 1 artwork every 6 hours (4 times per day) as part of the existing cron job rotation
- No additional scheduling needed - it's automatically included when the cron job runs
- The system tracks which artworks have been posted and resets when all have been posted

## Verification

After setup, verify the account:

```sql
SELECT 
  ma.id,
  ma.account_type,
  ma.account_username,
  ma.active,
  t.name as tag_name
FROM mastodon_accounts ma
JOIN tags t ON ma.tag_id = t.id
WHERE t.name = 'baroque';
```


