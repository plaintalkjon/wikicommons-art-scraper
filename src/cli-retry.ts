#!/usr/bin/env node
import { loadFailures, removeFailure } from './failureTracker';
import { fetchImageInfoByTitle } from './wikimedia';
import { ensureArtist, insertArtAsset, linkArtTags, upsertArt, upsertArtSource, upsertTags } from './db';
import { fetchWikidataItemTags } from './wikidata';
import { downloadImage } from './downloader';
import { uploadToStorage } from './storage';
import { buildStoragePath, normalizeTitle, normalizeWikidataTags } from './pipeline';
import { notifyCompletion } from './notify';

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.replace(/^--/, '');
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        parsed[key] = next;
        i += 1;
      } else {
        parsed[key] = true;
      }
    }
  }
  return parsed;
}

async function main() {
  const args = parseArgs();
  const artist = (args.artist as string);
  
  if (!artist) {
    console.error('Error: --artist is required');
    console.error('Usage: npm run retry -- --artist "Artist Name"');
    process.exit(1);
  }
  
  console.log(`Retrying failed uploads for: ${artist}`);
  
  const failures = loadFailures(artist);
  if (failures.length === 0) {
    console.log('No failures found for this artist.');
    return;
  }
  
  console.log(`Found ${failures.length} failed uploads to retry...\n`);
  
  const artistId = await ensureArtist(artist);
  let successCount = 0;
  let stillFailed: Array<{ title: string; message: string }> = [];
  
  // Process failures one at a time to avoid rate limits
  for (let i = 0; i < failures.length; i++) {
    const failure = failures[i];
    console.log(`[${i + 1}/${failures.length}] Retrying: ${failure.title}`);
    
    try {
      // Fetch image info
      const image = await fetchImageInfoByTitle(failure.title);
      if (!image) {
        console.log(`  ⚠️  Image not found, skipping...`);
        stillFailed.push({ title: failure.title, message: 'Image not found' });
        continue;
      }
      
      // Pick best variant (using the same logic as pipeline)
      const { pickBestVariant } = require('./wikimedia');
      const variant = pickBestVariant(image);
      if (!variant) {
        console.log(`  ⚠️  No suitable variant found, skipping...`);
        stillFailed.push({ title: failure.title, message: 'No suitable variant' });
        continue;
      }
      
      // Download image
      const downloaded = await downloadImage(variant);
      const storagePath = buildStoragePath(artist, image, downloaded.ext);
      
      // Upload to storage
      const upload = await uploadToStorage(storagePath, downloaded);
      
      // Upsert art record
      const artId = await upsertArt({
        title: normalizeTitle(image.title),
        description: image.description ?? null,
        imageUrl: upload.publicUrl,
        artistId,
      });
      
      // Get Wikidata tags if available
      let normalizedTags: string[];
      if (image.sourceItem) {
        const wikidataTags = await fetchWikidataItemTags(image.sourceItem);
        normalizedTags = normalizeWikidataTags(wikidataTags, image.museum);
      } else {
        normalizedTags = [];
      }
      
      // Upsert tags
      const tagIds = await upsertTags(normalizedTags).then((rows) => rows.map((r) => r.id));
      await linkArtTags(artId, tagIds);
      
      // Upsert source
      await upsertArtSource({
        artId,
        source: 'wikidata',
        sourcePageId: image.pageid,
        sourceTitle: image.title,
        sourceUrl: image.pageUrl,
      });
      
      // Insert asset
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
      
      // Remove from failures list
      removeFailure(artist, failure.title);
      successCount++;
      console.log(`  ✅ Successfully uploaded!`);
      
      // Small delay between retries to avoid rate limits
      if (i < failures.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
    } catch (err) {
      const errorMessage = (err as Error).message;
      console.log(`  ❌ Failed: ${errorMessage}`);
      stillFailed.push({ title: failure.title, message: errorMessage });
      
      // Update failure record
      const { saveFailure } = require('./failureTracker');
      await saveFailure({
        artist: failure.artist,
        title: failure.title,
        imageUrl: failure.imageUrl,
        error: errorMessage,
        timestamp: new Date().toISOString(),
        retryCount: failure.retryCount + 1,
        lastRetry: new Date().toISOString(),
      });
      
      // Longer delay on error to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  
  console.log(`\nCompleted retry.`);
  console.log(`  ✅ Successfully retried: ${successCount}`);
  console.log(`  ❌ Still failed: ${stillFailed.length}`);
  
  if (stillFailed.length > 0) {
    console.log('\nRemaining failures:');
    for (const failure of stillFailed) {
      console.log(`  - ${failure.title}: ${failure.message}`);
    }
  }
  
  // Send notification
  await notifyCompletion(artist, {
    attempted: failures.length,
    uploaded: successCount,
    skipped: 0,
    errors: stillFailed.length,
  });
}

main().catch(async (err) => {
  console.error(err);
  try {
    const args = parseArgs();
    const artist = (args.artist as string) || 'Unknown';
    await notifyCompletion(artist, {
      attempted: 0,
      uploaded: 0,
      skipped: 0,
      errors: 1,
    });
  } catch {
    // Ignore notification errors
  }
  process.exit(1);
});
