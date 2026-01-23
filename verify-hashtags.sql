-- Verify hashtags for Marcus Aurelius and Seneca accounts
-- Run this to check if both hashtags are properly assigned

SELECT 
  ma.account_username,
  qa.name as author_name,
  COUNT(mah.id) as hashtag_count,
  STRING_AGG(h.name, ', ' ORDER BY h.name) as hashtags
FROM mastodon_accounts ma
INNER JOIN quote_authors qa ON ma.author_id = qa.id
LEFT JOIN mastodon_account_hashtags mah ON ma.id = mah.mastodon_account_id
LEFT JOIN hashtags h ON mah.hashtag_id = h.id
WHERE ma.account_type = 'quote'
  AND (qa.name ILIKE '%Marcus Aurelius%' OR qa.name ILIKE '%Seneca%' OR qa.name ILIKE '%Lucius Annaeus Seneca%')
GROUP BY ma.id, ma.account_username, qa.name
ORDER BY qa.name;

-- Detailed view showing each hashtag assignment
SELECT 
  ma.account_username,
  qa.name as author_name,
  h.name as hashtag_name,
  mah.created_at as assigned_at
FROM mastodon_accounts ma
INNER JOIN quote_authors qa ON ma.author_id = qa.id
INNER JOIN mastodon_account_hashtags mah ON ma.id = mah.mastodon_account_id
INNER JOIN hashtags h ON mah.hashtag_id = h.id
WHERE ma.account_type = 'quote'
  AND (qa.name ILIKE '%Marcus Aurelius%' OR qa.name ILIKE '%Seneca%' OR qa.name ILIKE '%Lucius Annaeus Seneca%')
ORDER BY qa.name, h.name;
