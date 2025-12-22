/**
 * CLI script to add a new philosopher bot account
 * Usage: npm run add-philosopher-bot -- --philosopher "Friedrich Nietzsche" --token "access_token" --username "@username@instance"
 */

import { supabase } from './supabaseClient';
import dotenv from 'dotenv';
import path from 'path';

// Load .env
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL!;

interface Options {
  philosopher: string;
  token: string;
  baseUrl?: string;
  username?: string;
}

async function addPhilosopherBot(options: Options): Promise<void> {
  console.log(`\n=== Adding Philosopher Bot Account ===\n`);
  console.log(`Philosopher: ${options.philosopher}`);
  console.log(`Base URL: ${options.baseUrl || 'https://mastodon.social'}`);
  console.log(`Username: ${options.username || 'Not provided'}`);
  console.log('');

  // Step 1: Verify philosopher exists
  console.log('Step 1: Verifying philosopher exists...');
  const { data: philosopher, error: philosopherError } = await supabase
    .from('philosophers')
    .select('id, name')
    .eq('name', options.philosopher)
    .single();

  if (philosopherError || !philosopher) {
    throw new Error(
      `Philosopher "${options.philosopher}" not found in database. Make sure the name matches exactly. Run 'npm run fetch-quotes -- --philosopher "${options.philosopher}"' first.`,
    );
  }
  console.log(`✓ Found philosopher: ${philosopher.name} (ID: ${philosopher.id})\n`);

  // Step 2: Check if account already exists
  console.log('Step 2: Checking for existing account...');
  const { data: existing, error: existingError } = await supabase
    .from('mastodon_accounts')
    .select('id, account_username, active')
    .eq('philosopher_id', philosopher.id)
    .single();

  if (existing && !existingError) {
    console.log(`⚠️  Account already exists for this philosopher:`);
    console.log(`   Username: ${existing.account_username || 'N/A'}`);
    console.log(`   Active: ${existing.active}`);
    console.log(`\nUpdating existing account...\n`);
  } else {
    console.log('✓ No existing account found. Creating new account...\n');
  }

  // Step 3: Insert or update the account
  console.log('Step 3: Saving account to database...');
  
  if (existing && !existingError) {
    // Update existing account
    const { data: account, error: accountError } = await supabase
      .from('mastodon_accounts')
      .update({
        mastodon_base_url: options.baseUrl || 'https://mastodon.social',
        mastodon_access_token: options.token,
        account_username: options.username || null,
        active: true,
      })
      .eq('id', existing.id)
      .select()
      .single();

    if (accountError || !account) {
      throw new Error(`Failed to update account: ${accountError?.message || 'Unknown error'}`);
    }
    console.log(`✓ Account updated successfully!\n`);
  } else {
    // Insert new account
    const { data: account, error: accountError } = await supabase
      .from('mastodon_accounts')
      .insert({
        philosopher_id: philosopher.id,
        account_type: 'philosopher',
        mastodon_base_url: options.baseUrl || 'https://mastodon.social',
        mastodon_access_token: options.token,
        account_username: options.username || null,
        active: true,
      })
      .select()
      .single();

    if (accountError || !account) {
      throw new Error(`Failed to save account: ${accountError?.message || 'Unknown error'}`);
    }
    console.log(`✓ Account saved successfully!\n`);
  }

  console.log('✅ Philosopher bot account is ready!');
  console.log('   The account will automatically be included in the interval-based rotation.');
  console.log('   No additional scheduling needed.\n');
}

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.replace(/^--/, '');
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        parsed[key] = next;
        i += 1;
      } else {
        parsed[key] = true;
      }
    }
  }
  return parsed;
}

async function main() {
  const args = parseArgs();
  const philosopher = args.philosopher as string;
  const token = args.token as string;
  const baseUrl = args['base-url'] as string | undefined;
  const username = args.username as string | undefined;

  if (!philosopher || !token) {
    console.error('Error: --philosopher and --token are required');
    console.error('Usage: npm run add-philosopher-bot -- --philosopher "Friedrich Nietzsche" --token "access_token" --username "@username@instance"');
    process.exit(1);
  }

  try {
    await addPhilosopherBot({ philosopher, token, baseUrl, username });
  } catch (error) {
    console.error('\n❌ Error:', (error as Error).message);
    process.exit(1);
  }
}

main();
