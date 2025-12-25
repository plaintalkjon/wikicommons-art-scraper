#!/usr/bin/env node
import { loadFailures, removeFailure, getArtistsWithFailures } from './failureTracker';
import { fetchImageInfoByTitle, pickBestVariant } from './wikimedia';
import { ensureArtist, upsertArt, upsertTags, linkArtTags, upsertArtSource, insertArtAsset } from './db';
import { fetchWikidataItemTags } from './wikidata';
import { uploadToStorage } from './storage';
import { downloadImage } from './downloader';
import { normalizeTitle, normalizeWikidataTags } from './pipeline';
import { buildStoragePath } from './pipeline';

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

async function retryFailures(artist: string): Promise<void> {
  const failures = await loadFailures(artist);
  
  if (failures.length === 0) {
    console.log(`No failures found for ${artist}`);
    return;
  }
  
  console.log(`Found ${failures.length} failures for ${artist}. Retrying...`);
  
  const artistId = await ensureArtist(artist);
  let succeeded = 0;
  let failed = 0;
  
  for (const failure of failures) {
    try {
      console.log(`Retrying: ${failure.title}`);
      
      // Fetch image info
      const image = await fetchImageInfoByTitle(failure.title);
      if (!image) {
        console.log(`  ⚠ Could not fetch image info, skipping`);
        failed++;
        continue;
      }
      
      // Pick best variant
      const variant = pickBestVariant(image);
      if (!variant) {
        console.log(`  ⚠ No suitable variant found, skipping`);
        failed++;
        continue;
      }
      
      // Download and upload
      const downloaded = await downloadImage(variant);
      const path = buildStoragePath(artist, image, downloaded.ext);
      
      const upload = await uploadToStorage(path, downloaded);
      const artId = await upsertArt({
        title: normalizeTitle(image.title),
        description: image.description ?? null,
        imageUrl: upload.publicUrl,
        artistId,
      });
      
      // Add tags if we have source item
      if (image.sourceItem) {
        const wikidataTags = await fetchWikidataItemTags(image.sourceItem);
        const normalizedTags = normalizeWikidataTags(wikidataTags, image.museum);
        const tagIds = await upsertTags(normalizedTags).then((rows) => rows.map((r) => r.id));
        await linkArtTags(artId, tagIds);
      }
      
      // Add source
      await upsertArtSource({
        artId,
        source: 'wikidata',
        sourcePageId: image.pageid,
        sourceTitle: image.title,
        sourceUrl: image.pageUrl,
      });
      
      // Add asset
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
      await removeFailure(artist, failure.title);
      console.log(`  ✓ Successfully uploaded`);
      succeeded++;
      
      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 2000));
      
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
  
  if (artist) {
    // Retry specific artist
    await retryFailures(artist);
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
