# Query Cron Jobs - Manual Instructions

Since the RPC function doesn't exist yet, please run this SQL query in Supabase SQL Editor to see the actual cron jobs:

```sql
SELECT 
  jobid,
  jobname,
  schedule,
  active,
  command::text as command_text
FROM cron.job
ORDER BY jobname;
```

## Expected Cron Jobs (Based on Documentation)

Based on the documentation files, here's what we expect:

1. **post-mtg-card**
   - Schedule: `0 */6 * * *` (every 6 hours)
   - Function: `post-mtg-card` (showcase bot, auto-detects)

2. **post-mtg-commander**
   - Schedule: `0 */6 * * *` (every 6 hours)
   - Function: `post-mtg-card?bot_type=commander`

3. **post-yugioh-card** (optional)
   - Schedule: `0 */6 * * *` (every 6 hours)
   - Function: `post-yugioh-card`

## After Querying

Once you run the SQL query, please share the results so we can:
1. Compare actual vs expected
2. Update documentation to match reality
3. Fix any discrepancies

## To Enable Automatic Querying

Run this SQL in Supabase SQL Editor to create the RPC function:

```sql
CREATE OR REPLACE FUNCTION get_cron_jobs()
RETURNS TABLE (
  jobid bigint,
  schedule text,
  command text,
  nodename text,
  nodeport integer,
  database text,
  username text,
  active boolean,
  jobname text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.jobid,
    c.schedule,
    c.command::text as command,
    c.nodename,
    c.nodeport,
    c.database,
    c.username,
    c.active,
    c.jobname
  FROM cron.job c
  ORDER BY c.jobname NULLS LAST, c.jobid;
END;
$$;

GRANT EXECUTE ON FUNCTION get_cron_jobs() TO service_role;
GRANT EXECUTE ON FUNCTION get_cron_jobs() TO authenticated;
```

Then run: `npm run check-cron-jobs`

