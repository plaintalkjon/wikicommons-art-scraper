#!/usr/bin/env node
/**
 * Add a new Mastodon account to the cron system.
 *
 * Usage examples:
 *   npm run add-mastodon-account -- --username CuratedImpressionism --domain mastodon.social --token YOUR_TOKEN --type tag --tag impressionism
 *   npm run add-mastodon-account -- --username ArtistBot --domain mastodon.social --token YOUR_TOKEN --type artist --artist "Vincent van Gogh"
 *   npm run add-mastodon-account -- --username PhilosopherBot --domain mastodon.social --token YOUR_TOKEN --type philosopher --philosopher "Friedrich Nietzsche"
 */

import { supabase } from './config';
import { parseArgs } from './utils';

type AccountType = 'artist' | 'tag' | 'philosopher';

interface MastodonAccountData {
  account_username: string;
  mastodon_base_url: string;
  mastodon_access_token: string;
  account_type: AccountType;
  active: boolean;
  tag_id?: string;
  artist_id?: string;
  philosopher_id?: string;
}

async function findTagByName(tagName: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('tags')
    .select('id')
    .eq('name', tagName.toLowerCase())
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to lookup tag "${tagName}": ${error.message}`);
  }

  return data?.id ?? null;
}

async function findArtistByName(artistName: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('artists')
    .select('id')
    .eq('name', artistName)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to lookup artist "${artistName}": ${error.message}`);
  }

  return data?.id ?? null;
}

async function findPhilosopherByName(philosopherName: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('philosophers')
    .select('id')
    .eq('name', philosopherName)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to lookup philosopher "${philosopherName}": ${error.message}`);
  }

  return data?.id ?? null;
}

async function addMastodonAccount(accountData: MastodonAccountData): Promise<string> {
  console.log(`Adding ${accountData.account_type} account: @${accountData.account_username}@${accountData.mastodon_base_url}`);

  const { data, error } = await supabase
    .from('mastodon_accounts')
    .insert(accountData)
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to insert Mastodon account: ${error.message}`);
  }

  if (!data?.id) {
    throw new Error('Failed to insert Mastodon account: no ID returned');
  }

  console.log(`✅ Account added successfully with ID: ${data.id}`);
  return data.id;
}

async function linkTagAccount(accountId: string, tagName: string): Promise<void> {
  const tagId = await findTagByName(tagName);
  if (!tagId) {
    throw new Error(`Tag "${tagName}" not found. Make sure it exists in the tags table.`);
  }

  // For tag accounts, we store the tag_id directly in the mastodon_accounts table
  const { error } = await supabase
    .from('mastodon_accounts')
    .update({ tag_id: tagId })
    .eq('id', accountId);

  if (error) {
    throw new Error(`Failed to link account to tag "${tagName}": ${error.message}`);
  }

  console.log(`✅ Account linked to tag "${tagName}" (ID: ${tagId})`);
}

async function linkArtistAccount(accountId: string, artistName: string): Promise<void> {
  const artistId = await findArtistByName(artistName);
  if (!artistId) {
    throw new Error(`Artist "${artistName}" not found. Make sure it exists in the artists table.`);
  }

  // For artist accounts, we store the artist_id directly in the mastodon_accounts table
  const { error } = await supabase
    .from('mastodon_accounts')
    .update({ artist_id: artistId })
    .eq('id', accountId);

  if (error) {
    throw new Error(`Failed to link account to artist "${artistName}": ${error.message}`);
  }

  console.log(`✅ Account linked to artist "${artistName}" (ID: ${artistId})`);
}

async function createArtistAccountDirectly(username: string, domain: string, token: string, artistName: string): Promise<string> {
  console.log(`Adding artist account: @${username}@${domain} for "${artistName}"`);

  // First find the artist
  const artistId = await findArtistByName(artistName);
  if (!artistId) {
    throw new Error(`Artist "${artistName}" not found. Make sure it exists in the artists table.`);
  }

  const accountData = {
    account_username: username,
    mastodon_base_url: domain,
    mastodon_access_token: token,
    account_type: 'artist' as const,
    active: true,
    artist_id: artistId
  };

  const { data, error } = await supabase
    .from('mastodon_accounts')
    .insert(accountData)
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to insert Mastodon account: ${error.message}`);
  }

  if (!data?.id) {
    throw new Error('Failed to insert Mastodon account: no ID returned');
  }

  console.log(`✅ Artist account added successfully with ID: ${data.id}`);
  console.log(`✅ Account linked to artist "${artistName}" (ID: ${artistId})`);
  return data.id;
}

async function linkPhilosopherAccount(accountId: string, philosopherName: string): Promise<void> {
  const philosopherId = await findPhilosopherByName(philosopherName);
  if (!philosopherId) {
    throw new Error(`Philosopher "${philosopherName}" not found. Make sure it exists in the philosophers table.`);
  }

  // For philosopher accounts, we store the philosopher_id directly in the mastodon_accounts table
  const { error } = await supabase
    .from('mastodon_accounts')
    .update({ philosopher_id: philosopherId })
    .eq('id', accountId);

  if (error) {
    throw new Error(`Failed to link account to philosopher "${philosopherName}": ${error.message}`);
  }

  console.log(`✅ Account linked to philosopher "${philosopherName}" (ID: ${philosopherId})`);
}

async function main() {
  const args = parseArgs();

  // Required parameters
  const username = args.username as string;
  const domain = args.domain as string;
  const token = args.token as string;
  const type = args.type as AccountType;

  if (!username || !domain || !token || !type) {
    console.error('❌ Missing required parameters. Usage:');
    console.error('  --username <username> --domain <domain> --token <token> --type <artist|tag|philosopher>');
    console.error('');
    console.error('Additional parameters:');
    console.error('  --tag <tag_name>          (required for tag accounts)');
    console.error('  --artist <artist_name>    (required for artist accounts)');
    console.error('  --philosopher <name>      (required for philosopher accounts)');
    console.error('');
    console.error('Examples:');
    console.error('  --username CuratedImpressionism --domain mastodon.social --token abc123 --type tag --tag impressionism');
    console.error('  --username ArtistBot --domain mastodon.social --token def456 --type artist --artist "Vincent van Gogh"');
    process.exit(1);
  }

  if (!['artist', 'tag', 'philosopher'].includes(type)) {
    console.error(`❌ Invalid account type "${type}". Must be: artist, tag, or philosopher`);
    process.exit(1);
  }


  // Type-specific validation
  if (type === 'tag' && !args.tag) {
    console.error('❌ Tag accounts require --tag parameter');
    process.exit(1);
  }

  if (type === 'artist' && !args.artist) {
    console.error('❌ Artist accounts require --artist parameter');
    process.exit(1);
  }

  if (type === 'philosopher' && !args.philosopher) {
    console.error('❌ Philosopher accounts require --philosopher parameter');
    process.exit(1);
  }

  const accountData: MastodonAccountData = {
    account_username: username,
    mastodon_base_url: domain,
    mastodon_access_token: token,
    account_type: type,
    active: true
  };

  try {
    let accountId: string;

    if (type === 'artist') {
      // For artist accounts, create directly with artist_id
      accountId = await createArtistAccountDirectly(username, domain, token, args.artist as string);
    } else {
      // For tag and philosopher accounts, create first then link
      accountId = await addMastodonAccount(accountData);

      if (type === 'tag') {
        await linkTagAccount(accountId, args.tag as string);
      } else if (type === 'philosopher') {
        await linkPhilosopherAccount(accountId, args.philosopher as string);
      }
    }

    console.log('');
    console.log('🎉 Mastodon account successfully added to the cron system!');
    console.log(`   Account: @${username}@${domain}`);
    console.log(`   Type: ${type}`);
    console.log('   The account will start posting automatically on the next cron run.');

  } catch (error) {
    console.error('❌ Error adding Mastodon account:', error);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('❌ Unexpected error:', err);
  process.exit(1);
});
