-- Add Vincent van Gogh Mastodon bot account
-- Run this in Supabase SQL Editor after creating the mastodon_accounts table

INSERT INTO mastodon_accounts (artist_id, mastodon_base_url, mastodon_access_token, account_username)
SELECT 
  id,
  'https://mastodon.social',
  'yMlgc7PZ3YSqFEY2kzSgmdFh94sSIjokJdp4vvc2TQI',
  '@CuratedVanGogh@mastodon.social'
FROM artists
WHERE name = 'Vincent van Gogh'
ON CONFLICT (artist_id) DO UPDATE
SET 
  mastodon_base_url = EXCLUDED.mastodon_base_url,
  mastodon_access_token = EXCLUDED.mastodon_access_token,
  account_username = EXCLUDED.account_username,
  updated_at = NOW();

-- Verify the account was added
SELECT 
  a.name as artist_name,
  m.mastodon_base_url,
  m.account_username,
  m.active,
  m.created_at
FROM mastodon_accounts m
JOIN artists a ON m.artist_id = a.id
WHERE a.name = 'Vincent van Gogh';

