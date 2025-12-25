import { config } from './config';
import { fetchImageInfoByTitle, pickBestVariant, fetchImagesForArtist } from './wikimedia';
import { slugify } from './utils';
import { downloadImage } from './downloader';
import { uploadToStorage } from './storage';
import { WikimediaImage } from './types';
import { ensureArtist, insertArtAsset, linkArtTags, upsertArt, upsertArtSource, upsertTags } from './db';
import { fetchWikidataPaintings, fetchWikidataItemTags, hasCollection, findItemFromCommonsFile } from './wikidata';
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
  const limit = options.limit ?? 50;
  const CONCURRENCY = 5; // Process 5 images in parallel
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
  
  const artistId = await ensureArtist(options.artist);
  const errors: Array<{ title: string; message: string }> = [];
  let uploaded = 0;
  let skipped = 0;
  let attempted = 0;
  
  const processImage = async (image: WikimediaImage) => {
    if (maxUploads && uploaded >= maxUploads) {
      skipped++;
      return;
    }
    
    attempted++;
    
    // Filter: must have a collection/museum (P195 property in Wikidata)
    // Find the Wikidata item for this Commons file and verify it has a collection
    let itemId: string | null = image.sourceItem || null;
    if (!itemId) {
      // Try to find the Wikidata item from the Commons file
      itemId = await findItemFromCommonsFile(image.title);
      if (itemId) {
        // Update the image with the found sourceItem for later use
        image.sourceItem = itemId;
      }
    }
    
    if (!itemId) {
      // No Wikidata item found, skip
      skipped++;
      return;
    }
    
    // Verify the item has a collection/museum
    const hasMuseum = await hasCollection(itemId);
    if (!hasMuseum) {
      skipped++;
      return;
    }
    
    try {
      const variant = pickBestVariant(image);
      if (!variant) {
        skipped++;
        return;
      }
      
      if (options.dryRun) {
        console.log(`[DRY RUN] Would upload: ${image.title}`);
        skipped++;
        return;
      }
      
      const downloaded = await downloadImage(variant);
      const storagePath = buildStoragePath(options.artist, image, downloaded.ext);
      
      const upload = await uploadToStorage(storagePath, downloaded);
      const artId = await upsertArt({
        title: cleanTitle(normalizeTitle(image.title), options.artist),
        description: image.description ?? null,
        imageUrl: upload.publicUrl,
        artistId,
      });
      
      // Get Wikidata tags if available
      let normalizedTags: string[] = [];
      if (image.sourceItem) {
        const wikidataTags = await fetchWikidataItemTags(image.sourceItem);
        normalizedTags = normalizeWikidataTags(wikidataTags, image.museum);
      }
      
      // Upsert tags
      if (normalizedTags.length > 0) {
        const tagIds = await upsertTags(normalizedTags).then((rows) => rows.map((r) => r.id));
        await linkArtTags(artId, tagIds);
      }
      
      // Upsert source
      await upsertArtSource({
        artId,
        source: 'wikimedia',
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
      
      uploaded++;
      console.log(`✓ Uploaded: ${image.title}`);
      
    } catch (err) {
      const errorMessage = (err as Error).message;
      errors.push({ title: image.title, message: errorMessage });
      await saveFailure({
        artist: options.artist,
        title: image.title,
        imageUrl: image.original?.url || image.thumb?.url || '',
        error: errorMessage,
        timestamp: new Date().toISOString(),
        retryCount: 0,
      });
      console.error(`✗ Failed: ${image.title} - ${errorMessage}`);
    }
  };
  
  await processInParallel(images, processImage, CONCURRENCY);
  
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
