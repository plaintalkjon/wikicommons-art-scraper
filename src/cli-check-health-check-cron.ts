#!/usr/bin/env node
/**
 * Check if the health check cron job is set up
 */

import { supabase } from './config';

async function checkHealthCheckCron(): Promise<void> {
  console.log('🔍 Checking health check cron job setup...');
  console.log('═'.repeat(70));
  console.log('');

  try {
    // Try to use RPC function if available
    const { data: jobs, error: rpcError } = await supabase.rpc('get_cron_jobs') as { data: any[] | null; error: any };

    if (rpcError) {
      console.log('⚠️  Could not query cron jobs via RPC');
      console.log('   You may need to run create-get-cron-jobs-rpc.sql first');
      console.log('');
      console.log('📋 To check manually, run this SQL in Supabase SQL Editor:');
      console.log('   SELECT jobname, schedule, active, command::text');
      console.log('   FROM cron.job');
      console.log('   WHERE jobname = \'post-art-health-check\';');
      console.log('');
      return;
    }

    if (!jobs || jobs.length === 0) {
      console.log('⚠️  No cron jobs found');
      console.log('');
      console.log('📋 To set up the health check cron job:');
      console.log('   1. Go to Supabase Dashboard → SQL Editor');
      console.log('   2. Run: create-post-art-health-check-cron.sql');
      console.log('');
      return;
    }

    const healthCheckJob = jobs.find((j: any) => j.jobname === 'post-art-health-check');

    if (!healthCheckJob) {
      console.log('❌ Health check cron job NOT FOUND');
      console.log('');
      console.log('📋 To set up the health check cron job:');
      console.log('   1. Go to Supabase Dashboard → SQL Editor');
      console.log('   2. Run: create-post-art-health-check-cron.sql');
      console.log('');
      console.log('📋 Found cron jobs:');
      jobs.forEach((job: any) => {
        console.log(`   - ${job.jobname} (${job.active ? '✅ active' : '❌ inactive'})`);
      });
      return;
    }

    console.log('✅ Health check cron job FOUND');
    console.log('');
    console.log('Details:');
    console.log(`   Job Name: ${healthCheckJob.jobname}`);
    console.log(`   Schedule: ${healthCheckJob.schedule}`);
    console.log(`   Active: ${healthCheckJob.active ? '✅ Yes' : '❌ No'}`);
    console.log(`   Job ID: ${healthCheckJob.jobid}`);
    
    // Extract function URL from command
    const commandStr = typeof healthCheckJob.command === 'string' 
      ? healthCheckJob.command 
      : JSON.stringify(healthCheckJob.command);
    const urlMatch = commandStr.match(/url\s*:=\s*['"]([^'"]+)['"]/);
    if (urlMatch) {
      console.log(`   Function URL: ${urlMatch[1]}`);
    }

    console.log('');
    console.log('═'.repeat(70));
    
    if (healthCheckJob.active) {
      console.log('✅ Health check cron job is ACTIVE and will run automatically');
    } else {
      console.log('⚠️  Health check cron job exists but is INACTIVE');
      console.log('   You may need to activate it in Supabase Dashboard');
    }

  } catch (error: any) {
    console.error('❌ Error checking cron job:', error.message);
    console.error('');
    console.error('📋 To check manually, run this SQL in Supabase SQL Editor:');
    console.error('   SELECT jobname, schedule, active, command::text');
    console.error('   FROM cron.job');
    console.error('   WHERE jobname = \'post-art-health-check\';');
  }
}

checkHealthCheckCron().catch((err) => {
  console.error('❌ Unexpected error:', err);
  process.exit(1);
});

