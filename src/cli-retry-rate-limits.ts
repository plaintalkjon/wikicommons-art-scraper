#!/usr/bin/env node
/**
 * Retry failed uploads that failed due to Wikimedia rate limits (429 errors)
 * Processes up to 50 rate limit failures
 * 
 * Usage:
 *   npm run retry-rate-limits
 *   npm run retry-rate-limits -- --limit 100
 */

import { promises as fs } from 'fs';
import path from 'path';
import { FailedUpload, loadFailures, getArtistsWithFailures, removeFailure } from './failureTracker';
import { fetchImageInfoByTitle, pickBestVariant } from './wikimedia';
import { ensureArtist, upsertArt, upsertTags, linkArtTags, upsertArtSource, insertArtAsset } from './db';
import { fetchWikidataItemTags } from './wikidata';
import { uploadToStorage } from './storage';
import { downloadImage } from './downloader';
import { normalizeTitle, normalizeWikidataTags, buildStoragePath } from './pipeline';

const FAILURES_DIR = path.join(process.cwd(), '.failures');

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
      // Reconstruct artist name from slug (approximate)
      const artistName = artistSlug
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
      
      const failures = await loadFailures(artistName);
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
    const artistId = await ensureArtist(failure.artist);
    
    // Fetch image info using the title (Commons file title)
    console.log(`  → Fetching image info for: "${failure.title}"...`);
    const image = await fetchImageInfoByTitle(failure.title);
    if (!image) {
      console.log(`  ⚠ Could not fetch image info, skipping`);
      return false;
    }
    
    console.log(`  ✓ Fetched image info`);
    
    // Pick best variant
    console.log(`  → Selecting best variant...`);
    const variant = pickBestVariant(image);
    if (!variant) {
      console.log(`  ⚠ No suitable variant found (quality requirements not met), skipping`);
      return false;
    }
    
    console.log(`  ✓ Selected variant: ${variant.width}x${variant.height}`);
    
    // Download image (this is where rate limits usually occur)
    console.log(`  → Downloading image...`);
    const downloaded = await downloadImage(variant);
    console.log(`  ✓ Downloaded: ${downloaded.width}x${downloaded.height}, ${(downloaded.fileSize / 1024 / 1024).toFixed(2)}MB`);
    
    // Build storage path
    const storagePath = buildStoragePath(failure.artist, image, downloaded.ext);
    console.log(`  → Uploading to storage: ${storagePath}`);
    const upload = await uploadToStorage(storagePath, downloaded);
    console.log(`  ✓ Uploaded to storage`);
    
    // Create art record
    console.log(`  → Creating art record...`);
    const artId = await upsertArt({
      title: normalizeTitle(image.title),
      description: image.description ?? null,
      imageUrl: upload.publicUrl,
      artistId,
    });
    console.log(`  ✓ Art record created: ${artId}`);
    
    // Add tags if we have source item
    if (image.sourceItem) {
      console.log(`  → Fetching Wikidata tags (QID: ${image.sourceItem})...`);
      const wikidataTags = await fetchWikidataItemTags(image.sourceItem);
      const normalizedTags = normalizeWikidataTags(wikidataTags, image.museum);
      if (normalizedTags.length > 0) {
        console.log(`  ✓ Found ${normalizedTags.length} Wikidata tags: ${normalizedTags.join(', ')}`);
        const tagIds = await upsertTags(normalizedTags).then((rows) => rows.map((r) => r.id));
        await linkArtTags(artId, tagIds);
        console.log(`  ✓ Linked ${tagIds.length} tags`);
      }
    }
    
    // Add source
    console.log(`  → Adding source information...`);
    await upsertArtSource({
      artId,
      source: 'wikimedia',
      sourcePageId: image.pageid,
      sourceTitle: image.title,
      sourceUrl: image.pageUrl,
      wikidataQID: image.sourceItem,
    });
    console.log(`  ✓ Source added`);
    
    // Add asset
    console.log(`  → Creating asset record...`);
    await insertArtAsset({
      artId,
      storagePath: upload.path,
      publicUrl: upload.publicUrl,
      width: downloaded.width,
      height: downloaded.height,
      fileSize: downloaded.fileSize,
      mimeType: downloaded.mime,
      sha256: downloaded.sha256,
    });
    console.log(`  ✓ Asset record created`);
    
    // Remove from failures list
    await removeFailure(failure.artist, failure.title);
    console.log(`  ✓✓✓ Successfully uploaded: ${failure.title}`);
    return true;
    
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
  const args = process.argv.slice(2);
  let limit = 50;
  
  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
      i++;
    }
  }
  
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
        
        // Small delay between retries to avoid hitting rate limits again
        if (totalRetried < limit && totalRetried < failures.length) {
          console.log(`  Waiting 2 seconds before next retry...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      if (totalRetried >= limit) {
        break;
      }
      
      // Delay between artists
      if (totalRetried < limit) {
        console.log(`\n  Waiting 3 seconds before next artist...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
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
