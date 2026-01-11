#!/usr/bin/env node
/**
 * Retry failed uploads that failed due to Wikimedia rate limits (429 errors)
 * Processes up to 50 rate limit failures
 * 
 * Usage:
 *   npm run retry-rate-limits
 *   npm run retry-rate-limits -- --limit 100
 */

import { FailedUpload, loadFailures, getArtistsWithFailures, removeFailure } from './failureTracker';
import { fetchImageInfoByTitle, pickBestVariant } from './wikimedia';
import { ensureArtist } from './db';
import { downloadImage } from './downloader';
import { parseArgs } from './utils';
import { retrySingleFailure } from './retryUtils';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * Check if error is a rate limit error
 */
function isRateLimitError(error: string): boolean {
  const lower = error.toLowerCase();
  return lower.includes('429') || 
         lower.includes('rate limit') || 
         lower.includes('too many requests') ||
         lower.includes('rate limited');
}

/**
 * Get all rate limit failures across all artists
 */
async function getAllRateLimitFailures(limit?: number): Promise<FailedUpload[]> {
  const artists = await getArtistsWithFailures();
  const allFailures: FailedUpload[] = [];
  
  console.log(`Scanning ${artists.length} artist failure files for rate limit errors...\n`);
  
  for (const artistSlug of artists) {
    try {
      // Load failures - the file contains the actual artist name in each failure record
      // We need to read the file to get the actual artist name
      const filePath = path.join(process.cwd(), '.failures', `${artistSlug}.json`);
      const content = await fs.readFile(filePath, 'utf-8');
      const failures = JSON.parse(content) as FailedUpload[];
      
      // Filter for rate limit errors
      const rateLimitFailures = failures.filter(f => isRateLimitError(f.error));
      
      for (const failure of rateLimitFailures) {
        allFailures.push(failure);
        if (limit && allFailures.length >= limit) {
          break;
        }
      }
      
      if (limit && allFailures.length >= limit) {
        break;
      }
    } catch (err) {
      // Skip artists with invalid JSON or other issues
      continue;
    }
  }
  
  return limit ? allFailures.slice(0, limit) : allFailures;
}

/**
 * Retry a single failed upload
 * Uses the same approach as cli-retry.ts but specifically for rate limit errors
 */
async function retryFailure(failure: FailedUpload): Promise<boolean> {
  console.log(`\nRetrying: ${failure.title} by ${failure.artist}`);
  console.log(`  Previous error: ${failure.error.substring(0, 100)}...`);
  
  try {
    await ensureArtist(failure.artist);
    
    // Fetch image info using the title (Commons file title)
    console.log(`  → Fetching image info for: "${failure.title}"...`);
    const image = await fetchImageInfoByTitle(failure.title);
    if (!image) {
      console.log(`  ⚠ Could not fetch image info, removing from error list`);
      await removeFailure(failure.artist, failure.title);
      return false;
    }
    
    // Pick best variant
    console.log(`  → Selecting best variant...`);
    const variant = pickBestVariant(image);
    if (!variant) {
      console.log(`  ⚠ No suitable variant found (quality requirements not met), removing from error list`);
      await removeFailure(failure.artist, failure.title);
      return false;
    }
    
    // Download image (this is where rate limits usually occur)
    console.log(`  → Downloading image...`);
    const downloaded = await downloadImage(variant);
    
    // Use shared retry logic
    const result = await retrySingleFailure(failure, image, variant, downloaded, true);
    
    if (result.success) {
      // Extra delay after successful upload to be respectful
      await new Promise(resolve => setTimeout(resolve, 3000));
      return true;
    } else {
      const isRateLimit = result.error?.includes('429') || result.error?.includes('rate limit') || result.error?.includes('Too many requests');
      if (isRateLimit) {
        console.log(`  ✗ Still rate limited: ${result.error}`);
      } else {
        console.log(`  ✗ Failed: ${result.error}`);
      }
      return false;
    }
    
  } catch (err) {
    const errorMessage = (err as Error).message;
    const isRateLimit = errorMessage.includes('429') || errorMessage.includes('rate limit') || errorMessage.includes('Too many requests');
    
    if (isRateLimit) {
      console.log(`  ✗ Still rate limited: ${errorMessage}`);
    } else {
      console.log(`  ✗ Failed: ${errorMessage}`);
    }
    return false;
  }
}

async function main() {
  const args = parseArgs();
  const limit = args.limit ? parseInt(args.limit as string, 10) : 50;
  
  console.log('Retrying Wikimedia Rate Limit Failures\n');
  console.log('='.repeat(60));
  console.log(`Processing up to ${limit} rate limit failures`);
  console.log('='.repeat(60) + '\n');
  
  try {
    // Get all rate limit failures
    const failures = await getAllRateLimitFailures(limit);
    
    if (failures.length === 0) {
      console.log('No rate limit failures found.');
      process.exit(0);
    }
    
    console.log(`Found ${failures.length} rate limit failures to retry\n`);
    
    // Group by artist for better organization
    const failuresByArtist = new Map<string, FailedUpload[]>();
    for (const failure of failures) {
      if (!failuresByArtist.has(failure.artist)) {
        failuresByArtist.set(failure.artist, []);
      }
      failuresByArtist.get(failure.artist)!.push(failure);
    }
    
    console.log(`Processing ${failuresByArtist.size} artists with rate limit failures\n`);
    
    let totalRetried = 0;
    let totalSuccessful = 0;
    let totalFailed = 0;
    
    // Process artists one by one
    for (const [artist, artistFailures] of failuresByArtist.entries()) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`Processing ${artist} (${artistFailures.length} failures)`);
      console.log('='.repeat(60));
      
      // Retry all failures for this artist
      for (const failure of artistFailures) {
        if (totalRetried >= limit) {
          console.log(`\nReached limit of ${limit} retries`);
          break;
        }
        
        const success = await retryFailure(failure);
        totalRetried++;
        
        if (success) {
          totalSuccessful++;
        } else {
          totalFailed++;
        }
        
        // Rate limiter handles delays, but add extra buffer between retries
        if (totalRetried < limit && totalRetried < failures.length) {
          // Rate limiter already enforces 1 second minimum, add 1 more second buffer
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      if (totalRetried >= limit) {
        break;
      }
      
      // Delay between artists (rate limiter handles per-request delays)
      if (totalRetried < limit) {
        console.log(`\n  Waiting 5 seconds before next artist...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    
    console.log(`\n${'='.repeat(60)}`);
    console.log('Retry Summary');
    console.log('='.repeat(60));
    console.log(`  Total retried: ${totalRetried}`);
    console.log(`  Successful: ${totalSuccessful} ✓`);
    console.log(`  Still failed: ${totalFailed}`);
    console.log('='.repeat(60) + '\n');
    
  } catch (err) {
    console.error('Error:', (err as Error).message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});



















