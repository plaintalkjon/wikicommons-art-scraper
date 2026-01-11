-- Reset last_posted_at for MTG account to allow immediate testing
UPDATE mastodon_accounts 
SET last_posted_at = NULL 
WHERE account_username = 'CuratedMTGShowcase' AND account_type = 'mtg';

