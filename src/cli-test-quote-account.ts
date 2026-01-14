#!/usr/bin/env node
/**
 * Test a quote account by manually triggering the post-art function
 */

import { config } from './config';

async function testQuoteAccount(username: string): Promise<void> {
  console.log(`🧪 Testing quote account: ${username}`);
  console.log('═'.repeat(70));
  console.log('');

  const functionUrl = `${config.supabaseUrl}/functions/v1/post-art?account=${username}`;
  
  console.log(`📡 Calling function: ${functionUrl}`);
  console.log('');

  try {
    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.supabaseServiceRoleKey}`,
        'Content-Type': 'application/json',
      },
    });

    const responseText = await response.text();
    
    console.log(`📊 Response Status: ${response.status} ${response.statusText}`);
    console.log('');
    
    if (response.ok) {
      console.log('✅ Success! Response:');
      try {
        const json = JSON.parse(responseText);
        console.log(JSON.stringify(json, null, 2));
      } catch {
        console.log(responseText);
      }
    } else {
      console.log('❌ Error Response:');
      console.log(responseText);
    }
  } catch (error: any) {
    console.error('❌ Error calling function:', error.message);
    process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const username = args[0];

  if (!username) {
    console.error('❌ Usage: npm run test-quote-account -- <username>');
    console.error('   Example: npm run test-quote-account -- CuratedMarcusAurelius');
    process.exit(1);
  }

  await testQuoteAccount(username);
}

main().catch((err) => {
  console.error('❌ Unexpected error:', err);
  process.exit(1);
});

