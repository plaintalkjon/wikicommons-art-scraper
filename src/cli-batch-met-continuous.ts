#!/usr/bin/env node
/**
 * Continuously run batches of Met Museum artists until:
 * - All artists are processed (no more unprocessed artists), OR
 * - A 403 error occurs (bot protection)
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function runBatch(batchNumber: number, limit: number = 30, maxPaintings: number = 15): Promise<{ 
  success: boolean; 
  has403: boolean; 
  noMoreArtists: boolean;
  output: string;
  artistsProcessed: number;
}> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Starting Batch #${batchNumber}`);
  console.log(`${'='.repeat(60)}\n`);
  
  try {
    const { stdout, stderr } = await execAsync(
      `npm run batch-met-small ${limit} ${maxPaintings}`,
      { cwd: process.cwd(), maxBuffer: 10 * 1024 * 1024 } // 10MB buffer
    );
    
    const output = stdout + stderr;
    const has403 = output.includes('403') || 
                   output.includes('Forbidden') || 
                   output.includes('bot protection') ||
                   output.includes('Incapsula');
    
    // Check if no more artists were found
    const noArtistsMatch = output.match(/Selected (\d+) unprocessed artists/i);
    const artistsProcessed = noArtistsMatch ? parseInt(noArtistsMatch[1], 10) : limit;
    const noMoreArtists = artistsProcessed === 0 || 
                          output.includes('Only found 0 unprocessed artists') ||
                          output.includes('No artists found');
    
    return { success: true, has403, noMoreArtists, output, artistsProcessed };
  } catch (error: any) {
    const output = error.stdout + error.stderr;
    const has403 = output.includes('403') || 
                   output.includes('Forbidden') || 
                   output.includes('bot protection') ||
                   output.includes('Incapsula');
    
    // Check if no more artists were found
    const noArtistsMatch = output.match(/Selected (\d+) unprocessed artists/i);
    const artistsProcessed = noArtistsMatch ? parseInt(noArtistsMatch[1], 10) : 0;
    const noMoreArtists = artistsProcessed === 0 || 
                          output.includes('Only found 0 unprocessed artists') ||
                          output.includes('No artists found');
    
    return { success: false, has403, noMoreArtists, output, artistsProcessed };
  }
}

async function main() {
  const limit = parseInt(process.argv[2] || '30', 10);
  const maxPaintings = parseInt(process.argv[3] || '15', 10);
  
  console.log('='.repeat(60));
  console.log('Continuous Batch Processing: Met Museum Artists');
  console.log('Will run until all artists are processed OR 403 error occurs');
  console.log('='.repeat(60));
  console.log(`\nConfiguration:`);
  console.log(`  Artists per batch: ${limit}`);
  console.log(`  Max paintings per artist: ${maxPaintings}`);
  console.log(`\nStarting continuous processing...\n`);
  
  let batchNumber = 1;
  let totalBatches = 0;
  let totalUploaded = 0;
  let encountered403 = false;
  let allArtistsProcessed = false;
  
  while (!encountered403 && !allArtistsProcessed) {
    const result = await runBatch(batchNumber, limit, maxPaintings);
    totalBatches++;
    
    if (result.has403) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`⚠️  403 ERROR DETECTED in Batch #${batchNumber}`);
      console.log(`${'='.repeat(60)}`);
      console.log(`\nStopping continuous processing due to bot protection.`);
      encountered403 = true;
      break;
    }
    
    if (result.noMoreArtists) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`✓ All artists processed!`);
      console.log(`${'='.repeat(60)}`);
      console.log(`\nNo more unprocessed artists found.`);
      allArtistsProcessed = true;
      break;
    }
    
    if (!result.success) {
      console.log(`\n⚠️  Batch #${batchNumber} encountered an error (but not 403)`);
      console.log(`Continuing to next batch...\n`);
    } else {
      // Try to extract upload count from output
      const uploadMatch = result.output.match(/Total uploaded:\s*(\d+)/i);
      if (uploadMatch) {
        const uploaded = parseInt(uploadMatch[1], 10);
        totalUploaded += uploaded;
        console.log(`\n✓ Batch #${batchNumber} completed successfully`);
        console.log(`  Artists processed: ${result.artistsProcessed}`);
        console.log(`  Uploaded: ${uploaded} artworks`);
      } else {
        console.log(`\n✓ Batch #${batchNumber} completed successfully`);
        console.log(`  Artists processed: ${result.artistsProcessed}`);
      }
    }
    
    batchNumber++;
    
    // Small delay between batches to be respectful
    if (!encountered403 && !allArtistsProcessed) {
      console.log(`\nWaiting 5 seconds before next batch...\n`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  
  const completionTime = new Date().toISOString();
  
  console.log(`\n${'='.repeat(60)}`);
  console.log('Continuous Processing Complete');
  console.log(`${'='.repeat(60)}`);
  console.log(`\nFinal Statistics:`);
  console.log(`  Total batches run: ${totalBatches}`);
  console.log(`  Total artworks uploaded: ${totalUploaded}`);
  if (encountered403) {
    console.log(`  Stopped due to: 403 Error (Bot Protection)`);
  } else if (allArtistsProcessed) {
    console.log(`  Stopped due to: All artists processed (no more unprocessed artists)`);
  } else {
    console.log(`  Stopped due to: Unknown reason`);
  }
  console.log(`  Completed at: ${completionTime}`);
  console.log(`\n${'='.repeat(60)}\n`);
  
  // Write completion status to file for notification
  const fs = await import('fs/promises');
  const statusFile = '.batch-met-status.json';
  await fs.writeFile(statusFile, JSON.stringify({
    completed: true,
    completedAt: completionTime,
    totalBatches: totalBatches,
    totalUploaded: totalUploaded,
    stoppedDueTo: encountered403 ? '403_error' : allArtistsProcessed ? 'all_artists_processed' : 'unknown',
    batchNumber: batchNumber,
  }, null, 2));
  
  // Also write a simple completion marker
  await fs.writeFile('.batch-met-complete', completionTime);
  
  console.log(`\n✓ Completion status written to ${statusFile}`);
}

main().catch((err) => {
  console.error('\n✗ Fatal Error:', err.message);
  process.exit(1);
});
