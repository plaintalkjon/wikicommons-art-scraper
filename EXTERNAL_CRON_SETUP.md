# External Cron Setup (No Database Extensions Needed)

If `pg_net` isn't available, use an external cron service instead. This is actually simpler and doesn't require any database extensions!

## Recommended: cron-job.org (Free)

### Step 1: Sign Up
1. Go to https://cron-job.org
2. Sign up for a free account (no credit card needed)

### Step 2: Create Cron Job
1. Click **"Create cronjob"**
2. Fill in the details:

**Title:** `Vincent Van Gogh Art Post`

**Address (URL):**
```
https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/vincent-van-gogh?PREFIX=vincent-van-gogh
```

**Request method:** `POST`

**Request headers:**
```
Authorization: Bearer YOUR_ANON_KEY
Content-Type: application/json
```

(Replace `YOUR_ANON_KEY` with your actual anon key from Supabase Dashboard → Settings → API)

**Schedule:**
- Select **"Multiple times per day"**
- Or use cron expression: `0 0,6,12,18 * * *` (runs at 00:00, 06:00, 12:00, 18:00 UTC)

**That's it!** The service will call your function 4 times per day automatically.

## Alternative: EasyCron

1. Go to https://www.easycron.com
2. Sign up (free tier available)
3. Create a new cron job with the same settings as above

## Alternative: GitHub Actions (If you have a repo)

If you want to keep everything in code, you can use GitHub Actions. Let me know if you want this option.

## Finding Your Anon Key

1. Go to Supabase Dashboard
2. Settings → API
3. Copy the **anon/public** key (it's safe to use - it's a public key)

## Testing

Before setting up the cron, test manually:

```bash
curl -X POST \
  "https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/vincent-van-gogh?PREFIX=vincent-van-gogh" \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

Replace `YOUR_ANON_KEY` with your actual key.

