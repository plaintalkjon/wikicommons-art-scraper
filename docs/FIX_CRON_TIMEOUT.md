# Fix for Cron Job Timeout Issue

## Problem
The edge function was timing out because it tried to post for all 12 accounts sequentially with 5-minute delays, taking ~60 minutes total. Supabase edge functions have timeout limits (usually 60 seconds for free tier, up to 5 minutes for paid tiers).

## Solution
1. **Added pagination support** - The function now accepts `offset` and `limit` parameters to process accounts in batches
2. **Reduced delay to seconds** - Changed from minutes to seconds (default 30 seconds) to keep total time under timeout limits
3. **Split accounts across cron jobs** - Created 2 groups of 6 accounts each, running 5 minutes apart

## Changes Made

### Edge Function Updates
- Added `offset` and `limit` query parameters
- Changed delay from minutes to seconds (default 30 seconds)
- Function now processes only the specified range of accounts

### New Cron Schedule
- **Group 1** (accounts 0-5): Runs at :00 (12:00, 6:00, 12:00, 18:00 UTC)
- **Group 2** (accounts 6-11): Runs at :05 (12:05, 6:05, 12:05, 18:05 UTC)
- Each group takes ~3 minutes to complete (6 accounts × 30 seconds)
- All 12 accounts post within 5 minutes of each trigger

## How to Apply the Fix

### Step 1: Deploy Updated Function
The function has already been deployed with the pagination support.

### Step 2: Remove Old Cron Jobs
Run this in your Supabase SQL Editor:

```sql
SELECT cron.unschedule('auto-post-art-12am');
SELECT cron.unschedule('auto-post-art-6am');
SELECT cron.unschedule('auto-post-art-12pm');
SELECT cron.unschedule('auto-post-art-6pm');
```

### Step 3: Add New Split Cron Jobs
Run the SQL script: `docs/schedule-split-accounts.sql`

This creates 8 new cron jobs (4 for each group) that will:
- Process accounts in batches of 6
- Complete within ~3 minutes (well under timeout limits)
- Still stagger posts with 30-second delays

## Verification

After applying the fix, you can verify:

1. **Check cron jobs are active:**
```sql
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname LIKE 'auto-post-art%'
ORDER BY jobname;
```

2. **Test the function manually:**
```bash
# Test group 1 (first 6 accounts)
curl -X POST "https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/post-art?offset=0&limit=6&delay=5" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json"

# Test group 2 (last 6 accounts)
curl -X POST "https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/post-art?offset=6&limit=6&delay=5" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json"
```

3. **Check HTTP responses:**
Run `docs/check-http-responses.sql` to see if the function is completing successfully.

## Alternative: Further Reduce Delay
If you want even faster posting (less staggering), you can reduce the delay to 10-15 seconds:

```sql
-- Update all cron jobs to use delay=10 (10 seconds between posts)
UPDATE cron.job
SET command = REPLACE(
  REPLACE(command::text, 'delay=30', 'delay=10'),
  'delay=5', 'delay=10'
)::jsonb
WHERE jobname LIKE 'auto-post-art-group%';
```

This would make each group complete in ~1 minute instead of ~3 minutes.


