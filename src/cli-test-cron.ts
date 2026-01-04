#!/usr/bin/env node
/**
 * Test the cron system to verify it's working properly.
 *
 * Usage:
 *   npm run test-cron
 */

import { supabase } from './config';

async function testCronSystem() {
  console.log('🧪 TESTING CRON SYSTEM\n');

  const now = new Date();
  console.log(`Current time: ${now.toISOString()}\n`);

  // Check current status
  const sixHoursAgo = new Date(now.getTime() - (6 * 60 * 60 * 1000));

  const { data: dueAccounts, error: dueError } = await supabase
    .from('mastodon_accounts')
    .select('account_username, last_posted_at')
    .eq('active', true)
    .or('last_posted_at.is.null,last_posted_at.lt.' + sixHoursAgo.toISOString())
    .order('last_posted_at', { ascending: true, nullsFirst: true })
    .limit(15);

  if (dueError) {
    console.log('❌ Error checking due accounts:', dueError);
    return;
  }

  console.log(`📊 Accounts currently due to post: ${dueAccounts?.length || 0}\n`);

  if (dueAccounts && dueAccounts.length > 0) {
    console.log('Next accounts to post:');
    dueAccounts.slice(0, 10).forEach((account, i) => {
      const lastPost = account.last_posted_at ? new Date(account.last_posted_at) : null;
      const hoursAgo = lastPost ? (now.getTime() - lastPost.getTime()) / (1000 * 60 * 60) : null;
      console.log(`  ${i+1}. @${account.account_username} - ${hoursAgo ? `${hoursAgo.toFixed(1)}h ago` : 'never'}`);
    });
    console.log('');

    if (dueAccounts.length > 10) {
      console.log(`⚠️  ${dueAccounts.length - 10} more accounts waiting...\n`);
    }
  }

  // Check recent activity
  const oneHourAgo = new Date(now.getTime() - (60 * 60 * 1000));

  const { data: recentPosts, error: recentError } = await supabase
    .from('mastodon_accounts')
    .select('account_username, last_posted_at')
    .not('last_posted_at', 'is', null)
    .gte('last_posted_at', oneHourAgo.toISOString())
    .order('last_posted_at', { ascending: false });

  console.log('RECENT ACTIVITY (last hour):');
  if (recentError) {
    console.log('❌ Error checking recent posts:', recentError);
  } else if (recentPosts && recentPosts.length > 0) {
    console.log(`✅ ${recentPosts.length} accounts posted in the last hour`);
    recentPosts.slice(0, 5).forEach((account, i) => {
      const postTime = new Date(account.last_posted_at);
      const minutesAgo = (now.getTime() - postTime.getTime()) / (1000 * 60);
      console.log(`  ${i+1}. @${account.account_username} - ${minutesAgo.toFixed(0)} minutes ago`);
    });
  } else {
    console.log('❌ No posts in the last hour');
  }

  // Give recommendations
  console.log('\n📋 RECOMMENDATIONS:');

  if (dueAccounts && dueAccounts.length > 0) {
    if (recentPosts && recentPosts.length > 0) {
      console.log('✅ Cron is running but slowly - some accounts are posting');
      console.log('   Expected: 10 accounts every 10 minutes');
      console.log(`   Current: ${recentPosts.length} in last hour (${(recentPosts.length/6).toFixed(1)} per 10min)`);
    } else {
      console.log('❌ Cron appears to be stopped - no recent posts');
      console.log('   Check Supabase dashboard cron configuration');
    }
  } else {
    console.log('✅ All accounts are up to date - cron is working well');
  }

  console.log('\n🔧 To fix cron issues:');
  console.log('   1. Go to Supabase Dashboard → Edge Functions → Cron Jobs');
  console.log('   2. Ensure post-art cron is set to: "*/10 * * * *" (every 10 minutes)');
  console.log('   3. Make sure status is "Enabled"');
  console.log('   4. Run this test again to verify');
}

testCronSystem().catch(console.error);

