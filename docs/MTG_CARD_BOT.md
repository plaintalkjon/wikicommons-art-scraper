# MTG Card Posting Bot

This bot posts random Showcase frame Magic: The Gathering cards to Mastodon 4 times per day.

## Overview

The bot uses a Supabase Edge Function (`post-mtg-card`) that:
1. Fetches a random Showcase frame card from Scryfall API
2. Downloads the card image
3. Posts it to Mastodon with card name, set, and artist info

**No database scraping required** - cards are fetched on-demand from Scryfall.

## Setup

### 1. Deploy the Edge Function

Deploy the function to Supabase:

```bash
supabase functions deploy post-mtg-card
```

Or use the Supabase dashboard to deploy `supabase/functions/post-mtg-card/index.ts`.

### 2. Add Mastodon Account to Database

Add your MTG bot Mastodon account to the `mastodon_accounts` table:

```sql
INSERT INTO mastodon_accounts (
  account_username,
  mastodon_base_url,
  mastodon_access_token,
  account_type,
  active
) VALUES (
  'your-bot-username',
  'https://your-mastodon-instance.com',
  'your-access-token',
  'mtg',
  true
);
```

Or use the CLI (you may need to extend `cli-add-mastodon-account.ts` to support `mtg` type):

```bash
# Manual SQL insert recommended for now
```

### 3. Set Up Cron Job

In Supabase Dashboard → SQL Editor, run this SQL to create the cron job:

```sql
SELECT cron.schedule(
  'post-mtg-card',
  '0 */6 * * *',  -- Every 6 hours (4 times per day)
  $$
  SELECT net.http_post(
    url := 'https://YOUR_PROJECT.supabase.co/functions/v1/post-mtg-card',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_ANON_KEY'
    )
  ) AS request_id;
  $$
);
```

**Replace these values:**
- `YOUR_PROJECT` → Your Supabase project reference (e.g., `abcdefghijklmnop`)
- `YOUR_ANON_KEY` → Your Supabase anon/public key (found in Settings → API)

**Schedule format:** `0 */6 * * *` means:
- `0` - minute 0
- `*/6` - every 6 hours
- `*` - every day of month
- `*` - every month
- `*` - every day of week

This posts at: 00:00, 06:00, 12:00, 18:00 UTC daily.

**To remove the cron job later:**
```sql
SELECT cron.unschedule('post-mtg-card');
```

## How It Works

### Posting Schedule

- Posts **4 times per day** (every 6 hours)
- Uses `last_posted_at` timestamp to determine when account is due
- Skips if posted within last 5 minutes (prevents double-posting)

### Card Selection

- Fetches random card using Scryfall API: `https://api.scryfall.com/cards/random?q=frame:showcase`
- Only posts Showcase frame cards
- Prefers PNG images, falls back to normal JPG
- Handles double-faced cards (uses first face)

### Post Content

Each post includes:
- Card name
- Set name
- Artist credit (if available)
- Card image

Example post text:
```
Lightning Bolt
Core Set 2021
Art by Christopher Rush
```

## Manual Testing

Test the function manually:

```bash
# Test with specific account
curl -X POST \
  'https://YOUR_PROJECT.supabase.co/functions/v1/post-mtg-card?account=your-bot-username' \
  -H 'Authorization: Bearer YOUR_ANON_KEY'
```

Or use query parameters:
- `?account=username` - Post for specific account
- `?interval_hours=6` - Override interval check (default: 6 hours)

## API Details

### Scryfall API

- **Endpoint**: `https://api.scryfall.com/cards/random?q=frame:showcase`
- **Rate Limits**: Scryfall allows reasonable usage; 4 posts/day is well within limits
- **Image Formats**: Uses PNG (745×1040) or normal JPG (488×680)

### Mastodon API

- Uses standard Mastodon v1 API
- Uploads media, then creates status post
- Waits 4 seconds for media processing before posting

## Troubleshooting

### No cards found
- Check Scryfall API is accessible
- Verify `frame:showcase` query is working (some sets may not have showcase frames)

### Image download fails
- Check Scryfall image URLs are accessible
- Verify card has valid `image_uris` field

### Mastodon posting fails
- Verify access token is valid
- Check Mastodon instance is accessible
- Review Edge Function logs in Supabase dashboard

## Future Enhancements

Possible improvements:
- Filter by specific sets or artists
- Post different frame types (Extended Art, Borderless, etc.)
- Track posted cards to avoid duplicates (if desired)
- Support multiple MTG bot accounts
- Add card type/color tags

## Notes

- **No database storage**: Cards are fetched on-demand, no need to scrape/store cards
- **Always fresh**: Each post is a new random card
- **Simple**: No deduplication or complex logic needed
- **Rate limit friendly**: 4 posts/day is well within Scryfall's limits

