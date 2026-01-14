#!/usr/bin/env node
/**
 * Investigate why Seneca isn't posting
 */

import { supabase } from './config';

async function investigateSeneca(): Promise<void> {
  console.log('🔍 Investigating Seneca Quote Bot...');
  console.log('═'.repeat(70));
  console.log('');

  try {
    const senecaAccountId = 'c586b14b-bca1-49a9-aacd-c743cfa44203';
    const senecaAuthorId = '152ceea0-9e51-405d-baa5-83fa6d4e75eb';

    // Step 1: Check account status
    console.log('📝 Step 1: Checking account status...');
    const { data: account, error: accountError } = await supabase
      .from('mastodon_accounts')
      .select('*')
      .eq('id', senecaAccountId)
      .single();

    if (accountError || !account) {
      throw new Error(`Failed to get account: ${accountError?.message || 'Not found'}`);
    }

    console.log(`   Account: ${account.account_username}`);
    console.log(`   Type: ${account.account_type}`);
    console.log(`   Active: ${account.active ? '✅' : '❌'}`);
    console.log(`   Author ID: ${account.author_id || '⚠️  MISSING'}`);
    console.log(`   Last Posted: ${account.last_posted_at || 'NEVER'}`);
    
    if (account.last_posted_at) {
      const hoursAgo = (Date.now() - new Date(account.last_posted_at).getTime()) / (1000 * 60 * 60);
      console.log(`   Hours Since Last Post: ${hoursAgo.toFixed(1)}`);
      const isDue = hoursAgo > 6;
      console.log(`   Due to Post (>6h): ${isDue ? '✅ YES' : '❌ NO'}`);
    } else {
      console.log(`   Due to Post: ✅ YES (never posted)`);
    }

    console.log('');

    // Step 2: Check author
    console.log('📚 Step 2: Checking author...');
    const { data: author, error: authorError } = await supabase
      .from('quote_authors')
      .select('id, name, category')
      .eq('id', senecaAuthorId)
      .single();

    if (authorError || !author) {
      console.log(`   ❌ ERROR: Author not found - ${authorError?.message || 'Unknown'}`);
      return;
    }

    console.log(`   ✅ Author: ${author.name} (Category: ${author.category || 'N/A'})`);
    console.log('');

    // Step 3: Check quotes
    console.log('📖 Step 3: Checking quotes...');
    const { count: totalQuotes, error: countError } = await supabase
      .from('quotes')
      .select('*', { count: 'exact', head: true })
      .eq('author_id', senecaAuthorId);

    if (countError) {
      console.log(`   ❌ ERROR: ${countError.message}`);
      return;
    }

    console.log(`   Total Quotes: ${totalQuotes || 0}`);

    // Get all quote IDs
    const { data: allQuotes, error: allQuotesError } = await supabase
      .from('quotes')
      .select('id')
      .eq('author_id', senecaAuthorId);

    if (allQuotesError) {
      console.log(`   ❌ ERROR getting quote IDs: ${allQuotesError.message}`);
      return;
    }

    const allQuoteIds = (allQuotes || []).map(q => q.id);
    console.log(`   Quote IDs retrieved: ${allQuoteIds.length}`);

    // Check posted quotes
    const { data: postedQuotes, error: postedError } = await supabase
      .from('quote_posts')
      .select('quote_id, posted_at')
      .eq('mastodon_account_id', senecaAccountId);

    if (postedError) {
      console.log(`   ❌ ERROR getting posted quotes: ${postedError.message}`);
      return;
    }

    const postedQuoteIds = new Set((postedQuotes || []).map(p => p.quote_id));
    const unpostedQuoteIds = allQuoteIds.filter(id => !postedQuoteIds.has(id));

    console.log(`   Posted Quotes: ${postedQuoteIds.size}`);
    console.log(`   Unposted Quotes: ${unpostedQuoteIds.length}`);

    if (postedQuoteIds.size > 0) {
      const oldestPost = postedQuotes!.sort((a, b) => 
        new Date(a.posted_at).getTime() - new Date(b.posted_at).getTime()
      )[0];
      const hoursSinceOldest = (Date.now() - new Date(oldestPost.posted_at).getTime()) / (1000 * 60 * 60);
      console.log(`   Oldest Posted: ${hoursSinceOldest.toFixed(1)} hours ago`);
    }

    console.log('');

    // Step 4: Test the query logic from edge function
    console.log('🔍 Step 4: Testing edge function query logic...');
    
    if (unpostedQuoteIds.length > 0) {
      console.log(`   Testing unposted quote query...`);
      const { data: unpostedQuote, error: unpostedError } = await supabase
        .from("quotes")
        .select(`
          id, 
          text,
          quote_authors!inner(name, category)
        `)
        .eq("author_id", senecaAuthorId)
        .in("id", unpostedQuoteIds.slice(0, 10)) // Test with first 10
        .order("created_at", { ascending: true })
        .limit(1);

      if (unpostedError) {
        console.log(`   ❌ ERROR: ${JSON.stringify(unpostedError, null, 2)}`);
      } else if (unpostedQuote && unpostedQuote.length > 0) {
        console.log(`   ✅ Found unposted quote: ${unpostedQuote[0].id}`);
        console.log(`      Text preview: ${unpostedQuote[0].text.substring(0, 100)}...`);
      } else {
        console.log(`   ⚠️  Query returned no results (might be join issue)`);
      }
    } else {
      console.log(`   No unposted quotes, testing oldest posted query...`);
      const { data: oldestPost, error: oldestError } = await supabase
        .from("quote_posts")
        .select(`
          quote_id,
          posted_at,
          quotes!inner(
            id,
            text,
            quote_authors!inner(name, category)
          )
        `)
        .eq("mastodon_account_id", senecaAccountId)
        .order("posted_at", { ascending: true })
        .limit(1);

      if (oldestError) {
        console.log(`   ❌ ERROR: ${JSON.stringify(oldestError, null, 2)}`);
      } else if (oldestPost && oldestPost.length > 0) {
        console.log(`   ✅ Found oldest post: ${oldestPost[0].quote_id}`);
        const post = oldestPost[0] as any;
        if (post.quotes) {
          console.log(`      Quote text preview: ${post.quotes.text.substring(0, 100)}...`);
        }
      } else {
        console.log(`   ⚠️  No posted quotes found`);
      }
    }

    console.log('');

    // Step 5: Check recent quote_posts
    console.log('📊 Step 5: Recent quote_posts...');
    const { data: recentPosts, error: recentError } = await supabase
      .from('quote_posts')
      .select('quote_id, posted_at, mastodon_status_id')
      .eq('mastodon_account_id', senecaAccountId)
      .order('posted_at', { ascending: false })
      .limit(5);

    if (recentError) {
      console.log(`   ⚠️  Error: ${recentError.message}`);
    } else {
      console.log(`   Last 5 posts:`);
      (recentPosts || []).forEach((post, i) => {
        const hoursAgo = (Date.now() - new Date(post.posted_at).getTime()) / (1000 * 60 * 60);
        console.log(`   ${i + 1}. ${post.posted_at} (${hoursAgo.toFixed(1)}h ago) - Status: ${post.mastodon_status_id || 'N/A'}`);
      });
    }

    console.log('');
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

investigateSeneca().catch((err) => {
  console.error('❌ Unexpected error:', err);
  process.exit(1);
});

