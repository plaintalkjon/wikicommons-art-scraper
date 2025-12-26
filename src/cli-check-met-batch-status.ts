#!/usr/bin/env node
/**
 * Check status of Met batch processing and identify remaining/failed artists
 */

import { readFileSync, existsSync } from 'fs';

interface FailedMetArtist {
  artist: string;
  paintings: number;
  error: string;
  timestamp: string;
  source: 'metmuseum';
}

const MET_FAILURES_FILE = '.failures/met-artists-failed.json';

async function main() {
  console.log('Checking Met batch processing status...\n');
  
  // Read the log file
  const logFile = '.batch-met-large.log';
  if (!existsSync(logFile)) {
    console.log('❌ Log file not found: .batch-met-large.log');
    return;
  }
  
  const logContent = readFileSync(logFile, 'utf-8');
  
  // Extract completed artists
  const completedMatches = logContent.matchAll(/✓ Completed: ([^\n]+)/g);
  const completedArtists = new Set<string>();
  for (const match of completedMatches) {
    completedArtists.add(match[1].trim());
  }
  
  // Extract artists that encountered errors (403 or other)
  const errorMatches = logContent.matchAll(/⚠️.*403.*for ([^\n]+)|✗ Error processing ([^:]+):/g);
  const errorArtists = new Set<string>();
  for (const match of errorMatches) {
    const artist = match[1] || match[2];
    if (artist) errorArtists.add(artist.trim());
  }
  
  // Extract processing attempts
  const processingMatches = logContent.matchAll(/\[(\d+)\/37\] Processing: ([^(]+) \((\d+) paintings\)/g);
  const processedArtists: Array<{ num: number; name: string; paintings: number }> = [];
  for (const match of processingMatches) {
    processedArtists.push({
      num: parseInt(match[1], 10),
      name: match[2].trim(),
      paintings: parseInt(match[3], 10),
    });
  }
  
  // Expected list of 37 artists (from the initial query)
  const expectedArtists = [
    'Joan Miró', 'Alfred Sisley', 'Q239394', 'Josef Albers', 'Peter Paul Rubens',
    'John Singleton Copley', 'Vincent van Gogh', 'Jean-Honoré Fragonard',
    'Georges Braque', 'John Ramage', 'Hans Memling', 'Georg Baselitz',
    'Alberto Giacometti', 'Giovanni Battista Tiepolo', 'El Greco',
    'Pierre Bonnard', 'Paul Cézanne', 'Lucas Cranach the Elder', 'Henry Raeburn',
    'Hans Holbein the Younger', 'Édouard Manet', 'Q325925', 'Henri Matisse',
    'Gustave Courbet', 'Pierre-Auguste Renoir', 'Marcel Vertès',
    'Norman de Garis Davies', 'Rembrandt', 'Jean-Baptiste Camille Corot',
    'Camille Pissarro', 'Claude Monet', 'Edgar Degas', 'John Singer Sargent',
    'Pablo Picasso', 'Paul Klee', 'Anselm Kiefer', 'Nina M. Davies'
  ];
  
  console.log('='.repeat(60));
  console.log('Batch Processing Status');
  console.log('='.repeat(60));
  console.log(`\nTotal expected artists: ${expectedArtists.length}`);
  console.log(`Artists processed: ${processedArtists.length}`);
  console.log(`Artists completed: ${completedArtists.size}`);
  console.log(`Artists with errors: ${errorArtists.size}`);
  
  // Find remaining artists
  const processedNames = new Set(processedArtists.map(a => a.name));
  const remainingArtists = expectedArtists.filter(name => !processedNames.has(name));
  
  // Find failed artists (those with errors or 0 uploads)
  const failedArtists: FailedMetArtist[] = [];
  for (const artist of processedArtists) {
    if (errorArtists.has(artist.name)) {
      // Check log for specific error
      const artistSection = logContent.split(`[${artist.num}/37] Processing: ${artist.name}`)[1];
      const nextSection = artistSection?.split('\n============================================================\n[')[0] || '';
      let errorMsg = 'Unknown error';
      if (nextSection.includes('403')) {
        errorMsg = '403 Forbidden (Bot Protection)';
      } else if (nextSection.includes('No Met Museum artworks found')) {
        errorMsg = 'No artworks with images found';
      } else if (nextSection.includes('Could not find artist QID')) {
        errorMsg = 'Could not find artist in Wikidata';
      }
      
      failedArtists.push({
        artist: artist.name,
        paintings: artist.paintings,
        error: errorMsg,
        timestamp: new Date().toISOString(),
        source: 'metmuseum',
      });
    }
  }
  
  // Save failed Met artists
  if (failedArtists.length > 0) {
    const fs = await import('fs/promises');
    await fs.mkdir('.failures', { recursive: true });
    await fs.writeFile(
      MET_FAILURES_FILE,
      JSON.stringify(failedArtists, null, 2),
      'utf-8'
    );
    console.log(`\n✓ Saved ${failedArtists.length} failed Met artists to ${MET_FAILURES_FILE}`);
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log('Remaining Artists (Not Yet Processed)');
  console.log('='.repeat(60));
  if (remainingArtists.length === 0) {
    console.log('✓ All artists have been processed');
  } else {
    remainingArtists.forEach((name, i) => {
      console.log(`  ${(i + 1).toString().padStart(2)}. ${name}`);
    });
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log('Failed Met Artists');
  console.log('='.repeat(60));
  if (failedArtists.length === 0) {
    console.log('✓ No failed artists');
  } else {
    failedArtists.forEach((f, i) => {
      console.log(`  ${(i + 1).toString().padStart(2)}. ${f.artist.padEnd(40)} (${f.paintings} paintings)`);
      console.log(`      Error: ${f.error}`);
    });
  }
  
  // Check for 403 errors specifically
  const has403 = logContent.includes('403') || logContent.includes('Forbidden') || logContent.includes('bot protection');
  if (has403) {
    console.log(`\n${'='.repeat(60)}`);
    console.log('⚠️  403 ERRORS DETECTED');
    console.log('='.repeat(60));
    console.log('Bot protection may have been triggered.');
  }
  
  console.log();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
