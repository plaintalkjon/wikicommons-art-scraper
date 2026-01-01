#!/usr/bin/env node
/**
 * Manually trigger the cron system (temporary workaround).
 *
 * Usage:
 *   npm run trigger-cron
 */

import { supabase } from './config';

async function triggerCron() {
  console.log('🚀 MANUALLY TRIGGERING CRON SYSTEM\n');

  try {
    // Call the post-art function directly
    console.log('Calling post-art function...');

    // Note: This will likely fail with 401 since cron functions require special auth,
    // but let's try anyway
    const { data, error } = await supabase.functions.invoke('post-art', {
      body: {},
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (error) {
      console.log('❌ Function call failed (expected - cron functions need dashboard auth)');
      console.log('Error:', error.message);
      console.log('\n🔧 SOLUTION: Configure cron in Supabase Dashboard');
      console.log('   Go to: https://supabase.com/dashboard/project/YOUR_PROJECT/edge-functions');
      console.log('   Set cron schedule: "*/10 * * * *" (every 10 minutes)');
      console.log('   Function: post-art');
      console.log('   Status: Enabled');
    } else {
      console.log('✅ Function called successfully!');
      console.log('Result:', data);
    }

  } catch (err) {
    console.log('❌ Exception:', err instanceof Error ? err.message : String(err));
    console.log('\n🔧 The cron system requires configuration in the Supabase web dashboard.');
    console.log('   Manual triggering is not supported due to authentication requirements.');
  }

  console.log('\n📋 TO FIX THIS PERMANENTLY:');
  console.log('1. Open Supabase Dashboard');
  console.log('2. Go to Edge Functions → Cron Jobs');
  console.log('3. Create/edit the post-art cron:');
  console.log('   - Schedule: "*/10 * * * *"');
  console.log('   - Function: post-art');
  console.log('   - Status: Enabled');
  console.log('4. Run "npm run test-cron" to verify it\'s working');
}

triggerCron().catch(console.error);
