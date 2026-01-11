#!/usr/bin/env node
/**
 * Check Supabase Cron Jobs
 * 
 * Queries the cron.job system table to list all active cron jobs
 * 
 * Usage:
 *   npm run check-cron-jobs
 */

import { config, supabase } from './config';

interface CronJob {
  jobid: number;
  schedule: string;
  command: string;
  nodename: string;
  nodeport: number;
  database: string;
  username: string;
  active: boolean;
  jobname: string | null;
}

async function checkCronJobs(): Promise<void> {
  console.log('⏰ Checking Supabase Cron Jobs');
  console.log('═'.repeat(70));
  console.log('');

  try {
    // Use Supabase RPC function to query cron.job table
    // Note: You need to run create-get-cron-jobs-rpc.sql first in Supabase SQL Editor
    console.log('📡 Querying cron jobs from Supabase...');
    console.log('   Using RPC function: get_cron_jobs()');
    console.log('');

    const { data: jobs, error: rpcError } = await supabase.rpc('get_cron_jobs') as { data: CronJob[] | null; error: any };

    if (rpcError) {
      throw rpcError;
    }

    if (!jobs) {
      throw new Error('No data returned from RPC function');
    }

    if (jobs.length === 0) {
      console.log('⚠️  No cron jobs found.');
      console.log('');
      console.log('💡 Tip: Cron jobs are created using SQL in the Supabase SQL Editor.');
      console.log('   Example: SELECT cron.schedule(...)');
      return;
    }

    console.log(`✅ Found ${jobs.length} cron job(s):\n`);

    jobs.forEach((job: CronJob, index: number) => {
      console.log(`${index + 1}. ${job.jobname || `Job #${job.jobid}`}`);
      console.log(`   Job ID: ${job.jobid}`);
      console.log(`   Schedule: ${job.schedule}`);
      console.log(`   Active: ${job.active ? '✅ Yes' : '❌ No'}`);
      console.log(`   Database: ${job.database}`);
      console.log(`   Username: ${job.username}`);
      
      // Try to extract function URL from command if it's a net.http_post
      const commandStr = typeof job.command === 'string' ? job.command : JSON.stringify(job.command);
      const urlMatch = commandStr.match(/url\s*:=\s*['"]([^'"]+)['"]/);
      if (urlMatch) {
        console.log(`   Function URL: ${urlMatch[1]}`);
      }
      
      console.log('');
    });

    // Summary
    const activeJobs = jobs.filter((j: CronJob) => j.active);
    const inactiveJobs = jobs.filter((j: CronJob) => !j.active);
    
    console.log('═'.repeat(70));
    console.log('Summary:');
    console.log(`  Total Jobs: ${jobs.length}`);
    console.log(`  Active: ${activeJobs.length}`);
    console.log(`  Inactive: ${inactiveJobs.length}`);
    
    // Filter MTG-related jobs
    const mtgJobs = jobs.filter((j: CronJob) => 
      j.jobname && (j.jobname.includes('mtg') || j.jobname.includes('yugioh') || j.jobname.includes('pokemon'))
    );
    
    if (mtgJobs.length > 0) {
      console.log('');
      console.log('🎮 Card Bot Jobs:');
      mtgJobs.forEach((job: CronJob) => {
        console.log(`  - ${job.jobname} (${job.active ? 'active' : 'inactive'})`);
      });
    }

  } catch (error: any) {
    console.error('❌ Error querying cron jobs:');
    
    if (error.code === 'P0004' || error.message?.includes('not found') || error.message?.includes('function')) {
      // RPC function doesn't exist
      console.error(`   ${error.message || error}`);
      console.error('');
      console.error('💡 RPC function not found. You need to create it first:');
      console.error('');
      console.error('   1. Go to Supabase Dashboard → SQL Editor');
      console.error('   2. Run the SQL from: create-get-cron-jobs-rpc.sql');
      console.error('   3. Then run this script again');
      console.error('');
      console.error('   Or query directly in SQL Editor:');
      console.error('   SELECT jobid, jobname, schedule, active FROM cron.job;');
    } else if (error.code === '42501' || error.message?.includes('permission')) {
      console.error(`   ${error.message || error}`);
      console.error('');
      console.error('💡 Permission denied. System tables may require direct SQL access.');
      console.error('   Use Supabase SQL Editor to query:');
      console.error('');
      console.error('   SELECT jobid, jobname, schedule, active FROM cron.job;');
    } else {
      console.error(`   ${error.message || error}`);
    }
    
    console.error('');
    console.error('💡 Alternative: Query cron jobs directly in Supabase SQL Editor:');
    console.error('');
    console.error('   SELECT');
    console.error('     jobid,');
    console.error('     jobname,');
    console.error('     schedule,');
    console.error('     active,');
    console.error('     command::text');
    console.error('   FROM cron.job');
    console.error('   ORDER BY jobname;');
    
    process.exit(1);
  }
}

async function main() {
  await checkCronJobs();
}

main().catch((err) => {
  console.error('❌ Unexpected error:', err);
  process.exit(1);
});

