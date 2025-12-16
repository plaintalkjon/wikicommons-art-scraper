# Hourly Rotation Setup

## Overview

This setup uses **automatic account rotation based on the hour of day**. Instead of processing all accounts in one run (which causes timeouts), the function:

1. Runs every hour (or every X hours)
2. Automatically selects which account(s) to post based on the current hour
3. Each account posts multiple times per day, evenly spaced

## How It Works

### With 12 Accounts and `accounts_per_hour=1`:
- **24 cron jobs** (one per hour)
- Each account posts **2 times per day** (12 hours apart)
- Account 0 posts at 0:00 and 12:00 UTC
- Account 1 posts at 1:00 and 13:00 UTC
- Account 2 posts at 2:00 and 14:00 UTC
- And so on...

### With `accounts_per_hour=2`:
- Each account posts **4 times per day** (6 hours apart)
- Accounts 0-1 post at 0:00, 6:00, 12:00, 18:00 UTC
- Accounts 2-3 post at 1:00, 7:00, 13:00, 19:00 UTC
- And so on...

## Benefits

✅ **No timeouts** - Each function call processes 1-2 accounts (completes in seconds)  
✅ **Even distribution** - Posts spread throughout the day automatically  
✅ **Scalable** - Add more accounts without changing cron jobs  
✅ **Simple** - No manual offset/limit calculations needed  

## Setup Steps

### Step 1: Deploy Updated Function
The function has been updated with hourly rotation support. Deploy it:

```bash
./deploy-post-art.sh
```

### Step 2: Remove Old Cron Jobs
Run in Supabase SQL Editor:

```sql
-- Remove old 4-times-per-day jobs
SELECT cron.unschedule('auto-post-art-12am');
SELECT cron.unschedule('auto-post-art-6am');
SELECT cron.unschedule('auto-post-art-12pm');
SELECT cron.unschedule('auto-post-art-6pm');

-- Remove any split-group jobs if they exist
SELECT cron.unschedule(jobname) 
FROM cron.job 
WHERE jobname LIKE 'auto-post-art-group%';
```

### Step 3: Create Hourly Cron Jobs
Run `docs/schedule-hourly-rotation.sql` in your SQL Editor.

This creates 24 cron jobs (one per hour). Each job calls the function, which automatically selects the right account(s) based on the hour.

### Step 4: Verify
Check that all cron jobs are active:

```sql
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname LIKE 'auto-post-art-hour%'
ORDER BY jobname;
```

You should see 24 jobs (hour-00 through hour-23).

## Customization Options

### Option 1: Fewer Cron Jobs (Every 2 Hours)
If you want fewer cron jobs, modify `schedule-hourly-rotation.sql` to run every 2 hours:

```sql
-- Run every 2 hours (12 cron jobs instead of 24)
FOR hour_val IN 0,2,4,6,8,10,12,14,16,18,20,22 LOOP
```

This makes each account post **once per day** instead of twice.

### Option 2: More Posts Per Hour
To have each account post more frequently, increase `accounts_per_hour`:

```sql
-- In the cron job URL, change:
?accounts_per_hour=1  -- Each account posts 2x/day
?accounts_per_hour=2  -- Each account posts 4x/day
?accounts_per_hour=3  -- Each account posts 6x/day
```

### Option 3: Manual Override
You can still use manual pagination if needed:

```bash
# Process accounts 0-5
curl -X POST "https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/post-art?offset=0&limit=6" \
  -H "Authorization: Bearer YOUR_ANON_KEY"

# Process accounts 6-11
curl -X POST "https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/post-art?offset=6&limit=6" \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

## Testing

Test the rotation manually:

```bash
# Test at a specific "hour" (simulate hour 0)
curl -X POST "https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/post-art?accounts_per_hour=1" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json"
```

The function will automatically select the account based on the current UTC hour.

## Troubleshooting

**Problem:** Accounts not posting evenly  
**Solution:** Check that all 24 cron jobs are active and running

**Problem:** Want different posting frequency  
**Solution:** Adjust `accounts_per_hour` parameter or modify cron schedule intervals

**Problem:** Need to skip certain hours  
**Solution:** Manually unschedule specific hour jobs:
```sql
SELECT cron.unschedule('auto-post-art-hour-03');  -- Skip 3 AM
```


