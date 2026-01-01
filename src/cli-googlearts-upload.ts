#!/usr/bin/env node
/**
 * Google Arts CSV Upload Processor
 * Reads scraped metadata CSV and prepares for database upload
 *
 * Usage:
 *   npm run googlearts-upload -- --csv scraped-metadata.csv --images /path/to/images [--dry-run]
 */

import { parseArgs } from './utils';
import { parse } from 'csv-parse/sync';
import * as fs from 'fs';
import * as path from 'path';

interface UploadRecord {
  url: string;
  status: string;
  filename: string;
  title?: string;
  artist?: string;
  tags?: string;
  description?: string;
  date?: string;
  medium?: string;
  dimensions?: string;
  museum?: string;
  scraped_at: string;
  error?: string;
}

async function main() {
  const args = parseArgs();
  const csvPath = args.csv as string;
  const imagesDir = args.images as string;
  const dryRun = Boolean(args['dry-run'] ?? false);

  if (!csvPath || !imagesDir) {
    console.error('Usage: npm run googlearts-upload -- --csv <metadata-csv> --images <images-dir> [--dry-run]');
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

  console.log('📤 Google Arts Upload Processor');
  console.log(`📁 Metadata CSV: ${csvPath}`);
  console.log(`🖼️  Images: ${imagesDir}`);
  console.log(`🧪 Dry Run: ${dryRun ? 'YES' : 'NO'}`);
  console.log('');

  // Read and parse the metadata CSV
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const records: UploadRecord[] = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  console.log(`📊 Loaded ${records.length} records from CSV\n`);

  // Process records
  let successful = 0;
  let failed = 0;
  let skipped = 0;

  const issues: string[] = [];

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const progress = ((i + 1) / records.length * 100).toFixed(1);

    console.log(`[${i + 1}/${records.length}] ${progress}% Processing: ${record.filename}`);

    // Validate the record
    const validation = validateRecord(record, imagesDir);

    if (!validation.valid) {
      console.log(`  ❌ Invalid: ${validation.reason}`);
      failed++;
      issues.push(`${record.filename}: ${validation.reason}`);
      continue;
    }

    if (record.status !== 'SUCCESS') {
      console.log(`  ⏭️  Skipped (${record.status}): ${record.error || 'No error details'}`);
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`  🧪 DRY RUN: Would upload "${record.title}" by ${record.artist}`);
      console.log(`    📁 Image: ${validation.imagePath}`);
      console.log(`    📊 Metadata: ${Object.keys(record).filter(k => record[k as keyof UploadRecord]).length} fields`);

      // Show what would be uploaded
      const uploadData = {
        title: record.title,
        artist: record.artist,
        description: record.description,
        date: record.date,
        medium: record.medium,
        dimensions: record.dimensions,
        museum: record.museum,
        tags: record.tags?.split(';').filter(t => t.trim()),
        imageFile: validation.imagePath
      };
      console.log(`    📋 Data: ${JSON.stringify(uploadData, null, 2).split('\n').slice(0, 5).join('\n') + '...'}`);
    } else {
      // TODO: Implement actual upload logic
      console.log(`  ✅ Would upload: "${record.title}" by ${record.artist}`);
    }

    successful++;
  }

  console.log('\n' + '='.repeat(60));
  console.log('UPLOAD PROCESSING SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total records: ${records.length}`);
  console.log(`Valid for upload: ${successful}`);
  console.log(`Skipped (failed scraping): ${skipped}`);
  console.log(`Invalid records: ${failed}`);
  console.log(`Success rate: ${records.length > 0 ? ((successful / records.length) * 100).toFixed(1) : 0}%`);

  if (issues.length > 0) {
    console.log('\n⚠️  ISSUES FOUND:');
    issues.slice(0, 10).forEach(issue => console.log(`  - ${issue}`));
    if (issues.length > 10) {
      console.log(`  ... and ${issues.length - 10} more`);
    }
  }

  if (dryRun) {
    console.log('\n🧪 This was a dry run. No database changes were made.');
    console.log('Review the output above and run without --dry-run when ready.');
  } else {
    console.log('\n⚠️  UPLOAD NOT IMPLEMENTED YET');
    console.log('This CLI currently only validates records.');
    console.log('Database upload logic will be added next.');
  }
}

function validateRecord(record: UploadRecord, imagesDir: string): { valid: boolean; reason?: string; imagePath?: string } {
  // Check required fields
  if (!record.title || !record.artist) {
    return { valid: false, reason: 'Missing title or artist' };
  }

  // Check image exists
  const imagePath = path.join(imagesDir, record.filename);
  if (!fs.existsSync(imagePath)) {
    return { valid: false, reason: `Image file not found: ${record.filename}` };
  }

  // Get image stats
  try {
    const stats = fs.statSync(imagePath);
    if (stats.size === 0) {
      return { valid: false, reason: 'Image file is empty' };
    }
  } catch (error) {
    return { valid: false, reason: `Cannot read image file: ${error}` };
  }

  return { valid: true, imagePath };
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
