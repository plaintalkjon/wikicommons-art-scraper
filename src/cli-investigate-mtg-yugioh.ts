#!/usr/bin/env node
/**
 * Investigate MTG and Yu-Gi-Oh bot posting issues
 */

import { supabase } from './config';

async function investigateMTGYugioh(): Promise<void> {
  console.log('🔍 Investigating MTG and Yu-Gi-Oh Bot Posting...');
  console.log('═'.repeat(70));
  console.log('');

  try {
    // Step 1: Check MTG accounts
    console.log('🃏 Step 1: Checking MTG accounts...');
    const { data: mtgAccounts, error: mtgError } = await supabase
      .from('mastodon_accounts')
      .select('id, account_username, account_type, active, last_posted_at, mastodon_base_url')
      .eq('account_type', 'mtg')
      .eq('active', true);

    if (mtgError) {
      console.log(`   ❌ ERROR: ${mtgError.message}`);
    } else {
      console.log(`   Found ${mtgAccounts?.length || 0} active MTG account(s)`);
      (mtgAccounts || []).forEach(acc => {
        const hoursAgo = acc.last_posted_at 
          ? ((Date.now() - new Date(acc.last_posted_at).getTime()) / (1000 * 60 * 60)).toFixed(1)
          : 'NEVER';
        const isDue = !acc.last_posted_at || 
          (Date.now() - new Date(acc.last_posted_at).getTime()) > (6 * 60 * 60 * 1000);
        console.log(`   - ${acc.account_username}: ${hoursAgo}h ago ${isDue ? '✅ DUE' : '❌ NOT DUE'}`);
      });
    }

    console.log('');

    // Step 2: Check Yu-Gi-Oh accounts
    console.log('🃏 Step 2: Checking Yu-Gi-Oh accounts...');
    const { data: yugiohAccounts, error: yugiohError } = await supabase
      .from('mastodon_accounts')
      .select('id, account_username, account_type, active, last_posted_at, mastodon_base_url')
      .eq('account_type', 'yugioh')
      .eq('active', true);

    if (yugiohError) {
      console.log(`   ❌ ERROR: ${yugiohError.message}`);
    } else {
      console.log(`   Found ${yugiohAccounts?.length || 0} active Yu-Gi-Oh account(s)`);
      (yugiohAccounts || []).forEach(acc => {
        const hoursAgo = acc.last_posted_at 
          ? ((Date.now() - new Date(acc.last_posted_at).getTime()) / (1000 * 60 * 60)).toFixed(1)
          : 'NEVER';
        const isDue = !acc.last_posted_at || 
          (Date.now() - new Date(acc.last_posted_at).getTime()) > (6 * 60 * 60 * 1000);
        console.log(`   - ${acc.account_username}: ${hoursAgo}h ago ${isDue ? '✅ DUE' : '❌ NOT DUE'}`);
      });
    }

    console.log('');

    // Step 3: Check cron jobs
    console.log('⏰ Step 3: Checking cron jobs...');
    console.log('   Note: Run this SQL to check cron jobs:');
    console.log('   SELECT jobname, schedule, active FROM cron.job WHERE jobname IN (\'post-mtg-card\', \'post-yugioh-card\');');

    console.log('');
    console.log('═'.repeat(70));
    console.log('✅ Investigation Complete');
    console.log('═'.repeat(70));

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

investigateMTGYugioh().catch((err) => {
  console.error('❌ Unexpected error:', err);
  process.exit(1);
});

