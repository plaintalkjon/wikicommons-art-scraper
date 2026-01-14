# Yu-Gi-Oh Card Posting Bot - Complete Explanation

## Overview

The Yu-Gi-Oh card posting bot automatically posts random staple cards from the Yu-Gi-Oh Trading Card Game to Mastodon accounts. The system uses a Supabase Edge Function that processes multiple bot accounts on a schedule.

## Architecture

### Components

1. **Supabase Edge Function**: `post-yugioh-card` (`supabase/functions/post-yugioh-card/index.ts`)
2. **Database Table**: `mastodon_accounts` (stores bot account credentials and posting timestamps)
3. **Cron Job**: Supabase cron scheduler that triggers the function periodically
4. **External API**: YGOPRODeck API (https://db.ygoprodeck.com/api/v7/) for fetching card data

### How It Works

```
┌─────────────┐
│ Cron Job    │  Runs every 6 hours (or 15 minutes for faster retry)
│ (Supabase)  │
└──────┬──────┘
       │ HTTP POST
       ▼
┌─────────────────────┐
│ Edge Function       │  1. Query database for due accounts
│ post-yugioh-card    │  2. Fetch random staple card from YGOPRODeck
└──────┬──────────────┘  3. Download card image
       │                  4. Upload to Mastodon
       │                  5. Create status post
       ▼
┌─────────────────────┐
│ Mastodon Instance   │  Posts appear on Mastodon
└─────────────────────┘
```

## Detailed Flow

### 1. Cron Job Trigger

The cron job is configured in Supabase and runs on a schedule:

**Current Configuration** (from `fix-mtg-yugioh-cron-jobs.sql`):
- **Schedule**: Every 6 hours (`0 */6 * * *`)
- **Alternative** (from `create-yugioh-cron.sql`): Every 15 minutes (`*/15 * * * *`) for faster retry on failures

**Cron Job SQL**:
```sql
SELECT cron.schedule(
  'post-yugioh-card',
  '0 */6 * * *',  -- Every 6 hours
  $$
  SELECT net.http_post(
    url := 'https://lxtkpwsxuhhmvvz.supabase.co/functions/v1/post-yugioh-card?interval_hours=6',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer [ANON_KEY]'
    )
  ) AS request_id;
  $$
);
```

### 2. Function Execution

When the cron job triggers, it calls the Edge Function with query parameters:
- `interval_hours=6`: Tells the function to only process accounts that haven't posted in the last 6 hours
- `max_accounts=10`: Limits how many accounts to process per run (prevents timeout)

### 3. Account Selection Logic

The function queries the `mastodon_accounts` table:

```typescript
// Find accounts that are due to post
const { data: accounts } = await supabase
  .from("mastodon_accounts")
  .select("*")
  .eq("active", true)
  .eq("account_type", "yugioh")
  .or(`last_posted_at.is.null,last_posted_at.lt.${cutoffTime.toISOString()}`)
  .order("last_posted_at", { ascending: true, nullsFirst: true })
  .limit(maxAccounts);
```

**Selection Criteria**:
- `active = true`: Only active accounts
- `account_type = 'yugioh'`: Only Yu-Gi-Oh bot accounts
- `last_posted_at` is NULL OR older than 6 hours: Accounts due to post
- Ordered by `last_posted_at` (oldest first, never-posted accounts first)
- Limited to 10 accounts per run (configurable)

### 4. Card Fetching

For each account, the function fetches a random staple card:

**API Call**:
```typescript
const stapleUrl = "https://db.ygoprodeck.com/api/v7/cardinfo.php?staple=yes";
const response = await fetch(stapleUrl, {
  headers: {
    "User-Agent": "Yu-Gi-Oh-Card-Bot/1.0 (contact: developer@example.com)",
  },
});
```

**Card Selection Process**:
1. Fetches all staple cards from YGOPRODeck API
2. Filters cards that have images (`card_images[0].image_url`)
3. Randomly selects one card from the filtered list
4. Uses the first card image (usually the main one)

**Card Data Structure**:
```typescript
interface YugiohCard {
  id: number;
  name: string;
  type: string;
  frameType: string;
  desc: string;
  atk?: number;
  def?: number;
  level?: number;
  race?: string;
  attribute?: string;
  archetype?: string;
  card_images: YugiohCardImage[];
  ygoprodeck_url: string;
}
```

### 5. Image Processing

The function extracts the image URL from the card:

```typescript
function extractImageUrl(card: YugiohCard): { url: string; format: string } | null {
  const cardImage = card.card_images[0];
  const imageUrl = cardImage.image_url || cardImage.image_url_small || cardImage.image_url_cropped;
  const format = getFileExtension(imageUrl); // "png" or "jpg"
  return { url: imageUrl, format };
}
```

**Image Priority**:
1. `image_url` (full-size)
2. `image_url_small` (fallback)
3. `image_url_cropped` (last resort)

### 6. Mastodon Posting

The posting process involves two API calls:

**Step 1: Upload Media**
```typescript
// Download image from YGOPRODeck
const imageResponse = await fetch(imageInfo.url);
const imageBlob = await imageResponse.blob();

// Upload to Mastodon
const formData = new FormData();
formData.append("file", imageBlob, `yugioh-card.${imageInfo.format}`);

const mediaResponse = await fetch(`${mastodonUrl}/api/v1/media`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${account.mastodon_access_token}`,
  },
  body: formData,
});
```

**Step 2: Create Status Post**
```typescript
// Wait 4 seconds for media processing
await new Promise((resolve) => setTimeout(resolve, 4000));

// Create status post
const postText = formatCardPost(card); // "{card.name}\n\n#yugioh"
const statusResponse = await fetch(`${mastodonUrl}/api/v1/statuses`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${account.mastodon_access_token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    status: postText,
    media_ids: [mediaId],
    visibility: "public",
  }),
});
```

**Post Format**:
```
{Card Name}

#yugioh
```

Example:
```
Dark Magician

#yugioh
```

### 7. Database Update

After successful posting, the function updates the account's `last_posted_at` timestamp:

```typescript
const { error: updateError } = await supabase
  .from("mastodon_accounts")
  .update({ last_posted_at: now })
  .eq("id", account.id);
```

This timestamp is used in the next cron run to determine if the account is due to post again.

## Database Schema

### `mastodon_accounts` Table

Required columns for Yu-Gi-Oh bots:
- `id`: UUID (primary key)
- `account_username`: Mastodon username (e.g., "yugioh_bot")
- `mastodon_base_url`: Mastodon instance URL (e.g., "mastodon.social" or "https://mastodon.social")
- `mastodon_access_token`: OAuth access token for Mastodon API
- `account_type`: Must be `'yugioh'`
- `active`: Boolean (true = active, false = inactive)
- `last_posted_at`: Timestamp (NULL = never posted)

**Example Account**:
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

## Safety Features

### 1. Duplicate Prevention

The function checks if an account posted recently (within 5 minutes) and skips it:

```typescript
if (account.last_posted_at) {
  const minutesSinceLastPost = (Date.now() - lastPostTime.getTime()) / (1000 * 60);
  if (minutesSinceLastPost < 5) {
    console.log("Posted too recently, skipping");
    continue;
  }
}
```

### 2. Timeout Protection

The function stops processing accounts if it's approaching the function timeout (50 seconds):

```typescript
const elapsedMs = Date.now() - startTime;
if (elapsedMs > 50000) {
  console.log("Stopping early to avoid function timeout");
  break;
}
```

### 3. Error Handling

Each account is processed independently. If one account fails, others continue:

```typescript
try {
  // Process account
} catch (error: any) {
  console.error(`Error processing account:`, error.message);
  results.push({ account: account.account_username, error: error.message });
  // Continue to next account
}
```

## Manual Testing

You can test the function manually with curl:

```bash
# Test with specific account
curl -X POST \
  'https://lxtkpwsxuhhmvvz.supabase.co/functions/v1/post-yugioh-card?account=yugioh_staples' \
  -H 'Authorization: Bearer [ANON_KEY]'

# Test automatic mode (processes all due accounts)
curl -X POST \
  'https://lxtkpwsxuhhmvvz.supabase.co/functions/v1/post-yugioh-card?interval_hours=6&max_accounts=10' \
  -H 'Authorization: Bearer [ANON_KEY]'
```

**Query Parameters**:
- `account=username`: Process specific account only
- `interval_hours=6`: Override default interval (default: 6 hours)
- `max_accounts=10`: Override max accounts per run (default: 10)

## Posting Schedule

### Account-Level Interval

Each account posts independently every **6 hours** (4 times per day):
- 00:00 UTC
- 06:00 UTC
- 12:00 UTC
- 18:00 UTC

### Cron Job Frequency

**Option 1: Match Posting Interval** (`fix-mtg-yugioh-cron-jobs.sql`)
- Cron runs every 6 hours (`0 */6 * * *`)
- Matches the account posting interval exactly
- Simple and predictable

**Option 2: Faster Retry** (`create-yugioh-cron.sql`)
- Cron runs every 15 minutes (`*/15 * * * *`)
- Function still respects 6-hour posting interval per account
- If a post fails, retry happens in 15 minutes instead of waiting 6 hours
- More resilient to transient failures

**Recommendation**: Use Option 2 (15-minute cron) for better reliability, especially if you have multiple accounts.

## Differences from MTG Bot

| Feature | Yu-Gi-Oh Bot | MTG Bot |
|---------|--------------|---------|
| **Card Source** | YGOPRODeck API (staple cards) | Scryfall API (random cards) |
| **Card Selection** | Random from staple list | Random with filters (showcase, commander, etc.) |
| **Post Content** | Card name + `#yugioh` | Card name + set + artist |
| **Bot Types** | Single type (all use staples) | Multiple types (showcase, commander, secret-lair) |
| **Image Format** | PNG or JPG | PNG preferred, JPG fallback |

## Troubleshooting

### No Cards Found

**Symptoms**: Function logs show "No staple cards found in API response"

**Solutions**:
- Check YGOPRODeck API is accessible: `https://db.ygoprodeck.com/api/v7/cardinfo.php?staple=yes`
- Verify API response format hasn't changed
- Check function logs for detailed error messages

### Image Download Fails

**Symptoms**: Function logs show "Failed to download image"

**Solutions**:
- Verify card has valid `image_url` in API response
- Check YGOPRODeck image URLs are accessible
- Some cards may not have images (function filters these out)

### Mastodon Posting Fails

**Symptoms**: Function logs show "Mastodon media upload failed" or "Mastodon status creation failed"

**Solutions**:
- Verify `mastodon_access_token` is valid and not expired
- Check `mastodon_base_url` is correct (function normalizes it)
- Verify Mastodon instance is accessible
- Check function logs for specific error codes

### Account Not Posting

**Symptoms**: Account exists but never posts

**Solutions**:
- Verify `active = true` in database
- Verify `account_type = 'yugioh'` in database
- Check `last_posted_at` - if NULL, account should post; if recent, wait for interval
- Check cron job is running: `SELECT * FROM cron.job WHERE jobname = 'post-yugioh-card';`
- Review function logs for errors

## Monitoring

### Check Cron Job Status

```sql
SELECT 
  jobid,
  jobname,
  schedule,
  active,
  command::text
FROM cron.job 
WHERE jobname = 'post-yugioh-card';
```

### Check Account Status

```sql
SELECT 
  account_username,
  account_type,
  active,
  last_posted_at,
  CASE 
    WHEN last_posted_at IS NULL THEN 'Never posted'
    WHEN last_posted_at < NOW() - INTERVAL '6 hours' THEN 'Due to post'
    ELSE 'Not due'
  END as status
FROM mastodon_accounts
WHERE account_type = 'yugioh'
ORDER BY last_posted_at NULLS FIRST;
```

### View Function Logs

1. Go to Supabase Dashboard
2. Navigate to Edge Functions → `post-yugioh-card`
3. Click "Logs" tab
4. Look for log messages prefixed with `🃏 YU-GI-OH`

## Key Files

- **Function Code**: `supabase/functions/post-yugioh-card/index.ts`
- **Cron Setup (6 hours)**: `fix-mtg-yugioh-cron-jobs.sql`
- **Cron Setup (15 minutes)**: `create-yugioh-cron.sql`
- **Documentation**: This file (`docs/YUGIOH_CARD_BOT.md`)

## Summary

The Yu-Gi-Oh card posting bot is a fully automated system that:

1. ✅ Runs on a schedule via Supabase cron jobs
2. ✅ Processes multiple accounts automatically
3. ✅ Fetches random staple cards from YGOPRODeck API
4. ✅ Posts card images to Mastodon with card name and hashtag
5. ✅ Respects 6-hour posting intervals per account
6. ✅ Handles errors gracefully and prevents duplicate posts
7. ✅ Updates database timestamps to track posting history

The system is designed to be **set-and-forget**: add accounts to the database, and they'll automatically start posting on schedule.

