#!/usr/bin/env node
/**
 * Test MTG and Yu-Gi-Oh posting functions manually
 */

const SUPABASE_URL = 'https://lxtkpwsxupzkxuhhmvvz.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4dGtwd3N4dXB6a3h1aGhtdnZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUxMTY2OTQsImV4cCI6MjA4MDY5MjY5NH0.TpaMU7-7-U7BSyjqPkfiGjpHFB6qVt1dMUxG5KFptR8';

async function testMTGPosting(): Promise<void> {
  console.log('🃏 Testing MTG posting function...');
  console.log('═'.repeat(70));
  
  try {
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/post-mtg-card?interval_hours=6`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ANON_KEY}`,
        },
      }
    );

    const result = await response.json();
    
    if (response.ok) {
      console.log('✅ MTG Function Response:');
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.error('❌ MTG Function Error:');
      console.error(JSON.stringify(result, null, 2));
    }
  } catch (error: any) {
    console.error('❌ MTG Function Exception:', error.message);
  }
  
  console.log('');
}

async function testYugiohPosting(): Promise<void> {
  console.log('🃏 Testing Yu-Gi-Oh posting function...');
  console.log('═'.repeat(70));
  
  try {
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/post-yugioh-card?interval_hours=6`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ANON_KEY}`,
        },
      }
    );

    const result = await response.json();
    
    if (response.ok) {
      console.log('✅ Yu-Gi-Oh Function Response:');
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.error('❌ Yu-Gi-Oh Function Error:');
      console.error(JSON.stringify(result, null, 2));
    }
  } catch (error: any) {
    console.error('❌ Yu-Gi-Oh Function Exception:', error.message);
  }
  
  console.log('');
}

async function main(): Promise<void> {
  console.log('🧪 Testing MTG and Yu-Gi-Oh Posting Functions');
  console.log('═'.repeat(70));
  console.log('');
  
  await testMTGPosting();
  await testYugiohPosting();
  
  console.log('═'.repeat(70));
  console.log('✅ Testing Complete');
  console.log('═'.repeat(70));
}

main().catch((err) => {
  console.error('❌ Unexpected error:', err);
  process.exit(1);
});

