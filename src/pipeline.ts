import { config } from './config';
import { fetchImageInfoByTitle, pickBestVariant } from './wikimedia';
import { slugify } from './utils';
import { downloadImage } from './downloader';
import { uploadToStorage } from './storage';
import { WikimediaImage, DownloadedImage } from './types';
import { ensureArtist, insertArtAsset, linkArtTags, upsertArt, upsertArtSource, upsertTags } from './db';
import { fetchWikidataItemTags } from './wikidata';
import { saveFailure } from './failureTracker';
import { supabase } from './supabaseClient';

function extensionFromMime(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/tiff': 'tif',
    'image/svg+xml': 'svg',
  };
  return map[mime] ?? 'img';
}

export interface FetchOptions {
  artist: string;
  limit?: number;
  dryRun?: boolean;
  paintingsOnly?: boolean; // Kept for CLI compatibility but not used (wikidata.ts only fetches paintings now)
  maxUploads?: number;
  source?: 'wikimedia' | 'metmuseum' | 'both'; // Default: 'wikimedia'
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
  const CONCURRENCY = 2; // Process 2 images in parallel (matches Wikimedia's max concurrent download limit)
  const maxUploads = options.maxUploads;
  const source = options.source || 'wikimedia';
  
  console.log(`Fetching artworks for: ${options.artist} (source: ${source})...`);
  
  // Route to appropriate source handler
  if (source === 'metmuseum') {
    return await fetchAndStoreFromMetMuseum(options);
  } else if (source === 'both') {
    // Fetch from both sources and combine results
    const [wikimediaResult, metResult] = await Promise.all([
      fetchAndStoreFromWikimedia(options),
      fetchAndStoreFromMetMuseum(options),
    ]);
    
    return {
      attempted: wikimediaResult.attempted + metResult.attempted,
      uploaded: wikimediaResult.uploaded + metResult.uploaded,
      skipped: wikimediaResult.skipped + metResult.skipped,
      errors: [...wikimediaResult.errors, ...metResult.errors],
    };
  } else {
    // Default: wikimedia
    return await fetchAndStoreFromWikimedia(options);
  }
}

async function fetchAndStoreFromWikimedia(options: FetchOptions): Promise<FetchResult> {
  const limit = options.limit ?? 10000;
  const CONCURRENCY = 2;
  const maxUploads = options.maxUploads;
  
  // Step 1: Find artist QID
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Step 1: Finding artist in Wikidata`);
  console.log(`${'='.repeat(60)}`);
  console.log(`→ Searching for artist: "${options.artist}"...`);
  
  let artistQID: string | null = null;
  let artworks: Array<{ itemQid: string; imageUrl: string; commonsTitle: string }> = [];
  
  try {
    const { findArtistQID, findArtworksByArtist } = await import('./wikidata');
    const startTime = Date.now();
    artistQID = await findArtistQID(options.artist);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    
    if (artistQID) {
      console.log(`✓ Found artist QID: ${artistQID} (took ${elapsed}s)`);
      console.log(`\n${'='.repeat(60)}`);
      console.log(`Step 2: Querying artworks by ${options.artist}`);
      console.log(`${'='.repeat(60)}`);
      console.log(`→ Querying Wikidata for artworks by artist ${artistQID}...`);
      console.log(`  (Looking for items with: creator=${artistQID}, has image, has collection)`);
      
      const queryStartTime = Date.now();
      artworks = await findArtworksByArtist(artistQID);
      const queryElapsed = ((Date.now() - queryStartTime) / 1000).toFixed(1);
      
      console.log(`✓ Query complete (took ${queryElapsed}s)`);
      console.log(`✓ Found ${artworks.length} artworks with images and collections`);
      
      if (artworks.length === 0) {
        console.log(`⚠ No artworks found for ${options.artist} with images and collections`);
        return { attempted: 0, uploaded: 0, skipped: 0, errors: [] };
      }
    } else {
      console.log(`⚠ Could not find artist QID for "${options.artist}" (took ${elapsed}s)`);
      console.log(`  Possible reasons:`);
      console.log(`    - Artist name doesn't match Wikidata label exactly`);
      console.log(`    - Artist doesn't have a Wikidata entry`);
      console.log(`    - Query timed out`);
      return { attempted: 0, uploaded: 0, skipped: 0, errors: [] };
    }
  } catch (err) {
    const errorMessage = (err as Error).message;
    const isRateLimit = errorMessage.includes('429') || errorMessage.includes('rate limit');
    const isTimeout = errorMessage.includes('timeout');
    
    console.error(`\n✗ Error during artist lookup or artwork query:`);
    console.error(`  Error: ${errorMessage}`);
    
    if (isRateLimit) {
      console.error(`  → This is a rate limit error (429)`);
    } else if (isTimeout) {
      console.error(`  → This is a timeout error`);
    } else {
      console.error(`  → Unexpected error type`);
    }
    
    return { attempted: 0, uploaded: 0, skipped: 0, errors: [] };
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Step 3: Processing ${artworks.length} artworks from Wikidata`);
  console.log(`${'='.repeat(60)}`);
  
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
  
  const processArtwork = async (artwork: { itemQid: string; imageUrl: string; commonsTitle: string }) => {
    if (maxUploads && uploaded >= maxUploads) {
      skipped++;
      return;
    }
    
    attempted++;
    console.log(`[${attempted}/${artworks.length}] Processing: ${artwork.commonsTitle} (QID: ${artwork.itemQid})`);
    
    try {
      // Fetch Commons file info using the title from Wikidata
      console.log(`  → Fetching Commons file info for: "${artwork.commonsTitle}"...`);
      const { fetchImageInfoByTitle } = await import('./wikimedia');
      const fetchStartTime = Date.now();
      const image = await fetchImageInfoByTitle(artwork.commonsTitle);
      const fetchElapsed = ((Date.now() - fetchStartTime) / 1000).toFixed(1);
      
      if (!image) {
        console.log(`  ⚠ Could not fetch Commons file info (took ${fetchElapsed}s), skipping`);
        skipped++;
        await saveFailure({
          artist: options.artist,
          title: artwork.commonsTitle,
          imageUrl: artwork.imageUrl,
          error: 'Could not fetch Commons file info',
          timestamp: new Date().toISOString(),
          retryCount: 0,
        });
        logStats();
        return;
      }
      
      console.log(`  ✓ Fetched Commons file info (took ${fetchElapsed}s)`);
      image.sourceItem = artwork.itemQid; // Set Wikidata QID
      
      // Check size requirements
      console.log(`  → Selecting best image variant`);
      const { pickBestVariant } = await import('./wikimedia');
      const variant = pickBestVariant(image);
      
      if (!variant) {
        console.log(`  ⚠ No suitable variant found (size requirements not met), skipping`);
        skipped++;
        await saveFailure({
          artist: options.artist,
          title: artwork.commonsTitle,
          imageUrl: artwork.imageUrl,
          error: 'No suitable image variant found (does not meet size requirements)',
          timestamp: new Date().toISOString(),
          retryCount: 0,
        });
        logStats();
        return;
      }
      
      console.log(`  ✓ Selected variant: ${variant.width}x${variant.height}`);
      
      if (options.dryRun) {
        console.log(`  [DRY RUN] Would upload: ${artwork.commonsTitle}`);
        skipped++;
        return;
      }
      
      // Check if artwork already exists in database (caching)
      // First check by Wikidata QID (most reliable), then by title
      const { findArtByWikidataQID } = await import('./db');
      let existingArtId: string | null = null;
      
      // Check by Wikidata QID first
      if (artwork.itemQid) {
        existingArtId = await findArtByWikidataQID(artwork.itemQid, artistId);
        if (existingArtId) {
          console.log(`  ✓ Artwork already exists in database (matched by Wikidata QID: ${artwork.itemQid}), skipping`);
          skipped++;
          logStats();
          return;
        }
      }
      
      // Fallback: check by normalized title
      const normalizedTitle = cleanTitle(normalizeTitle(image.title), options.artist);
      const existingArt = await supabase
        .from('arts')
        .select('id')
        .eq('artist_id', artistId)
        .eq('title', normalizedTitle)
        .limit(1)
        .maybeSingle();
      
      if (existingArt.data?.id) {
        console.log(`  ✓ Artwork already exists in database (matched by title), skipping`);
        skipped++;
        logStats();
        return;
      }
      
      // Download and upload
      console.log(`  → Downloading image...`);
      const { downloadImage } = await import('./downloader');
      const downloaded = await downloadImage(variant);
      console.log(`  ✓ Downloaded: ${downloaded.width}x${downloaded.height}, ${(downloaded.fileSize / 1024 / 1024).toFixed(2)}MB`);
      
      const storagePath = buildStoragePath(options.artist, image, downloaded.ext);
      console.log(`  → Uploading to storage: ${storagePath}`);
      const { uploadToStorage } = await import('./storage');
      const upload = await uploadToStorage(storagePath, downloaded);
      console.log(`  ✓ Uploaded to storage`);
      
      // Create database records
      console.log(`  → Creating art record...`);
      const { upsertArt } = await import('./db');
      const artId = await upsertArt({
        title: cleanTitle(normalizeTitle(image.title), options.artist),
        description: image.description ?? null,
        imageUrl: upload.publicUrl,
        artistId,
      });
      console.log(`  ✓ Art record created: ${artId}`);
      
      // Get Wikidata tags
      let normalizedTags: string[] = [];
      console.log(`  → Fetching Wikidata tags...`);
      try {
        const { fetchWikidataItemTags } = await import('./wikidata');
        const { normalizeWikidataTags } = await import('./pipeline');
        const wikidataTags = await fetchWikidataItemTags(artwork.itemQid);
        normalizedTags = normalizeWikidataTags(wikidataTags, image.museum);
        console.log(`  ✓ Found ${normalizedTags.length} tags: ${normalizedTags.join(', ')}`);
      } catch (err) {
        console.log(`  ⚠ Could not fetch tags: ${(err as Error).message}`);
      }
      
      // Upsert tags
      if (normalizedTags.length > 0) {
        console.log(`  → Linking tags...`);
        const { upsertTags, linkArtTags } = await import('./db');
        const tagIds = await upsertTags(normalizedTags).then((rows) => rows.map((r) => r.id));
        await linkArtTags(artId, tagIds);
        console.log(`  ✓ Linked ${tagIds.length} tags`);
      }
      
      // Upsert source
      console.log(`  → Adding source information...`);
      const { upsertArtSource } = await import('./db');
      await upsertArtSource({
        artId,
        source: 'wikimedia',
        sourcePageId: image.pageid,
        sourceTitle: image.title,
        sourceUrl: image.pageUrl,
        wikidataQID: artwork.itemQid, // Store Wikidata QID for deduplication
      });
      console.log(`  ✓ Source added`);
      
      // Insert asset
      console.log(`  → Creating asset record...`);
      const { insertArtAsset } = await import('./db');
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
      console.log(`  ✓✓✓ Successfully uploaded: ${artwork.commonsTitle}`);
      logStats();
      
    } catch (err) {
      const errorMessage = (err as Error).message;
      const isRateLimit = errorMessage.includes('429') || errorMessage.includes('rate limit') || errorMessage.includes('Too many requests');
      if (isRateLimit) rateLimitErrors++;
      
      console.log(`  ✗✗✗ Failed: ${errorMessage}${isRateLimit ? ' [RATE LIMIT]' : ''}`);
      errors.push({ title: artwork.commonsTitle, message: errorMessage });
      await saveFailure({
        artist: options.artist,
        title: artwork.commonsTitle,
        imageUrl: artwork.imageUrl,
        error: errorMessage,
        timestamp: new Date().toISOString(),
        retryCount: 0,
      });
      logStats();
    }
  };
  
  console.log(`\nStarting to process ${artworks.length} artworks with concurrency=${CONCURRENCY}...\n`);
  await processInParallel(artworks, processArtwork, CONCURRENCY);
  
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

async function fetchAndStoreFromMetMuseum(options: FetchOptions): Promise<FetchResult> {
  const CONCURRENCY = 2;
  const maxUploads = options.maxUploads;
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Step 1: Finding artist in Wikidata`);
  console.log(`${'='.repeat(60)}`);
  console.log(`→ Searching for artist: "${options.artist}"...`);
  
  // First, find the artist QID (same as Wikimedia flow)
  let artistQID: string | null = null;
  let artworks: Array<{ objectID: number; title: string; artistDisplayName?: string; primaryImage?: string; objectDate?: string; wikidataQID?: string }> = [];
  
  try {
    const { findArtistQID } = await import('./wikidata');
    const { findArtworksByArtist } = await import('./metmuseum');
    const startTime = Date.now();
    artistQID = await findArtistQID(options.artist);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    
    if (artistQID) {
      console.log(`✓ Found artist QID: ${artistQID} (took ${elapsed}s)`);
      console.log(`\n${'='.repeat(60)}`);
      console.log(`Step 2: Finding Met Museum artworks via Wikidata`);
      console.log(`${'='.repeat(60)}`);
      
      const queryStartTime = Date.now();
      artworks = await findArtworksByArtist(artistQID);
      const queryElapsed = ((Date.now() - queryStartTime) / 1000).toFixed(1);
      
      console.log(`✓ Query complete (took ${queryElapsed}s)`);
      console.log(`✓ Found ${artworks.length} artworks in Met Museum with images`);
      
      if (artworks.length === 0) {
        console.log(`⚠ No Met Museum artworks found for ${options.artist}`);
        return { attempted: 0, uploaded: 0, skipped: 0, errors: [] };
      }
    } else {
      console.log(`⚠ Could not find artist QID for "${options.artist}"`);
      return { attempted: 0, uploaded: 0, skipped: 0, errors: [] };
    }
  } catch (err) {
    const errorMessage = (err as Error).message;
    const isRateLimit = errorMessage.includes('429') || errorMessage.includes('rate limit');
    const isTimeout = errorMessage.includes('timeout');
    
    console.error(`\n✗ Error during artist lookup or Met Museum query:`);
    console.error(`  Error: ${errorMessage}`);
    
    if (isRateLimit) {
      console.error(`  → This is a rate limit error (429)`);
    } else if (isTimeout) {
      console.error(`  → This is a timeout error`);
    }
    
    return { attempted: 0, uploaded: 0, skipped: 0, errors: [] };
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Step 2: Processing ${artworks.length} artworks from Met Museum`);
  console.log(`${'='.repeat(60)}`);
  
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
  
  const processArtwork = async (artwork: { objectID: number; title: string; artistDisplayName?: string; primaryImage?: string; objectDate?: string; wikidataQID?: string }) => {
    if (maxUploads && uploaded >= maxUploads) {
      skipped++;
      return;
    }
    
    attempted++;
    console.log(`[${attempted}/${artworks.length}] Processing: ${artwork.title} (Object ID: ${artwork.objectID})`);
    
    // Require Wikidata QID for tags
    if (!artwork.wikidataQID) {
      console.log(`  ⚠ Skipping: artwork has no Wikidata QID (required for tags)`);
      skipped++;
      await saveFailure({
        artist: options.artist,
        title: artwork.title,
        imageUrl: artwork.primaryImage || '',
        error: 'No Wikidata QID found (required for tags)',
        timestamp: new Date().toISOString(),
        retryCount: 0,
      });
      logStats();
      return;
    }
    
    try {
      // Add delay between Met API requests to avoid overwhelming the API
      // This helps reduce 403 bot protection errors
      await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay to be more conservative
      
      // Fetch full object details
      console.log(`  → Fetching object details for ID ${artwork.objectID}...`);
      const { fetchObjectDetails, normalizeMetTags, extractImageDimensions } = await import('./metmuseum');
      const fetchStartTime = Date.now();
      const object = await fetchObjectDetails(artwork.objectID);
      const fetchElapsed = ((Date.now() - fetchStartTime) / 1000).toFixed(1);
      
      if (!object || !object.primaryImage) {
        console.log(`  ⚠ Could not fetch object details or no image available (took ${fetchElapsed}s), skipping`);
        skipped++;
        await saveFailure({
          artist: options.artist,
          title: artwork.title,
          imageUrl: artwork.primaryImage || '',
          error: 'Could not fetch object details or no image',
          timestamp: new Date().toISOString(),
          retryCount: 0,
        });
        logStats();
        return;
      }
      
      console.log(`  ✓ Fetched object details (took ${fetchElapsed}s)`);
      
      // Check if artwork already exists in database
      // First check by Wikidata QID (most reliable), then by title
      const { findArtByWikidataQID } = await import('./db');
      let existingArtId: string | null = null;
      
      // Check by Wikidata QID first
      if (artwork.wikidataQID) {
        existingArtId = await findArtByWikidataQID(artwork.wikidataQID, artistId);
        if (existingArtId) {
          console.log(`  ✓ Artwork already exists in database (matched by Wikidata QID: ${artwork.wikidataQID}), skipping`);
          skipped++;
          logStats();
          return;
        }
      }
      
      // Fallback: check by normalized title
      const normalizedTitle = cleanTitle(object.title, options.artist);
      const existingArt = await supabase
        .from('arts')
        .select('id')
        .eq('artist_id', artistId)
        .eq('title', normalizedTitle)
        .limit(1)
        .maybeSingle();
      
      if (existingArt.data?.id) {
        console.log(`  ✓ Artwork already exists in database (matched by title), skipping`);
        skipped++;
        logStats();
        return;
      }
      
      if (options.dryRun) {
        console.log(`  [DRY RUN] Would upload: ${object.title}`);
        skipped++;
        return;
      }
      
      // Download image
      console.log(`  → Downloading image...`);
      const { downloadImage } = await import('./downloader');
      
      // Create ImageVariant from Met primaryImage
      // We'll need to download to get dimensions, or use a placeholder
      const imageVariant = {
        url: object.primaryImage,
        width: 0, // Will be set after download
        height: 0,
        mime: 'image/jpeg', // Met images are typically JPEG
      };
      
      const downloaded = await downloadImage(imageVariant);
      console.log(`  ✓ Downloaded: ${downloaded.width}x${downloaded.height}, ${(downloaded.fileSize / 1024 / 1024).toFixed(2)}MB`);
      
      // Check size requirements (same as Wikimedia: min 1280px width or height)
      const MIN_VARIANT_WIDTH = 1280;
      if (downloaded.width < MIN_VARIANT_WIDTH && downloaded.height < MIN_VARIANT_WIDTH) {
        console.log(`  ⚠ Image too small (${downloaded.width}x${downloaded.height}), skipping`);
        skipped++;
        await saveFailure({
          artist: options.artist,
          title: object.title,
          imageUrl: object.primaryImage,
          error: `Image too small: ${downloaded.width}x${downloaded.height} (minimum: ${MIN_VARIANT_WIDTH}px)`,
          timestamp: new Date().toISOString(),
          retryCount: 0,
        });
        logStats();
        return;
      }
      
      // Build storage path (Met Museum objects don't have pageid, use objectID)
      const artistSlug = slugify(options.artist);
      const titleSlug = slugify(object.title.replace(/^File:/i, ''));
      const safeTitle = titleSlug || `object-${object.objectID}`;
      const storagePath = `${artistSlug}/${safeTitle}.${downloaded.ext}`;
      console.log(`  → Uploading to storage: ${storagePath}`);
      const { uploadToStorage } = await import('./storage');
      const upload = await uploadToStorage(storagePath, downloaded);
      console.log(`  ✓ Uploaded to storage`);
      
      // Create database records
      console.log(`  → Creating art record...`);
      const { upsertArt } = await import('./db');
      const artId = await upsertArt({
        title: normalizedTitle,
        description: object.medium || object.dimensions || null,
        imageUrl: upload.publicUrl,
        artistId,
      });
      console.log(`  ✓ Art record created: ${artId}`);
      
      // Get tags from both Wikidata and Met object
      let normalizedTags: string[] = [];
      console.log(`  → Fetching Wikidata tags (QID: ${artwork.wikidataQID})...`);
      try {
        const { fetchWikidataItemTags } = await import('./wikidata');
        const { normalizeWikidataTags } = await import('./pipeline');
        const wikidataTags = await fetchWikidataItemTags(artwork.wikidataQID);
        const wikidataNormalized = normalizeWikidataTags(wikidataTags, object.department);
        normalizedTags.push(...wikidataNormalized);
        console.log(`  ✓ Found ${wikidataNormalized.length} Wikidata tags: ${wikidataNormalized.join(', ')}`);
      } catch (err) {
        console.log(`  ⚠ Could not fetch Wikidata tags: ${(err as Error).message}`);
      }
      
      // Also add Met tags (as supplementary)
      try {
        const { normalizeMetTags } = await import('./metmuseum');
        const metTags = normalizeMetTags(object.tags);
        normalizedTags.push(...metTags);
        if (object.department) {
          normalizedTags.push(object.department.toLowerCase().trim());
        }
        // Deduplicate
        normalizedTags = Array.from(new Set(normalizedTags));
        console.log(`  ✓ Total tags (Wikidata + Met): ${normalizedTags.length}`);
      } catch (err) {
        console.log(`  ⚠ Could not process Met tags: ${(err as Error).message}`);
      }
      
      // Upsert tags
      if (normalizedTags.length > 0) {
        console.log(`  → Linking tags...`);
        const { upsertTags, linkArtTags } = await import('./db');
        const tagIds = await upsertTags(normalizedTags).then((rows) => rows.map((r) => r.id));
        await linkArtTags(artId, tagIds);
        console.log(`  ✓ Linked ${tagIds.length} tags`);
      }
      
      // Upsert source
      console.log(`  → Adding source information...`);
      const { upsertArtSource } = await import('./db');
      await upsertArtSource({
        artId,
        source: 'metmuseum',
        sourcePageId: object.objectID,
        sourceTitle: object.title,
        sourceUrl: object.objectURL || `https://www.metmuseum.org/art/collection/search/${object.objectID}`,
        wikidataQID: artwork.wikidataQID, // Store Wikidata QID for deduplication
      });
      console.log(`  ✓ Source added`);
      
      // Insert asset
      console.log(`  → Creating asset record...`);
      const { insertArtAsset } = await import('./db');
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
      console.log(`  ✓✓✓ Successfully uploaded: ${object.title}`);
      logStats();
      
    } catch (err) {
      const errorMessage = (err as Error).message;
      const isRateLimit = errorMessage.includes('429') || errorMessage.includes('rate limit') || errorMessage.includes('Too many requests');
      if (isRateLimit) rateLimitErrors++;
      
      console.log(`  ✗✗✗ Failed: ${errorMessage}${isRateLimit ? ' [RATE LIMIT]' : ''}`);
      errors.push({ title: artwork.title, message: errorMessage });
      await saveFailure({
        artist: options.artist,
        title: artwork.title,
        imageUrl: artwork.primaryImage || '',
        error: errorMessage,
        timestamp: new Date().toISOString(),
        retryCount: 0,
      });
      logStats();
    }
  };
  
  console.log(`\nStarting to process ${artworks.length} artworks with concurrency=${CONCURRENCY}...\n`);
  await processInParallel(artworks, processArtwork, CONCURRENCY);
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Processing complete for ${options.artist} (Met Museum)`);
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
