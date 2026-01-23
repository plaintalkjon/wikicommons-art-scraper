-- Add #stoicism hashtag to Seneca and Marcus Aurelius accounts
-- Run this in Supabase SQL Editor after running migrate-hashtags-system.sql

-- Step 1: Ensure stoicism hashtag exists (should already exist from migration, but just in case)
INSERT INTO hashtags (name) VALUES ('stoicism')
ON CONFLICT (name) DO NOTHING;

-- Step 2: Add stoicism hashtag to Marcus Aurelius account
INSERT INTO mastodon_account_hashtags (mastodon_account_id, hashtag_id)
SELECT 
  ma.id as mastodon_account_id,
  h.id as hashtag_id
FROM mastodon_accounts ma
INNER JOIN quote_authors qa ON ma.author_id = qa.id
INNER JOIN hashtags h ON h.name = 'stoicism'
WHERE ma.account_type = 'quote'
  AND qa.name ILIKE '%Marcus Aurelius%'
  AND NOT EXISTS (
    SELECT 1 FROM mastodon_account_hashtags mah
    WHERE mah.mastodon_account_id = ma.id
      AND mah.hashtag_id = h.id
  );

-- Step 3: Add stoicism hashtag to Seneca account
INSERT INTO mastodon_account_hashtags (mastodon_account_id, hashtag_id)
SELECT 
  ma.id as mastodon_account_id,
  h.id as hashtag_id
FROM mastodon_accounts ma
INNER JOIN quote_authors qa ON ma.author_id = qa.id
INNER JOIN hashtags h ON h.name = 'stoicism'
WHERE ma.account_type = 'quote'
  AND (qa.name ILIKE '%Seneca%' OR qa.name ILIKE '%Lucius Annaeus Seneca%')
  AND NOT EXISTS (
    SELECT 1 FROM mastodon_account_hashtags mah
    WHERE mah.mastodon_account_id = ma.id
      AND mah.hashtag_id = h.id
  );

-- Step 4: Verify the changes
SELECT 
  ma.account_username,
  qa.name as author_name,
  STRING_AGG(h.name, ', ' ORDER BY h.name) as hashtags
FROM mastodon_accounts ma
INNER JOIN quote_authors qa ON ma.author_id = qa.id
LEFT JOIN mastodon_account_hashtags mah ON ma.id = mah.mastodon_account_id
LEFT JOIN hashtags h ON mah.hashtag_id = h.id
WHERE ma.account_type = 'quote'
  AND (qa.name ILIKE '%Marcus Aurelius%' OR qa.name ILIKE '%Seneca%' OR qa.name ILIKE '%Lucius Annaeus Seneca%')
GROUP BY ma.id, ma.account_username, qa.name
ORDER BY qa.name;
