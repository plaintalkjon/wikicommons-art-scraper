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
  source?: 'wikimedia' | 'smithsonian';
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

  if (source === 'smithsonian') {
    return await fetchAndStoreFromSmithsonian(options);
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

async function fetchAndStoreFromSmithsonian(options: FetchOptions): Promise<FetchResult> {
  const limit = options.limit ?? 1000;
  const CONCURRENCY = 2;
  const maxUploads = options.maxUploads;
  const allowedMedia = (options.media?.length ? options.media : ['painting', 'sculpture']).map((m) => m.toLowerCase());
  const excludeDrawings = options.excludeDrawings !== undefined ? options.excludeDrawings : true;

  const matchesMediaFilter = (classification?: string, medium?: string): boolean => {
    if (allowedMedia.includes('all')) return true;
    const cls = (classification ?? '').toLowerCase();
    const med = (medium ?? '').toLowerCase();
    return allowedMedia.some((token) => cls.includes(token) || med.includes(token));
  };

  const isDrawingLike = (classification?: string, medium?: string): boolean => {
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

  // Step 1: Find artist in Smithsonian
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Step 1: Finding artworks by "${options.artist}" in Smithsonian`);
  console.log(`${'='.repeat(60)}`);

  let artworks: Array<any> = [];

  try {
    const { searchSmithsonianArtworks } = await import('./smithsonian');
    const startTime = Date.now();
    artworks = await searchSmithsonianArtworks(options.artist, limit);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`✓ Search complete (took ${elapsed}s)`);
    console.log(`✓ Found ${artworks.length} artworks`);

    if (artworks.length === 0) {
      console.log(`⚠ No artworks found for ${options.artist} in Smithsonian collection`);
      return { attempted: 0, uploaded: 0, skipped: 0, errors: [] };
    }
  } catch (err) {
    const errorMessage = (err as Error).message;
    console.error(`\n✗ Error during Smithsonian search:`);
    console.error(`  Error: ${errorMessage}`);
    return { attempted: 0, uploaded: 0, skipped: 0, errors: [] };
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Step 2: Processing ${artworks.length} artworks from Smithsonian`);
  console.log(`${'='.repeat(60)}`);

  const artistId = await ensureArtist(options.artist);
  const errors: Array<{ title: string; message: string }> = [];
  let uploaded = 0;
  let skipped = 0;
  let attempted = 0;

  const logStats = () => {
    console.log(`\n📊 Progress: Attempted=${attempted} | Uploaded=${uploaded} | Skipped=${skipped} | Errors=${errors.length}\n`);
  };

  const processArtwork = async (artwork: any) => {
    if (maxUploads && uploaded >= maxUploads) {
      skipped++;
      return;
    }

    attempted++;
    const title = artwork.title;
    console.log(`[${attempted}/${artworks.length}] Processing: ${title} (Object ID: ${artwork.objectId})`);

    try {
      // Media filter (classification/medium). Default allows painting & sculpture; override with --media option.
      if (!matchesMediaFilter(artwork.classification, artwork.medium)) {
        console.log(
          `  ⚠ Skipping due to media filter (classification="${artwork.classification || ''}", medium="${artwork.medium || ''}")`,
        );
        skipped++;
        return;
      }
      if (excludeDrawings && isDrawingLike(artwork.classification, artwork.medium)) {
        console.log(
          `  ⚠ Skipping drawing-like work (classification="${artwork.classification || ''}", medium="${artwork.medium || ''}")`,
        );
        skipped++;
        return;
      }

      // Check if artwork already exists in database (caching)
      // First check by Wikidata QID (most reliable), then by title
      let existingArtId: string | null = null;

      // Check by title/artist combination (Smithsonian doesn't have Wikidata IDs)
      const normalizedTitle = cleanTitle(normalizeTitle(title), options.artist);
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

      // Get image URL and dimensions
      const { getSmithsonianBestImageUrl, getSmithsonianDimensions } = await import('./smithsonian');

      const imageUrl = getSmithsonianBestImageUrl(artwork);
      const dimensions = getSmithsonianDimensions(artwork);
      let width = dimensions?.width || 0;
      let height = dimensions?.height || 0;

      // No image found
      if (!imageUrl) {
        console.log(`  ⚠ No image available, skipping`);
        skipped++;
        await saveFailure({
          artist: options.artist,
          title,
          imageUrl: '',
          error: 'No image available from Smithsonian',
          timestamp: new Date().toISOString(),
          retryCount: 0,
        });
        logStats();
        return;
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

      // Download image
      console.log(`  → Downloading image...`);
      const downloaded = await downloadImage({
        url: imageUrl,
        width: width || 0,
        height: height || 0,
        mime: 'image/jpeg', // Smithsonian images are typically JPEG
      });
      console.log(`  ✓ Downloaded: ${downloaded.width}x${downloaded.height}, ${(downloaded.fileSize / 1024 / 1024).toFixed(2)}MB`);

      // Build storage path
      const storagePath = buildStoragePath(options.artist, {
        title: title,
        pageid: artwork.objectId,
      } as any, downloaded.ext);

      console.log(`  → Uploading to storage: ${storagePath}`);
      const upload = await uploadToStorage(storagePath, downloaded);
      console.log(`  ✓ Uploaded to storage`);

      // Create art record
      console.log(`  → Creating art record...`);
      const artId = await upsertArt({
        title: cleanTitle(normalizeTitle(title), options.artist),
        description: artwork.medium || artwork.classification || null,
        imageUrl: upload.publicUrl,
        artistId,
      });
      console.log(`  ✓ Art record created: ${artId}`);

      // Add tags from various Smithsonian fields
      const tags: string[] = [];

      // Classification and medium
      if (artwork.classification) tags.push(artwork.classification);
      if (artwork.medium) tags.push(artwork.medium);

      // Extract year from date
      const extractYear = (dateStr: string | undefined): string | null => {
        if (!dateStr) return null;
        const yearMatch = dateStr.match(/\b(1[0-9]{3}|2[0-9]{3})\b/);
        return yearMatch ? yearMatch[1] : null;
      };

      const year = extractYear(artwork.date);
      if (year) {
        tags.push(year);
      }

      if (tags.length > 0) {
        console.log(`  → Linking tags: ${tags.join(', ')}...`);
        const tagIds = await upsertTags(tags).then((rows) => rows.map((r) => r.id));
        await linkArtTags(artId, tagIds);
        console.log(`  ✓ Linked ${tagIds.length} tags`);
      }

      // Upsert source
      console.log(`  → Adding source information...`);
      await upsertArtSource({
        artId,
        source: 'smithsonian',
        sourcePageId: null, // Smithsonian IDs are complex strings, not integers
        sourceTitle: title,
        sourceUrl: artwork.sourceUrl,
        wikidataQID: undefined,
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
      console.log(`  ✓✓✓ Successfully uploaded: ${title}`);
      logStats();

    } catch (err) {
      const errorMessage = (err as Error).message;
      console.log(`  ✗✗✗ Failed: ${errorMessage}`);
      errors.push({ title: artwork.title, message: errorMessage });
      await saveFailure({
        artist: options.artist,
        title: artwork.title,
        imageUrl: artwork.imageUrl || '',
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

