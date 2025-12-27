#!/usr/bin/env node
import { loadFailures, removeFailure, getArtistsWithFailures } from './failureTracker';
import { fetchImageInfoByTitle, pickBestVariant } from './wikimedia';
import { ensureArtist } from './db';
import { downloadImage } from './downloader';
import { parseArgs } from './utils';
import { retrySingleFailure } from './retryUtils';

async function retryFailures(artist: string, limit?: number): Promise<void> {
  const failures = await loadFailures(artist);
  
  if (failures.length === 0) {
    console.log(`No failures found for ${artist}`);
    return;
  }
  
  const failuresToRetry = limit ? failures.slice(0, limit) : failures;
  console.log(`Found ${failures.length} failures for ${artist}. Retrying ${failuresToRetry.length}...`);
  
  await ensureArtist(artist);
  let succeeded = 0;
  let failed = 0;
  
  for (const failure of failuresToRetry) {
    try {
      console.log(`Retrying: ${failure.title}`);
      
      // Fetch image info
      const image = await fetchImageInfoByTitle(failure.title);
      if (!image) {
        console.log(`  ⚠ Could not fetch image info, removing from error list`);
        await removeFailure(artist, failure.title);
        failed++;
        continue;
      }
      
      // Pick best variant
      const variant = pickBestVariant(image);
      if (!variant) {
        console.log(`  ⚠ No suitable variant found (quality requirements not met), removing from error list`);
        await removeFailure(artist, failure.title);
        failed++;
        continue;
      }
      
      // Download image
      const downloaded = await downloadImage(variant);
      
      // Use shared retry logic
      const result = await retrySingleFailure(failure, image, variant, downloaded, false);
      
      if (result.success) {
        console.log(`  ✓ Successfully uploaded`);
        succeeded++;
        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else {
        console.log(`  ✗ Failed: ${result.error}`);
        failed++;
        // Don't remove from failures list, will retry again later
      }
      
    } catch (err) {
      console.log(`  ✗ Failed: ${(err as Error).message}`);
      failed++;
      // Don't remove from failures list, will retry again later
    }

  }
  
  console.log(`\nRetry complete: ${succeeded} succeeded, ${failed} still failed`);
}

async function main() {
  const args = parseArgs();
  const artist = args.artist as string | undefined;
  const limit = args.limit ? Number(args.limit) : undefined;
  
  if (artist) {
    // Retry specific artist
    await retryFailures(artist, limit);
  } else {
    // List all artists with failures
    const artists = await getArtistsWithFailures();
    if (artists.length === 0) {
      console.log('No failures found for any artist');
      return;
    }
    
    console.log('Artists with failures:');
    for (const artistName of artists) {
      const failures = await loadFailures(artistName);
      console.log(`  ${artistName}: ${failures.length} failures`);
    }
    console.log('\nTo retry, use: npm run retry -- --artist "Artist Name"');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
