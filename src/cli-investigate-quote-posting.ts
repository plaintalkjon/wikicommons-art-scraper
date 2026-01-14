#!/usr/bin/env node
/**
 * Investigate why quote bots aren't posting
 */

import { supabase } from './config';

async function investigateQuotePosting(): Promise<void> {
  console.log('🔍 Investigating Quote Bot Posting Issues...');
  console.log('═'.repeat(70));
  console.log('');

  try {
    // Step 1: Check quote accounts
    console.log('📝 Step 1: Checking quote accounts...');
    const { data: quoteAccounts, error: accountError } = await supabase
      .from('mastodon_accounts')
      .select('id, account_username, account_type, author_id, active, last_posted_at, mastodon_base_url')
      .eq('account_type', 'quote')
      .eq('active', true);

    if (accountError) {
      throw new Error(`Failed to query accounts: ${accountError.message}`);
    }

    if (!quoteAccounts || quoteAccounts.length === 0) {
      console.log('⚠️  No active quote accounts found');
      return;
    }

    console.log(`   Found ${quoteAccounts.length} active quote account(s)\n`);

    for (const account of quoteAccounts) {
      console.log(`\n📋 Account: ${account.account_username}`);
      console.log(`   ID: ${account.id}`);
      console.log(`   Active: ${account.active ? '✅' : '❌'}`);
      console.log(`   Author ID: ${account.author_id || '⚠️  MISSING'}`);
      console.log(`   Last Posted: ${account.last_posted_at || 'NEVER'}`);
      
      if (account.last_posted_at) {
        const hoursAgo = (Date.now() - new Date(account.last_posted_at).getTime()) / (1000 * 60 * 60);
        console.log(`   Hours Since Last Post: ${hoursAgo.toFixed(1)}`);
      }

      // Check if account is due to post (6 hours)
      const intervalHours = 6;
      const isDue = !account.last_posted_at || 
        (Date.now() - new Date(account.last_posted_at).getTime()) > (intervalHours * 60 * 60 * 1000);
      console.log(`   Due to Post: ${isDue ? '✅ YES' : '❌ NO'}`);

      if (!account.author_id) {
        console.log(`   ⚠️  PROBLEM: Missing author_id - account cannot post`);
        continue;
      }

      // Step 2: Check author exists
      console.log(`\n   📚 Checking author...`);
      const { data: author, error: authorError } = await supabase
        .from('quote_authors')
        .select('id, name, category')
        .eq('id', account.author_id)
        .single();

      if (authorError || !author) {
        console.log(`   ❌ PROBLEM: Author not found - ${authorError?.message || 'Unknown error'}`);
        continue;
      }

      console.log(`   ✅ Author: ${author.name} (Category: ${author.category || 'N/A'})`);

      // Step 3: Check quotes available
      console.log(`\n   📖 Checking quotes...`);
      const { count: totalQuotes, error: countError } = await supabase
        .from('quotes')
        .select('*', { count: 'exact', head: true })
        .eq('author_id', account.author_id);

      if (countError) {
        console.log(`   ❌ PROBLEM: Error counting quotes - ${countError.message}`);
        continue;
      }

      console.log(`   Total Quotes: ${totalQuotes || 0}`);

      if (!totalQuotes || totalQuotes === 0) {
        console.log(`   ⚠️  PROBLEM: No quotes available for this author`);
        continue;
      }

      // Check unposted quotes
      const { count: unpostedCount, error: unpostedError } = await supabase
        .from('quotes')
        .select('*', { count: 'exact', head: true })
        .eq('author_id', account.author_id)
        .is('posted_at', null);

      if (unpostedError) {
        console.log(`   ⚠️  Error checking unposted quotes: ${unpostedError.message}`);
      } else {
        console.log(`   Unposted Quotes: ${unpostedCount || 0}`);
      }

      // Check posted quotes
      const { count: postedCount, error: postedError } = await supabase
        .from('quotes')
        .select('*', { count: 'exact', head: true })
        .eq('author_id', account.author_id)
        .not('posted_at', 'is', null);

      if (postedError) {
        console.log(`   ⚠️  Error checking posted quotes: ${postedError.message}`);
      } else {
        console.log(`   Posted Quotes: ${postedCount || 0}`);
      }

      // Get oldest posted quote (for repost logic)
      const { data: oldestPosted, error: oldestError } = await supabase
        .from('quotes')
        .select('id, text, posted_at')
        .eq('author_id', account.author_id)
        .not('posted_at', 'is', null)
        .order('posted_at', { ascending: true })
        .limit(1);

      if (!oldestError && oldestPosted && oldestPosted.length > 0) {
        const oldestDate = new Date(oldestPosted[0].posted_at);
        const hoursSinceOldest = (Date.now() - oldestDate.getTime()) / (1000 * 60 * 60);
        console.log(`   Oldest Posted Quote: ${hoursSinceOldest.toFixed(1)} hours ago`);
      }

      // Step 4: Check quote_posts table
      console.log(`\n   📊 Checking quote_posts tracking...`);
      const { count: quotePostsCount, error: qpError } = await supabase
        .from('quote_posts')
        .select('*', { count: 'exact', head: true })
        .eq('mastodon_account_id', account.id);

      if (qpError) {
        console.log(`   ⚠️  Error checking quote_posts: ${qpError.message}`);
      } else {
        console.log(`   Total Quote Posts Recorded: ${quotePostsCount || 0}`);
      }
    }

    // Step 5: Check if cron job is running
    console.log('\n\n⏰ Step 5: Checking cron job status...');
    console.log('   Note: Run this SQL to check cron jobs:');
    console.log('   SELECT jobname, schedule, active FROM cron.job WHERE jobname = \'post-art-task\';');

    console.log('\n');
    console.log('═'.repeat(70));
    console.log('✅ Investigation Complete');
    console.log('═'.repeat(70));

  } catch (error: any) {
    console.error('');
    console.error('❌ Investigation failed:');
    console.error(`   ${error.message}`);
    process.exit(1);
  }
}

investigateQuotePosting().catch((err) => {
  console.error('❌ Unexpected error:', err);
  process.exit(1);
});

