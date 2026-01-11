-- Create RPC function to query cron jobs
-- Run this in Supabase SQL Editor first, then you can use the CLI script

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

-- Grant execute permission to authenticated users (or service_role)
GRANT EXECUTE ON FUNCTION get_cron_jobs() TO service_role;
GRANT EXECUTE ON FUNCTION get_cron_jobs() TO authenticated;

