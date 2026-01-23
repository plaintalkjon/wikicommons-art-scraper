#!/usr/bin/env node
/**
 * Debug hashtags for quote accounts
 * Tests the exact query logic used in the edge function
 */

import { supabase } from './config';

async function debugHashtags(): Promise<void> {
  console.log('🔍 Debugging Hashtags for Marcus Aurelius and Seneca...');
  console.log('═'.repeat(70));
  console.log('');

  try {
    // Find Marcus Aurelius and Seneca accounts
    const { data: accounts, error: accountsError } = await supabase
      .from('mastodon_accounts')
      .select(`
        id,
        account_username,
        account_type,
        author_id,
        quote_authors!inner(name)
      `)
      .eq('account_type', 'quote')
      .in('quote_authors.name', ['Marcus Aurelius', 'Seneca', 'Lucius Annaeus Seneca']);

    if (accountsError) {
      throw new Error(`Failed to fetch accounts: ${accountsError.message}`);
    }

    if (!accounts || accounts.length === 0) {
      console.log('❌ No accounts found for Marcus Aurelius or Seneca');
      return;
    }

    console.log(`Found ${accounts.length} account(s):\n`);

    for (const account of accounts) {
      const accountData = account as any;
      console.log(`📝 Account: ${accountData.account_username}`);
      console.log(`   ID: ${accountData.id}`);
      console.log(`   Author: ${accountData.quote_authors?.name || 'N/A'}`);
      console.log('');

      // Test the exact query from the edge function (two-step approach)
      console.log('   Step 1: Fetching hashtag links...');
      const { data: accountHashtagLinks, error: linkError } = await supabase
        .from("mastodon_account_hashtags")
        .select("hashtag_id")
        .eq("mastodon_account_id", accountData.id);

      if (linkError) {
        console.error(`   ❌ ERROR: ${linkError.message}`);
        continue;
      }

      console.log(`   ✅ Found ${accountHashtagLinks?.length || 0} hashtag link(s)`);
      
      if (!accountHashtagLinks || accountHashtagLinks.length === 0) {
        console.log('   ⚠️  No hashtags assigned to this account');
        console.log('');
        continue;
      }

      const hashtagIds = accountHashtagLinks.map((link: any) => link.hashtag_id).filter((id: any) => id);
      console.log(`   Hashtag IDs: ${hashtagIds.join(', ')}`);
      console.log('');

      console.log('   Step 2: Fetching hashtag names...');
      const { data: hashtagsData, error: hashtagError } = await supabase
        .from("hashtags")
        .select("name")
        .in("id", hashtagIds);

      if (hashtagError) {
        console.error(`   ❌ ERROR: ${hashtagError.message}`);
        continue;
      }

      console.log(`   ✅ Found ${hashtagsData?.length || 0} hashtag(s)`);
      
      if (!hashtagsData || hashtagsData.length === 0) {
        console.log('   ⚠️  No hashtag names found');
        console.log('');
        continue;
      }

      const hashtags = hashtagsData
        .map((h: any) => `#${h.name}`)
        .sort();

      console.log(`   Hashtags: ${hashtags.join(', ')}`);
      console.log('');

      // Also test the join query to see if it works differently
      console.log('   Testing join query (original approach)...');
      const { data: joinResult, error: joinError } = await supabase
        .from("mastodon_account_hashtags")
        .select(`
          hashtag_id,
          hashtags!inner(name)
        `)
        .eq("mastodon_account_id", accountData.id);

      if (joinError) {
        console.error(`   ❌ JOIN ERROR: ${joinError.message}`);
      } else {
        console.log(`   ✅ Join query returned ${joinResult?.length || 0} result(s)`);
        if (joinResult && joinResult.length > 0) {
          console.log(`   Join result structure:`, JSON.stringify(joinResult[0], null, 2));
          
          const joinHashtags = joinResult
            .map((ah: any) => {
              const name = ah.hashtags?.name;
              return name ? `#${name}` : null;
            })
            .filter((h: string | null): h is string => h !== null)
            .sort();
          
          console.log(`   Join hashtags: ${joinHashtags.join(', ')}`);
        }
      }

      console.log('');
      console.log('─'.repeat(70));
      console.log('');
    }

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

debugHashtags();
