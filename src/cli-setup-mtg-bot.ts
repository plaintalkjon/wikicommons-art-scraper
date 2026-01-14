#!/usr/bin/env node
/**
 * Set up MTG card bot: Add account and create cron job
 * 
 * Usage:
 *   npm run setup-mtg-bot
 */

import { supabase, config } from './config';

interface SetupResult {
  accountAdded: boolean;
  cronCreated: boolean;
  accountId?: string;
  cronJobName?: string;
  errors: string[];
}

async function addMTGAccount(): Promise<{ success: boolean; accountId?: string; error?: string; needsConstraintUpdate?: boolean }> {
  console.log('📝 Adding MTG account to database...');
  
  // First, try to update the constraint to allow 'mtg' type
  console.log('   Updating account_type constraint to include "mtg"...');
  
  const updateConstraintSQL = `
    ALTER TABLE mastodon_accounts 
    DROP CONSTRAINT IF EXISTS mastodon_accounts_account_type_check;
    
    ALTER TABLE mastodon_accounts 
    ADD CONSTRAINT mastodon_accounts_account_type_check 
    CHECK (account_type IN ('artist', 'tag', 'quote', 'mtg', 'yugioh'));
  `;

  // Execute SQL via RPC or direct query
  // Note: Supabase JS client doesn't support direct SQL execution
  // We'll need to use the REST API or provide SQL for manual execution
  let constraintError: any = null;
  try {
    const result = await supabase.rpc('exec_sql', { 
      sql: updateConstraintSQL 
    } as any);
    constraintError = result.error;
  } catch {
    constraintError = { message: 'exec_sql RPC not available' };
  }

  if (constraintError && !constraintError.message.includes('not available')) {
    console.log(`   ⚠️  Could not update constraint automatically: ${constraintError.message}`);
    console.log('   You may need to run the SQL manually to update the constraint');
  } else if (!constraintError) {
    console.log('   ✅ Constraint updated successfully');
  }
  
  // Check if account already exists
  const { data: existing } = await supabase
    .from('mastodon_accounts')
    .select('id')
    .eq('account_username', 'CuratedMTGShowcase')
    .maybeSingle();

  if (existing?.id) {
    console.log(`⚠️  Account already exists with ID: ${existing.id}`);
    return { success: true, accountId: existing.id };
  }

  // Normalize to standard format: username without @, base_url without protocol
  const { data, error } = await supabase
    .from('mastodon_accounts')
    .insert({
      account_username: 'CuratedMTGShowcase', // Already normalized (no @)
      mastodon_base_url: 'mastodon.social', // Standard format: no protocol
      mastodon_access_token: 'T7SK9fhzMZQ49ptyqfoQyhBv9m0o4vaTv5O9R3-ZOBc',
      account_type: 'mtg' as any, // Type assertion to bypass TypeScript check
      active: true,
    })
    .select('id')
    .single();

  if (error) {
    if (error.message.includes('check constraint')) {
      return { 
        success: false, 
        error: error.message,
        needsConstraintUpdate: true 
      };
    }
    return { success: false, error: error.message };
  }

  if (!data?.id) {
    return { success: false, error: 'No ID returned from insert' };
  }

  console.log(`✅ Account added successfully with ID: ${data.id}`);
  return { success: true, accountId: data.id };
}

async function createCronJob(): Promise<{ success: boolean; error?: string; sql?: string }> {
  console.log('⏰ Preparing cron job SQL...');

  // Extract project reference from Supabase URL
  // URL format: https://abcdefghijklmnop.supabase.co
  const urlMatch = config.supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/);
  if (!urlMatch) {
    return { success: false, error: 'Could not extract project reference from SUPABASE_URL' };
  }
  const projectRef = urlMatch[1];

  // Get anon key from environment (prefer anon key for cron jobs)
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!anonKey) {
    console.log('⚠️  SUPABASE_ANON_KEY not found in environment');
    console.log('   Using service role key (will work but anon key is preferred)');
  }
  const authKey = anonKey || config.supabaseServiceRoleKey;
  
  const functionUrl = `https://${projectRef}.supabase.co/functions/v1/post-mtg-card`;

  console.log(`   Function URL: ${functionUrl}`);
  console.log(`   Schedule: Every 6 hours (4 times per day)`);

  // Generate the cron SQL
  const cronSQL = `SELECT cron.schedule(
  'post-mtg-card',
  '0 */6 * * *',
  $$
  SELECT net.http_post(
    url := '${functionUrl}',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ${authKey}'
    )
  ) AS request_id;
  $$
);`;

  // Try to execute via Supabase REST API using a custom approach
  // Note: Supabase doesn't expose direct SQL execution via REST API for security
  // We'll attempt to use the SQL execution endpoint, but it likely won't work
  // So we'll provide the SQL for manual execution
  
  try {
    // Check if we can execute SQL via REST API (unlikely to work without custom RPC)
    // For now, we'll just return the SQL for manual execution
    return { success: false, error: 'Cron job requires manual SQL execution', sql: cronSQL };
  } catch (err: any) {
    return { success: false, error: err.message, sql: cronSQL };
  }
}

async function main() {
  console.log('🃏 MTG Card Bot Setup');
  console.log('═'.repeat(70));
  console.log('');

  const result: SetupResult = {
    accountAdded: false,
    cronCreated: false,
    errors: [],
  };

  // Step 1: Add account
  let needsConstraintUpdate = false;
  try {
    const accountResult = await addMTGAccount();
    if (accountResult.success) {
      result.accountAdded = true;
      result.accountId = accountResult.accountId;
    } else {
      needsConstraintUpdate = accountResult.needsConstraintUpdate || false;
      result.errors.push(`Account creation failed: ${accountResult.error}`);
    }
  } catch (err: any) {
    result.errors.push(`Account creation error: ${err.message}`);
  }

  console.log('');

  // Step 2: Create cron job
  let cronSQL: string | undefined;
  try {
    const cronResult = await createCronJob();
    if (cronResult.success) {
      result.cronCreated = true;
    } else {
      cronSQL = cronResult.sql;
      result.errors.push(`Cron creation: ${cronResult.error}`);
    }
  } catch (err: any) {
    result.errors.push(`Cron creation error: ${err.message}`);
  }

  console.log('');
  console.log('═'.repeat(70));
  console.log('Setup Summary:');
  console.log(`  Account Added: ${result.accountAdded ? '✅' : '❌'}`);
  console.log(`  Cron Job Created: ${result.cronCreated ? '✅' : '⚠️  (Manual SQL required)'}`);
  
  if (result.errors.length > 0) {
    console.log('');
    console.log('Errors:');
    result.errors.forEach((error, i) => {
      console.log(`  ${i + 1}. ${error}`);
    });
  }

  if (!result.accountAdded && needsConstraintUpdate) {
    console.log('');
    console.log('📋 Database Constraint Update Required:');
    console.log('   The account_type constraint needs to be updated to allow "mtg" type.');
    console.log('   Run this SQL first in Supabase SQL Editor:');
    console.log('');
    console.log('─'.repeat(70));
    console.log(`ALTER TABLE mastodon_accounts 
DROP CONSTRAINT IF EXISTS mastodon_accounts_account_type_check;

ALTER TABLE mastodon_accounts 
ADD CONSTRAINT mastodon_accounts_account_type_check 
CHECK (account_type IN ('artist', 'tag', 'philosopher', 'mtg'));`);
    console.log('─'.repeat(70));
    console.log('');
    console.log('   Then run this script again to add the account.');
  }

  if (result.accountAdded && !result.cronCreated && cronSQL) {
    console.log('');
    console.log('📋 Next Steps:');
    console.log('   1. Go to Supabase Dashboard → SQL Editor');
    console.log('   2. Copy and paste this SQL to create the cron job:');
    console.log('');
    console.log('─'.repeat(70));
    console.log(cronSQL);
    console.log('─'.repeat(70));
    console.log('');
    console.log('   3. Click "Run" to execute the SQL');
    console.log('   4. The bot will start posting automatically!');
  }
  
  if (!result.accountAdded && !needsConstraintUpdate) {
    console.log('');
    console.log('💡 Tip: A complete SQL script is available at: setup-mtg-bot-complete.sql');
    console.log('   This script updates the constraint, adds the account, and provides cron SQL.');
  }

  if (result.accountAdded && result.cronCreated) {
    console.log('');
    console.log('🎉 Setup complete! The bot will start posting automatically.');
  }

  process.exit(result.accountAdded ? 0 : 1);
}

main().catch((err) => {
  console.error('❌ Unexpected error:', err);
  process.exit(1);
});

