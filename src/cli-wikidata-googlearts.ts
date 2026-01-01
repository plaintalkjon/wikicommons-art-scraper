#!/usr/bin/env node
/**
 * WikiData-Powered Google Arts Importer
 * Uses WikiData API for metadata instead of scraping Google Arts
 *
 * Usage:
 *   npm run wikidata-googlearts -- --csv google-arts-remaining.csv --images downloads/GoogleImages --limit 5
 */

import { parseArgs } from './utils';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import fs from 'fs';
import path from 'path';
import { ensureArtist, upsertArt, upsertArtSource, insertArtAsset, upsertTags, linkArtTags } from './db';
import { cleanTitle, normalizeTitle, buildStoragePath } from './artUtils';
import { supabase } from './config';
import { matchGoogleArtsToWikiData, extractWikiDataTags, testWikiDataMatching, testWikiDataAPI } from './wikidata-googlearts';

async function main() {
  const args = parseArgs();
  const csvPath = args.csv as string || 'google-arts-remaining.csv';
  const imagesDir = args.images as string || 'downloads/GoogleImages';
  const limit = args.limit ? parseInt(args.limit as string, 10) : 5;
  const test = Boolean(args.test ?? false);
  const dryRun = Boolean(args['dry-run'] ?? false);
  const generateCsv = Boolean(args['generate-csv'] ?? false);
  const includeProcessed = Boolean(args['include-processed'] ?? false);
  const csvOutputPath = (args['csv-output'] as string) || 'wikidata-googlearts-matches.csv';
  const minConfidence = (args['min-confidence'] as string) || 'low'; // high, medium, low, none

  console.log('🔄 WikiData-Powered Google Arts Import');
  console.log(`📁 CSV: ${csvPath}`);
  console.log(`🖼️  Images: ${imagesDir}`);
  console.log(`🎯 Limit: ${limit}`);
  console.log(`📚 Data Source: WikiData API`);
  console.log(`🎯 Min Confidence: ${minConfidence}`);
  console.log(`🧪 Dry Run: ${dryRun ? 'YES' : 'NO'}`);
  console.log(`📊 Generate CSV: ${generateCsv ? `YES (${csvOutputPath})` : 'NO'}`);
  console.log(`🔄 Include Processed: ${includeProcessed ? 'YES' : 'NO'}`);
  console.log('');

  // Run test if requested
  if (test) {
    console.log('🧪 Running WikiData API test...\n');
    await testWikiDataAPI();
    console.log('\n🧪 Running WikiData matching test...\n');
    await testWikiDataMatching();
    console.log('\n✅ Test complete. Run without --test to import.');
    return;
  }

  // Read CSV
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  });

  console.log(`📊 Found ${records.length} artworks in CSV\n`);

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
  let noMatch = 0;
  let lowConfidence = 0;

  // Collect CSV data if generating CSV
  const csvData: any[] = [];

  const confidenceLevels = { high: 3, medium: 2, low: 1, none: 0 };
  const minConfidenceLevel = confidenceLevels[minConfidence as keyof typeof confidenceLevels] || 0;

  for (let i = 0; i < records.length && uploaded < limit; i++) {
    const record = records[i];
    const filename = record.filename;
    const sourceUrl = record.page;

    console.log(`\n[${i + 1}/${records.length}] Processing: ${filename}`);

    // Check if already processed (skip for CSV generation with include-processed flag)
    let alreadyProcessed = false;
    if (!generateCsv || !includeProcessed) {
      const existing = await supabase
        .from('art_sources')
        .select('id')
        .eq('source', 'googlearts')
        .eq('source_url', sourceUrl)
        .maybeSingle();

      if (existing.data?.id) {
        console.log(`  ⏭️  Already processed: ${filename}`);
        skipped++;
        continue;
      }
    }

    try {
      // Match with WikiData
      const match = await matchGoogleArtsToWikiData(filename, sourceUrl);

      if (!match.wikiDataItem) {
        console.log(`  📭 No WikiData match found for ${filename}`);
        noMatch++;
        continue;
      }

      // Check confidence level
      const currentConfidenceLevel = confidenceLevels[match.confidence];
      if (currentConfidenceLevel < minConfidenceLevel) {
        console.log(`  ⚠️  Low confidence match (${match.confidence}) for ${filename}, skipping`);
        lowConfidence++;
        continue;
      }

      const wikiData = match.wikiDataItem;
      const title = cleanTitle(normalizeTitle(wikiData.title));

      // Check if image exists
      const imagePath = path.join(imagesDir, filename);
      const imageExists = fs.existsSync(imagePath);
      const stats = imageExists ? fs.statSync(imagePath) : null;

      let mime = 'image/jpeg';
      if (filename.toLowerCase().endsWith('.png')) mime = 'image/png';

      const storagePath = buildStoragePath(wikiData.artist, {
        title,
        pageid: null,
      } as any, path.extname(filename).slice(1));

      const tags = extractWikiDataTags(wikiData);

      // Collect CSV data
      csvData.push({
        filename,
        google_url: sourceUrl,
        image_exists: imageExists ? 'YES' : 'NO',
        image_size: stats ? stats.size : '',
        image_mime: mime,
        wikidata_qid: wikiData.qid,
        title: wikiData.title,
        clean_title: title,
        artist: wikiData.artist,
        confidence: match.confidence,
        description: wikiData.description || '',
        inception: wikiData.inception || '',
        genre: wikiData.genre?.join('; ') || '',
        materials: wikiData.materials?.join('; ') || '',
        location: wikiData.location || '',
        storage_path: storagePath,
        tags: tags.join('; '),
        search_terms: match.searchTerms.join('; ')
      });

      if (generateCsv) {
        console.log(`  📊 Collected: "${title}" by ${wikiData.artist} (${match.confidence} confidence)`);
        uploaded++;
      } else if (dryRun) {
        console.log(`  🧪 DRY RUN: Would import "${title}" by ${wikiData.artist} (${match.confidence} confidence)`);
        console.log(`    📁 Storage path: ${storagePath}`);
        console.log(`    🏷️  Tags: ${tags.join(', ') || 'none'}`);
        uploaded++;
      } else {
        const artistId = await getArtistId(wikiData.artist);
        const { uploadToStorage } = await import('./db');
        const buffer = fs.readFileSync(imagePath);
        const upload = await uploadToStorage(storagePath, { buffer: Buffer.from(buffer), mime });

        const artId = await upsertArt({
          title,
          description: wikiData.description || null,
          imageUrl: upload.publicUrl,
          artistId,
        });

        const { error: sourceError } = await supabase
          .from('art_sources')
          .insert({
            art_id: artId,
            source: 'googlearts',
            source_pageid: null,
            source_title: wikiData.title,
            source_url: sourceUrl,
            wikidata_qid: wikiData.qid,
          });

        if (sourceError) {
          if (sourceError.code === '23505') {
            console.log(`  ⏭️  Duplicate artwork: ${title}`);
            skipped++;
            continue;
          }
          throw new Error(`Failed to insert art source: ${sourceError.message}`);
        }

        await insertArtAsset({
          artId,
          storagePath: upload.path,
          publicUrl: upload.publicUrl,
          width: 0,
          height: 0,
          fileSize: stats?.size || 0,
          mimeType: mime,
          sha256: '',
        });

        // Add WikiData-based tags
        const allTags = extractWikiDataTags(wikiData);

        if (allTags.length) {
          const tagIds = await upsertTags(allTags).then((rows) => rows.map((r) => r.id));
          await linkArtTags(artId, tagIds);
        }

        console.log(`  ✅ Imported: "${title}" by ${wikiData.artist} (${match.confidence} confidence)`);
        uploaded++;
      }

      // Respectful delay for WikiData API
      await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (err) {
      console.log(`  ❌ Failed to process ${filename}: ${(err as Error).message}`);
      errors++;
    }
  }

  // Generate CSV if requested
  if (generateCsv && csvData.length > 0) {
    console.log(`\n📊 Generating CSV with ${csvData.length} matches...`);
    const csvContent = stringify(csvData, { header: true });
    fs.writeFileSync(csvOutputPath, csvContent);
    console.log(`✅ CSV saved to: ${csvOutputPath}`);

    // Show sample of CSV data
    console.log('\n📋 Sample of CSV data:');
    const sample = csvData.slice(0, 2);
    sample.forEach((row, i) => {
      console.log(`  ${i + 1}. "${row.clean_title}" by ${row.artist} (${row.confidence})`);
      console.log(`     Tags: ${row.tags || 'none'}`);
      console.log(`     Storage: ${row.storage_path}`);
      console.log('');
    });
  }

  console.log('\n' + '='.repeat(60));
  console.log('WIKIDATA GOOGLE ARTS IMPORT SUMMARY');
  console.log('='.repeat(60));
  const totalProcessed = uploaded + skipped + errors + noMatch + lowConfidence;
  console.log(`Total processed: ${totalProcessed}`);
  console.log(`Successfully ${generateCsv ? 'collected' : 'uploaded'}: ${uploaded}`);
  console.log(`Skipped (already processed): ${skipped}`);
  console.log(`No WikiData match: ${noMatch}`);
  console.log(`Low confidence matches: ${lowConfidence}`);
  console.log(`Other errors: ${errors}`);
  console.log(`Success rate: ${totalProcessed > 0 ? ((uploaded / totalProcessed) * 100).toFixed(1) : 0}%`);

  if (uploaded > 0) {
    if (generateCsv) {
      console.log('\n📊 CSV generated successfully!');
      console.log('Review the CSV file and run the import when ready.');
    } else {
      console.log('\n🎉 Successfully imported artworks using WikiData metadata!');
      console.log('No Google Arts scraping required - much more reliable! 🚀');
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
