#!/usr/bin/env node
/**
 * Check account queue to see if Seneca is being blocked by other accounts
 */

import { supabase } from './config';

async function checkAccountQueue(): Promise<void> {
  console.log('🔍 Checking Account Queue...');
  console.log('═'.repeat(70));
  console.log('');

  try {
    const intervalHours = 6;
    const now = new Date();
    const cutoffTime = new Date(now.getTime() - intervalHours * 60 * 60 * 1000);
    const limit = 10; // Default limit from edge function

    console.log(`Cutoff time: ${cutoffTime.toISOString()}`);
    console.log(`Default limit per run: ${limit}`);
    console.log('');

    // Get never-posted accounts
    const { data: neverPosted, error: neverError } = await supabase
      .from("mastodon_accounts")
      .select("*")
      .eq("active", true)
      .in("account_type", ["artist", "tag", "quote"])
      .is("last_posted_at", null)
      .order("created_at", { ascending: true })
      .limit(limit * 2);

    // Get old-posted accounts
    const { data: oldPosted, error: oldError } = await supabase
      .from("mastodon_accounts")
      .select("*")
      .eq("active", true)
      .in("account_type", ["artist", "tag", "quote"])
      .not("last_posted_at", "is", null)
      .lt("last_posted_at", cutoffTime.toISOString())
      .order("last_posted_at", { ascending: true })
      .limit(limit * 2);

    if (neverError || oldError) {
      throw new Error(`Query error: ${neverError?.message || oldError?.message}`);
    }

    // Combine and sort like the edge function does
    const allAccounts = [
      ...(neverPosted || []),
      ...(oldPosted || [])
    ];

    const uniqueAccounts = allAccounts.filter((account, index, self) =>
      index === self.findIndex((a) => a.id === account.id)
    );

    uniqueAccounts.sort((a, b) => {
      if (!a.last_posted_at && !b.last_posted_at) return 0;
      if (!a.last_posted_at) return -1;
      if (!b.last_posted_at) return 1;
      return new Date(a.last_posted_at).getTime() - new Date(b.last_posted_at).getTime();
    });

    console.log(`📊 Total accounts due to post: ${uniqueAccounts.length}`);
    console.log('');

    // Show first 20 accounts
    console.log('📋 First 20 accounts in queue:');
    uniqueAccounts.slice(0, 20).forEach((acc, i) => {
      const hoursAgo = acc.last_posted_at 
        ? ((Date.now() - new Date(acc.last_posted_at).getTime()) / (1000 * 60 * 60)).toFixed(1)
        : 'NEVER';
      const isSeneca = acc.account_username === 'CuratedSeneca';
      const marker = isSeneca ? ' 👈 SENECA' : '';
      console.log(`   ${i + 1}. ${acc.account_username} (${acc.account_type}) - ${hoursAgo}h ago${marker}`);
    });

    const senecaIndex = uniqueAccounts.findIndex(a => a.account_username === 'CuratedSeneca');
    
    console.log('');
    if (senecaIndex === -1) {
      console.log('❌ Seneca NOT found in queue!');
    } else {
      console.log(`✅ Seneca is at position ${senecaIndex + 1} in the queue`);
      console.log(`   Accounts processed per run: ${limit}`);
      console.log(`   Would be processed in run: ${Math.floor(senecaIndex / limit) + 1}`);
      
      if (senecaIndex < limit) {
        console.log(`   ✅ Should be processed in next run!`);
      } else {
        console.log(`   ⚠️  Will be processed after ${senecaIndex} other accounts`);
      }
    }

    // Check how many quote accounts are ahead
    const quoteAccountsAhead = uniqueAccounts.slice(0, senecaIndex).filter(a => a.account_type === 'quote').length;
    console.log(`   Quote accounts ahead: ${quoteAccountsAhead}`);

    console.log('');
    console.log('═'.repeat(70));

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkAccountQueue().catch((err) => {
  console.error('❌ Unexpected error:', err);
  process.exit(1);
});

