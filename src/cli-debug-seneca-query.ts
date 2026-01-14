#!/usr/bin/env node
/**
 * Debug the exact query that the edge function uses
 */

import { supabase } from './config';

async function debugSenecaQuery(): Promise<void> {
  console.log('🔍 Debugging Edge Function Query Logic...');
  console.log('═'.repeat(70));
  console.log('');

  try {
    const intervalHours = 6;
    const now = new Date();
    const intervalMs = intervalHours * 60 * 60 * 1000;
    const cutoffTime = new Date(now.getTime() - intervalMs);

    console.log(`Now: ${now.toISOString()}`);
    console.log(`Cutoff: ${cutoffTime.toISOString()}`);
    console.log(`Interval: ${intervalHours} hours`);
    console.log('');

    // Test never-posted query
    console.log('📝 Never-posted query:');
    const { data: neverPosted, error: neverError } = await supabase
      .from("mastodon_accounts")
      .select("*")
      .eq("active", true)
      .in("account_type", ["artist", "tag", "quote"])
      .is("last_posted_at", null)
      .order("created_at", { ascending: true })
      .limit(20);

    if (neverError) {
      console.log(`   ❌ ERROR: ${JSON.stringify(neverError, null, 2)}`);
    } else {
      console.log(`   ✅ Found ${neverPosted?.length || 0} accounts`);
      const seneca = neverPosted?.find(a => a.account_username === 'CuratedSeneca');
      console.log(`   Seneca in results: ${seneca ? '✅ YES' : '❌ NO'}`);
    }

    console.log('');

    // Test old-posted query
    console.log('📝 Old-posted query:');
    console.log(`   Cutoff: ${cutoffTime.toISOString()}`);
    
    const { data: oldPosted, error: oldError } = await supabase
      .from("mastodon_accounts")
      .select("*")
      .eq("active", true)
      .in("account_type", ["artist", "tag", "quote"])
      .not("last_posted_at", "is", null)
      .lt("last_posted_at", cutoffTime.toISOString())
      .order("last_posted_at", { ascending: true })
      .limit(20);

    if (oldError) {
      console.log(`   ❌ ERROR: ${JSON.stringify(oldError, null, 2)}`);
    } else {
      console.log(`   ✅ Found ${oldPosted?.length || 0} accounts`);
      const seneca = oldPosted?.find(a => a.account_username === 'CuratedSeneca');
      if (seneca) {
        console.log(`   ✅ Seneca found!`);
        console.log(`      Last posted: ${seneca.last_posted_at}`);
        const lastPost = new Date(seneca.last_posted_at);
        console.log(`      Last post date: ${lastPost.toISOString()}`);
        console.log(`      Is before cutoff: ${lastPost < cutoffTime ? '✅ YES' : '❌ NO'}`);
        console.log(`      Comparison: ${lastPost.toISOString()} < ${cutoffTime.toISOString()}`);
      } else {
        console.log(`   ❌ Seneca NOT found`);
        
        // Check Seneca directly
        const { data: senecaDirect, error: senecaError } = await supabase
          .from("mastodon_accounts")
          .select("*")
          .eq("account_username", "CuratedSeneca")
          .single();

        if (!senecaError && senecaDirect) {
          console.log(`   Checking Seneca directly:`);
          console.log(`      Last posted: ${senecaDirect.last_posted_at}`);
          if (senecaDirect.last_posted_at) {
            const lastPost = new Date(senecaDirect.last_posted_at);
            const cutoff = new Date(cutoffTime.toISOString());
            console.log(`      Last post: ${lastPost.toISOString()}`);
            console.log(`      Cutoff: ${cutoff.toISOString()}`);
            console.log(`      Comparison result: ${lastPost.getTime()} < ${cutoff.getTime()} = ${lastPost < cutoff}`);
            console.log(`      Hours difference: ${(now.getTime() - lastPost.getTime()) / (1000 * 60 * 60)}`);
          }
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

debugSenecaQuery().catch((err) => {
  console.error('❌ Unexpected error:', err);
  process.exit(1);
});

