#!/usr/bin/env node
/**
 * Analyze Met batch processing and identify remaining/failed artists
 */

import { readFileSync, existsSync, writeFileSync } from 'fs';

interface FailedMetArtist {
  artist: string;
  paintings: number;
  error: string;
  timestamp: string;
  source: 'metmuseum';
}

async function main() {
  console.log('Analyzing Met batch processing...\n');
  
  const logFile = '.batch-met-large.log';
  if (!existsSync(logFile)) {
    console.log('❌ Log file not found');
    return;
  }
  
  const logContent = readFileSync(logFile, 'utf-8');
  
  // Expected 37 artists (ordered from least to most paintings)
  const expectedArtists = [
    { name: 'Joan Miró', paintings: 16 },
    { name: 'Alfred Sisley', paintings: 16 },
    { name: 'Q239394', paintings: 16 },
    { name: 'Josef Albers', paintings: 17 },
    { name: 'Peter Paul Rubens', paintings: 17 },
    { name: 'John Singleton Copley', paintings: 18 },
    { name: 'Vincent van Gogh', paintings: 18 },
    { name: 'Jean-Honoré Fragonard', paintings: 18 },
    { name: 'Georges Braque', paintings: 19 },
    { name: 'John Ramage', paintings: 19 },
    { name: 'Hans Memling', paintings: 20 },
    { name: 'Georg Baselitz', paintings: 20 },
    { name: 'Alberto Giacometti', paintings: 20 },
    { name: 'Giovanni Battista Tiepolo', paintings: 23 },
    { name: 'El Greco', paintings: 23 },
    { name: 'Pierre Bonnard', paintings: 24 },
    { name: 'Paul Cézanne', paintings: 24 },
    { name: 'Lucas Cranach the Elder', paintings: 24 },
    { name: 'Henry Raeburn', paintings: 24 },
    { name: 'Hans Holbein the Younger', paintings: 24 },
    { name: 'Édouard Manet', paintings: 25 },
    { name: 'Q325925', paintings: 26 },
    { name: 'Henri Matisse', paintings: 26 },
    { name: 'Gustave Courbet', paintings: 28 },
    { name: 'Pierre-Auguste Renoir', paintings: 28 },
    { name: 'Marcel Vertès', paintings: 30 },
    { name: 'Norman de Garis Davies', paintings: 30 },
    { name: 'Rembrandt', paintings: 31 },
    { name: 'Jean-Baptiste Camille Corot', paintings: 39 },
    { name: 'Camille Pissarro', paintings: 42 },
    { name: 'Claude Monet', paintings: 43 },
    { name: 'Edgar Degas', paintings: 49 },
    { name: 'John Singer Sargent', paintings: 58 },
    { name: 'Pablo Picasso', paintings: 78 },
    { name: 'Paul Klee', paintings: 116 },
    { name: 'Anselm Kiefer', paintings: 129 },
    { name: 'Nina M. Davies', paintings: 310 },
  ];
  
  // Extract completed artists from summary
  const summarySection = logContent.split('Per-Artist Summary:')[1];
  const processedArtists = new Set<string>();
  const artistResults = new Map<string, { uploaded: number; skipped: number; errors: number }>();
  
  if (summarySection) {
    const lines = summarySection.split('\n');
    for (const line of lines) {
      // Format: "   28. John Singer Sargent                      | Paintings:   58 | Uploaded:   0 | Skipped:   0 | Errors:  0"
      const match = line.match(/\d+\.\s+([^|]+)\s+\|\s+Paintings:\s+\d+\s+\|\s+Uploaded:\s+(\d+)\s+\|\s+Skipped:\s+(\d+)\s+\|\s+Errors:\s+(\d+)/);
      if (match) {
        const artist = match[1].trim();
        processedArtists.add(artist);
        artistResults.set(artist, {
          uploaded: parseInt(match[2], 10),
          skipped: parseInt(match[3], 10),
          errors: parseInt(match[4], 10),
        });
      }
    }
  }
  
  // Find remaining artists
  const remainingArtists = expectedArtists.filter(a => !processedArtists.has(a.name));
  
  // Find failed artists (those with 0 uploads and errors, or specific error messages)
  const failedArtists: FailedMetArtist[] = [];
  
  for (const artist of expectedArtists) {
    if (processedArtists.has(artist.name)) {
      const result = artistResults.get(artist.name);
      
      // Check log for this artist's processing
      const artistSections = logContent.split(new RegExp(`\\[\\d+/\\d+\\] Processing: ${artist.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
      let foundArtworks = 0;
      let retrievedArtworks = 0;
      let has403 = false;
      
      if (artistSections.length > 1) {
        const artistSection = artistSections[1].split('\n============================================================\n[')[0] || '';
        
        // Check for found artworks count
        const foundMatch = artistSection.match(/Found (\d+) artworks in Met Museum collection/);
        if (foundMatch) {
          foundArtworks = parseInt(foundMatch[1], 10);
        }
        
        // Check for retrieved artworks count
        const retrievedMatch = artistSection.match(/Retrieved (\d+) artworks with images from Met Museum/);
        if (retrievedMatch) {
          retrievedArtworks = parseInt(retrievedMatch[1], 10);
        }
        
        // Check for 403 errors
        has403 = artistSection.includes('403') || 
                 artistSection.includes('Forbidden') || 
                 artistSection.includes('bot protection') ||
                 artistSection.includes('Incapsula');
      }
      
      // Mark as failed if:
      // 1. Has errors in result
      // 2. Found artworks but retrieved 0 (likely 403 during batch fetch)
      // 3. Has explicit 403 in log
      if (result && ((result.uploaded === 0 && result.errors > 0) || 
                     (foundArtworks > 0 && retrievedArtworks === 0) ||
                     has403)) {
        let errorMsg = 'Unknown error';
        if (has403 || (foundArtworks > 0 && retrievedArtworks === 0)) {
          errorMsg = `403 Forbidden (Bot Protection) - Found ${foundArtworks} artworks in Wikidata but 0 retrieved from Met API`;
        } else if (result.errors > 0) {
          errorMsg = `Processing errors (${result.errors} errors)`;
        } else if (foundArtworks === 0) {
          errorMsg = 'No artworks found in Wikidata';
        } else {
          errorMsg = 'No artworks with images found in Met API';
        }
        
        failedArtists.push({
          artist: artist.name,
          paintings: artist.paintings,
          error: errorMsg,
          timestamp: new Date().toISOString(),
          source: 'metmuseum',
        });
      }
    } else {
      // Not processed at all
      failedArtists.push({
        artist: artist.name,
        paintings: artist.paintings,
        error: 'Not processed (script stopped early)',
        timestamp: new Date().toISOString(),
        source: 'metmuseum',
      });
    }
  }
  
  // Save failed Met artists
  const fs = await import('fs/promises');
  await fs.mkdir('.failures', { recursive: true });
  const metFailuresFile = '.failures/met-artists-failed.json';
  await fs.writeFile(
    metFailuresFile,
    JSON.stringify(failedArtists, null, 2),
    'utf-8'
  );
  
  // Display results
  console.log('='.repeat(60));
  console.log('Met Batch Processing Analysis');
  console.log('='.repeat(60));
  console.log(`\nTotal expected artists: ${expectedArtists.length}`);
  console.log(`Artists processed: ${processedArtists.size}`);
  console.log(`Artists remaining: ${remainingArtists.length}`);
  console.log(`Failed artists: ${failedArtists.length}`);
  
  // Check for 403 errors
  const has403 = logContent.includes('403') || logContent.includes('Forbidden') || logContent.includes('bot protection');
  if (has403) {
    console.log(`\n⚠️  403 ERRORS DETECTED in log`);
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log('Remaining Artists (Not Processed)');
  console.log('='.repeat(60));
  if (remainingArtists.length === 0) {
    console.log('✓ All artists have been processed');
  } else {
    remainingArtists.forEach((a, i) => {
      console.log(`  ${(i + 1).toString().padStart(2)}. ${a.name.padEnd(40)} (${a.paintings} paintings)`);
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
    console.log(`\n✓ Saved to: ${metFailuresFile}`);
  }
  
  // Show successful uploads
  const successfulArtists = Array.from(artistResults.entries())
    .filter(([_, result]) => result.uploaded > 0)
    .map(([name, result]) => ({ name, ...result }));
  
  if (successfulArtists.length > 0) {
    console.log(`\n${'='.repeat(60)}`);
    console.log('Successfully Processed Artists');
    console.log('='.repeat(60));
    successfulArtists
      .sort((a, b) => b.uploaded - a.uploaded)
      .forEach((a, i) => {
        console.log(`  ${(i + 1).toString().padStart(2)}. ${a.name.padEnd(40)} | Uploaded: ${a.uploaded} | Skipped: ${a.skipped}`);
      });
  }
  
  console.log();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
