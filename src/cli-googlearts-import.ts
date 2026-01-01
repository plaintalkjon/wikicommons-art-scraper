#!/usr/bin/env node
/**
 * Google Arts & Culture importer
 * - Reads CSV file mapping filenames to artsandculture.google.com URLs
 * - Scrapes metadata (title, artist, tags) from each URL
 * - Uploads already-downloaded images with scraped metadata to Supabase
 *
 * Usage:
 *   npm run googlearts-import -- --csv downloads/GoogleImages.csv --images downloads/GoogleImages [--dry-run] [--limit 10]
 */

import { parseArgs } from './utils';
import { scrapeGoogleArtsArtworks, googleArtsImageExists, GoogleArtsArtwork, scrapeGoogleArtsPage } from './googlearts';
import { downloadImage } from './downloader';
import { ensureArtist, upsertArt, upsertArtSource, insertArtAsset, upsertTags, linkArtTags } from './db';
import { cleanTitle, normalizeTitle, buildStoragePath } from './artUtils';
import { supabase } from './config';
import { rateLimiter } from './rateLimiter';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const args = parseArgs();
  const csvPath = args.csv as string;
  const imagesDir = args.images as string;
  const limit = args.limit ? parseInt(args.limit as string, 10) : undefined;
  const dryRun = Boolean(args['dry-run'] ?? args.dryRun);
  const skipMissingImages = Boolean(args['skip-missing'] ?? args.skipMissing ?? true);
  const forceRescrape = Boolean(args['force-rescrape'] ?? args.forceRescrape ?? false);
  const resume = Boolean(args['resume'] ?? args.resume ?? false);

  if (!csvPath || !imagesDir) {
    console.error('Usage: npm run googlearts-import -- --csv <csv-path> --images <images-dir> [--dry-run] [--limit <number>] [--skip-missing] [--force-rescrape]');
    console.error('Example: npm run googlearts-import -- --csv downloads/GoogleImages.csv --images downloads/GoogleImages --limit 10 --dry-run');
    process.exit(1);
  }

  if (!fs.existsSync(csvPath)) {
    console.error(`CSV file not found: ${csvPath}`);
    process.exit(1);
  }

  if (!fs.existsSync(imagesDir)) {
    console.error(`Images directory not found: ${imagesDir}`);
    process.exit(1);
  }

  console.log(`Google Arts & Culture import:`);
  console.log(`  CSV: ${csvPath}`);
  console.log(`  Images: ${imagesDir}`);
  console.log(`  Limit: ${limit || 'unlimited'}`);
  console.log(`  Dry run: ${dryRun}`);
  console.log(`  Skip missing images: ${skipMissingImages}`);
  console.log(`  Force rescrape: ${forceRescrape}`);
  console.log(`  Resume mode: ${resume}`);
  console.log('');

  try {
    // Sequential processing: one artwork at a time
    console.log('Sequential processing: one artwork at a time...');

    const { parse } = await import('csv-parse/sync');
    const fs = await import('fs');

    // Read and parse CSV
    const csvContent = fs.readFileSync(csvPath, 'utf8');
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });

  console.log(`Found ${records.length} artworks in CSV`);

  // Handle resume mode: find where to start processing
  let startIndex = 0;
  if (resume) {
    console.log('Resume mode: Finding starting point...');

    // Get all processed URLs
    const { data: processedSources } = await supabase
      .from('art_sources')
      .select('source_url')
      .eq('source', 'googlearts');

    const processedUrls = new Set(processedSources?.map(s => s.source_url) || []);

    // Find first unprocessed record
    for (let i = 0; i < records.length; i++) {
      const url = records[i].page;
      if (url && !processedUrls.has(url)) {
        startIndex = i;
        break;
      }
    }

    console.log(`Resuming from record ${startIndex + 1} (${records.length - startIndex} artworks remaining)`);
  }

  const artistCache = new Map<string, string>();
    const getArtistId = async (name: string) => {
      if (artistCache.has(name)) return artistCache.get(name)!;
      const id = await ensureArtist(name);
      artistCache.set(name, id);
      return id;
    };

    let uploaded = 0;
    let skipped = 0;
    let errors = 0;
    let rateLimitErrors = 0;
    let attempted = 0;
    let missingImages = 0;
    const failedArtworks: Array<{filename: string, url: string, error: string, timestamp: string}> = [];

    // Process each record sequentially
    for (let i = startIndex; i < records.length; i++) {
      if (limit && attempted >= limit) break;

      const record = records[i];
      attempted++;

      const filename = record.filename;
      const sourceUrl = record.page;

      if (!filename || !sourceUrl) {
        console.log(`  ⚠ Skipping invalid record ${i + 1}: missing filename or URL`);
        continue;
      }

      const currentIndex = attempted + (resume ? startIndex : 0);
      console.log(`\n[${currentIndex + 1}/${limit || records.length}] Processing: ${filename}`);

      // Check if local image exists
      if (!googleArtsImageExists({ filename, sourceUrl } as any, imagesDir)) {
        if (skipMissingImages) {
          console.log(`  ⚠ Image file not found, skipping: ${filename}`);
          missingImages++;
          continue;
        } else {
          console.log(`  ✗ Image file not found: ${filename}`);
          errors++;
          continue;
        }
      }

      // Check for existing artwork by source URL (skip if already processed)
      const existing = await supabase
        .from('art_sources')
        .select('id')
        .eq('source', 'googlearts')
        .eq('source_url', sourceUrl)
        .maybeSingle();

      if (existing.data?.id && !forceRescrape) {
        console.log(`  Skip existing Google Arts artwork: ${filename}`);
        skipped++;
        continue;
      }

      try {
        // Scrape metadata for this artwork
        const artwork = await scrapeGoogleArtsPage(sourceUrl);
        if (!artwork) {
          console.log(`  ✗ Failed to scrape metadata for ${filename}`);
          errors++;
          continue;
        }

        const title = cleanTitle(normalizeTitle(artwork.title));
        const artistId = await getArtistId(artwork.artist);

        // Get image file info
        const imagePath = path.join(imagesDir, filename);
        const stats = fs.statSync(imagePath);
        const buffer = fs.readFileSync(imagePath);

        let mime = 'image/jpeg'; // Default assumption
        if (filename.toLowerCase().endsWith('.png')) mime = 'image/png';
        else if (filename.toLowerCase().endsWith('.gif')) mime = 'image/gif';

        if (dryRun) {
          console.log(`  [DRY RUN] Would upload "${title}" by ${artwork.artist}`);
          console.log(`    Tags: ${artwork.tags.join(', ')}`);
          if (artwork.date) console.log(`    Date: ${artwork.date}`);
          if (artwork.medium) console.log(`    Medium: ${artwork.medium}`);
          if (artwork.museum) console.log(`    Museum: ${artwork.museum}`);
          skipped++;
          continue;
        }

        const storagePath = buildStoragePath(artwork.artist, {
          title,
          pageid: null,
        } as any, path.extname(filename).slice(1));

        const { uploadToStorage } = await import('./db');
        const upload = await uploadToStorage(storagePath, {
          buffer,
          mime,
        });

        const artId = await upsertArt({
          title,
          description: artwork.description || null,
          imageUrl: upload.publicUrl,
          artistId,
        });

        // Insert art source
        const { error: sourceError } = await supabase
          .from('art_sources')
          .insert({
            art_id: artId,
            source: 'googlearts',
            source_pageid: null,
            source_title: artwork.title,
            source_url: sourceUrl,
            wikidata_qid: null,
          });

        if (sourceError) {
          if (sourceError.code === '23505') {
            console.log(`  Skip duplicate Google Arts artwork: ${title}`);
            skipped++;
            continue;
          }
          throw new Error(`Failed to insert art source: ${sourceError.message}`);
        }

        await insertArtAsset({
          artId,
          storagePath: upload.path,
          publicUrl: upload.publicUrl,
          width: 0, // Will be determined later
          height: 0, // Will be determined later
          fileSize: stats.size,
          mimeType: mime,
          sha256: '', // Skip for now
        });

        // Add tags
        const allTags = [...artwork.tags];
        if (artwork.date) {
          const yearMatch = artwork.date.match(/(\d{4})/);
          if (yearMatch) allTags.push(yearMatch[1]);
        }
        if (artwork.medium) allTags.push(artwork.medium.toLowerCase());
        if (artwork.museum) allTags.push(`museum:${artwork.museum.toLowerCase()}`);

        if (allTags.length) {
          const tagIds = await upsertTags(allTags).then((rows) => rows.map((r) => r.id));
          await linkArtTags(artId, tagIds);
        }

        uploaded++;
        console.log(`  ✓ Uploaded "${title}" by ${artwork.artist}`);

        // Add delay between artworks to respect rate limits
        if (i < records.length - 1) { // Don't delay after the last one
          console.log(`  ⏳ Waiting 45 seconds before next artwork...`);
          await new Promise(resolve => setTimeout(resolve, 45000));
        }

      } catch (err) {
        const errorMessage = (err as Error).message;
        const isRateLimit = errorMessage.includes('429') || errorMessage.includes('Too Many Requests');

        if (isRateLimit) {
          rateLimitErrors++;
          console.log(`  🚫 Rate limit error for ${filename}: ${errorMessage}`);
        } else {
          errors++;
          console.log(`  ✗ Failed to process ${filename}: ${errorMessage}`);
        }

        // Record the failed artwork for retry later
        failedArtworks.push({
          filename,
          url: sourceUrl,
          error: errorMessage,
          timestamp: new Date().toISOString()
        });

        // Longer delay on errors (even longer for rate limits)
        const delayMs = isRateLimit ? 600000 : 180000; // 10 minutes for rate limits, 3 minutes for other errors
        const delayDesc = isRateLimit ? '10 minutes' : '3 minutes';
        console.log(`  ⏳ Waiting ${delayDesc} after ${isRateLimit ? 'rate limit' : 'error'}...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    // Save failed artworks for retry
    if (failedArtworks.length > 0) {
      const fs = await import('fs');

      // Save detailed JSON log
      const failedLogPath = 'google-arts-failed-artworks.json';
      fs.writeFileSync(failedLogPath, JSON.stringify({
        summary: {
          total_failed: failedArtworks.length,
          rate_limit_errors: failedArtworks.filter(f => f.error.includes('429') || f.error.includes('Too Many Requests')).length,
          other_errors: failedArtworks.filter(f => !f.error.includes('429') && !f.error.includes('Too Many Requests')).length,
          generated_at: new Date().toISOString()
        },
        failed_artworks: failedArtworks
      }, null, 2));

      // Save CSV for easy retry
      const failedCsvPath = 'google-arts-failed-artworks.csv';
      const csvHeader = 'filename,b_bgr_mean,g_bgr_mean,r_bgr_mean,h_hsv_mean,s_hsv_mean,v_hsv_mean,l_lab_mean,a_lab_mean,b_lab_mean,b_bgr_std,g_bgr_std,r_bgr_std,h_hsv_std,s_hsv_std,v_hsv_std,l_lab_std,a_lab_std,b_lab_std,image,page,color,index\n';

      // Find the original CSV records for failed artworks
      const failedRecords = records.filter((record: any) =>
        failedArtworks.some(failed => failed.filename === record.filename)
      );

      const csvContent = csvHeader + failedRecords.map((record: any) => {
        return [
          record.filename,
          record.b_bgr_mean || '',
          record.g_bgr_mean || '',
          record.r_bgr_mean || '',
          record.h_hsv_mean || '',
          record.s_hsv_mean || '',
          record.v_hsv_mean || '',
          record.l_lab_mean || '',
          record.a_lab_mean || '',
          record.b_lab_mean || '',
          record.b_bgr_std || '',
          record.g_bgr_std || '',
          record.r_bgr_std || '',
          record.h_hsv_std || '',
          record.s_hsv_std || '',
          record.v_hsv_std || '',
          record.l_lab_std || '',
          record.a_lab_std || '',
          record.b_lab_std || '',
          record.image || '',
          record.page || '',
          record.color || '',
          record.index || ''
        ].join(',');
      }).join('\n');

      fs.writeFileSync(failedCsvPath, csvContent);

      console.log(`\n📁 Failed artworks saved to:`);
      console.log(`   JSON: ${failedLogPath} (${failedArtworks.length} artworks)`);
      console.log(`   CSV:  ${failedCsvPath} (${failedRecords.length} artworks for retry)`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total artworks in CSV: ${records.length}`);
    console.log(`Attempted: ${attempted}`);
    console.log(`Uploaded: ${uploaded}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Rate limit errors (429): ${rateLimitErrors}`);
    console.log(`Other errors: ${errors}`);
    console.log(`Missing images: ${missingImages}`);
    console.log(`Failed artworks: ${failedArtworks.length}`);
    console.log(`Success rate: ${attempted > 0 ? ((uploaded / attempted) * 100).toFixed(1) : 0}%`);

  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
