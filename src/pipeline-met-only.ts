/**
 * Met Museum pipeline - NO Wikidata required
 * Uses only Met API metadata for tags and processing
 */

import { config } from './config';
import { slugify } from './utils';
import { downloadImage } from './downloader';
import { uploadToStorage } from './storage';
import { DownloadedImage } from './types';
import { ensureArtist, insertArtAsset, linkArtTags, upsertArt, upsertArtSource, upsertTags } from './db';
import { saveFailure } from './failureTracker';
import { supabase } from './supabaseClient';
import { fetchObjectDetails, extractAllMetTags, MetObject } from './metmuseum';

export interface MetOnlyFetchOptions {
  departmentId?: number;
  departmentName?: string;
  objectIDs?: number[]; // Pre-fetched object IDs
  limit?: number;
  dryRun?: boolean;
  maxUploads?: number;
}

export interface MetOnlyFetchResult {
  attempted: number;
  uploaded: number;
  skipped: number;
  errors: Array<{ title: string; message: string }>;
}

function cleanTitle(title: string): string {
  let cleaned = title.trim();
  
  // Remove "File:" prefix if present
  cleaned = cleaned.replace(/^File:/i, '');
  
  // Remove common suffixes
  cleaned = cleaned.replace(/\s*\([^)]*\)\s*$/g, ''); // Remove trailing parentheses
  cleaned = cleaned.replace(/\s*\[[^\]]*\]\s*$/g, ''); // Remove trailing brackets
  
  // Clean up whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  return cleaned || 'Untitled';
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

/**
 * Process Met Museum objects without requiring Wikidata
 * Uses only Met API metadata for tags and deduplication
 */
export async function fetchAndStoreFromMetOnly(options: MetOnlyFetchOptions): Promise<MetOnlyFetchResult> {
  const CONCURRENCY = 2;
  const maxUploads = options.maxUploads;
  const limit = options.limit;
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Met Museum Scraping (Met-Only Mode)`);
  console.log(`${'='.repeat(60)}`);
  
  if (options.departmentId) {
    console.log(`Department ID: ${options.departmentId}`);
  }
  if (options.departmentName) {
    console.log(`Department: ${options.departmentName}`);
  }
  if (options.objectIDs) {
    console.log(`Pre-fetched Object IDs: ${options.objectIDs.length}`);
  }
  
  const objectIDs = options.objectIDs || [];
  
  if (objectIDs.length === 0) {
    console.log(`⚠ No object IDs provided`);
    return { attempted: 0, uploaded: 0, skipped: 0, errors: [] };
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Processing ${objectIDs.length} objects from Met Museum`);
  console.log(`${'='.repeat(60)}`);
  
  const errors: Array<{ title: string; message: string }> = [];
  let uploaded = 0;
  let skipped = 0;
  let attempted = 0;
  const MIN_VARIANT_WIDTH = 1280;
  
  // Track processed artists
  const artistMap = new Map<string, string>(); // artist name -> artist ID
  
  // Helper to log running stats
  const logStats = () => {
    console.log(`\n📊 Progress: Attempted=${attempted} | Uploaded=${uploaded} | Skipped=${skipped} | Errors=${errors.length}\n`);
  };
  
  const processObject = async (objectID: number) => {
    if (maxUploads && uploaded >= maxUploads) {
      skipped++;
      return;
    }
    
    if (limit && attempted >= limit) {
      skipped++;
      return;
    }
    
    attempted++;
    console.log(`[${attempted}/${objectIDs.length}] Processing: Object ID ${objectID}`);
    
    try {
      // Add delay between Met API requests to avoid overwhelming the API
      await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
      
      // Fetch full object details
      console.log(`  → Fetching object details...`);
      const fetchStartTime = Date.now();
      const object = await fetchObjectDetails(objectID, 3, 1000); // 3 retries, 1s base delay
      const fetchElapsed = ((Date.now() - fetchStartTime) / 1000).toFixed(1);
      
      if (!object) {
        console.log(`  ⚠ Could not fetch object details (took ${fetchElapsed}s), skipping`);
        skipped++;
        logStats();
        return;
      }
      
      if (!object.primaryImage) {
        console.log(`  ⚠ No primary image available, skipping`);
        skipped++;
        logStats();
        return;
      }
      
      // Filter by department if specified
      if (options.departmentId && object.department) {
        // Check if department matches (may need to parse department name)
        // For now, we'll trust the pre-filtered list
      }
      
      console.log(`  ✓ Fetched object details (took ${fetchElapsed}s): ${object.title}`);
      
      // Get or create artist
      const artistName = object.artistDisplayName || 'Unknown Artist';
      let artistId: string;
      if (artistMap.has(artistName)) {
        artistId = artistMap.get(artistName)!;
      } else {
        artistId = await ensureArtist(artistName);
        artistMap.set(artistName, artistId);
      }
      
      // Check if artwork already exists in database
      // First check by Met object ID (most specific - exact match)
      const existingSource = await supabase
        .from('art_sources')
        .select('art_id')
        .eq('source', 'metmuseum')
        .eq('source_pageid', objectID)
        .limit(1)
        .maybeSingle();
      
      // Also check by title and artist (may be from Wikimedia or other source)
      const normalizedTitle = cleanTitle(object.title);
      const existingArt = await supabase
        .from('arts')
        .select('id')
        .eq('artist_id', artistId)
        .eq('title', normalizedTitle)
        .limit(1)
        .maybeSingle();
      
      // If found by exact Met object ID match, check if we should skip
      if (existingSource.data?.art_id) {
        const existingArtId = existingSource.data.art_id;
        console.log(`  ✓ Artwork already exists in database (matched by Met object ID, ID: ${existingArtId})`);
        
        // This exact Met object was already processed - check if tags need updating
        const { getArtTags } = await import('./db');
        const existingTags = await getArtTags(existingArtId);
        const existingTagsSet = new Set(existingTags);
        
        // Extract Met tags
        const metTags = extractAllMetTags(object);
        const missingTags = metTags.filter(tag => !existingTagsSet.has(tag));
        
        if (missingTags.length > 0) {
          console.log(`  → Found ${missingTags.length} new Met tags to add: ${missingTags.slice(0, 10).join(', ')}${missingTags.length > 10 ? '...' : ''}`);
          
          if (!options.dryRun) {
            const { upsertTags, linkArtTags } = await import('./db');
            const tagIds = await upsertTags(missingTags).then((rows) => rows.map((r) => r.id));
            await linkArtTags(existingArtId, tagIds);
            console.log(`  ✓ Added ${tagIds.length} Met tags to existing artwork`);
          } else {
            console.log(`  [DRY RUN] Would add ${missingTags.length} Met tags`);
          }
        } else {
          console.log(`  → All Met tags already present, skipping`);
        }
        
        skipped++;
        logStats();
        return;
      }
      
      // If found by title/artist (likely from Wikimedia), add Met tags and source
      if (existingArt.data?.id) {
        const existingArtId = existingArt.data.id;
        console.log(`  ✓ Artwork already exists in database (matched by title and artist, ID: ${existingArtId})`);
        console.log(`  → Adding Met tags and source to existing artwork...`);
        
        // Check if it already has Met source (might have been added from another Met object)
        const { hasMetSource, getArtTags } = await import('./db');
        const hasMet = await hasMetSource(existingArtId);
        
        // Extract Met tags
        const metTags = extractAllMetTags(object);
        
        if (metTags.length > 0) {
          // Get existing tags
          const existingTags = await getArtTags(existingArtId);
          const existingTagsSet = new Set(existingTags);
          
          // Find missing Met tags
          const missingTags = metTags.filter(tag => !existingTagsSet.has(tag));
          
          if (missingTags.length > 0) {
            console.log(`  → Found ${missingTags.length} new Met tags to add: ${missingTags.slice(0, 10).join(', ')}${missingTags.length > 10 ? '...' : ''}`);
            
            if (!options.dryRun) {
              // Upsert tags and link them
              const { upsertTags, linkArtTags } = await import('./db');
              const tagIds = await upsertTags(missingTags).then((rows) => rows.map((r) => r.id));
              await linkArtTags(existingArtId, tagIds);
              console.log(`  ✓ Added ${tagIds.length} Met tags to existing artwork`);
            } else {
              console.log(`  [DRY RUN] Would add ${missingTags.length} Met tags`);
            }
          } else {
            console.log(`  → All Met tags already present`);
          }
        } else {
          console.log(`  → No Met tags to add`);
        }
        
        // Add Met source if it doesn't exist
        if (!hasMet && !options.dryRun) {
          console.log(`  → Adding Met source information...`);
          const { upsertArtSource } = await import('./db');
          await upsertArtSource({
            artId: existingArtId,
            source: 'metmuseum',
            sourcePageId: object.objectID,
            sourceTitle: object.title,
            sourceUrl: object.objectURL || `https://www.metmuseum.org/art/collection/search/${object.objectID}`,
          });
          console.log(`  ✓ Met source added`);
        } else if (hasMet) {
          console.log(`  → Met source already exists`);
        }
        
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
      const imageVariant = {
        url: object.primaryImage,
        width: 0, // Will be set after download
        height: 0,
        mime: 'image/jpeg',
      };
      
      const downloaded = await downloadImage(imageVariant);
      console.log(`  ✓ Downloaded: ${downloaded.width}x${downloaded.height}, ${(downloaded.fileSize / 1024 / 1024).toFixed(2)}MB`);
      
      // Check size requirements
      if (downloaded.width < MIN_VARIANT_WIDTH && downloaded.height < MIN_VARIANT_WIDTH) {
        console.log(`  ⚠ Image too small (${downloaded.width}x${downloaded.height}), skipping`);
        skipped++;
        await saveFailure({
          artist: artistName,
          title: object.title,
          imageUrl: object.primaryImage,
          error: `Image too small: ${downloaded.width}x${downloaded.height} (minimum: ${MIN_VARIANT_WIDTH}px)`,
          timestamp: new Date().toISOString(),
          retryCount: 0,
          source: 'metmuseum',
        });
        logStats();
        return;
      }
      
      // Build storage path
      const artistSlug = slugify(artistName);
      const titleSlug = slugify(object.title.replace(/^File:/i, ''));
      const safeTitle = titleSlug || `object-${object.objectID}`;
      const storagePath = `${artistSlug}/${safeTitle}.${downloaded.ext}`;
      console.log(`  → Uploading to storage: ${storagePath}`);
      const upload = await uploadToStorage(storagePath, downloaded);
      console.log(`  ✓ Uploaded to storage`);
      
      // Create database records
      console.log(`  → Creating art record...`);
      const artId = await upsertArt({
        title: normalizedTitle,
        description: object.medium || object.dimensions || null,
        imageUrl: upload.publicUrl,
        artistId,
      });
      console.log(`  ✓ Art record created: ${artId}`);
      
      // Extract all Met tags (department, classification, culture, period, medium, tags)
      console.log(`  → Extracting Met tags...`);
      const metTags = extractAllMetTags(object);
      console.log(`  ✓ Found ${metTags.length} Met tags: ${metTags.slice(0, 10).join(', ')}${metTags.length > 10 ? '...' : ''}`);
      
      // Upsert tags
      if (metTags.length > 0) {
        console.log(`  → Linking tags...`);
        const tagIds = await upsertTags(metTags).then((rows) => rows.map((r) => r.id));
        await linkArtTags(artId, tagIds);
        console.log(`  ✓ Linked ${tagIds.length} tags`);
      }
      
      // Upsert source (NO wikidataQID)
      console.log(`  → Adding source information...`);
      await upsertArtSource({
        artId,
        source: 'metmuseum',
        sourcePageId: object.objectID,
        sourceTitle: object.title,
        sourceUrl: object.objectURL || `https://www.metmuseum.org/art/collection/search/${object.objectID}`,
        // wikidataQID is intentionally omitted - this is Met-only mode
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
      console.log(`  ✓✓✓ Successfully uploaded: ${object.title}`);
      logStats();
      
    } catch (err) {
      const errorMessage = (err as Error).message;
      console.log(`  ✗✗✗ Failed: ${errorMessage}`);
      errors.push({ title: `Object ${objectID}`, message: errorMessage });
      await saveFailure({
        artist: 'Unknown',
        title: `Object ${objectID}`,
        imageUrl: '',
        error: errorMessage,
        timestamp: new Date().toISOString(),
        retryCount: 0,
        source: 'metmuseum',
      });
      logStats();
    }
  };
  
  console.log(`\nStarting to process ${objectIDs.length} objects with concurrency=${CONCURRENCY}...\n`);
  await processInParallel(objectIDs, processObject, CONCURRENCY);
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Processing complete (Met-Only Mode)`);
  console.log(`  Attempted: ${attempted}`);
  console.log(`  Uploaded: ${uploaded} ✓`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Errors: ${errors.length}`);
  if (errors.length > 0) {
    console.log(`\nErrors saved to: .failures/met-only.json`);
  }
  console.log(`${'='.repeat(60)}\n`);
  
  return { attempted, uploaded, skipped, errors };
}
