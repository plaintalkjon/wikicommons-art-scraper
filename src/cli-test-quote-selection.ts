#!/usr/bin/env node
/**
 * Test the exact quote selection logic from edge function
 */

import { supabase } from './config';

async function testQuoteSelection(): Promise<void> {
  console.log('🔍 Testing Quote Selection Logic...');
  console.log('═'.repeat(70));
  console.log('');

  try {
    const senecaAccountId = 'c586b14b-bca1-49a9-aacd-c743cfa44203';
    const senecaAuthorId = '152ceea0-9e51-405d-baa5-83fa6d4e75eb';

    console.log('📝 Step 1: Get all quotes for author...');
    const { data: allQuotes, error: allQuotesError } = await supabase
      .from("quotes")
      .select("id")
      .eq("author_id", senecaAuthorId);

    if (allQuotesError) {
      throw new Error(`Failed to get all quotes: ${allQuotesError.message}`);
    }

    const allQuoteIds = (allQuotes || []).map(q => q.id);
    console.log(`   ✅ Found ${allQuoteIds.length} total quotes`);

    console.log('\n📝 Step 2: Get posted quotes for this account...');
    const { data: postedQuotes, error: postedQuotesError } = await supabase
      .from("quote_posts")
      .select("quote_id")
      .eq("mastodon_account_id", senecaAccountId);

    if (postedQuotesError) {
      throw new Error(`Failed to get posted quotes: ${postedQuotesError.message}`);
    }

    const postedQuoteIds = new Set((postedQuotes || []).map(p => p.quote_id));
    const unpostedQuoteIds = allQuoteIds.filter(id => !postedQuoteIds.has(id));

    console.log(`   ✅ Posted: ${postedQuoteIds.size}, Unposted: ${unpostedQuoteIds.length}`);

    if (unpostedQuoteIds.length === 0) {
      console.log('\n⚠️  No unposted quotes! Testing repost logic...');
      
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
        return;
      }

      if (oldestPost && oldestPost.length > 0) {
        const post = oldestPost[0] as any;
        console.log(`   ✅ Found oldest post: ${post.quote_id}`);
        if (post.quotes) {
          console.log(`      Quote text: ${post.quotes.text.substring(0, 100)}...`);
          console.log(`      Author: ${post.quotes.quote_authors.name}`);
        }
      }
      return;
    }

    console.log('\n📝 Step 3: Test unposted quote query (with join)...');
    console.log(`   Testing with first 10 unposted IDs...`);
    
    const testIds = unpostedQuoteIds.slice(0, 10);
    const { data: unpostedQuotes, error: unpostedError } = await supabase
      .from("quotes")
      .select(`
        id, 
        text,
        quote_authors!inner(name, category)
      `)
      .eq("author_id", senecaAuthorId)
      .in("id", testIds)
      .order("created_at", { ascending: true })
      .limit(1);

    if (unpostedError) {
      console.log(`   ❌ ERROR: ${JSON.stringify(unpostedError, null, 2)}`);
      console.log('\n   Testing without join...');
      
      const { data: simpleQuotes, error: simpleError } = await supabase
        .from("quotes")
        .select("id, text")
        .eq("author_id", senecaAuthorId)
        .in("id", testIds)
        .order("created_at", { ascending: true })
        .limit(1);

      if (simpleError) {
        console.log(`   ❌ ERROR (simple): ${JSON.stringify(simpleError, null, 2)}`);
      } else if (simpleQuotes && simpleQuotes.length > 0) {
        console.log(`   ✅ Found quote without join: ${simpleQuotes[0].id}`);
        console.log(`      Text: ${simpleQuotes[0].text.substring(0, 100)}...`);
      }
    } else if (unpostedQuotes && unpostedQuotes.length > 0) {
      console.log(`   ✅ Found unposted quote with join: ${unpostedQuotes[0].id}`);
      console.log(`      Text: ${unpostedQuotes[0].text.substring(0, 100)}...`);
      const quote = unpostedQuotes[0] as any;
      if (quote.quote_authors) {
        console.log(`      Author: ${quote.quote_authors.name}`);
        console.log(`      Category: ${quote.quote_authors.category || 'N/A'}`);
      }
    } else {
      console.log(`   ⚠️  Query returned no results`);
    }

    console.log('\n📝 Step 4: Test with ALL unposted IDs (might hit limit)...');
    const { data: allUnposted, error: allUnpostedError } = await supabase
      .from("quotes")
      .select(`
        id, 
        text,
        quote_authors!inner(name, category)
      `)
      .eq("author_id", senecaAuthorId)
      .in("id", unpostedQuoteIds)
      .order("created_at", { ascending: true })
      .limit(1);

    if (allUnpostedError) {
      console.log(`   ❌ ERROR: ${JSON.stringify(allUnpostedError, null, 2)}`);
      console.log(`   ⚠️  This might be the issue - the .in() query might be too large!`);
    } else if (allUnposted && allUnposted.length > 0) {
      console.log(`   ✅ Found quote with all IDs: ${allUnposted[0].id}`);
    } else {
      console.log(`   ⚠️  No results with all IDs`);
    }

    console.log('');
    console.log('═'.repeat(70));

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

testQuoteSelection().catch((err) => {
  console.error('❌ Unexpected error:', err);
  process.exit(1);
});

