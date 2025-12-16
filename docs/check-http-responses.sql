-- Check actual HTTP responses from pg_net requests
-- This shows whether the edge function actually completed successfully

-- Get the most recent HTTP requests from pg_net
SELECT 
  id,
  created,
  status_code,
  content::text as response_body,
  error_msg,
  request_id
FROM net.http_response_queue
WHERE created > NOW() - INTERVAL '24 hours'
ORDER BY created DESC
LIMIT 20;

-- Alternative: Check by matching request IDs from cron jobs
-- This requires joining with cron.job_run_details if available
SELECT 
  r.id,
  r.created,
  r.status_code,
  LEFT(r.content::text, 500) as response_preview,
  r.error_msg,
  r.request_id
FROM net.http_response_queue r
WHERE r.created > NOW() - INTERVAL '24 hours'
ORDER BY r.created DESC
LIMIT 20;


