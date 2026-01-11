#!/usr/bin/env node
/**
 * Verify Cron Jobs Setup and Compare with Documentation
 * 
 * This script attempts to query cron jobs and compares with documented expectations
 */

import { config, supabase } from './config';
import axios from 'axios';

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

interface ExpectedCronJob {
  name: string;
  schedule: string;
  functionUrl: string;
  botType?: string;
  description: string;
}

// Expected cron jobs based on actual setup
const EXPECTED_CRON_JOBS: ExpectedCronJob[] = [
  {
    name: 'post-art-task',
    schedule: '0 */6 * * *', // Typical schedule (may vary)
    functionUrl: 'post-art',
    description: 'Posts artwork to Mastodon for artist, tag, and philosopher accounts'
  },
  {
    name: 'post-mtg-card',
    schedule: '0 */6 * * *',
    functionUrl: 'post-mtg-card',
    description: 'Posts MTG cards for ALL MTG bot accounts (unified, auto-detects bot types)'
  }
];

async function tryQueryCronJobs(): Promise<CronJob[] | null> {
  console.log('🔍 Attempting to query cron jobs...\n');

  // Method 1: Try RPC function
  try {
    const { data, error } = await supabase.rpc('get_cron_jobs') as { data: CronJob[] | null; error: any };
    if (!error && data) {
      console.log('✅ Successfully queried via RPC function\n');
      return data;
    }
  } catch (err) {
    // RPC doesn't exist, continue to other methods
  }

  // Method 2: Try direct REST API (won't work but worth trying)
  try {
    const response = await axios.get(`${config.supabaseUrl}/rest/v1/cron.job?select=*`, {
      headers: {
        'apikey': config.supabaseServiceRoleKey,
        'Authorization': `Bearer ${config.supabaseServiceRoleKey}`,
      },
    });
    if (response.data) {
      console.log('✅ Successfully queried via REST API\n');
      return response.data;
    }
  } catch (err) {
    // Won't work, continue
  }

  return null;
}

function extractFunctionUrl(command: string): string {
  const urlMatch = command.match(/url\s*:=\s*['"]([^'"]+)['"]/);
  return urlMatch ? urlMatch[1] : 'unknown';
}

function compareWithExpected(actualJobs: CronJob[]): void {
  console.log('═'.repeat(70));
  console.log('📊 COMPARISON: Expected vs Actual');
  console.log('═'.repeat(70));
  console.log('');

  const actualJobMap = new Map<string, CronJob>();
  actualJobs.forEach(job => {
    if (job.jobname) {
      actualJobMap.set(job.jobname, job);
    }
  });

  console.log('Expected Cron Jobs:');
  EXPECTED_CRON_JOBS.forEach(expected => {
    const actual = actualJobMap.get(expected.name);
    const status = actual ? (actual.active ? '✅ ACTIVE' : '⚠️  INACTIVE') : '❌ MISSING';
    console.log(`\n  ${expected.name}: ${status}`);
    console.log(`    Description: ${expected.description}`);
    console.log(`    Expected Schedule: ${expected.schedule}`);
    
    if (actual) {
      console.log(`    Actual Schedule: ${actual.schedule}`);
      const functionUrl = extractFunctionUrl(typeof actual.command === 'string' ? actual.command : JSON.stringify(actual.command));
      console.log(`    Function URL: ${functionUrl}`);
      
      // Check if schedule matches
      if (actual.schedule !== expected.schedule) {
        console.log(`    ⚠️  Schedule mismatch!`);
      }
      
      // Check if function URL matches
      const expectedUrl = expected.functionUrl.includes('?') 
        ? `https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/${expected.functionUrl}`
        : `https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/${expected.functionUrl}`;
      
      if (!functionUrl.includes(expected.functionUrl.split('?')[0])) {
        console.log(`    ⚠️  Function URL mismatch!`);
        console.log(`        Expected: ${expectedUrl}`);
        console.log(`        Actual: ${functionUrl}`);
      }
    } else {
      console.log(`    ❌ Job not found in database`);
    }
  });

  // Check for unexpected jobs
  const expectedNames = new Set(EXPECTED_CRON_JOBS.map(e => e.name));
  const unexpectedJobs = actualJobs.filter(job => job.jobname && !expectedNames.has(job.jobname));
  
  if (unexpectedJobs.length > 0) {
    console.log('\n⚠️  Unexpected Cron Jobs Found:');
    unexpectedJobs.forEach(job => {
      console.log(`  - ${job.jobname} (${job.active ? 'active' : 'inactive'})`);
      console.log(`    Schedule: ${job.schedule}`);
    });
  }
}

async function main() {
  console.log('🔍 Verifying Cron Jobs Setup');
  console.log('═'.repeat(70));
  console.log('');

  const actualJobs = await tryQueryCronJobs();

  if (!actualJobs || actualJobs.length === 0) {
    console.log('❌ Could not query cron jobs automatically.');
    console.log('');
    console.log('📋 To verify cron jobs manually:');
    console.log('   1. Go to Supabase Dashboard → SQL Editor');
    console.log('   2. Run: SELECT jobid, jobname, schedule, active, command::text FROM cron.job ORDER BY jobname;');
    console.log('');
    console.log('📋 Expected Cron Jobs (based on documentation):');
    EXPECTED_CRON_JOBS.forEach(job => {
      console.log(`   - ${job.name}: ${job.schedule} → ${job.functionUrl}`);
    });
    console.log('');
    console.log('💡 To enable automatic querying:');
    console.log('   1. Run create-get-cron-jobs-rpc.sql in Supabase SQL Editor');
    console.log('   2. Then run: npm run check-cron-jobs');
    process.exit(1);
  }

  console.log(`✅ Found ${actualJobs.length} cron job(s) in database\n`);

  // Display actual jobs
  console.log('═'.repeat(70));
  console.log('📋 ACTUAL CRON JOBS IN DATABASE');
  console.log('═'.repeat(70));
  console.log('');

  actualJobs.forEach((job, index) => {
    console.log(`${index + 1}. ${job.jobname || `Job #${job.jobid}`}`);
    console.log(`   Job ID: ${job.jobid}`);
    console.log(`   Schedule: ${job.schedule}`);
    console.log(`   Active: ${job.active ? '✅ Yes' : '❌ No'}`);
    const functionUrl = extractFunctionUrl(typeof job.command === 'string' ? job.command : JSON.stringify(job.command));
    console.log(`   Function URL: ${functionUrl}`);
    console.log('');
  });

  // Compare with expected
  compareWithExpected(actualJobs);

  console.log('');
  console.log('═'.repeat(70));
  console.log('✅ Verification Complete');
  console.log('═'.repeat(70));
}

main().catch((err) => {
  console.error('❌ Unexpected error:', err);
  process.exit(1);
});

