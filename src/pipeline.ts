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
  source?: 'wikimedia';
  category?: string; // Wikimedia Commons category name (alternative to artist-based scraping)
  limit?: number;
  dryRun?: boolean;
  maxUploads?: number;
  concurrency?: number; // Optional concurrency override
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
  
  // Check if this is category-based scraping
  if (options.category) {
    return await fetchAndStoreFromCategory(options);
  }
  
  console.log(`Fetching artworks for: ${options.artist} from ${source}...`);

  return await fetchAndStoreFromWikimedia(options);
}

async function fetchAndStoreFromWikimedia(options: FetchOptions): Promise<FetchResult> {
  const limit = options.limit ?? 10000;
  // Concurrency: use CLI override, or auto-detect based on OAuth
  // With OAuth, Wikimedia allows higher rates; without OAuth, keep conservative
  const { config } = await import('./config');
  const CONCURRENCY = options.concurrency ?? (config.wikimediaClientId ? 8 : 4);
  const maxUploads = options.maxUploads;
  
  // Step 0: Check database first (skip Wikidata lookup if artist exists)
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Step 0: Checking database for existing artist`);
  console.log(`${'='.repeat(60)}`);
  const artistId = await ensureArtist(options.artist);
  const { getArtistQIDFromDatabase, getArtistArtworkCount } = await import('./db');
  
  const existingArtworkCount = await getArtistArtworkCount(artistId);
  console.log(`✓ Artist exists in database (ID: ${artistId})`);
  console.log(`  → Found ${existingArtworkCount} existing artwork(s)`);
  
  // Try to get QID from existing artworks
  const dbQID = await getArtistQIDFromDatabase(artistId);
  let artistQID: string | null = dbQID;
  
  if (dbQID) {
    console.log(`✓ Found Wikidata QID from database: ${dbQID} (skipping Wikidata lookup)`);
  } else {
    console.log(`  → No QID found in database, will query Wikidata`);
  }
  
  // Step 1: Find artist QID (only if not found in database)
  if (!artistQID) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Step 1: Finding artist in Wikidata`);
    console.log(`${'='.repeat(60)}`);
    console.log(`→ Searching for artist: "${options.artist}"...`);
  }
  
  let artworks: Array<{ itemQid: string; imageUrl: string; commonsTitle: string }> = [];
  
  try {
    if (!artistQID) {
      const { findArtistQID } = await import('./wikidata');
      const startTime = Date.now();
      artistQID = await findArtistQID(options.artist);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      
      if (artistQID) {
        console.log(`✓ Found artist QID: ${artistQID} (took ${elapsed}s)`);
      } else {
        console.log(`⚠ Could not find artist QID for "${options.artist}" (took ${elapsed}s)`);
        console.log(`  Possible reasons:`);
        console.log(`    - Artist name doesn't match Wikidata label exactly`);
        console.log(`    - Artist doesn't have a Wikidata entry`);
        console.log(`    - Query timed out`);
        return { attempted: 0, uploaded: 0, skipped: 0, errors: [] };
      }
    }
    
    // Step 2: Query artworks (always needed, even if QID came from database)
    if (artistQID) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`Step 2: Querying artworks by ${options.artist}`);
      console.log(`${'='.repeat(60)}`);
      console.log(`→ Querying Wikidata for artworks by artist ${artistQID}...`);
      console.log(`  (Looking for items with: creator=${artistQID}, has image, has collection)`);
      
      const { findArtworksByArtist } = await import('./wikidata');
      const queryStartTime = Date.now();
      artworks = await findArtworksByArtist(artistQID);
      const queryElapsed = ((Date.now() - queryStartTime) / 1000).toFixed(1);
      
      console.log(`✓ Query complete (took ${queryElapsed}s)`);
      console.log(`✓ Found ${artworks.length} artworks with images and collections`);
      
      if (artworks.length === 0) {
        console.log(`⚠ No artworks found for ${options.artist} with images and collections`);
        return { attempted: 0, uploaded: 0, skipped: 0, errors: [] };
      }
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
  
  // artistId already obtained in Step 0
  
  // Batch deduplication check - check all QIDs upfront for speed
  console.log(`  → Batch checking for existing artworks...`);
  const { findArtsByWikidataQIDsBatch } = await import('./db');
  const allQIDs = artworks.map(a => a.itemQid).filter(Boolean);
  const existingQIDsMap = await findArtsByWikidataQIDsBatch(allQIDs, artistId);
  console.log(`  ✓ Found ${existingQIDsMap.size} existing artworks (will skip)`);
  
  // Pre-fetch Wikidata tags for all artworks in parallel (with concurrency control)
  console.log(`  → Pre-fetching Wikidata tags for ${artworks.length} artworks...`);
  const { fetchWikidataItemTags } = await import('./wikidata');
  const { normalizeWikidataTags } = await import('./artUtils');
  
  // Fetch tags with concurrency control to avoid rate limits
  const TAG_FETCH_CONCURRENCY = Math.min(CONCURRENCY * 2, 10); // Allow more concurrent tag fetches
  const tagResults: Array<{ qid: string; tags: any }> = [];
  
  await processInParallel(artworks, async (artwork) => {
    try {
      const tags = await fetchWikidataItemTags(artwork.itemQid);
      tagResults.push({ qid: artwork.itemQid, tags });
    } catch (err) {
      tagResults.push({ qid: artwork.itemQid, tags: null });
    }
  }, TAG_FETCH_CONCURRENCY);
  
  const tagsByQID = new Map<string, any>();
  tagResults.forEach(({ qid, tags }) => {
    if (tags) tagsByQID.set(qid, tags);
  });
  console.log(`  ✓ Pre-fetched tags for ${tagsByQID.size}/${artworks.length} artworks`);
  
  // Collect all unique tags for batch upsert
  const allTagsSet = new Set<string>();
  const artworkTagMap = new Map<string, string[]>(); // artId -> tag names
  
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
      
      // Check if artwork already exists in database (using batch-checked map)
      if (artwork.itemQid && existingQIDsMap.has(artwork.itemQid)) {
        console.log(`  ✓ Artwork already exists in database (matched by Wikidata QID: ${artwork.itemQid}), skipping`);
        skipped++;
        logStats();
        return;
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
      
      // Get Wikidata tags (from pre-fetched cache)
      let normalizedTags: string[] = [];
      const wikidataTags = tagsByQID.get(artwork.itemQid);
      if (wikidataTags) {
        normalizedTags = normalizeWikidataTags(wikidataTags, image.museum);
        console.log(`  ✓ Found ${normalizedTags.length} tags: ${normalizedTags.join(', ')}`);
        
        // Collect tags for batch processing
        normalizedTags.forEach(tag => allTagsSet.add(tag));
        artworkTagMap.set(artId, normalizedTags);
      } else {
        console.log(`  ⚠ No tags available for this artwork`);
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
  
  // Batch upsert all tags and link to artworks (much faster than individual operations)
  if (allTagsSet.size > 0 && artworkTagMap.size > 0) {
    console.log(`\n  → Batch processing ${allTagsSet.size} unique tags for ${artworkTagMap.size} artworks...`);
    const { upsertTags, linkArtTags } = await import('./db');
    const allTagsArray = Array.from(allTagsSet);
    const tagRows = await upsertTags(allTagsArray);
    const tagIdMap = new Map<string, string>(); // tag name -> tag id
    tagRows.forEach(row => tagIdMap.set(row.name, row.id));
    
    // Link tags to artworks in batches
    const linkPromises: Promise<void>[] = [];
    for (const [artId, tagNames] of artworkTagMap.entries()) {
      const tagIds = tagNames.map(name => tagIdMap.get(name)).filter(Boolean) as string[];
      if (tagIds.length > 0) {
        linkPromises.push(linkArtTags(artId, tagIds));
      }
    }
    await Promise.all(linkPromises);
    console.log(`  ✓ Batch linked tags to ${artworkTagMap.size} artworks`);
  }
  
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

async function fetchAndStoreFromCategory(options: FetchOptions): Promise<FetchResult> {
  const limit = options.limit ?? 10000;
  const { config } = await import('./config');
  // Very conservative concurrency for category scraping to avoid rate limits
  // Image downloads have explicit delays (1.5s), but we still need low concurrency
  // to avoid overwhelming Wikimedia's servers
  const CONCURRENCY = options.concurrency ?? 1; // Default to 1 for category scraping
  const maxUploads = options.maxUploads;
  const categoryName = options.category!;
  
  // Use category name as "artist" for database storage
  const collectionName = options.artist || categoryName.replace(/^Category:/i, '');
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Category-Based Scraping: ${categoryName}`);
  console.log(`${'='.repeat(60)}`);
  
  // Step 0: Check database
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Step 0: Checking database for existing collection`);
  console.log(`${'='.repeat(60)}`);
  const artistId = await ensureArtist(collectionName);
  const { getArtistArtworkCount } = await import('./db');
  
  const existingArtworkCount = await getArtistArtworkCount(artistId);
  console.log(`✓ Collection exists in database (ID: ${artistId})`);
  console.log(`  → Found ${existingArtworkCount} existing artwork(s)`);
  
  // Step 1: List category members
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Step 1: Listing files in category`);
  console.log(`${'='.repeat(60)}`);
  console.log(`→ Fetching files from category: "${categoryName}"...`);
  
  const { listCategoryMembers } = await import('./wikimedia');
  const startTime = Date.now();
  const fileTitles = await listCategoryMembers(categoryName, limit);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  
  console.log(`✓ Found ${fileTitles.length} files in category (took ${elapsed}s)`);
  
  if (fileTitles.length === 0) {
    console.log(`⚠ No files found in category "${categoryName}"`);
    return { attempted: 0, uploaded: 0, skipped: 0, errors: [] };
  }
  
  // Step 2: Process files
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Step 2: Processing ${fileTitles.length} files`);
  console.log(`${'='.repeat(60)}`);
  
  const errors: Array<{ title: string; message: string }> = [];
  let uploaded = 0;
  let skipped = 0;
  let attempted = 0;
  let rateLimitErrors = 0;
  
  // Collect tags for batch processing
  const allTagsSet = new Set<string>();
  const artworkTagMap = new Map<string, string[]>(); // artId -> tag names
  
  const logStats = () => {
    console.log(`\n📊 Progress: Attempted=${attempted} | Uploaded=${uploaded} | Skipped=${skipped} | Errors=${errors.length} | Rate Limits=${rateLimitErrors}\n`);
  };
  
  const processFile = async (fileTitle: string) => {
    if (maxUploads && uploaded >= maxUploads) {
      skipped++;
      return;
    }
    
    attempted++;
    console.log(`[${attempted}/${fileTitles.length}] Processing: ${fileTitle}`);
    
    try {
      // Fetch Commons file info
      console.log(`  → Fetching Commons file info...`);
      const { fetchImageInfoByTitle } = await import('./wikimedia');
      const image = await fetchImageInfoByTitle(fileTitle);
      
      if (!image) {
        console.log(`  ⚠ Could not fetch Commons file info, skipping`);
        skipped++;
        await saveFailure({
          artist: collectionName,
          title: fileTitle,
          imageUrl: '',
          error: 'Could not fetch Commons file info',
          timestamp: new Date().toISOString(),
          retryCount: 0,
        });
        logStats();
        return;
      }
      
      console.log(`  ✓ Fetched Commons file info`);
      
      // Check size requirements
      console.log(`  → Selecting best image variant`);
      const { pickBestVariant } = await import('./wikimedia');
      const variant = pickBestVariant(image);
      
      if (!variant) {
        console.log(`  ⚠ No suitable variant found (size requirements not met), skipping`);
        skipped++;
        await saveFailure({
          artist: collectionName,
          title: fileTitle,
          imageUrl: image.original?.url || '',
          error: 'No suitable image variant found (does not meet size requirements)',
          timestamp: new Date().toISOString(),
          retryCount: 0,
        });
        logStats();
        return;
      }
      
      console.log(`  ✓ Selected variant: ${variant.width}x${variant.height}`);
      
      if (options.dryRun) {
        console.log(`  [DRY RUN] Would upload: ${fileTitle}`);
        skipped++;
        return;
      }
      
      // Check if already exists (by title)
      const normalizedTitle = cleanTitle(normalizeTitle(image.title), collectionName);
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
      
      const storagePath = buildStoragePath(collectionName, image, downloaded.ext);
      console.log(`  → Uploading to storage: ${storagePath}`);
      const { uploadToStorage } = await import('./db');
      const upload = await uploadToStorage(storagePath, downloaded);
      console.log(`  ✓ Uploaded to storage`);
      
      // Create database records
      console.log(`  → Creating art record...`);
      const { upsertArt } = await import('./db');
      const artId = await upsertArt({
        title: cleanTitle(normalizeTitle(image.title), collectionName),
        description: image.description ?? null,
        imageUrl: upload.publicUrl,
        artistId,
      });
      console.log(`  ✓ Art record created: ${artId}`);
      
      // Extract tags from Commons metadata
      const { normalizeCommonsTags } = await import('./artUtils');
      const normalizedTags = normalizeCommonsTags(
        image.categories,
        image.description,
        image.dateCreated,
        image.title // Pass title for year extraction
      );
      
      if (normalizedTags.length > 0) {
        console.log(`  ✓ Found ${normalizedTags.length} tags: ${normalizedTags.slice(0, 10).join(', ')}${normalizedTags.length > 10 ? '...' : ''}`);
        
        // Collect tags for batch processing
        normalizedTags.forEach(tag => allTagsSet.add(tag));
        artworkTagMap.set(artId, normalizedTags);
      }
      
      // Upsert source (no QID for category-based scraping)
      console.log(`  → Adding source information...`);
      const { upsertArtSource } = await import('./db');
      await upsertArtSource({
        artId,
        source: 'wikimedia',
        sourcePageId: image.pageid,
        sourceTitle: image.title,
        sourceUrl: image.pageUrl,
        wikidataQID: undefined, // No QID for category-based items
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
      console.log(`  ✓✓✓ Successfully uploaded: ${fileTitle}`);
      logStats();
      
    } catch (err) {
      const errorMessage = (err as Error).message;
      const isRateLimit = errorMessage.includes('429') || errorMessage.includes('rate limit') || errorMessage.includes('Too many requests');
      if (isRateLimit) rateLimitErrors++;
      
      console.log(`  ✗✗✗ Failed: ${errorMessage}${isRateLimit ? ' [RATE LIMIT]' : ''}`);
      errors.push({ title: fileTitle, message: errorMessage });
      await saveFailure({
        artist: collectionName,
        title: fileTitle,
        imageUrl: '',
        error: errorMessage,
        timestamp: new Date().toISOString(),
        retryCount: 0,
      });
      logStats();
    }
  };
  
  console.log(`\nStarting to process ${fileTitles.length} files with concurrency=${CONCURRENCY}...\n`);
  await processInParallel(fileTitles, processFile, CONCURRENCY);
  
  // Batch upsert all tags and link to artworks
  if (allTagsSet.size > 0 && artworkTagMap.size > 0) {
    console.log(`\n  → Batch processing ${allTagsSet.size} unique tags for ${artworkTagMap.size} artworks...`);
    const { upsertTags, linkArtTags } = await import('./db');
    const allTagsArray = Array.from(allTagsSet);
    const tagRows = await upsertTags(allTagsArray);
    const tagIdMap = new Map<string, string>();
    tagRows.forEach(row => tagIdMap.set(row.name, row.id));
    
    const linkPromises: Promise<void>[] = [];
    for (const [artId, tagNames] of artworkTagMap.entries()) {
      const tagIds = tagNames.map(name => tagIdMap.get(name)).filter(Boolean) as string[];
      if (tagIds.length > 0) {
        linkPromises.push(linkArtTags(artId, tagIds));
      }
    }
    await Promise.all(linkPromises);
    console.log(`  ✓ Batch linked tags to ${artworkTagMap.size} artworks`);
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Processing complete for ${categoryName}`);
  console.log(`  Attempted: ${attempted}`);
  console.log(`  Uploaded: ${uploaded} ✓`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Errors: ${errors.length}`);
  console.log(`  Rate Limit Errors: ${rateLimitErrors}${rateLimitErrors > 0 ? ' ⚠️' : ''}`);
  if (errors.length > 0) {
    console.log(`\nErrors saved to: .failures/${collectionName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}.json`);
  }
  if (rateLimitErrors > 5) {
    console.log(`\n⚠️  WARNING: High number of rate limit errors (${rateLimitErrors}). Consider retrying later.`);
  }
  console.log(`${'='.repeat(60)}\n`);
  
  return { attempted, uploaded, skipped, errors };
}

// Met Museum scraper removed - entire function deleted

