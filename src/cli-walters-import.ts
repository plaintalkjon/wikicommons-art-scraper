#!/usr/bin/env node
/**
 * Walters Art Museum importer
 * Downloads and processes CSV data files from Walters Art Museum GitHub repository
 * No API key required - uses static CSV files
 *
 * Usage:
 *   npm run walters-import -- --limit 1000
 */

import { parseArgs } from './utils';
import {
  downloadWaltersArt,
  downloadWaltersMedia,
  downloadWaltersCreators,
  buildImageUrl,
  extractTags,
  WaltersArtwork,
  WaltersMedia,
  WaltersCreator
} from './walters';
import { downloadImage } from './downloader';
import { ensureArtist, upsertArt, upsertArtSource, insertArtAsset, upsertTags, linkArtTags } from './db';
import { cleanTitle, normalizeTitle, buildStoragePath } from './artUtils';
import { supabase } from './config';
import { rateLimiter } from './rateLimiter';
import crypto from 'crypto';

async function main() {
  const args = parseArgs();
  const limit = args.limit ? parseInt(args.limit as string, 10) : 5000;
  const dryRun = Boolean(args['dry-run'] ?? args.dryRun);
  const minDim = args['min-dim'] ? parseInt(args['min-dim'] as string, 10) : 1280;
  const minMajor = args['min-major'] ? parseInt(args['min-major'] as string, 10) : 1800;
  const collections = args.collections ? (args.collections as string).split(',') : null;
  const artworkTypes = args['artwork-types'] ? (args['artwork-types'] as string).split(',') : null;
  const skipCount = args.skip ? parseInt(args.skip as string, 10) : 0;

  console.log(
    `Walters Art Museum import: limit=${limit}, skip=${skipCount}, dryRun=${dryRun}, minDim=${minDim}, minMajor=${minMajor}, collections=${collections?.join(',') || 'all'}, artworkTypes=${artworkTypes?.join(',') || 'all'}`
  );

  const artistCache = new Map<string, string>();
  const getArtistId = async (name: string): Promise<string> => {
    if (artistCache.has(name)) return artistCache.get(name)!;
    const id = await ensureArtist(name);
    artistCache.set(name, id);
    return id;
  };

  try {
    console.log('📥 Downloading Walters data files...');
    const [artworks, mediaRecords, creatorsMap] = await Promise.all([
      downloadWaltersArt(),
      downloadWaltersMedia(),
      downloadWaltersCreators()
    ]);

    console.log(`✅ Downloaded: ${artworks.length} artworks, ${mediaRecords.length} media records, ${creatorsMap.size} creators`);

    // Create media lookup map (ObjectID -> primary image)
    const mediaMap = new Map<string, WaltersMedia>();
    mediaRecords.forEach(media => {
      if (media.IsPrimary && !mediaMap.has(media.ObjectID)) {
        mediaMap.set(media.ObjectID, media);
      }
    });

    console.log(`📸 Found primary images for ${mediaMap.size} artworks`);

    const artistCache = new Map<string, string>();

    let uploaded = 0;
    let skipped = 0;
    let errors = 0;
    let attempted = 0;
    let processedFiltered = 0; // Track how many filtered artworks we've encountered

    // Process artworks
    for (const artwork of artworks) {
      // Apply collection filter
      if (collections && !collections.includes(artwork.CollectionID || '')) {
        continue; // Skip this artwork entirely
      }

      // Apply artwork type filter
      if (artworkTypes) {
        const artworkType = getArtworkType(artwork);
        if (!artworkTypes.some(type => artworkType.includes(type.toLowerCase()))) {
          continue; // Skip this artwork entirely
        }
      }

      processedFiltered++;

      // Skip the first N filtered artworks if requested
      if (processedFiltered <= skipCount) {
        skipped++;
        continue;
      }

      if (attempted >= limit) break;
      attempted++;

      // Only process artworks with primary images
      const primaryMedia = mediaMap.get(artwork.ObjectID);
      if (!primaryMedia) {
        skipped++;
        continue;
      }

      const title = cleanTitle(
        normalizeTitle(artwork.Title || `Walters ${artwork.ObjectNumber}`),
        artwork.CreatorID ? creatorsMap.get(artwork.CreatorID)?.name || 'Unknown artist' : 'Unknown artist'
      );

      // Get creator info
      const creator = artwork.CreatorID ? creatorsMap.get(artwork.CreatorID) : undefined;
      const artistName = creator?.name || 'Unknown artist';
      const artistId = await getArtistId(artistName);
      const tags = extractTags(artwork, creator);

      // Dedup by ObjectID
      const sourcePageId = artwork.ObjectID;
      const existing = await supabase
        .from('art_sources')
        .select('id')
        .eq('source', 'walters')
        .eq('source_pageid', sourcePageId)
        .maybeSingle();
      if (existing.data?.id) {
        console.log(`Skip existing Walters id=${artwork.ObjectID}`);
        skipped++;
        continue;
      }

      const imageUrl = buildImageUrl(primaryMedia);
      if (!imageUrl) {
        console.log(`No image URL for Walters id=${artwork.ObjectID}, skipping`);
        skipped++;
        continue;
      }

      try {
        await rateLimiter.waitIfNeeded();
        const downloaded = await downloadImage({
          url: imageUrl,
          width: 0,
          height: 0,
          mime: 'image/jpeg',
        });

        // Size checks
        if ((downloaded.width < minDim && downloaded.height < minDim) ||
            (downloaded.width < minMajor && downloaded.height < minMajor)) {
          console.log(`Too small (${downloaded.width}x${downloaded.height}) Walters id=${artwork.ObjectID}, skipping`);
          skipped++;
          continue;
        }

        if (dryRun) {
          console.log(`[DRY RUN] Would upload Walters id=${artwork.ObjectID} "${title}"`);
          skipped++;
          continue;
        }

        const storagePath = buildStoragePath(artistName, { title, pageid: sourcePageId } as any, downloaded.ext);
        const { uploadToStorage } = await import('./db');
        const upload = await uploadToStorage(storagePath, downloaded);

        const artId = await upsertArt({
          title,
          description: artwork.Description || null,
          imageUrl: upload.publicUrl,
          artistId,
        });

        await upsertArtSource({
          artId,
          source: 'walters',
          sourcePageId: sourcePageId,
          sourceTitle: artwork.Title || undefined,
          sourceUrl: artwork.ObjectURL || `https://art.thewalters.org/detail/${artwork.ObjectID}`,
          wikidataQID: undefined,
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

        if (tags.length) {
          const tagIds = await upsertTags(tags).then((rows) => rows.map((r) => r.id));
          await linkArtTags(artId, tagIds);
        }

        uploaded++;
        console.log(`Uploaded Walters id=${artwork.ObjectID} "${title}"`);

      } catch (err) {
        console.log(`Failed Walters id=${artwork.ObjectID}: ${(err as Error).message}`);
        errors++;
      }
    }

    console.log(`\n🏛️ Walters import complete:`);
    console.log(`   Attempted: ${attempted}`);
    console.log(`   Uploaded: ${uploaded} ✅`);
    console.log(`   Skipped: ${skipped}`);
    console.log(`   Errors: ${errors}`);

  } catch (err) {
    console.error('❌ Walters import failed:', err);
    process.exit(1);
  }
}

// Helper function to determine artwork type
function getArtworkType(artwork: WaltersArtwork): string {
  // Check ObjectName
  if (artwork.ObjectName) {
    const name = artwork.ObjectName.toLowerCase();
    if (name.includes('painting') || name.includes('panel') || name.includes('canvas')) {
      return 'painting';
    }
    if (name.includes('sculpture') || name.includes('statue') || name.includes('figure') || name.includes('relief')) {
      return 'sculpture';
    }
    if (name.includes('drawing') || name.includes('sketch')) {
      return 'drawing';
    }
    if (name.includes('print') || name.includes('engraving')) {
      return 'print';
    }
  }

  // Check Classification
  if (artwork.Classification) {
    const classification = artwork.Classification.toLowerCase();
    if (classification.includes('painting')) {
      return 'painting';
    }
    if (classification.includes('sculpture')) {
      return 'sculpture';
    }
  }

  // Check Medium for hints
  if (artwork.Medium) {
    const medium = artwork.Medium.toLowerCase();
    if (medium.includes('oil') || medium.includes('tempera') || medium.includes('acrylic') || medium.includes('watercolor')) {
      return 'painting';
    }
    if (medium.includes('marble') || medium.includes('bronze') || medium.includes('stone') || medium.includes('wood')) {
      return 'sculpture';
    }
  }

  return 'other';
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
