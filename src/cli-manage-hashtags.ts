#!/usr/bin/env node
/**
 * Manage hashtags for Mastodon quote accounts
 *
 * Usage examples:
 *   # List hashtags for an account
 *   npm run manage-hashtags -- --account username --list
 *
 *   # Add hashtags to an account
 *   npm run manage-hashtags -- --account username --add philosophy stoicism
 *
 *   # Remove hashtags from an account
 *   npm run manage-hashtags -- --account username --remove philosophy
 *
 *   # Create a new hashtag
 *   npm run manage-hashtags -- --create stoicism
 *
 *   # List all available hashtags
 *   npm run manage-hashtags -- --list-all
 */

import { supabase } from './config';
import { parseArgs } from './utils';

interface CliArgs {
  account?: string;
  list?: boolean;
  add?: string[];
  remove?: string[];
  create?: string;
  'list-all'?: boolean;
}

async function findHashtagByName(name: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('hashtags')
    .select('id')
    .eq('name', name.toLowerCase())
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to lookup hashtag "${name}": ${error.message}`);
  }

  return data?.id ?? null;
}

async function findAccountByUsername(username: string): Promise<{ id: string; account_type: string } | null> {
  // Remove @ symbols and extract username
  const cleanUsername = username.replace(/^@+/, '').split('@')[0];

  const { data, error } = await supabase
    .from('mastodon_accounts')
    .select('id, account_type')
    .eq('account_username', cleanUsername)
    .eq('account_type', 'quote')
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to lookup account "${username}": ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return { id: data.id, account_type: data.account_type };
}

async function createHashtag(name: string): Promise<string> {
  const { data, error } = await supabase
    .from('hashtags')
    .insert({ name: name.toLowerCase() })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') { // Unique violation
      throw new Error(`Hashtag "#${name}" already exists`);
    }
    throw new Error(`Failed to create hashtag "${name}": ${error.message}`);
  }

  if (!data?.id) {
    throw new Error('Failed to create hashtag: no ID returned');
  }

  return data.id;
}

async function listAccountHashtags(accountId: string): Promise<void> {
  const { data, error } = await supabase
    .from('mastodon_account_hashtags')
    .select(`
      hashtag_id,
      hashtags!inner(name)
    `)
    .eq('mastodon_account_id', accountId)
    .order('hashtags(name)', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch hashtags: ${error.message}`);
  }

  if (!data || data.length === 0) {
    console.log('No hashtags assigned to this account');
    return;
  }

  console.log('\nHashtags for this account:');
  data.forEach((item: any) => {
    const hashtag = item.hashtags;
    console.log(`  #${hashtag.name}`);
  });
}

async function addHashtagsToAccount(accountId: string, hashtagNames: string[]): Promise<void> {
  for (const hashtagName of hashtagNames) {
    let hashtagId = await findHashtagByName(hashtagName);

    // Create hashtag if it doesn't exist
    if (!hashtagId) {
      console.log(`Creating new hashtag: #${hashtagName}`);
      hashtagId = await createHashtag(hashtagName);
    }

    // Check if association already exists
    const { data: existing } = await supabase
      .from('mastodon_account_hashtags')
      .select('id')
      .eq('mastodon_account_id', accountId)
      .eq('hashtag_id', hashtagId)
      .single();

    if (existing) {
      console.log(`Hashtag #${hashtagName} is already assigned to this account`);
      continue;
    }

    // Add association
    const { error } = await supabase
      .from('mastodon_account_hashtags')
      .insert({
        mastodon_account_id: accountId,
        hashtag_id: hashtagId,
      });

    if (error) {
      throw new Error(`Failed to add hashtag #${hashtagName}: ${error.message}`);
    }

    console.log(`✅ Added hashtag #${hashtagName} to account`);
  }
}

async function removeHashtagsFromAccount(accountId: string, hashtagNames: string[]): Promise<void> {
  for (const hashtagName of hashtagNames) {
    const hashtagId = await findHashtagByName(hashtagName);

    if (!hashtagId) {
      console.log(`⚠️  Hashtag #${hashtagName} not found`);
      continue;
    }

    const { error } = await supabase
      .from('mastodon_account_hashtags')
      .delete()
      .eq('mastodon_account_id', accountId)
      .eq('hashtag_id', hashtagId);

    if (error) {
      throw new Error(`Failed to remove hashtag #${hashtagName}: ${error.message}`);
    }

    console.log(`✅ Removed hashtag #${hashtagName} from account`);
  }
}

async function listAllHashtags(): Promise<void> {
  const { data, error } = await supabase
    .from('hashtags')
    .select('name, created_at')
    .order('name', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch hashtags: ${error.message}`);
  }

  if (!data || data.length === 0) {
    console.log('No hashtags found');
    return;
  }

  console.log('\nAvailable hashtags:');
  data.forEach((hashtag) => {
    console.log(`  #${hashtag.name}`);
  });
}

async function main(): Promise<void> {
  const args = parseArgs<CliArgs>();

  try {
    // List all hashtags
    if (args['list-all']) {
      await listAllHashtags();
      return;
    }

    // Create new hashtag
    if (args.create) {
      await createHashtag(args.create);
      console.log(`✅ Created hashtag #${args.create}`);
      return;
    }

    // Account operations require account username
    if (!args.account) {
      console.error('❌ Error: --account is required for list/add/remove operations');
      console.error('\nUsage:');
      console.error('  npm run manage-hashtags -- --account username --list');
      console.error('  npm run manage-hashtags -- --account username --add philosophy stoicism');
      console.error('  npm run manage-hashtags -- --account username --remove philosophy');
      console.error('  npm run manage-hashtags -- --create stoicism');
      console.error('  npm run manage-hashtags -- --list-all');
      process.exit(1);
    }

    // Find account
    const account = await findAccountByUsername(args.account);
    if (!account) {
      console.error(`❌ Error: Quote account "${args.account}" not found`);
      console.error('Make sure the account exists and is of type "quote"');
      process.exit(1);
    }

    // List hashtags
    if (args.list) {
      await listAccountHashtags(account.id);
      return;
    }

    // Add hashtags
    if (args.add && args.add.length > 0) {
      await addHashtagsToAccount(account.id, args.add);
      console.log('\n✅ Done! Updated hashtags:');
      await listAccountHashtags(account.id);
      return;
    }

    // Remove hashtags
    if (args.remove && args.remove.length > 0) {
      await removeHashtagsFromAccount(account.id, args.remove);
      console.log('\n✅ Done! Updated hashtags:');
      await listAccountHashtags(account.id);
      return;
    }

    // No operation specified
    console.error('❌ Error: No operation specified');
    console.error('Use --list, --add, --remove, --create, or --list-all');
    process.exit(1);
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();

