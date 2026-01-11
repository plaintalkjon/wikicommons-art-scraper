#!/usr/bin/env node
/**
 * Setup RPC function for querying cron jobs
 * 
 * This attempts to create the get_cron_jobs() RPC function via Supabase REST API
 * If that fails, it provides the SQL for manual execution
 */

import { config, supabase } from './config';
import axios from 'axios';
import { readFileSync } from 'fs';
import { join } from 'path';

async function createRPCFunction(): Promise<boolean> {
  console.log('🔧 Setting up cron jobs RPC function...');
  console.log('');

  // Read the SQL file
  const sqlPath = join(process.cwd(), 'create-get-cron-jobs-rpc.sql');
  let sql: string;
  
  try {
    sql = readFileSync(sqlPath, 'utf-8');
  } catch (error) {
    console.error(`❌ Could not read ${sqlPath}`);
    return false;
  }

  // Try to execute via Supabase REST API
  // Note: Supabase doesn't expose direct SQL execution, but we can try the management API
  // or use a workaround with RPC if exec_sql exists
  
  console.log('📡 Attempting to create RPC function...');
  
  try {
    // Try using exec_sql RPC if it exists
    const { error } = await supabase.rpc('exec_sql', { 
      sql: sql 
    } as any);
    
    if (!error) {
      console.log('✅ RPC function created successfully!');
      return true;
    }
    
    if (error.message?.includes('not found') || error.message?.includes('function')) {
      console.log('⚠️  exec_sql RPC not available');
    } else {
      console.log(`⚠️  Error: ${error.message}`);
    }
  } catch (err: any) {
    console.log('⚠️  Could not create RPC function programmatically');
  }

  // Fallback: Show SQL for manual execution
  console.log('');
  console.log('📋 Manual Setup Required:');
  console.log('═'.repeat(70));
  console.log('1. Go to Supabase Dashboard → SQL Editor');
  console.log('2. Copy and paste the SQL below:');
  console.log('');
  console.log('─'.repeat(70));
  console.log(sql);
  console.log('─'.repeat(70));
  console.log('');
  console.log('3. Click "Run" to execute');
  console.log('4. Then run: npm run check-cron-jobs');
  
  return false;
}

async function main() {
  const success = await createRPCFunction();
  process.exit(success ? 0 : 1);
}

main().catch((err) => {
  console.error('❌ Unexpected error:', err);
  process.exit(1);
});

