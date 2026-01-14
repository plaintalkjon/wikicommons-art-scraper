# Account Management Review

## Overview

This document reviews how accounts are added to Supabase and the different types of accounts supported in the system.

## Account Types

The system supports **5 account types**, enforced by a database constraint:

1. **`artist`** - Posts artwork from specific artists
2. **`tag`** - Posts artwork tagged with specific tags
3. **`quote`** - Posts quotes from quote authors (previously called "philosopher")
4. **`mtg`** - Posts Magic: The Gathering card images
5. **`yugioh`** - Posts Yu-Gi-Oh card images

### Database Constraint

All account types are enforced by a CHECK constraint:

```sql
CHECK (account_type IN ('artist', 'tag', 'quote', 'mtg', 'yugioh'))
```

**Note:** The constraint must be updated manually in Supabase SQL Editor when adding new account types.

## Database Schema: `mastodon_accounts` Table

### Core Fields (All Account Types)

- `id` - UUID (primary key, auto-generated)
- `account_username` - TEXT (Mastodon username, normalized: no @ symbols)
- `mastodon_base_url` - TEXT (Mastodon instance domain, normalized: no protocol)
- `mastodon_access_token` - TEXT (OAuth access token)
- `account_type` - TEXT (one of: 'artist', 'tag', 'quote', 'mtg', 'yugioh')
- `active` - BOOLEAN (true = active, false = inactive)
- `last_posted_at` - TIMESTAMP (NULL = never posted, used for scheduling)

### Type-Specific Foreign Keys

Different account types use different foreign key relationships:

- **`artist`** accounts → `artist_id` (references `artists.id`)
- **`tag`** accounts → `tag_id` (references `tags.id`)
- **`quote`** accounts → `author_id` (references `quote_authors.id`)
- **`mtg`** accounts → No foreign key required
- **`yugioh`** accounts → No foreign key required

## Adding Accounts

### Method 1: CLI Script (Recommended for artist, tag, quote)

**Script:** `src/cli-add-mastodon-account.ts`

**Usage:**

```bash
# Artist account
npm run add-mastodon-account -- \
  --username ArtistBot \
  --domain mastodon.social \
  --token YOUR_TOKEN \
  --type artist \
  --artist "Vincent van Gogh"

# Tag account
npm run add-mastodon-account -- \
  --username CuratedImpressionism \
  --domain mastodon.social \
  --token YOUR_TOKEN \
  --type tag \
  --tag impressionism

# Quote account (note: CLI still uses "philosopher" but creates "quote" type)
npm run add-mastodon-account -- \
  --username PhilosopherBot \
  --domain mastodon.social \
  --token YOUR_TOKEN \
  --type philosopher \
  --philosopher "Marcus Aurelius"
```

**What it does:**

1. **Normalizes inputs:**
   - Username: Removes `@` symbols and extracts username part
   - Domain: Removes protocol (`https://`) and path components

2. **Validates foreign keys:**
   - Artist accounts: Verifies artist exists in `artists` table
   - Tag accounts: Verifies tag exists in `tags` table
   - Quote accounts: Verifies author exists in `quote_authors` table

3. **Creates account:**
   - Artist accounts: Creates directly with `artist_id` set
   - Tag/Quote accounts: Creates account first, then updates with foreign key

### Method 2: Direct SQL Insert (For mtg, yugioh, or manual)

**Example for MTG:**

```sql
-- First, ensure constraint allows the account type
ALTER TABLE mastodon_accounts 
DROP CONSTRAINT IF EXISTS mastodon_accounts_account_type_check;

ALTER TABLE mastodon_accounts 
ADD CONSTRAINT mastodon_accounts_account_type_check 
CHECK (account_type IN ('artist', 'tag', 'quote', 'mtg', 'yugioh'));

-- Then insert the account
INSERT INTO mastodon_accounts (
  account_username,
  mastodon_base_url,
  mastodon_access_token,
  account_type,
  active
) VALUES (
  'CuratedMTGShowcase',
  'mastodon.social',  -- Note: normalized format (no protocol)
  'your_access_token_here',
  'mtg',
  true
);
```

**Example for Yu-Gi-Oh:**

```sql
INSERT INTO mastodon_accounts (
  account_username,
  mastodon_base_url,
  mastodon_access_token,
  account_type,
  active
) VALUES (
  'yugioh_staples',
  'mastodon.social',
  'your_access_token_here',
  'yugioh',
  true
);
```

### Method 3: Setup Scripts (For MTG)

**Script:** `src/cli-setup-mtg-bot.ts`

**Usage:**

```bash
npm run setup-mtg-bot
```

**What it does:**

1. Attempts to update the database constraint (may require manual SQL)
2. Checks if account already exists
3. Adds the MTG account if it doesn't exist
4. Generates cron job SQL (requires manual execution)

**Note:** This script provides SQL for manual execution in Supabase SQL Editor.

## Data Normalization

### Username Normalization

The system normalizes usernames to remove `@` symbols:

```typescript
function normalizeUsername(username: string): string {
  return username.replace(/^@+/, '').split('@')[0];
}
```

**Examples:**
- `@username` → `username`
- `@username@domain.com` → `username`
- `username` → `username`

### Base URL Normalization

The system normalizes Mastodon base URLs to domain-only format:

```typescript
function normalizeBaseUrl(url: string): string {
  let normalized = url.replace(/^https?:\/\//, '');  // Remove protocol
  normalized = normalized.replace(/\/$/, '');        // Remove trailing slash
  const parts = normalized.split('/');
  return parts[0];  // Keep only domain
}
```

**Examples:**
- `https://mastodon.social` → `mastodon.social`
- `https://mastodon.social/` → `mastodon.social`
- `mastodon.social` → `mastodon.social`

## Account Type Details

### 1. Artist Accounts

**Purpose:** Post artwork from specific artists

**Required Fields:**
- `account_type`: `'artist'`
- `artist_id`: Foreign key to `artists.id`

**How Content Works:**
- Queries `artworks` table filtered by `artist_id`
- Posts images with artist attribution

**Adding:**
- Use CLI script with `--type artist --artist "Artist Name"`
- Or create manually with SQL (ensure `artist_id` is set)

### 2. Tag Accounts

**Purpose:** Post artwork tagged with specific tags

**Required Fields:**
- `account_type`: `'tag'`
- `tag_id`: Foreign key to `tags.id`

**How Content Works:**
- Queries `artworks` table via `artwork_tags` join table
- Posts images with tag hashtags

**Adding:**
- Use CLI script with `--type tag --tag tag_name`
- Or create manually with SQL (ensure `tag_id` is set)

### 3. Quote Accounts

**Purpose:** Post quotes from quote authors

**Required Fields:**
- `account_type`: `'quote'` (previously `'philosopher'`, migrated)
- `author_id`: Foreign key to `quote_authors.id`

**How Content Works:**
- Queries `quotes` table filtered by `author_id`
- Posts quote text (no images)

**Migration Note:**
- Old accounts used `account_type = 'philosopher'`
- Migrated to `account_type = 'quote'` for generalization
- CLI script still accepts `--type philosopher` but creates `'quote'` type

**Adding:**
- Use CLI script with `--type philosopher --philosopher "Author Name"`
- Or create manually with SQL (ensure `author_id` is set)

### 4. MTG Accounts

**Purpose:** Post Magic: The Gathering card images

**Required Fields:**
- `account_type`: `'mtg'`
- No foreign keys required

**How Content Works:**
- Queries external MTG API (Scryfall)
- Posts card images with card name and hashtags

**Adding:**
- Use setup script: `npm run setup-mtg-bot`
- Or use SQL directly (see `setup-mtg-bot-final.sql`)

**Special Setup:**
- Requires cron job to call `post-mtg-card` function
- Cron typically runs every 6 hours

### 5. Yu-Gi-Oh Accounts

**Purpose:** Post Yu-Gi-Oh card images

**Required Fields:**
- `account_type`: `'yugioh'`
- No foreign keys required

**How Content Works:**
- Queries external Yu-Gi-Oh API
- Posts card images with card name and hashtags

**Adding:**
- Use SQL directly (no CLI script yet)
- See `docs/YUGIOH_CARD_BOT.md` for examples

**Special Setup:**
- Requires cron job to call `post-yugioh-card` function
- Cron typically runs every 15 minutes (function respects 6-hour posting interval)

## Checking Accounts

### View All Accounts

```bash
npm run check-account-types
```

This script:
- Lists all accounts grouped by type
- Shows active/inactive status
- Warns about unexpected account types
- Checks for accounts that need migration

### Query Accounts Directly

```sql
-- All accounts
SELECT id, account_username, account_type, active, last_posted_at
FROM mastodon_accounts
ORDER BY account_type, account_username;

-- Accounts by type
SELECT account_type, COUNT(*) as count
FROM mastodon_accounts
GROUP BY account_type;

-- Active accounts due to post
SELECT account_username, account_type, last_posted_at
FROM mastodon_accounts
WHERE active = true
  AND (last_posted_at IS NULL OR last_posted_at < NOW() - INTERVAL '6 hours')
ORDER BY last_posted_at NULLS FIRST;
```

## Common Issues

### 1. Constraint Violation

**Error:** `check constraint "mastodon_accounts_account_type_check"`

**Solution:** Update the constraint to include the new account type:

```sql
ALTER TABLE mastodon_accounts 
DROP CONSTRAINT IF EXISTS mastodon_accounts_account_type_check;

ALTER TABLE mastodon_accounts 
ADD CONSTRAINT mastodon_accounts_account_type_check 
CHECK (account_type IN ('artist', 'tag', 'quote', 'mtg', 'yugioh', 'new_type'));
```

### 2. Foreign Key Missing

**Error:** Account created but doesn't post content

**Solution:** Ensure the foreign key is set:
- Artist accounts: `artist_id` must reference existing artist
- Tag accounts: `tag_id` must reference existing tag
- Quote accounts: `author_id` must reference existing quote author

### 3. Account Not Posting

**Check:**
1. `active = true`
2. `last_posted_at` is NULL or older than posting interval
3. Cron job is configured and running
4. Foreign key is set (for artist/tag/quote accounts)
5. Content exists in database (for artist/tag/quote accounts)

## Best Practices

1. **Use CLI scripts** when possible for artist/tag/quote accounts (handles normalization and validation)
2. **Normalize data** before inserting (remove @ from username, remove protocol from domain)
3. **Check constraints** before adding new account types
4. **Verify foreign keys** exist before linking accounts
5. **Test accounts** by manually calling the posting function before relying on cron
6. **Monitor `last_posted_at`** to ensure accounts are posting regularly

## Related Files

- **CLI Scripts:**
  - `src/cli-add-mastodon-account.ts` - Add artist/tag/quote accounts
  - `src/cli-setup-mtg-bot.ts` - Setup MTG bot account
  - `src/cli-check-account-types.ts` - Check account types

- **SQL Scripts:**
  - `setup-mtg-bot-final.sql` - Complete MTG setup
  - `create-yugioh-cron.sql` - Yu-Gi-Oh cron setup
  - `migrate-philosopher-to-quote.sql` - Migration script

- **Documentation:**
  - `docs/QUOTES_SYSTEM_README.md` - Quote accounts guide
  - `docs/MTG_CARD_BOT.md` - MTG bot guide
  - `docs/YUGIOH_CARD_BOT.md` - Yu-Gi-Oh bot guide

