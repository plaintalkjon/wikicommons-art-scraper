#!/usr/bin/env node
/**
 * Check quotes data structure and query issues
 */

import { supabase } from './config';

async function checkQuotesData(): Promise<void> {
  console.log('🔍 Checking Quotes Data Structure...');
  console.log('═'.repeat(70));
  console.log('');

  try {
    // Check Nietzsche account
    const nietzscheAccountId = 'fcb57d84-958d-4b8f-9766-3cee3d51500b';
    const nietzscheAuthorId = 'e9a83be8-993e-450b-ba71-1ab80ade3bd0';

    console.log('📚 Checking Nietzsche quotes...');
    console.log(`   Author ID: ${nietzscheAuthorId}`);
    console.log('');

    // Test the exact query from the edge function
    console.log('1. Testing unposted quotes query (with join)...');
    const { data: unpostedQuotes, error: unpostedError } = await supabase
      .from("quotes")
      .select(`
        id, 
        text, 
        posted_at,
        quote_authors!inner(name, category)
      `)
      .eq("author_id", nietzscheAuthorId)
      .is("posted_at", null)
      .order("created_at", { ascending: true })
      .limit(1);

    if (unpostedError) {
      console.log(`   ❌ ERROR: ${JSON.stringify(unpostedError, null, 2)}`);
    } else {
      console.log(`   ✅ Found ${unpostedQuotes?.length || 0} unposted quotes`);
      if (unpostedQuotes && unpostedQuotes.length > 0) {
        console.log(`   Sample: ${JSON.stringify(unpostedQuotes[0], null, 2).substring(0, 200)}...`);
      }
    }

    console.log('');

    // Test without join
    console.log('2. Testing unposted quotes query (without join)...');
    const { data: unpostedSimple, error: unpostedSimpleError } = await supabase
      .from("quotes")
      .select("id, text, posted_at, author_id")
      .eq("author_id", nietzscheAuthorId)
      .is("posted_at", null)
      .order("created_at", { ascending: true })
      .limit(5);

    if (unpostedSimpleError) {
      console.log(`   ❌ ERROR: ${JSON.stringify(unpostedSimpleError, null, 2)}`);
    } else {
      console.log(`   ✅ Found ${unpostedSimple?.length || 0} unposted quotes`);
    }

    console.log('');

    // Test posted quotes query
    console.log('3. Testing posted quotes query (with join)...');
    const { data: postedQuotes, error: postedError } = await supabase
      .from("quotes")
      .select(`
        id, 
        text, 
        posted_at,
        quote_authors!inner(name, category)
      `)
      .eq("author_id", nietzscheAuthorId)
      .not("posted_at", "is", null)
      .order("posted_at", { ascending: true })
      .limit(1);

    if (postedError) {
      console.log(`   ❌ ERROR: ${JSON.stringify(postedError, null, 2)}`);
    } else {
      console.log(`   ✅ Found ${postedQuotes?.length || 0} posted quotes`);
      if (postedQuotes && postedQuotes.length > 0) {
        console.log(`   Sample: ${JSON.stringify(postedQuotes[0], null, 2).substring(0, 200)}...`);
      }
    }

    console.log('');

    // Check quote structure
    console.log('4. Checking quote table structure...');
    const { data: sampleQuote, error: sampleError } = await supabase
      .from("quotes")
      .select("*")
      .eq("author_id", nietzscheAuthorId)
      .limit(1)
      .single();

    if (sampleError) {
      console.log(`   ⚠️  Could not get sample quote: ${sampleError.message}`);
    } else {
      console.log(`   ✅ Sample quote structure:`);
      console.log(`      Keys: ${Object.keys(sampleQuote || {}).join(', ')}`);
      if (sampleQuote) {
        console.log(`      Has posted_at: ${'posted_at' in sampleQuote}`);
        console.log(`      Has author_id: ${'author_id' in sampleQuote}`);
      }
    }

    console.log('');

    // Check quote_authors relationship
    console.log('5. Checking quote_authors relationship...');
    const { data: author, error: authorError } = await supabase
      .from("quote_authors")
      .select("id, name, category")
      .eq("id", nietzscheAuthorId)
      .single();

    if (authorError) {
      console.log(`   ❌ ERROR: ${JSON.stringify(authorError, null, 2)}`);
    } else {
      console.log(`   ✅ Author found: ${author?.name}`);
      console.log(`      Category: ${author?.category || 'N/A'}`);
    }

    console.log('');
    console.log('═'.repeat(70));

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkQuotesData().catch((err) => {
  console.error('❌ Unexpected error:', err);
  process.exit(1);
});

