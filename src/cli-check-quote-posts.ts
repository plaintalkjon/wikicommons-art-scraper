#!/usr/bin/env node
/**
 * Check quote_posts table structure
 */

import { supabase } from './config';

async function checkQuotePosts(): Promise<void> {
  console.log('🔍 Checking quote_posts table...');
  console.log('═'.repeat(70));
  console.log('');

  try {
    const nietzscheAccountId = 'fcb57d84-958d-4b8f-9766-3cee3d51500b';
    const nietzscheAuthorId = 'e9a83be8-993e-450b-ba71-1ab80ade3bd0';

    // Check quote_posts structure
    console.log('1. Checking quote_posts table structure...');
    const { data: samplePost, error: sampleError } = await supabase
      .from("quote_posts")
      .select("*")
      .eq("mastodon_account_id", nietzscheAccountId)
      .limit(1)
      .maybeSingle();

    if (sampleError) {
      console.log(`   ❌ ERROR: ${JSON.stringify(sampleError, null, 2)}`);
    } else if (samplePost) {
      console.log(`   ✅ Sample quote_post structure:`);
      console.log(`      Keys: ${Object.keys(samplePost).join(', ')}`);
      console.log(`      Sample: ${JSON.stringify(samplePost, null, 2)}`);
    } else {
      console.log(`   ⚠️  No quote_posts found for this account`);
    }

    console.log('');

    // Check which quotes have been posted
    console.log('2. Checking posted quotes via quote_posts...');
    const { data: postedQuotes, error: postedError } = await supabase
      .from("quote_posts")
      .select("quote_id, posted_at")
      .eq("mastodon_account_id", nietzscheAccountId)
      .order("posted_at", { ascending: true })
      .limit(5);

    if (postedError) {
      console.log(`   ❌ ERROR: ${JSON.stringify(postedError, null, 2)}`);
    } else {
      console.log(`   ✅ Found ${postedQuotes?.length || 0} posted quotes`);
      if (postedQuotes && postedQuotes.length > 0) {
        console.log(`   Oldest posted: ${postedQuotes[0].posted_at}`);
      }
    }

    console.log('');

    // Check unposted quotes (quotes not in quote_posts for this account)
    console.log('3. Finding unposted quotes (not in quote_posts for this account)...');
    const { data: allQuotes, error: allQuotesError } = await supabase
      .from("quotes")
      .select("id")
      .eq("author_id", nietzscheAuthorId);

    if (allQuotesError) {
      console.log(`   ❌ ERROR getting all quotes: ${allQuotesError.message}`);
    } else {
      const allQuoteIds = (allQuotes || []).map(q => q.id);
      console.log(`   Total quotes: ${allQuoteIds.length}`);

      const { data: postedIds, error: postedIdsError } = await supabase
        .from("quote_posts")
        .select("quote_id")
        .eq("mastodon_account_id", nietzscheAccountId);

      if (postedIdsError) {
        console.log(`   ❌ ERROR getting posted IDs: ${postedIdsError.message}`);
      } else {
        const postedQuoteIds = new Set((postedIds || []).map(p => p.quote_id));
        const unpostedIds = allQuoteIds.filter(id => !postedQuoteIds.has(id));
        console.log(`   Posted quotes: ${postedQuoteIds.size}`);
        console.log(`   Unposted quotes: ${unpostedIds.length}`);
        if (unpostedIds.length > 0) {
          console.log(`   First unposted ID: ${unpostedIds[0]}`);
        }
      }
    }

    console.log('');
    console.log('═'.repeat(70));

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkQuotePosts().catch((err) => {
  console.error('❌ Unexpected error:', err);
  process.exit(1);
});

