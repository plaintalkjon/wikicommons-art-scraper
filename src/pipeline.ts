import { config } from './config';
import { fetchImageInfoByTitle, pickBestVariant } from './wikimedia';
import { slugify } from './utils';
import { downloadImage } from './downloader';
import { uploadToStorage } from './storage';
import { WikimediaImage } from './types';
import { ensureArtist, insertArtAsset, linkArtTags, upsertArt, upsertArtSource, upsertTags } from './db';
import { fetchWikidataPaintings, fetchWikidataItemTags, findArtistQID } from './wikidata';

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
  const artistQid = await findArtistQID(options.artist);
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
        const artId = await upsertArt({
          title: normalizeTitle(image.title),
          description: image.description ?? null,
          imageUrl: upload.publicUrl,
          artistId,
        });

        // Always use Wikidata tags (genre, movement, inception date)
        let normalizedTags: string[];
        if (image.sourceItem) {
          const wikidataTags = await fetchWikidataItemTags(image.sourceItem);
          normalizedTags = normalizeWikidataTags(wikidataTags, image.museum);
        } else {
          // Fallback: if no sourceItem, use Commons categories (shouldn't happen with Wikidata source)
          normalizedTags = normalizeTags(image.categories, image.museum);
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
      errors.push({ title: image.title, message: (err as Error).message });
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

function buildStoragePath(artist: string, image: WikimediaImage, ext: string): string {
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

function normalizeTitle(title: string): string {
  return title.replace(/^File:/i, '').trim();
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

function normalizeWikidataTags(
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
