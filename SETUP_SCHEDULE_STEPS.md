# Setting Up the Schedule - Step by Step

## Step 1: Enable pg_net Extension

1. Go to your Supabase Dashboard
2. Navigate to **Database** → **Extensions**
3. Search for `pg_net` and enable it (if not already enabled)
4. You should already have `pg_cron` enabled

## Step 2: Get Your Anon Key

1. In Supabase Dashboard, go to **Settings** → **API**
2. Find the **anon/public** key (it's safe to use - it's a public key)
3. Copy it - you'll need it in the next step

## Step 3: Update and Run the SQL Script

1. Go to **SQL Editor** in your Supabase Dashboard
2. Open the file `setup-schedule.sql` from this project
3. Replace all instances of `YOUR_ANON_KEY` with your actual anon key
4. Copy the entire script
5. Paste it into the SQL Editor
6. Click **Run** (or press Ctrl+Enter)

## Step 4: Verify the Schedule

Run this query to see your scheduled jobs:

```sql
SELECT * FROM cron.job WHERE jobname LIKE 'vincent-van-gogh%';
```

You should see 4 jobs scheduled for:
- `vincent-van-gogh-12am` (runs at 00:00 UTC)
- `vincent-van-gogh-6am` (runs at 06:00 UTC)
- `vincent-van-gogh-12pm` (runs at 12:00 UTC)
- `vincent-van-gogh-6pm` (runs at 18:00 UTC)

## Step 5: Test Manually First

Before waiting for the schedule, test the function manually:

```bash
curl -X POST \
  "https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/vincent-van-gogh?PREFIX=vincent-van-gogh" \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

Replace `YOUR_ANON_KEY` with your actual key.

## Troubleshooting

**If you get an error about pg_net:**
- Make sure `pg_net` extension is enabled in Database → Extensions

**If you get authentication errors:**
- Double-check your anon key is correct
- Make sure the function `vincent-van-gogh` is deployed

**To remove a schedule:**
```sql
SELECT cron.unschedule('vincent-van-gogh-12am');
SELECT cron.unschedule('vincent-van-gogh-6am');
SELECT cron.unschedule('vincent-van-gogh-12pm');
SELECT cron.unschedule('vincent-van-gogh-6pm');
```

**To view all scheduled jobs:**
```sql
SELECT * FROM cron.job;
```


