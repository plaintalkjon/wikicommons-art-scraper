#!/usr/bin/env node
/**
 * Google Arts & Culture Browser Automation Importer
 * Uses Puppeteer to mimic real user behavior and avoid rate limiting
 *
 * Usage:
 *   npm run googlearts-browser -- --csv google-arts-remaining.csv --images downloads/GoogleImages --limit 10
 */

import puppeteer from 'puppeteer';
import { parseArgs } from './utils';
import { parse } from 'csv-parse/sync';
import fs from 'fs';
import path from 'path';
import { ensureArtist, upsertArt, upsertArtSource, insertArtAsset, upsertTags, linkArtTags } from './db';
import { cleanTitle, normalizeTitle, buildStoragePath } from './artUtils';
import { supabase } from './config';

interface BrowserConfig {
  headless: boolean;
  userAgent: string;
  viewport: { width: number; height: number };
  delays: {
    betweenRequests: [number, number]; // [min, max] seconds
    pageLoad: [number, number]; // [min, max] seconds
    mouseMovement: [number, number]; // [min, max] milliseconds
    scrolling: [number, number]; // [min, max] seconds
  };
}

const BROWSER_CONFIG: BrowserConfig = {
  headless: false, // Set to true for production
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  viewport: { width: 1366, height: 768 },
  delays: {
    betweenRequests: [45, 120], // 45-120 seconds between requests
    pageLoad: [3, 8], // 3-8 seconds for page load
    mouseMovement: [500, 2000], // 0.5-2 seconds for mouse movements
    scrolling: [2, 5] // 2-5 seconds for scrolling
  }
};

function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function simulateHumanBehavior(page: any) {
  // Random mouse movements
  const viewport = BROWSER_CONFIG.viewport;
  for (let i = 0; i < randomDelay(3, 8); i++) {
    await page.mouse.move(
      Math.random() * viewport.width,
      Math.random() * viewport.height
    );
    await new Promise(resolve => setTimeout(resolve, randomDelay(200, 800)));
  }

  // Random scrolling
  for (let i = 0; i < randomDelay(2, 5); i++) {
    await page.evaluate(() => {
      window.scrollBy(0, Math.random() * 300 - 150);
    });
    await new Promise(resolve => setTimeout(resolve, randomDelay(500, 1500)));
  }

  // Random wait
  await new Promise(resolve => setTimeout(resolve, randomDelay(1000, 3000)));
}

function extractArtistFromEntityUrl(html: string): string {
  // Look for entity URLs with categoryId=artist
  const entityMatch = html.match(/href="\/entity\/([^\/]+)\/[^"]*\?categoryId=artist"/i);
  if (entityMatch) {
    // Convert slug to title case
    return entityMatch[1]
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  // Fallback to other patterns
  const patterns = [
    /"author":\s*"([^"]+)"/i,
    /"creator":\s*"([^"]+)"/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return 'Unknown Artist';
}

function extractTitle(html: string): string {
  const patterns = [
    /"name":\s*"([^"]*Symphony in White[^"]*)"/i,
    /"name":\s*"([^"]+)"/i,
    /<title>([^<]+)<\/title>/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      let title = match[1].trim();
      title = title.replace(/^Google Arts & Culture\s*-\s*/i, '');
      title = title.replace(/\s*\|\s*Google Arts & Culture$/i, '');
      if (title.length > 3) return title;
    }
  }

  return 'Untitled Artwork';
}

function extractMetadata(html: string): {
  title: string;
  artist: string;
  description?: string;
  date?: string;
  medium?: string;
  museum?: string;
} {
  return {
    title: extractTitle(html),
    artist: extractArtistFromEntityUrl(html),
    description: '',
    date: '',
    medium: 'Painting', // Default assumption
    museum: ''
  };
}

async function main() {
  const args = parseArgs();
  const csvPath = args.csv as string || 'google-arts-remaining.csv';
  const imagesDir = args.images as string || 'downloads/GoogleImages';
  const limit = args.limit ? parseInt(args.limit as string, 10) : 10;
  const startFrom = args['start-from'] ? parseInt(args['start-from'] as string, 10) : 0;

  console.log('🚀 Google Arts Browser Automation Import');
  console.log(`📁 CSV: ${csvPath}`);
  console.log(`🖼️  Images: ${imagesDir}`);
  console.log(`🎯 Limit: ${limit}`);
  console.log(`📍 Start from: ${startFrom}`);
  console.log(`🤖 Browser: ${BROWSER_CONFIG.headless ? 'Headless' : 'Visible'}`);
  console.log('');

  // Read CSV
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  });

  console.log(`📊 Found ${records.length} artworks in CSV`);

  // Launch browser
  const browser = await puppeteer.launch({
    headless: BROWSER_CONFIG.headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu'
    ]
  });

  const artistCache = new Map<string, string>();

  try {
    let uploaded = 0;
    let skipped = 0;
    let errors = 0;

    for (let i = startFrom; i < records.length && uploaded < limit; i++) {
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
        // Create new page for each request
        const page = await browser.newPage();
        await page.setUserAgent(BROWSER_CONFIG.userAgent);
        await page.setViewport(BROWSER_CONFIG.viewport);

        // Add random delays and human-like behavior
        console.log(`  🕐 Waiting ${randomDelay(BROWSER_CONFIG.delays.betweenRequests[0], BROWSER_CONFIG.delays.betweenRequests[1])}s before request...`);
        await new Promise(resolve => setTimeout(resolve, randomDelay(BROWSER_CONFIG.delays.betweenRequests[0], BROWSER_CONFIG.delays.betweenRequests[1]) * 1000));

        // Navigate to page
        console.log(`  🌐 Loading: ${sourceUrl}`);
        await page.goto(sourceUrl, {
          waitUntil: 'networkidle2',
          timeout: 30000
        });

        // Wait for page to load
        await new Promise(resolve => setTimeout(resolve, randomDelay(BROWSER_CONFIG.delays.pageLoad[0], BROWSER_CONFIG.delays.pageLoad[1]) * 1000));

        // Simulate human behavior
        await simulateHumanBehavior(page);

        // Extract HTML content
        const html = await page.content();

        // Parse metadata
        const metadata = extractMetadata(html);

        console.log(`  ✅ Extracted: "${metadata.title}" by ${metadata.artist}`);

        // Close page
        await page.close();

        // Process artwork (same as original importer)
        const getArtistId = async (name: string) => {
          if (artistCache.has(name)) return artistCache.get(name)!;
          const id = await ensureArtist(name);
          artistCache.set(name, id);
          return id;
        };

        const title = cleanTitle(normalizeTitle(metadata.title));
        const artistId = await getArtistId(metadata.artist);

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

        const storagePath = buildStoragePath(metadata.artist, {
          title,
          pageid: null,
        } as any, path.extname(filename).slice(1));

        const { uploadToStorage } = await import('./db');
        const upload = await uploadToStorage(storagePath, { buffer, mime });

        const artId = await upsertArt({
          title,
          description: metadata.description || null,
          imageUrl: upload.publicUrl,
          artistId,
        });

        const { error: sourceError } = await supabase
          .from('art_sources')
          .insert({
            art_id: artId,
            source: 'googlearts',
            source_pageid: null,
            source_title: metadata.title,
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

        // Add basic tags
        const allTags = ['google arts'];
        if (metadata.medium) allTags.push(metadata.medium.toLowerCase());
        if (metadata.museum) allTags.push(`museum:${metadata.museum.toLowerCase()}`);

        if (allTags.length) {
          const tagIds = await upsertTags(allTags).then((rows) => rows.map((r) => r.id));
          await linkArtTags(artId, tagIds);
        }

        uploaded++;
        console.log(`  ✅ Successfully imported: "${title}" by ${metadata.artist}`);

      } catch (err) {
        console.log(`  ❌ Failed to process ${filename}: ${(err as Error).message}`);
        errors++;

        // Longer delay after errors
        console.log(`  🕐 Waiting 3 minutes after error...`);
        await new Promise(resolve => setTimeout(resolve, 180000));
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('BROWSER AUTOMATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`Processed: ${uploaded + skipped + errors}`);
    console.log(`Successfully uploaded: ${uploaded}`);
    console.log(`Skipped (already processed): ${skipped}`);
    console.log(`Errors: ${errors}`);
    console.log(`Success rate: ${uploaded + skipped + errors > 0 ? ((uploaded / (uploaded + skipped + errors)) * 100).toFixed(1) : 0}%`);

  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

