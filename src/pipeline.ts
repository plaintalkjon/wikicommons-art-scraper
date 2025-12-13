import { config } from './config';
import { fetchImageInfoByTitle, pickBestVariant } from './wikimedia';
import { slugify } from './utils';
import { downloadImage } from './downloader';
import { uploadToStorage } from './storage';
import { WikimediaImage } from './types';
import { ensureArtist, insertArtAsset, linkArtTags, upsertArt, upsertArtSource, upsertTags } from './db';
import { fetchWikidataPaintings, fetchWikidataItemTags, findArtistQID } from './wikidata';
import { saveFailure } from './failureTracker';

export interface FetchOptions {
  artist: string;
  limit?: number;
  dryRun?: boolean;
  paintingsOnly?: boolean;
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
  
  // Look up artist QID from name
  console.log(`Looking up Wikidata QID for artist: ${options.artist}...`);
  let artistQid = await findArtistQID(options.artist);
  
  // Special case for known problematic artists
  if (!artistQid) {
    const knownArtists: Record<string, string> = {
      'Jean‑François Millet': 'Q148458',
      'Jean-François Millet': 'Q148458',
      'Jean Francois Millet': 'Q148458',
      'Jean-Francois Millet': 'Q148458',
      'Édouard Manet': 'Q40599',
      'Edouard Manet': 'Q40599',
      'Rembrandt van Rijn': 'Q5598',
      'Rembrandt': 'Q5598',
      'Rembrandt Harmenszoon van Rijn': 'Q5598',
      'Michelangelo Merisi da Caravaggio': 'Q42207',
      'Caravaggio': 'Q42207',
      'Michelangelo Merisi': 'Q42207',
      'Diego Velázquez': 'Q297',
      'Diego Velazquez': 'Q297',
      'Diego Rodríguez de Silva y Velázquez': 'Q297',
    };
    artistQid = knownArtists[options.artist] || null;
  }
  
  if (!artistQid) {
    throw new Error(`Could not find Wikidata QID for artist: ${options.artist}`);
  }
  console.log(`Found artist QID: ${artistQid}`);
  
  // Always use Wikidata for discovery (museum-filtered paintings)
  const items = await fetchWikidataPaintings({ limit, artistQid: `wd:${artistQid}` });
  console.log(`Found ${items.length} paintings from Wikidata, fetching image info...`);
  
  // Fetch image info in parallel batches to avoid rate limiting (lower concurrency for API)
  const validItems = items.filter((item) => item.title).slice(0, limit);
  
  // Process in smaller batches with rate limiting (3 concurrent API calls)
  const fetchWithMetadata = async (item: { title: string; museum?: string; itemId?: string }) => {
    const info = await fetchImageInfoByTitle(item.title);
    if (!info) return null;
    info.museum = item.museum;
    info.sourceItem = item.itemId;
    return info;
  };

  // Process in smaller batches (2 at a time) with longer delays to respect rate limits
  const imageResults: (WikimediaImage | null)[] = [];
  const BATCH_SIZE = 2; // Reduced from 3 to 2
  const DELAY_MS = 1500; // 1.5 seconds between batches
  
  for (let i = 0; i < validItems.length; i += BATCH_SIZE) {
    const batch = validItems.slice(i, i + BATCH_SIZE);
    try {
      const batchResults = await Promise.all(batch.map(fetchWithMetadata));
      imageResults.push(...batchResults);
    } catch (err) {
      // If rate limited, add the batch items as null and wait longer
      console.warn(`Rate limit hit at batch ${i / BATCH_SIZE + 1}, waiting 5 seconds...`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
      // Retry the batch
      const batchResults = await Promise.all(batch.map(fetchWithMetadata));
      imageResults.push(...batchResults);
    }
    
    // Delay between batches
    if (i + BATCH_SIZE < validItems.length) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      if ((i / BATCH_SIZE) % 20 === 0 && i > 0) {
        console.log(`Fetched info for ${i + batch.length}/${validItems.length} items...`);
      }
    }
  }

  const images = imageResults.filter((img): img is WikimediaImage => img !== null);
  console.log(`Fetched info for ${images.length} images, processing...`);
  
  const artistId = await ensureArtist(options.artist);

  let uploaded = 0;
  let skipped = 0;
  const errors: FetchResult['errors'] = [];
  let processed = 0;

  // Process images in parallel batches
  const processImage = async (image: WikimediaImage): Promise<void> => {
    let reservedSlot = false;
    try {
      // Early exit if we've hit the upload limit (check before any processing)
      if (options.maxUploads && uploaded >= options.maxUploads) {
        processed += 1;
        return;
      }

      if (options.paintingsOnly && !isLikelyColorPainting(image)) {
        skipped += 1;
        processed += 1;
        if (processed % 10 === 0) {
          console.log(`Progress: ${processed}/${images.length} processed, ${uploaded} uploaded, ${skipped} skipped`);
        }
        return;
      }

      const variant = pickBestVariant(image);
      if (!variant) {
        skipped += 1;
        processed += 1;
        if (processed % 10 === 0) {
          console.log(`Progress: ${processed}/${images.length} processed, ${uploaded} uploaded, ${skipped} skipped`);
        }
        return;
      }

      // Reserve upload slot immediately (before any async work) to prevent race condition
      if (options.maxUploads) {
        const currentCount = uploaded;
        if (currentCount >= options.maxUploads) {
          processed += 1;
          return;
        }
        uploaded += 1; // Reserve the slot immediately
        reservedSlot = true;
        // If we went over (another process also incremented), release and skip
        if (uploaded > options.maxUploads) {
          uploaded -= 1;
          reservedSlot = false;
          processed += 1;
          return;
        }
      }

      const downloaded = await downloadImage(variant);
      const path = buildStoragePath(options.artist, image, downloaded.ext);

      if (!options.dryRun) {
        const upload = await uploadToStorage(path, downloaded);
        // Clean the title before storing
        const rawTitle = normalizeTitle(image.title);
        const cleanedTitle = cleanTitle(rawTitle);
        const artId = await upsertArt({
          title: cleanedTitle,
          description: image.description ?? null,
          imageUrl: upload.publicUrl,
          artistId,
        });

        // Always use Wikidata tags (genre, movement, inception date, artwork type)
        let normalizedTags: string[];
        if (image.sourceItem) {
          const wikidataTags = await fetchWikidataItemTags(image.sourceItem);
          // If no artwork type detected but we have a sourceItem, default to "painting"
          // (since current queries filter for paintings only; when we expand to sculptures, this will be detected)
          if (!wikidataTags.artworkType) {
            wikidataTags.artworkType = 'painting';
          }
          normalizedTags = normalizeWikidataTags(wikidataTags, image.museum);
        } else {
          // Fallback: if no sourceItem, use Commons categories (shouldn't happen with Wikidata source)
          // Default to "painting" for existing artworks
          const fallbackTags = normalizeTags(image.categories, image.museum);
          normalizedTags = ['painting', ...fallbackTags];
        }

        const tagIds = await upsertTags(normalizedTags).then((rows) => rows.map((r) => r.id));
        await linkArtTags(artId, tagIds);
        await upsertArtSource({
          artId,
          source: 'wikidata',
          sourcePageId: image.pageid,
          sourceTitle: image.title,
          sourceUrl: image.pageUrl,
        });
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
        // Slot was already reserved above, so uploaded counter is correct
      } else {
        // In dry-run mode, release the reserved slot since we didn't actually upload
        if (reservedSlot) {
          uploaded -= 1;
          reservedSlot = false;
        }
      }
      processed += 1;
      if (processed % 10 === 0 || processed === images.length) {
        console.log(`Progress: ${processed}/${images.length} processed, ${uploaded} uploaded, ${skipped} skipped`);
      }
    } catch (err) {
      // If we reserved a slot but failed, release it
      if (reservedSlot) {
        uploaded -= 1;
      }
      const errorMessage = (err as Error).message;
      errors.push({ title: image.title, message: errorMessage });
      
      // Save failure for later retry (only for download/upload errors, not skipped items)
      if (errorMessage.includes('Failed to download') || errorMessage.includes('Failed to insert') || errorMessage.includes('429') || errorMessage.includes('503')) {
        await saveFailure({
          artist: options.artist,
          title: image.title,
          imageUrl: image.original?.url || image.thumb?.url,
          error: errorMessage,
          timestamp: new Date().toISOString(),
          retryCount: 0,
        });
      }
      
      processed += 1;
    }
  };

  await processInParallel(images, processImage, CONCURRENCY);

  return {
    attempted: images.length,
    uploaded,
    skipped,
    errors,
  };
}

export function buildStoragePath(artist: string, image: WikimediaImage, ext: string): string {
  const artistSlug = slugify(artist);
  const titleSlug = slugify(image.title.replace(/^File:/i, ''));
  const safeTitle = titleSlug || `image-${image.pageid}`;
  return `${artistSlug}/${safeTitle}.${ext}`;
}

function isLikelyColorPainting(image: WikimediaImage): boolean {
  const cats = image.categories.map((c) => c.toLowerCase());
  const hasPainting = cats.some((c) => c.includes('painting'));
  if (!hasPainting) return false;

  const excludePatterns = [
    'drawing',
    'sketch',
    'etching',
    'engraving',
    'black-and-white',
    'black and white',
    'monochrome',
    'bw',
    'line art',
    'study',
  ];

  if (cats.some((c) => excludePatterns.some((p) => c.includes(p)))) {
    return false;
  }

  const mime = image.original?.mime ?? image.thumb?.mime ?? '';
  if (mime.includes('svg') || mime.includes('gif')) return false;

  return true;
}

export function normalizeTitle(title: string): string {
  return title.replace(/^File:/i, '').trim();
}

/**
 * Clean up artwork titles by removing filename artifacts
 * This is the same logic as cli-clean-titles.ts
 */
export function cleanTitle(title: string): string {
  let cleaned = title;
  
  // Remove "File:" prefix
  cleaned = cleaned.replace(/^File:\s*/i, '');
  
  // Remove file extensions
  cleaned = cleaned.replace(/\.(jpg|jpeg|png|gif|tiff|tif|webp|svg)$/i, '');
  
  // Remove common museum codes and identifiers
  cleaned = cleaned.replace(/\s*-\s*(s\d+[VvMmAa]\d+|Google Art Project|Art Project)/gi, '');
  cleaned = cleaned.replace(/\s*-\s*\d{4}\.\d+\s*-\s*[^-]+$/i, ''); // Museum accession numbers
  cleaned = cleaned.replace(/\s*\(\d{4}\)\s*$/i, ''); // Years in parentheses at end
  
  // Remove artist name if it appears at the start (common pattern)
  cleaned = cleaned.replace(/^(Vincent\s+van\s+Gogh|Van\s+Gogh|Rembrandt|Peter\s+Paul\s+Rubens|John\s+Singer\s+Sargent)[\s\-:]+/i, '');
  
  // Clean up multiple spaces/hyphens
  cleaned = cleaned.replace(/\s+/g, ' ');
  cleaned = cleaned.replace(/\s*-\s*/g, ' - ');
  cleaned = cleaned.replace(/^\s+|\s+$/g, '');
  
  // Capitalize first letter
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  
  return cleaned;
}

function normalizeTags(categories: string[], museum?: string): string[] {
  const noise = [
    'cc-pd',
    'cc-zero',
    'pd-old',
    'public domain',
    'wikimedia',
    'hidden-category',
    'maintenance',
    'images from',
  ];

  const base = [...categories];
  if (museum) base.push(museum);

  const cleaned = base
    .map((c) => c.replace(/^Category:/i, '').trim().toLowerCase())
    .map((c) => c.replace(/\s+/g, ' '))
    .filter(Boolean)
    .filter((c) => !noise.some((n) => c.includes(n)))
    .filter((c) => c.length <= 80);

  return Array.from(new Set(cleaned));
}

export function normalizeWikidataTags(
  tags: { genre?: string; movement?: string; inceptionDate?: string; artworkType?: string },
  museum?: string,
): string[] {
  const result: string[] = [];

  // Add artwork type first (painting or sculpture)
  if (tags.artworkType) {
    result.push(tags.artworkType.toLowerCase().trim());
  }

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

