#!/usr/bin/env node
/**
 * Test if Seneca would be selected by the cron query
 */

import { supabase } from './config';

async function testSenecaQuery(): Promise<void> {
  console.log('🔍 Testing if Seneca would be selected by cron query...');
  console.log('═'.repeat(70));
  console.log('');

  try {
    const intervalHours = 6;
    const now = new Date();
    const cutoffTime = new Date(now.getTime() - intervalHours * 60 * 60 * 1000);

    console.log(`Current time: ${now.toISOString()}`);
    console.log(`Cutoff time: ${cutoffTime.toISOString()}`);
    console.log(`Interval: ${intervalHours} hours`);
    console.log('');

    // Test the exact query from the edge function
    console.log('📝 Testing never-posted accounts query...');
    const { data: neverPosted, error: neverPostedError } = await supabase
      .from("mastodon_accounts")
      .select("*")
      .eq("active", true)
      .in("account_type", ["artist", "tag", "quote"])
      .is("last_posted_at", null)
      .order("created_at", { ascending: true })
      .limit(10);

    if (neverPostedError) {
      console.log(`   ❌ ERROR: ${JSON.stringify(neverPostedError, null, 2)}`);
    } else {
      console.log(`   ✅ Found ${neverPosted?.length || 0} never-posted accounts`);
      const senecaInNever = neverPosted?.find(a => a.account_username === 'CuratedSeneca');
      if (senecaInNever) {
        console.log(`   ✅ Seneca found in never-posted list`);
      } else {
        console.log(`   ❌ Seneca NOT in never-posted list`);
      }
    }

    console.log('');

    console.log('📝 Testing old-posted accounts query...');
    const { data: oldPosted, error: oldPostedError } = await supabase
      .from("mastodon_accounts")
      .select("*")
      .eq("active", true)
      .in("account_type", ["artist", "tag", "quote"])
      .not("last_posted_at", "is", null)
      .lt("last_posted_at", cutoffTime.toISOString())
      .order("last_posted_at", { ascending: true })
      .limit(10);

    if (oldPostedError) {
      console.log(`   ❌ ERROR: ${JSON.stringify(oldPostedError, null, 2)}`);
    } else {
      console.log(`   ✅ Found ${oldPosted?.length || 0} old-posted accounts`);
      const senecaInOld = oldPosted?.find(a => a.account_username === 'CuratedSeneca');
      if (senecaInOld) {
        console.log(`   ✅ Seneca found in old-posted list`);
        console.log(`      Last posted: ${senecaInOld.last_posted_at}`);
        const hoursAgo = (Date.now() - new Date(senecaInOld.last_posted_at).getTime()) / (1000 * 60 * 60);
        console.log(`      Hours ago: ${hoursAgo.toFixed(1)}`);
      } else {
        console.log(`   ❌ Seneca NOT in old-posted list`);
      }
    }

    console.log('');

    // Check Seneca's exact last_posted_at value
    console.log('📝 Checking Seneca account directly...');
    const { data: seneca, error: senecaError } = await supabase
      .from("mastodon_accounts")
      .select("*")
      .eq("account_username", "CuratedSeneca")
      .single();

    if (senecaError) {
      console.log(`   ❌ ERROR: ${senecaError.message}`);
    } else {
      console.log(`   Account: ${seneca.account_username}`);
      console.log(`   Active: ${seneca.active}`);
      console.log(`   Account Type: ${seneca.account_type}`);
      console.log(`   Last Posted At: ${seneca.last_posted_at}`);
      
      if (seneca.last_posted_at) {
        const lastPostDate = new Date(seneca.last_posted_at);
        const hoursAgo = (Date.now() - lastPostDate.getTime()) / (1000 * 60 * 60);
        const isBeforeCutoff = lastPostDate < cutoffTime;
        
        console.log(`   Hours Since Last Post: ${hoursAgo.toFixed(1)}`);
        console.log(`   Is Before Cutoff: ${isBeforeCutoff ? '✅ YES' : '❌ NO'}`);
        console.log(`   Would Be Selected: ${isBeforeCutoff && seneca.active ? '✅ YES' : '❌ NO'}`);
      } else {
        console.log(`   Would Be Selected: ${seneca.active ? '✅ YES (never posted)' : '❌ NO (inactive)'}`);
      }
    }

    console.log('');
    console.log('═'.repeat(70));

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

testSenecaQuery().catch((err) => {
  console.error('❌ Unexpected error:', err);
  process.exit(1);
});

