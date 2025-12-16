-- Try to enable pg_net extension via SQL
-- Run this in Supabase SQL Editor

CREATE EXTENSION IF NOT EXISTS pg_net;

-- Check if it's enabled
SELECT * FROM pg_extension WHERE extname = 'pg_net';


