/**
 * CLI script to add a new artist bot account and optionally set up scheduling
 * Usage: npm run add-artist-bot -- --artist "Artist Name" --token "access_token" --username "@username@instance" [--schedule]
 */

import { supabase } from './supabaseClient';
import dotenv from 'dotenv';
import path from 'path';

// Load .env
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL!;

interface Options {
  artist: string;
  token: string;
  baseUrl?: string;
  username?: string;
  schedule?: boolean;
}

async function addArtistBot(options: Options): Promise<void> {
  console.log(`\n=== Adding Artist Bot Account ===\n`);
  console.log(`Artist: ${options.artist}`);
  console.log(`Base URL: ${options.baseUrl || 'https://mastodon.social'}`);
  console.log(`Username: ${options.username || 'Not provided'}`);
  console.log('');

  // Step 1: Verify artist exists
  console.log('Step 1: Verifying artist exists...');
  const { data: artist, error: artistError } = await supabase
    .from('artists')
    .select('id, name')
    .eq('name', options.artist)
    .single();

  if (artistError || !artist) {
    throw new Error(`Artist "${options.artist}" not found in database. Make sure the name matches exactly.`);
  }
  console.log(`✓ Found artist: ${artist.name} (ID: ${artist.id})\n`);

  // Step 2: Check if account already exists
  console.log('Step 2: Checking for existing account...');
  const { data: existing, error: existingError } = await supabase
    .from('mastodon_accounts')
    .select('id, account_username, active')
    .eq('artist_id', artist.id)
    .single();

  if (existing && !existingError) {
    console.log(`⚠️  Account already exists for this artist:`);
    console.log(`   Username: ${existing.account_username || 'N/A'}`);
    console.log(`   Active: ${existing.active}`);
    console.log(`\nUpdating existing account...\n`);
  } else {
    console.log('✓ No existing account found. Creating new account...\n');
  }

  // Step 3: Upsert the account
  console.log('Step 3: Saving account to database...');
  const { data: account, error: accountError } = await supabase
    .from('mastodon_accounts')
    .upsert(
      {
        artist_id: artist.id,
        mastodon_base_url: options.baseUrl || 'https://mastodon.social',
        mastodon_access_token: options.token,
        account_username: options.username || null,
        active: true,
      },
      { onConflict: 'artist_id' }
    )
    .select()
    .single();

  if (accountError || !account) {
    throw new Error(`Failed to save account: ${accountError?.message || 'Unknown error'}`);
  }
  console.log(`✓ Account saved successfully!\n`);

  // Step 4: Test the function
  console.log('Step 4: Testing the function...');
  const testUrl = `${SUPABASE_URL}/functions/v1/post-art?artist=${encodeURIComponent(options.artist)}`;
  
  try {
    // Get anon key from environment or use a placeholder
    const anonKey = process.env.SUPABASE_ANON_KEY || 'test';
    const response = await fetch(testUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (response.ok) {
      const result = await response.json();
      console.log(`✓ Function test successful!`);
      console.log(`   Posted: ${result.title || 'N/A'}`);
      console.log(`   Status ID: ${result.status_id || 'N/A'}\n`);
    } else {
      const errorText = await response.text();
      console.log(`⚠️  Function test returned status ${response.status}`);
      console.log(`   Response: ${errorText.substring(0, 200)}\n`);
      console.log(`   Note: This might be due to missing anon key. Test manually to verify.\n`);
    }
  } catch (err) {
    console.log(`⚠️  Could not test function automatically: ${(err as Error).message}`);
    console.log(`   Test manually with:`);
    console.log(`   curl -X POST "${testUrl}" \\`);
    console.log(`     -H "Authorization: Bearer YOUR_ANON_KEY"\n`);
  }

  // Step 5: Generate scheduling SQL (if requested)
  if (options.schedule) {
    console.log('Step 5: Generating scheduling SQL...');
    const artistSlug = options.artist.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const encodedArtist = encodeURIComponent(options.artist);
    const functionUrl = `${SUPABASE_URL}/functions/v1/post-art?artist=${encodedArtist}`;
    
    console.log(`\n=== Scheduling SQL (4 times per day) ===\n`);
    console.log(`-- Add these 4 cron jobs for ${options.artist}:`);
    console.log(`\n-- 12:00 AM UTC`);
    console.log(`SELECT cron.schedule(`);
    console.log(`  '${artistSlug}-12am',`);
    console.log(`  '0 0 * * *',`);
    console.log(`  $$`);
    console.log(`  SELECT net.http_post(`);
    console.log(`    url := '${functionUrl}',`);
    console.log(`    headers := jsonb_build_object(`);
    console.log(`      'Content-Type', 'application/json',`);
    console.log(`      'Authorization', 'Bearer YOUR_ANON_KEY'`);
    console.log(`    )`);
    console.log(`  ) as request_id;`);
    console.log(`  $$`);
    console.log(`);\n`);

    console.log(`-- 6:00 AM UTC`);
    console.log(`SELECT cron.schedule(`);
    console.log(`  '${artistSlug}-6am',`);
    console.log(`  '0 6 * * *',`);
    console.log(`  $$`);
    console.log(`  SELECT net.http_post(`);
    console.log(`    url := '${functionUrl}',`);
    console.log(`    headers := jsonb_build_object(`);
    console.log(`      'Content-Type', 'application/json',`);
    console.log(`      'Authorization', 'Bearer YOUR_ANON_KEY'`);
    console.log(`    )`);
    console.log(`  ) as request_id;`);
    console.log(`  $$`);
    console.log(`);\n`);

    console.log(`-- 12:00 PM UTC`);
    console.log(`SELECT cron.schedule(`);
    console.log(`  '${artistSlug}-12pm',`);
    console.log(`  '0 12 * * *',`);
    console.log(`  $$`);
    console.log(`  SELECT net.http_post(`);
    console.log(`    url := '${functionUrl}',`);
    console.log(`    headers := jsonb_build_object(`);
    console.log(`      'Content-Type', 'application/json',`);
    console.log(`      'Authorization', 'Bearer YOUR_ANON_KEY'`);
    console.log(`    )`);
    console.log(`  ) as request_id;`);
    console.log(`  $$`);
    console.log(`);\n`);

    console.log(`-- 6:00 PM UTC`);
    console.log(`SELECT cron.schedule(`);
    console.log(`  '${artistSlug}-6pm',`);
    console.log(`  '0 18 * * *',`);
    console.log(`  $$`);
    console.log(`  SELECT net.http_post(`);
    console.log(`    url := '${functionUrl}',`);
    console.log(`    headers := jsonb_build_object(`);
    console.log(`      'Content-Type', 'application/json',`);
    console.log(`      'Authorization', 'Bearer YOUR_ANON_KEY'`);
    console.log(`    )`);
    console.log(`  ) as request_id;`);
    console.log(`  $$`);
    console.log(`);\n`);
  }

  console.log('=== Complete! ===\n');
  console.log(`✓ Artist bot account added for: ${options.artist}`);
  if (options.schedule) {
    console.log(`✓ Scheduling SQL generated above`);
    console.log(`  Copy and run it in Supabase SQL Editor (replace YOUR_ANON_KEY)`);
  }
  console.log('');
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const options: Partial<Options> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--artist' && args[i + 1]) {
      options.artist = args[i + 1];
      i++;
    } else if (arg === '--token' && args[i + 1]) {
      options.token = args[i + 1];
      i++;
    } else if (arg === '--base-url' && args[i + 1]) {
      options.baseUrl = args[i + 1];
      i++;
    } else if (arg === '--username' && args[i + 1]) {
      options.username = args[i + 1];
      i++;
    } else if (arg === '--schedule') {
      options.schedule = true;
    }
  }

  if (!options.artist || !options.token) {
    console.error('Usage: npm run add-artist-bot -- --artist "Artist Name" --token "access_token" [--username "@user@instance"] [--base-url "https://instance.com"] [--schedule]');
    console.error('\nRequired:');
    console.error('  --artist "Artist Name"     Artist name (must match database exactly)');
    console.error('  --token "access_token"     Mastodon access token');
    console.error('\nOptional:');
    console.error('  --username "@user@inst"   Account username for reference');
    console.error('  --base-url "https://..."  Mastodon instance URL (default: https://mastodon.social)');
    console.error('  --schedule                Generate scheduling SQL');
    process.exit(1);
  }

  return options as Options;
}

async function main() {
  try {
    const options = parseArgs();
    await addArtistBot(options);
  } catch (err) {
    console.error('\n❌ Error:', (err as Error).message);
    process.exit(1);
  }
}

main();


