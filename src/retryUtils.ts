/**
 * Shared retry logic for failed uploads
 */

import { FailedUpload } from './failureTracker';
import { WikimediaImage, ImageVariant, DownloadedImage } from './types';
import { ensureArtist, upsertArt, upsertTags, linkArtTags, upsertArtSource, insertArtAsset, uploadToStorage } from './db';
import { fetchWikidataItemTags } from './wikidata';
import { removeFailure } from './failureTracker';
import { normalizeTitle, normalizeWikidataTags, buildStoragePath } from './artUtils';

export interface RetryResult {
  success: boolean;
  error?: string;
}

/**
 * Retry a single failed upload
 * Shared logic used by both cli-retry.ts and cli-retry-rate-limits.ts
 */
export async function retrySingleFailure(
  failure: FailedUpload,
  image: WikimediaImage,
  variant: ImageVariant,
  downloaded: DownloadedImage,
  verbose = false
): Promise<RetryResult> {
  try {
    const artistId = await ensureArtist(failure.artist);
    
    if (verbose) {
      console.log(`  ✓ Fetched image info`);
      console.log(`  → Selecting best variant...`);
      console.log(`  ✓ Selected variant: ${variant.width}x${variant.height}`);
      console.log(`  → Downloading image...`);
      console.log(`  ✓ Downloaded: ${downloaded.width}x${downloaded.height}, ${(downloaded.fileSize / 1024 / 1024).toFixed(2)}MB`);
    }
    
    // Build storage path
    const storagePath = buildStoragePath(failure.artist, image, downloaded.ext);
    if (verbose) {
      console.log(`  → Uploading to storage: ${storagePath}`);
    }
    const upload = await uploadToStorage(storagePath, downloaded);
    if (verbose) {
      console.log(`  ✓ Uploaded to storage`);
    }
    
    // Create art record
    if (verbose) {
      console.log(`  → Creating art record...`);
    }
    const artId = await upsertArt({
      title: normalizeTitle(image.title),
      description: image.description ?? null,
      imageUrl: upload.publicUrl,
      artistId,
    });
    if (verbose) {
      console.log(`  ✓ Art record created: ${artId}`);
    }
    
    // Add tags if we have source item
    if (image.sourceItem) {
      if (verbose) {
        console.log(`  → Fetching Wikidata tags (QID: ${image.sourceItem})...`);
      }
      const wikidataTags = await fetchWikidataItemTags(image.sourceItem);
      const normalizedTags = normalizeWikidataTags(wikidataTags, image.museum);
      if (normalizedTags.length > 0) {
        if (verbose) {
          console.log(`  ✓ Found ${normalizedTags.length} Wikidata tags: ${normalizedTags.join(', ')}`);
        }
        const tagIds = await upsertTags(normalizedTags).then((rows) => rows.map((r) => r.id));
        await linkArtTags(artId, tagIds);
        if (verbose) {
          console.log(`  ✓ Linked ${tagIds.length} tags`);
        }
      }
    }
    
    // Add source
    if (verbose) {
      console.log(`  → Adding source information...`);
    }
    await upsertArtSource({
      artId,
      source: 'wikimedia',
      sourcePageId: image.pageid,
      sourceTitle: image.title,
      sourceUrl: image.pageUrl,
      wikidataQID: image.sourceItem,
    });
    if (verbose) {
      console.log(`  ✓ Source added`);
    }
    
    // Add asset
    if (verbose) {
      console.log(`  → Creating asset record...`);
    }
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
    if (verbose) {
      console.log(`  ✓ Asset record created`);
    }
    
    // Remove from failures list
    await removeFailure(failure.artist, failure.title);
    if (verbose) {
      console.log(`  ✓✓✓ Successfully uploaded: ${failure.title}`);
    }
    
    return { success: true };
    
  } catch (err) {
    const errorMessage = (err as Error).message;
    return { success: false, error: errorMessage };
  }
}

















