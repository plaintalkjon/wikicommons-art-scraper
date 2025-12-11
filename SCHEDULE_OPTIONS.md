# Scheduling Options for Vincent Van Gogh Function

You want to run the function **4 times per day**. Here are your options:

## Option 1: Supabase pg_cron (Recommended if available)

**Prerequisites:**
- pg_cron extension enabled in your Supabase project
- http extension enabled (for making HTTP calls)

**Steps:**
1. Go to Supabase Dashboard → Database → Extensions
2. Enable `pg_cron` and `http` extensions
3. Go to SQL Editor
4. Open `setup-schedule.sql` and replace `YOUR_ANON_KEY` with your actual anon key
5. Run the SQL script

**To find your anon key:**
- Supabase Dashboard → Settings → API → anon/public key

**To view scheduled jobs:**
```sql
SELECT * FROM cron.job;
```

**To remove a schedule:**
```sql
SELECT cron.unschedule('vincent-van-gogh-12am');
```

## Option 2: External Cron Service (Easiest)

Use a free cron service like:
- **cron-job.org** (free tier available)
- **EasyCron** (free tier)
- **GitHub Actions** (if you have a repo)

**Example cron-job.org setup:**
1. Sign up at cron-job.org
2. Create a new cron job
3. Set schedule: `0 */6 * * *` (every 6 hours)
4. URL: `https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/vincent-van-gogh?PREFIX=vincent-van-gogh`
5. Method: POST
6. Headers: `Authorization: Bearer YOUR_ANON_KEY`

**Cron schedule for 4 times per day:**
- `0 0,6,12,18 * * *` (at 00:00, 06:00, 12:00, 18:00 UTC every day)

## Option 3: GitHub Actions (If you have a repo)

Create `.github/workflows/vincent-van-gogh.yml`:

```yaml
name: Post Vincent Van Gogh Art

on:
  schedule:
    - cron: '0 0,6,12,18 * * *'  # 4 times per day (UTC)
  workflow_dispatch:  # Allow manual trigger

jobs:
  post:
    runs-on: ubuntu-latest
    steps:
      - name: Call Edge Function
        run: |
          curl -X POST \
            "https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/vincent-van-gogh?PREFIX=vincent-van-gogh" \
            -H "Authorization: Bearer ${{ secrets.SUPABASE_ANON_KEY }}"
```

## Option 4: Local Cron (If you have a server)

Add to your crontab (`crontab -e`):

```bash
# Run 4 times per day (every 6 hours)
0 0,6,12,18 * * * curl -X POST "https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/vincent-van-gogh?PREFIX=vincent-van-gogh" -H "Authorization: Bearer YOUR_ANON_KEY"
```

## Recommended Schedule Times

The current setup runs at:
- **12:00 AM UTC** (midnight)
- **6:00 AM UTC**
- **12:00 PM UTC** (noon)
- **6:00 PM UTC**

Adjust these times in the cron expressions if you want different times.

## Testing

Test manually first:
```bash
curl -X POST \
  "https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/vincent-van-gogh?PREFIX=vincent-van-gogh" \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```
