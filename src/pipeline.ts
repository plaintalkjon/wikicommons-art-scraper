import { config } from './config';
import { fetchImageInfoByTitle, pickBestVariant, fetchImagesForArtist } from './wikimedia';
import { slugify } from './utils';
import { downloadImage } from './downloader';
import { uploadToStorage } from './storage';
import { WikimediaImage } from './types';
import { ensureArtist, insertArtAsset, linkArtTags, upsertArt, upsertArtSource, upsertTags } from './db';
import { fetchWikidataPaintings, fetchWikidataItemTags, hasCollection, findItemFromCommonsFile, batchFindItemsWithCollections } from './wikidata';
import { saveFailure } from './failureTracker';

export interface FetchOptions {
  artist: string;
  limit?: number;
  dryRun?: boolean;
  paintingsOnly?: boolean; // Kept for CLI compatibility but not used (wikidata.ts only fetches paintings now)
  maxUploads?: number;
}

export interface FetchResult {
  attempted: number;
  uploaded: number;
  skipped: number;
  errors: Array<{ title: string; message: string }>;
}

async function processInParallel<T>(
  items: T[],
  processor: (item: T) => Promise<void>,
  concurrency: number,
): Promise<void> {
  const executing = new Set<Promise<void>>();

  for (const item of items) {
    const promise = processor(item).finally(() => {
      executing.delete(promise);
    });

    executing.add(promise);

    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
}

export async function fetchAndStoreArtworks(options: FetchOptions): Promise<FetchResult> {
  const limit = options.limit ?? 10000;
  const CONCURRENCY = 2; // Process 2 images in parallel to avoid overwhelming Wikidata
  const maxUploads = options.maxUploads;
  
  console.log(`Fetching artworks for: ${options.artist}...`);
  
  // Since findArtistQID was removed, we'll use Wikimedia Commons directly
  // This is a fallback approach - ideally artist QID should be provided
  const images = await fetchImagesForArtist({ artist: options.artist, limit });
  
  if (images.length === 0) {
    console.log('No images found via Wikimedia Commons categories');
    return { attempted: 0, uploaded: 0, skipped: 0, errors: [] };
  }
  
  console.log(`Found ${images.length} images to process`);
  
  // Step 1: Batch query Wikidata for all items with collections (or load from cache)
  console.log(`\n→ Loading Wikidata items with images and collections...`);
  let wikidataMap: Map<string, string>;
  try {
    wikidataMap = await batchFindItemsWithCollections();
    console.log(`✓ Loaded ${wikidataMap.size} Wikidata items with collections`);
  } catch (err) {
    const errorMessage = (err as Error).message;
    const isRateLimit = errorMessage.includes('429') || errorMessage.includes('rate limit');
    if (isRateLimit) {
      console.error(`✗ Batch Wikidata query rate limited: ${errorMessage}`);
      console.log(`  Will use per-image queries (may be slower)...`);
    } else {
      console.error(`✗ Batch Wikidata query failed: ${errorMessage}`);
      console.log(`  Falling back to per-image queries...`);
    }
    wikidataMap = new Map(); // Empty map, will fall back to individual queries
  }
  
  const artistId = await ensureArtist(options.artist);
  const errors: Array<{ title: string; message: string }> = [];
  let uploaded = 0;
  let skipped = 0;
  let attempted = 0;
  let rateLimitErrors = 0;
  
  // Helper to log running stats
  const logStats = () => {
    console.log(`\n📊 Progress: Attempted=${attempted} | Uploaded=${uploaded} | Skipped=${skipped} | Errors=${errors.length} | Rate Limits=${rateLimitErrors}\n`);
  };
  
  const processImage = async (image: WikimediaImage) => {
    if (maxUploads && uploaded >= maxUploads) {
      skipped++;
      return;
    }
    
    attempted++;
    console.log(`[${attempted}/${images.length}] Processing: ${image.title}`);
    
    // Filter: must have a collection/museum (P195 property in Wikidata)
    // Try to find Wikidata item from batch query first, fall back to individual query if needed
    let itemId: string | null = image.sourceItem || null;
    
    if (!itemId) {
      // Extract filename from Commons title (remove "File:" prefix)
      const filename = image.title.replace(/^File:/i, '').trim();
      
      // Try batch map first - try multiple variations for matching
      if (wikidataMap.size > 0) {
        // Try exact matches first
        itemId = wikidataMap.get(image.title) || 
                 wikidataMap.get(filename) ||
                 // Try URL-encoded versions
                 wikidataMap.get(encodeURIComponent(filename)) ||
                 wikidataMap.get(`File:${encodeURIComponent(filename)}`) ||
                 null;
        
        // If still not found, try case-insensitive and normalized matching
        if (!itemId) {
          const normalizedTitle = image.title.toLowerCase().trim();
          const normalizedFilename = filename.toLowerCase().trim();
          for (const [key, value] of wikidataMap.entries()) {
            const normalizedKey = key.toLowerCase().trim();
            if (normalizedKey === normalizedTitle || normalizedKey === normalizedFilename) {
              itemId = value;
              console.log(`  ✓ Found Wikidata item via case-insensitive match: ${itemId}`);
              break;
            }
          }
        }
        
        if (itemId) {
          console.log(`  ✓ Found Wikidata item with collection (from batch): ${itemId}`);
          image.sourceItem = itemId;
        } else {
          console.log(`  → Not found in batch map (${wikidataMap.size} items), trying individual query...`);
        }
        if (itemId) {
          console.log(`  ✓ Found Wikidata item with collection (from batch): ${itemId}`);
          image.sourceItem = itemId;
        }
      }
      
      // Fall back to individual query if batch didn't find it
      if (!itemId) {
        console.log(`  → Looking up Wikidata item individually (not in batch): ${image.title}`);
        try {
          itemId = await findItemFromCommonsFile(image.title);
          if (itemId) {
            console.log(`  ✓ Found Wikidata item with collection: ${itemId}`);
            image.sourceItem = itemId;
          } else {
            console.log(`  ⚠ No Wikidata item found, skipping`);
            skipped++;
            await saveFailure({
              artist: options.artist,
              title: image.title,
              imageUrl: image.original?.url || image.thumb?.url || '',
              error: 'No Wikidata item found for Commons file',
              timestamp: new Date().toISOString(),
              retryCount: 0,
            });
            logStats();
            return;
          }
        } catch (err) {
          const errorMessage = (err as Error).message;
          const isRateLimit = errorMessage.includes('429') || errorMessage.includes('rate limit');
          if (isRateLimit) rateLimitErrors++;
          
          console.log(`  ✗ Error finding Wikidata item: ${errorMessage}${isRateLimit ? ' [RATE LIMIT - skipping]' : ''}`);
          skipped++;
          errors.push({ title: image.title, message: errorMessage });
          await saveFailure({
            artist: options.artist,
            title: image.title,
            imageUrl: image.original?.url || image.thumb?.url || '',
            error: `Wikidata lookup failed: ${errorMessage}`,
            timestamp: new Date().toISOString(),
            retryCount: 0,
          });
          logStats();
          return; // Move on immediately, don't wait
        }
      }
    } else {
      // If itemId was pre-set, verify it has a collection (only if not in batch map)
      if (wikidataMap.size === 0 || !wikidataMap.has(image.title)) {
        console.log(`  → Verifying pre-set Wikidata item ${itemId} has a collection/museum`);
        try {
          const hasMuseum = await hasCollection(itemId);
          if (!hasMuseum) {
            console.log(`  ⚠ No collection/museum found, skipping`);
            skipped++;
            await saveFailure({
              artist: options.artist,
              title: image.title,
              imageUrl: image.original?.url || image.thumb?.url || '',
              error: 'Wikidata item does not have a collection/museum (P195)',
              timestamp: new Date().toISOString(),
              retryCount: 0,
            });
            logStats();
            return;
          }
          console.log(`  ✓ Collection/museum verified`);
        } catch (err) {
          const errorMessage = (err as Error).message;
          const isRateLimit = errorMessage.includes('429') || errorMessage.includes('rate limit');
          if (isRateLimit) rateLimitErrors++;
          
          console.log(`  ✗ Error checking collection: ${errorMessage}${isRateLimit ? ' [RATE LIMIT - skipping]' : ''}`);
          skipped++;
          errors.push({ title: image.title, message: errorMessage });
          await saveFailure({
            artist: options.artist,
            title: image.title,
            imageUrl: image.original?.url || image.thumb?.url || '',
            error: `Collection check failed: ${errorMessage}`,
            timestamp: new Date().toISOString(),
            retryCount: 0,
          });
          logStats();
          return; // Move on immediately, don't wait
        }
      } else {
        console.log(`  ✓ Pre-set Wikidata item verified (in batch map): ${itemId}`);
      }
    }
    
    try {
      console.log(`  → Selecting best image variant`);
      const variant = pickBestVariant(image);
        if (!variant) {
          console.log(`  ⚠ No suitable variant found (size requirements not met), skipping`);
          skipped++;
          await saveFailure({
            artist: options.artist,
            title: image.title,
            imageUrl: image.original?.url || image.thumb?.url || '',
            error: 'No suitable image variant found (does not meet size requirements)',
            timestamp: new Date().toISOString(),
            retryCount: 0,
          });
          logStats();
          return;
        }
      console.log(`  ✓ Selected variant: ${variant.width}x${variant.height}`);
      
      if (options.dryRun) {
        console.log(`  [DRY RUN] Would upload: ${image.title}`);
        skipped++;
        return;
      }
      
      console.log(`  → Downloading image...`);
      const downloaded = await downloadImage(variant);
      console.log(`  ✓ Downloaded: ${downloaded.width}x${downloaded.height}, ${(downloaded.fileSize / 1024 / 1024).toFixed(2)}MB`);
      
      const storagePath = buildStoragePath(options.artist, image, downloaded.ext);
      console.log(`  → Uploading to storage: ${storagePath}`);
      const upload = await uploadToStorage(storagePath, downloaded);
      console.log(`  ✓ Uploaded to storage`);
      
      console.log(`  → Creating art record...`);
      const artId = await upsertArt({
        title: cleanTitle(normalizeTitle(image.title), options.artist),
        description: image.description ?? null,
        imageUrl: upload.publicUrl,
        artistId,
      });
      console.log(`  ✓ Art record created: ${artId}`);
      
      // Get Wikidata tags if available
      let normalizedTags: string[] = [];
      if (image.sourceItem) {
        console.log(`  → Fetching Wikidata tags...`);
        try {
          const wikidataTags = await fetchWikidataItemTags(image.sourceItem);
          normalizedTags = normalizeWikidataTags(wikidataTags, image.museum);
          console.log(`  ✓ Found ${normalizedTags.length} tags: ${normalizedTags.join(', ')}`);
        } catch (err) {
          console.log(`  ⚠ Could not fetch tags: ${(err as Error).message}`);
        }
      }
      
      // Upsert tags
      if (normalizedTags.length > 0) {
        console.log(`  → Linking tags...`);
        const tagIds = await upsertTags(normalizedTags).then((rows) => rows.map((r) => r.id));
        await linkArtTags(artId, tagIds);
        console.log(`  ✓ Linked ${tagIds.length} tags`);
      }
      
      // Upsert source
      console.log(`  → Adding source information...`);
      await upsertArtSource({
        artId,
        source: 'wikimedia',
        sourcePageId: image.pageid,
        sourceTitle: image.title,
        sourceUrl: image.pageUrl,
      });
      console.log(`  ✓ Source added`);
      
      // Insert asset
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
      
      uploaded++;
      console.log(`  ✓✓✓ Successfully uploaded: ${image.title}`);
      logStats();
      
    } catch (err) {
      const errorMessage = (err as Error).message;
      const isRateLimit = errorMessage.includes('429') || errorMessage.includes('rate limit') || errorMessage.includes('Too many requests');
      if (isRateLimit) rateLimitErrors++;
      
      console.log(`  ✗✗✗ Failed: ${errorMessage}${isRateLimit ? ' [RATE LIMIT]' : ''}`);
      errors.push({ title: image.title, message: errorMessage });
      await saveFailure({
        artist: options.artist,
        title: image.title,
        imageUrl: image.original?.url || image.thumb?.url || '',
        error: errorMessage,
        timestamp: new Date().toISOString(),
        retryCount: 0,
      });
      logStats();
    }
  };
  
  console.log(`\nStarting to process ${images.length} images with concurrency=${CONCURRENCY}...\n`);
  await processInParallel(images, processImage, CONCURRENCY);
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Processing complete for ${options.artist}`);
  console.log(`  Attempted: ${attempted}`);
  console.log(`  Uploaded: ${uploaded} ✓`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Errors: ${errors.length}`);
  console.log(`  Rate Limit Errors: ${rateLimitErrors}${rateLimitErrors > 0 ? ' ⚠️' : ''}`);
  if (errors.length > 0) {
    console.log(`\nErrors saved to: .failures/${options.artist.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}.json`);
  }
  if (rateLimitErrors > 5) {
    console.log(`\n⚠️  WARNING: High number of rate limit errors (${rateLimitErrors}). Consider retrying later.`);
  }
  console.log(`${'='.repeat(60)}\n`);
  
  return { attempted, uploaded, skipped, errors };
}

export function buildStoragePath(artist: string, image: WikimediaImage, ext: string): string {
  const artistSlug = slugify(artist);
  const titleSlug = slugify(image.title.replace(/^File:/i, ''));
  const safeTitle = titleSlug || `image-${image.pageid}`;
  return `${artistSlug}/${safeTitle}.${ext}`;
}

export function normalizeTitle(title: string): string {
  return title.replace(/^File:/i, '').trim();
}

/**
 * Clean up artwork titles by removing filename artifacts, artist names, museum names, and IDs
 */
export function cleanTitle(title: string, artistName?: string): string {
  let cleaned = title.trim();
  
  // Remove "File:" prefix
  cleaned = cleaned.replace(/^File:\s*/i, '');
  
  // Remove file extensions
  cleaned = cleaned.replace(/\.(jpg|jpeg|png|gif|tiff|tif|webp|svg)$/i, '');
  
  // Remove leading numbers and dashes (like "001", "0 Title")
  cleaned = cleaned.replace(/^\d+\s*[-.]?\s*/, '');
  
  // Remove parenthetical location info at start (like "(Albi)")
  cleaned = cleaned.replace(/^\([^)]+\)\s*[-.]?\s*/i, '');
  
  // Remove artist birth/death years in parentheses
  cleaned = cleaned.replace(/\s*\(\d{4}\s*-\s*\d{4}\)\s*[-.]?\s*/g, '');
  
  // Remove quotes around title
  cleaned = cleaned.replace(/^['"]\s*([^'"]+)\s*['"]\s*/, '$1');
  
  // Remove "by Artist Name" patterns
  if (artistName) {
    const artistPattern = new RegExp(`\\s*by\\s+${artistName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
    cleaned = cleaned.replace(artistPattern, '');
  }
  
  // Remove common museum/institution suffixes
  cleaned = cleaned.replace(/\s*-\s*(museum|gallery|collection|institute|foundation).*$/i, '');
  
  // Remove location suffixes (common patterns)
  cleaned = cleaned.replace(/\s*,\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s*$/, '');
  
  // Remove file hash suffixes (like "abc123def")
  cleaned = cleaned.replace(/[a-f0-9]{8,}\s*$/i, '');
  
  // Remove duplicate spaces
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  return cleaned;
}

export function normalizeWikidataTags(
  tags: { genre?: string; movement?: string; inceptionDate?: string },
  museum?: string,
): string[] {
  const result: string[] = [];

  if (tags.genre) {
    result.push(tags.genre.toLowerCase().trim());
  }
  if (tags.movement) {
    result.push(tags.movement.toLowerCase().trim());
  }
  if (tags.inceptionDate) {
    result.push(tags.inceptionDate.toLowerCase().trim());
  }
  if (museum) {
    result.push(museum.toLowerCase().trim());
  }

  return Array.from(new Set(result.filter(Boolean)));
}
