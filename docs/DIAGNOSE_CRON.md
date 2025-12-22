# Diagnosing Cron Job Issues

## Current Status
✅ **Function works when called directly** - Successfully posted for Titian
❌ **Cron job running on wrong schedule** - Running every hour instead of every 10 minutes
⚠️ **Cron completes too quickly** - 0.03-0.47 seconds suggests HTTP call completes but function may not execute

## IMMEDIATE FIX
Run `docs/fix-cron-immediate.sql` in Supabase SQL Editor to:
1. Remove the old hourly cron job
2. Create the correct 10-minute cron job

## Step 1: Check Cron Job Status

Run this SQL in Supabase SQL Editor:

```sql
-- Check if cron job exists and is active
SELECT 
  jobid,
  jobname,
  schedule,
  active,
  nodename
FROM cron.job 
WHERE jobname LIKE 'auto-post-art%'
ORDER BY jobname;
```

**Expected:** Should see `auto-post-art-every-10-min` with `active = true`

## Step 2: Check Recent Cron Runs

```sql
-- Check recent cron job runs (last 20)
SELECT 
  runid,
  start_time,
  end_time,
  status,
  return_message,
  EXTRACT(EPOCH FROM (end_time - start_time)) as duration_seconds
FROM cron.job_run_details
WHERE jobid IN (
  SELECT jobid FROM cron.job WHERE jobname LIKE 'auto-post-art%'
)
ORDER BY start_time DESC
LIMIT 20;
```

**Look for:**
- Are there any recent runs? (Should be every 10 minutes)
- What is the `status`? (Should be 'succeeded' or 'failed')
- Any errors in `return_message`?

## Step 3: Check for Errors

```sql
-- Check for any errors
SELECT 
  runid,
  start_time,
  status,
  return_message
FROM cron.job_run_details
WHERE jobid IN (
  SELECT jobid FROM cron.job WHERE jobname LIKE 'auto-post-art%'
)
AND (status = 'failed' OR return_message LIKE '%error%' OR return_message LIKE '%Error%')
ORDER BY start_time DESC
LIMIT 10;
```

## Step 4: Verify Extensions

```sql
-- Check if required extensions are enabled
SELECT 
  extname,
  extversion
FROM pg_extension
WHERE extname IN ('pg_cron', 'pg_net');
```

**Required:**
- `pg_cron` - For scheduling
- `pg_net` - For making HTTP requests

## Step 5: Recreate Cron Job (If Needed)

If the cron job doesn't exist or isn't active, run this:

```sql
-- Remove old job if it exists
SELECT cron.unschedule('auto-post-art-every-10-min');

-- Create new cron job
DO $$
BEGIN
  PERFORM cron.schedule(
    'auto-post-art-every-10-min',
    '*/10 * * * *',  -- Every 10 minutes
    $cmd$
    SELECT net.http_post(
      url := 'https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/post-art?interval_hours=6&max_accounts=10',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4dGtwd3N4dXB6a3h1aGhtdnZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUxMTY2OTQsImV4cCI6MjA4MDY5MjY5NH0.TpaMU7-7-U7BSyjqPkfiGjpHFB6qVt1dMUxG5KFptR8'
      )
    );
    $cmd$
  );
END $$;
```

## Step 6: Test Function Directly

The function works when called directly. You can test it with:

```bash
curl -X POST \
  "https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/post-art?interval_hours=6&max_accounts=10" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4dGtwd3N4dXB6a3h1aGhtdnZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUxMTY2OTQsImV4cCI6MjA4MDY5MjY5NH0.TpaMU7-7-U7BSyjqPkfiGjpHFB6qVt1dMUxG5KFptR8" \
  -H "Content-Type: application/json"
```

## Common Issues

1. **Cron job not active** - Check `active = true` in cron.job table
2. **pg_net extension missing** - Enable it in Database → Extensions
3. **Cron job failing silently** - Check `cron.job_run_details` for errors
4. **Wrong URL or auth token** - Verify the URL and Bearer token in the cron job

## Next Steps

1. Run the diagnostic SQL queries above
2. Share the results so we can identify the specific issue
3. If cron job doesn't exist, recreate it using Step 5
4. If it exists but isn't running, check the error messages in `cron.job_run_details`
