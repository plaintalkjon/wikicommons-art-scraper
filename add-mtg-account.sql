-- Add MTG Showcase card bot account to mastodon_accounts table
-- Username: CuratedMTGShowcase
-- Domain: mastodon.social

INSERT INTO mastodon_accounts (
  account_username,
  mastodon_base_url,
  mastodon_access_token,
  account_type,
  active
) VALUES (
  'CuratedMTGShowcase',
  'https://mastodon.social',
  'T7SK9fhzMZQ49ptyqfoQyhBv9m0o4vaTv5O9R3-ZOBc',
  'mtg',
  true
);

