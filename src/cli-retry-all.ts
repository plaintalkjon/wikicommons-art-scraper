#!/usr/bin/env node
/**
 * CLI script to retry all failed paintings across all artists
 * Usage: npm run retry-all
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadFailures } from './failureTracker';

const FAILURES_DIR = path.join(process.cwd(), 'failures');

async function main() {
  console.log('=== Retrying All Failed Paintings ===\n');

  // Get all failure files
  if (!fs.existsSync(FAILURES_DIR)) {
    console.log('No failures directory found. Nothing to retry.');
    return;
  }

  const files = fs.readdirSync(FAILURES_DIR).filter(f => f.endsWith('.json'));
  
  if (files.length === 0) {
    console.log('No failure files found. Nothing to retry.');
    return;
  }

  // Extract unique artist names from failure files
  const artists = new Set<string>();
  files.forEach(file => {
    try {
      const content = fs.readFileSync(path.join(FAILURES_DIR, file), 'utf-8');
      const failures = JSON.parse(content);
      failures.forEach((f: { artist: string }) => artists.add(f.artist));
    } catch (e) {
      console.error(`Error reading ${file}:`, (e as Error).message);
    }
  });

  const artistList = Array.from(artists).sort();
  console.log(`Found ${artistList.length} artists with failures:\n`);

  // Show summary
  for (const artist of artistList) {
    const failures = loadFailures(artist);
    const retriable = failures.filter(f => 
      !f.error.includes('duplicate key') && 
      !f.error.includes('unique constraint')
    );
    console.log(`  ${artist}: ${failures.length} total, ${retriable.length} retriable`);
  }

  console.log('\n=== Starting Retry Process ===\n');

  // Retry each artist
  for (let i = 0; i < artistList.length; i++) {
    const artist = artistList[i];
    console.log(`\n[${i + 1}/${artistList.length}] Retrying failures for: ${artist}`);
    console.log('─'.repeat(50));

    // Use the existing retry script logic
    const { execSync } = require('child_process');
    try {
      execSync(`npm run retry -- --artist "${artist}"`, {
        stdio: 'inherit',
        cwd: process.cwd(),
      });
    } catch (error) {
      console.error(`Error retrying ${artist}:`, (error as Error).message);
      // Continue with next artist
    }

    // Small delay between artists
    if (i < artistList.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  console.log('\n=== Retry Process Complete ===\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
