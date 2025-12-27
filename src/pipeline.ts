import { config, supabase } from './config';
import { fetchImageInfoByTitle, pickBestVariant } from './wikimedia';
import { downloadImage } from './downloader';
import { WikimediaImage, DownloadedImage, ImageVariant } from './types';
import { ensureArtist, insertArtAsset, linkArtTags, upsertArt, upsertArtSource, upsertTags, uploadToStorage } from './db';
import { fetchWikidataItemTags } from './wikidata';
import { saveFailure } from './failureTracker';
import { normalizeTitle, cleanTitle, buildStoragePath, normalizeWikidataTags } from './artUtils';

export interface FetchOptions {
  artist: string;
  source?: 'wikimedia' | 'nga';
  limit?: number;
  dryRun?: boolean;
  maxUploads?: number;
  media?: string[]; // optional media filter (e.g., ['painting','sculpture']); defaults apply
  excludeDrawings?: boolean; // default true
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
  const source = options.source || 'wikimedia';
  console.log(`Fetching artworks for: ${options.artist} from ${source}...`);
  
  if (source === 'nga') {
    return await fetchAndStoreFromNGA(options);
  }
  
  return await fetchAndStoreFromWikimedia(options);
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
      const { uploadToStorage } = await import('./db');
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
        const { normalizeWikidataTags } = await import('./artUtils');
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

async function fetchAndStoreFromNGA(options: FetchOptions): Promise<FetchResult> {
  const limit = options.limit ?? 10000;
  const CONCURRENCY = 2;
  const maxUploads = options.maxUploads;
  const allowedMedia = (options.media?.length ? options.media : ['painting', 'sculpture']).map((m) => m.toLowerCase());
  const excludeDrawings = options.excludeDrawings !== undefined ? options.excludeDrawings : true;
  const matchesMediaFilter = (classification?: string | null, medium?: string | null): boolean => {
    if (allowedMedia.includes('all')) return true;
    const cls = (classification ?? '').toLowerCase();
    const med = (medium ?? '').toLowerCase();
    return allowedMedia.some((token) => cls.includes(token) || med.includes(token));
  };

  const isDrawingLike = (classification?: string | null, medium?: string | null): boolean => {
    const cls = (classification ?? '').toLowerCase();
    const med = (medium ?? '').toLowerCase();
    const drawingTokens = [
      'drawing',
      'graphite',
      'chalk',
      'charcoal',
      'pen and ink',
      'ink',
      'wash',
      'watercolor',
      'gouache',
      'pastel',
      'colored pencil',
    ];
    return drawingTokens.some((t) => cls.includes(t) || med.includes(t));
  };
  
  // Step 1: Find artist in NGA
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Step 1: Finding artist in NGA`);
  console.log(`${'='.repeat(60)}`);
  console.log(`→ Searching for artist: "${options.artist}"...`);
  
  let constituentId: string | null = null;
  let artworks: Array<{ object: any; image: any }> = [];
  
  try {
    const { findNGAArtist, findArtworksByConstituent } = await import('./nga');
    const startTime = Date.now();
    const artist = await findNGAArtist(options.artist);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    
    if (artist) {
      constituentId = artist.constituentid;
      console.log(`✓ Found artist: ${artist.name} (ID: ${constituentId}, took ${elapsed}s)`);
      if (artist.wikidataid) {
        console.log(`  Wikidata ID: ${artist.wikidataid}`);
      }
      
      console.log(`\n${'='.repeat(60)}`);
      console.log(`Step 2: Querying artworks by ${artist.name}`);
      console.log(`${'='.repeat(60)}`);
      console.log(`→ Querying NGA for artworks by constituent ${constituentId}...`);
      
      const queryStartTime = Date.now();
      artworks = await findArtworksByConstituent(constituentId);
      const queryElapsed = ((Date.now() - queryStartTime) / 1000).toFixed(1);
      
      console.log(`✓ Query complete (took ${queryElapsed}s)`);
      console.log(`✓ Found ${artworks.length} artworks`);
      
      if (artworks.length === 0) {
        console.log(`⚠ No artworks found for ${options.artist} in NGA collection`);
        return { attempted: 0, uploaded: 0, skipped: 0, errors: [] };
      }
    } else {
      console.log(`⚠ Could not find artist "${options.artist}" in NGA (took ${elapsed}s)`);
      return { attempted: 0, uploaded: 0, skipped: 0, errors: [] };
    }
  } catch (err) {
    const errorMessage = (err as Error).message;
    console.error(`\n✗ Error during artist lookup or artwork query:`);
    console.error(`  Error: ${errorMessage}`);
    return { attempted: 0, uploaded: 0, skipped: 0, errors: [] };
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Step 3: Processing ${artworks.length} artworks from NGA`);
  console.log(`${'='.repeat(60)}`);
  
  const artistId = await ensureArtist(options.artist);
  const errors: Array<{ title: string; message: string }> = [];
  let uploaded = 0;
  let skipped = 0;
  let attempted = 0;
  
  const logStats = () => {
    console.log(`\n📊 Progress: Attempted=${attempted} | Uploaded=${uploaded} | Skipped=${skipped} | Errors=${errors.length}\n`);
  };
  
  const processArtwork = async (artwork: { object: any; image: any }) => {
    if (maxUploads && uploaded >= maxUploads) {
      skipped++;
      return;
    }
    
    attempted++;
    const title = artwork.object.title || `Untitled (Object ID: ${artwork.object.objectid})`;
    console.log(`[${attempted}/${artworks.length}] Processing: ${title} (Object ID: ${artwork.object.objectid})`);
    
    try {
      // Media filter (classification/medium). Default allows painting & sculpture; override with --media option.
      if (!matchesMediaFilter(artwork.object.classification, artwork.object.medium)) {
        console.log(
          `  ⚠ Skipping due to media filter (classification="${artwork.object.classification || ''}", medium="${artwork.object.medium || ''}")`,
        );
        skipped++;
        return;
      }
      if (excludeDrawings && isDrawingLike(artwork.object.classification, artwork.object.medium)) {
        console.log(
          `  ⚠ Skipping drawing-like work (classification="${artwork.object.classification || ''}", medium="${artwork.object.medium || ''}")`,
        );
        skipped++;
        return;
      }
      
      // Resolve image via published_images first, then fallback to IIIF manifest
      const { getNGABestImageUrl, getNGADimensions, fetchIIIFImageForObject } = await import('./nga');
      
      let imageUrl: string | null = null;
      let width = 0;
      let height = 0;
      
      if (artwork.image) {
        imageUrl = getNGABestImageUrl(artwork.image);
        const dimensions = getNGADimensions(artwork.image);
        width = dimensions?.width || 0;
        height = dimensions?.height || 0;
      }
      
      // Fallback: try IIIF manifest when no published_images entry or URL
      if (!imageUrl) {
        const iiif = await fetchIIIFImageForObject(artwork.object.objectid);
        if (iiif) {
          imageUrl = iiif.url;
          width = iiif.width || width;
          height = iiif.height || height;
        }
      }
      
      // No image found after both methods
      if (!imageUrl) {
        console.log(`  ⚠ No image available (published_images and IIIF manifest), skipping`);
        skipped++;
        await saveFailure({
          artist: options.artist,
          title,
          imageUrl: '',
          error: 'No image available in NGA published_images or IIIF manifest',
          timestamp: new Date().toISOString(),
          retryCount: 0,
        });
        logStats();
        return;
      }
      
      // Check size requirements (same as Wikimedia):
      // 1. At least one dimension (width OR height) must be >= 1800px
      // 2. At least one dimension (width OR height) must be >= 1280px
      const MIN_ORIGINAL_WIDTH = 1800;
      const MIN_VARIANT_WIDTH = 1280;
      
      if (width > 0 && height > 0) {
        // Check 1800px requirement (at least width OR height >= 1800)
        if (width < MIN_ORIGINAL_WIDTH && height < MIN_ORIGINAL_WIDTH) {
          console.log(`  ⚠ Image too small (${width}x${height}), skipping - requires at least 1800px in width or height`);
          skipped++;
          await saveFailure({
            artist: options.artist,
            title,
            imageUrl,
            error: `Image too small: ${width}x${height} (requires at least 1800px in width or height)`,
            timestamp: new Date().toISOString(),
            retryCount: 0,
          });
          logStats();
          return;
        }
        
        // Check 1280px requirement (at least width OR height >= 1280)
        if (width < MIN_VARIANT_WIDTH && height < MIN_VARIANT_WIDTH) {
          console.log(`  ⚠ Image too small (${width}x${height}), skipping - requires at least 1280px in width or height`);
          skipped++;
          await saveFailure({
            artist: options.artist,
            title,
            imageUrl,
            error: `Image too small: ${width}x${height} (requires at least 1280px in width or height)`,
            timestamp: new Date().toISOString(),
            retryCount: 0,
          });
          logStats();
          return;
        }
      } else {
        // If dimensions are missing, we'll still try to download and check actual dimensions
        // (downloader will extract dimensions from image buffer)
        console.log(`  ⚠ Dimensions not available in CSV, will check after download`);
      }
      
      console.log(`  ✓ Image URL: ${imageUrl}`);
      if (width > 0 && height > 0) {
        console.log(`  ✓ Dimensions: ${width}x${height}`);
      }
      
      if (options.dryRun) {
        console.log(`  [DRY RUN] Would upload: ${title}`);
        skipped++;
        return;
      }
      
      // Check if artwork already exists
      const { findArtByNGADbjectId } = await import('./db');
      const existingArtId = await findArtByNGADbjectId(artwork.object.objectid, artistId);
      if (existingArtId) {
        console.log(`  ✓ Artwork already exists in database (matched by NGA Object ID), skipping`);
        skipped++;
        logStats();
        return;
      }
      
      // Download image
      console.log(`  → Downloading image...`);
      const { downloadImage } = await import('./downloader');
      
      // Create ImageVariant from NGA image
      const variant: ImageVariant = {
        url: imageUrl,
        width: width || 0,
        height: height || 0,
        mime: 'image/jpeg', // NGA images are typically JPEG
      };
      
      const downloaded = await downloadImage(variant);
      console.log(`  ✓ Downloaded: ${downloaded.width}x${downloaded.height}, ${(downloaded.fileSize / 1024 / 1024).toFixed(2)}MB`);
      
      // Build storage path
      const { buildStoragePath } = await import('./artUtils');
      const storagePath = buildStoragePath(options.artist, {
        title: title,
        pageid: parseInt(artwork.object.objectid, 10),
      } as any, downloaded.ext);
      
      console.log(`  → Uploading to storage: ${storagePath}`);
      const { uploadToStorage } = await import('./db');
      const upload = await uploadToStorage(storagePath, downloaded);
      console.log(`  ✓ Uploaded to storage`);
      
      // Create art record
      console.log(`  → Creating art record...`);
      const { upsertArt } = await import('./db');
      const { normalizeTitle, cleanTitle } = await import('./artUtils');
      const artId = await upsertArt({
        title: cleanTitle(normalizeTitle(title), options.artist),
        description: artwork.object.attribution || artwork.object.creditline || null,
        imageUrl: upload.publicUrl,
        artistId,
      });
      console.log(`  ✓ Art record created: ${artId}`);
      
      // Add tags from various NGA fields
      const tags: string[] = [];
      
      // Classification, culture, period (existing tags)
      if (artwork.object.classification) tags.push(artwork.object.classification);
      if (artwork.object.culture) tags.push(artwork.object.culture);
      if (artwork.object.period) tags.push(artwork.object.period);
      
      // Medium (e.g., "oil on canvas", "watercolor")
      if (artwork.object.medium) tags.push(artwork.object.medium);
      
      // Dynasty (for historical works)
      if (artwork.object.dynasty) tags.push(artwork.object.dynasty);
      
      // Series (if part of a series)
      if (artwork.object.series) tags.push(artwork.object.series);
      
      // Extract year from dated or displaydate for time-based filtering
      const extractYear = (dateStr: string | undefined): string | null => {
        if (!dateStr) return null;
        // Try to extract 4-digit year from various formats:
        // "1889", "c. 1889", "1889-1890", "1889/1890", etc.
        const yearMatch = dateStr.match(/\b(1[0-9]{3}|2[0-9]{3})\b/);
        return yearMatch ? yearMatch[1] : null;
      };
      
      const year = extractYear(artwork.object.dated) || extractYear(artwork.object.displaydate);
      if (year) {
        tags.push(year);
      }
      
      if (tags.length > 0) {
        console.log(`  → Linking tags: ${tags.join(', ')}...`);
        const { upsertTags, linkArtTags } = await import('./db');
        const tagIds = await upsertTags(tags).then((rows) => rows.map((r) => r.id));
        await linkArtTags(artId, tagIds);
        console.log(`  ✓ Linked ${tagIds.length} tags`);
      }
      
      // Upsert source
      console.log(`  → Adding source information...`);
      const { upsertArtSource } = await import('./db');
      await upsertArtSource({
        artId,
        source: 'nga',
        sourcePageId: parseInt(artwork.object.objectid, 10),
        sourceTitle: title,
        sourceUrl: `https://www.nga.gov/collection/art-object-page.${artwork.object.objectid}.html`,
        wikidataQID: undefined, // NGA doesn't always have Wikidata QIDs
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
      console.log(`  ✓✓✓ Successfully uploaded: ${title}`);
      logStats();
      
    } catch (err) {
      const errorMessage = (err as Error).message;
      console.log(`  ✗✗✗ Failed: ${errorMessage}`);
      const { getNGABestImageUrl } = await import('./nga');
      errors.push({ title: artwork.object.title || `Object ${artwork.object.objectid}`, message: errorMessage });
      await saveFailure({
        artist: options.artist,
        title: artwork.object.title || `Object ${artwork.object.objectid}`,
        imageUrl: artwork.image ? (getNGABestImageUrl(artwork.image) || '') : '',
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
  if (errors.length > 0) {
    console.log(`\nErrors saved to: .failures/${options.artist.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}.json`);
  }
  console.log(`${'='.repeat(60)}\n`);
  
  return { attempted, uploaded, skipped, errors };
}

// Met Museum scraper removed - entire function deleted

