#!/usr/bin/env node
/**
 * Monitor the continuous batch process and notify when complete
 */

import { existsSync, readFileSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function checkCompletion(): Promise<boolean> {
  return existsSync('.batch-met-complete');
}

async function getStatus(): Promise<any> {
  if (existsSync('.batch-met-status.json')) {
    const content = readFileSync('.batch-met-status.json', 'utf-8');
    return JSON.parse(content);
  }
  return null;
}

async function main() {
  console.log('Monitoring continuous batch process...');
  console.log('Will check every 30 seconds for completion.\n');
  
  let checkCount = 0;
  const maxChecks = 1000; // ~8 hours max
  
  while (checkCount < maxChecks) {
    if (await checkCompletion()) {
      console.log('\n' + '='.repeat(60));
      console.log('✓ BATCH PROCESSING COMPLETE!');
      console.log('='.repeat(60) + '\n');
      
      const status = await getStatus();
      if (status) {
        console.log('Final Results:');
        console.log(`  Total batches run: ${status.totalBatches}`);
        console.log(`  Total artworks uploaded: ${status.totalUploaded}`);
        console.log(`  Stopped due to: ${status.stoppedDueTo}`);
        console.log(`  Completed at: ${status.completedAt}`);
        console.log();
      }
      
      // Fetch detailed information
      console.log('Fetching detailed upload information...\n');
      try {
        const { stdout } = await execAsync('node dist/cli-check-met-uploads.js');
        console.log(stdout);
      } catch (err: any) {
        console.log('Could not fetch detailed info:', err.message);
      }
      
      // Beep notification (if available)
      try {
        await execAsync('echo -e "\\a"'); // Terminal bell
      } catch (err) {
        // Ignore if beep fails
      }
      
      console.log('\n' + '='.repeat(60));
      console.log('Monitoring complete. Batch processing finished.');
      console.log('='.repeat(60) + '\n');
      
      break;
    }
    
    checkCount++;
    if (checkCount % 10 === 0) {
      console.log(`Still running... (checked ${checkCount} times, ~${Math.floor(checkCount * 30 / 60)} minutes)`);
    }
    
    await new Promise(resolve => setTimeout(resolve, 30000)); // 30 seconds
  }
  
  if (checkCount >= maxChecks) {
    console.log('\n⚠️  Monitoring timeout reached. Batch may still be running.');
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
