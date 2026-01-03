#!/usr/bin/env node
/**
 * Google Arts & Culture Hybrid Metadata Importer
 * Uses WikiData API for artist/title metadata instead of scraping Google Arts
 *
 * Usage:
 *   npm run googlearts-hybrid -- --csv google-arts-remaining.csv --images downloads/GoogleImages --limit 10
 */

import { parseArgs } from './utils';
import { parse } from 'csv-parse/sync';
import fs from 'fs';
import path from 'path';
import { ensureArtist, upsertArt, upsertArtSource, insertArtAsset, upsertTags, linkArtTags } from './db';
import { cleanTitle, normalizeTitle, buildStoragePath } from './artUtils';
import { supabase } from './config';

interface WikiDataArtwork {
  title: string;
  artist: string;
  description?: string;
  date?: string;
  medium?: string;
  tags: string[];
}

async function searchWikiDataByTitle(title: string): Promise<WikiDataArtwork | null> {
  try {
    // Clean up title for search
    const searchTitle = title
      .replace(/"/g, '')
      .replace(/symphony in white/i, 'Symphony in White')
      .split(' - ')[0] // Remove artist name if present
      .trim();

    const query = `
      SELECT ?item ?itemLabel ?artistLabel ?date ?description WHERE {
        ?item wdt:P31 wd:Q3305213;  # instance of painting
              wdt:P1476 ?title.     # title
        ?item wdt:P170 ?artist.     # creator
        FILTER(CONTAINS(LCASE(?title), LCASE("${searchTitle}")))
        SERVICE wikibase:label { bd:serviceParam wikibase:language "[AUTO_LANGUAGE],en". }
        OPTIONAL { ?item wdt:P571 ?inception. }
        OPTIONAL { ?item wdt:P18 ?image. }
        OPTIONAL { ?item wdt:P571 ?date. }
        OPTIONAL { ?item schema:description ?description. }
      }
      LIMIT 5
    `;

    const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'WikiCommons-Art-Scraper/1.0 (https://github.com/plaintalkjon/wikicommons-art-scraper)'
      }
    });

    if (!response.ok) {
      console.log(`  WikiData query failed: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const bindings = data.results?.bindings || [];

    if (bindings.length === 0) {
      console.log(`  No WikiData results for: ${searchTitle}`);
      return null;
    }

    // Use first result
    const result = bindings[0];
    const artwork: WikiDataArtwork = {
      title: result.itemLabel?.value || searchTitle,
      artist: result.artistLabel?.value || 'Unknown Artist',
      description: result.description?.value || '',
      date: result.date?.value || '',
      medium: 'Painting', // Default for paintings
      tags: ['painting', 'wikidata']
    };

    console.log(`  📚 WikiData found: "${artwork.title}" by ${artwork.artist}`);
    return artwork;

  } catch (error) {
    console.log(`  WikiData search failed: ${error}`);
    return null;
  }
}

async function main() {
  const args = parseArgs();
  const csvPath = args.csv as string || 'google-arts-remaining.csv';
  const imagesDir = args.images as string || 'downloads/GoogleImages';
  const limit = args.limit ? parseInt(args.limit as string, 10) : 10;

  console.log('🔄 Google Arts Hybrid Metadata Import');
  console.log(`📁 CSV: ${csvPath}`);
  console.log(`🖼️  Images: ${imagesDir}`);
  console.log(`🎯 Limit: ${limit}`);
  console.log(`📚 Using WikiData API for metadata`);
  console.log('');

  // Read CSV
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  });

  console.log(`📊 Found ${records.length} artworks in CSV`);

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
  let wikiDataFound = 0;

  for (let i = 0; i < records.length && uploaded < limit; i++) {
    const record = records[i];
    const filename = record.filename;
    const sourceUrl = record.page;

    console.log(`\n[${i + 1}/${records.length}] Processing: ${filename}`);

    // Check if already processed
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

    try {
      // Extract potential title from filename or URL
      let potentialTitle = filename.replace(/\.\w+$/, ''); // Remove extension

      // Try to extract title from URL
      const urlMatch = sourceUrl.match(/\/asset\/([^\/]+)\//);
      if (urlMatch) {
        potentialTitle = urlMatch[1]
          .replace(/-/g, ' ')
          .replace(/\b\w/g, (l: string) => l.toUpperCase()); // Title case
      }

      console.log(`  🔍 Searching WikiData for: "${potentialTitle}"`);

      // Search WikiData for metadata
      const wikiData = await searchWikiDataByTitle(potentialTitle);

      if (!wikiData) {
        console.log(`  ⚠️  No WikiData metadata found for ${filename}, skipping`);
        errors++;
        continue;
      }

      wikiDataFound++;
      const title = cleanTitle(normalizeTitle(wikiData.title));
      const artistId = await getArtistId(wikiData.artist);

      // Check if image exists
      const imagePath = path.join(imagesDir, filename);
      if (!fs.existsSync(imagePath)) {
        console.log(`  ⚠️  Image not found: ${filename}`);
        errors++;
        continue;
      }

      const stats = fs.statSync(imagePath);
      const buffer = fs.readFileSync(imagePath);

      let mime = 'image/jpeg';
      if (filename.toLowerCase().endsWith('.png')) mime = 'image/png';

      const storagePath = buildStoragePath(wikiData.artist, {
        title,
        pageid: null,
      } as any, path.extname(filename).slice(1));

      const { uploadToStorage } = await import('./db');
      const upload = await uploadToStorage(storagePath, { buffer, mime });

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
          wikidata_qid: null,
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
        fileSize: stats.size,
        mimeType: mime,
        sha256: '',
      });

      // Add tags from WikiData
      const allTags = [...wikiData.tags];
      if (wikiData.date) {
        const yearMatch = wikiData.date.match(/(\d{4})/);
        if (yearMatch) allTags.push(yearMatch[1]);
      }
      if (wikiData.medium) allTags.push(wikiData.medium.toLowerCase());

      if (allTags.length) {
        const tagIds = await upsertTags(allTags).then((rows) => rows.map((r) => r.id));
        await linkArtTags(artId, tagIds);
      }

      uploaded++;
      console.log(`  ✅ Imported: "${title}" by ${wikiData.artist} (via WikiData)`);

      // Small delay to be respectful to WikiData API
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (err) {
      console.log(`  ❌ Failed to process ${filename}: ${(err as Error).message}`);
      errors++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('HYBRID METADATA IMPORT SUMMARY');
  console.log('='.repeat(60));
  console.log(`Processed: ${uploaded + skipped + errors}`);
  console.log(`Successfully uploaded: ${uploaded}`);
  console.log(`WikiData metadata found: ${wikiDataFound}`);
  console.log(`Skipped (already processed): ${skipped}`);
  console.log(`Errors: ${errors}`);
  console.log(`Success rate: ${uploaded + skipped + errors > 0 ? ((uploaded / (uploaded + skipped + errors)) * 100).toFixed(1) : 0}%`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
