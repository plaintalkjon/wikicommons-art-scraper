#!/usr/bin/env node
/**
 * Batch process the top 50 European artists with Met paintings
 * Processes each artist through the Met Museum pipeline
 */

import { fetchAndStoreArtworks } from './pipeline';

const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';

/**
 * Check if artist name should be skipped (anonymous, unknown, etc.)
 */
function shouldSkipArtist(name: string | null | undefined): boolean {
  if (!name || name.trim() === '') return true;
  
  const lower = name.toLowerCase().trim();
  const skipPatterns = [
    'unknown',
    'anonymous',
    'unidentified',
    'attributed to',
    'workshop of',
    'follower of',
    'circle of',
    'style of',
    'after',
    'copy after',
    'possibly',
    'probably',
  ];
  
  return skipPatterns.some(pattern => lower.includes(pattern));
}

/**
 * Normalize artist name (basic cleanup)
 */
function normalizeArtistName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ' ') // Multiple spaces to single
    .replace(/\([^)]*\)/g, '') // Remove parenthetical notes
    .trim();
}

/**
 * Get top 50 European artists with Met paintings from Wikidata
 */
async function getTop50Artists(): Promise<string[]> {
  console.log('Fetching top 50 European artists with Met paintings from Wikidata...\n');
  
  const query = `
    SELECT DISTINCT ?artist ?artistLabel (COUNT(?metId) AS ?count) WHERE {
      ?artwork wdt:P31 wd:Q3305213 .  # instance of painting
      ?artwork wdt:P195 wd:Q160236 .   # in Met Museum collection
      ?artwork wdt:P3634 ?metId .      # has Met object ID
      ?artwork wdt:P170 ?artist .      # creator = artist
      ?artist wdt:P31 wd:Q5 .          # artist is human
      {
        ?artist wdt:P27 ?country .     # artist nationality
        ?country wdt:P30 wd:Q46 .      # country in Europe
      }
      UNION
      {
        ?artwork wdt:P17 ?country .    # artwork country of origin
        ?country wdt:P30 wd:Q46 .      # country in Europe
      }
      SERVICE wikibase:label {
        bd:serviceParam wikibase:language "en" .
      }
    }
    GROUP BY ?artist ?artistLabel
    ORDER BY DESC(?count)
    LIMIT 50
  `;
  
  try {
    const { config } = await import('./config');
    
    const headers: HeadersInit = {
      'Content-Type': 'application/sparql-query',
      Accept: 'application/sparql-results+json',
      'User-Agent': config.wikimediaClientId 
        ? `wikicommons-art-scraper/1.0 (OAuth client: ${config.wikimediaClientId})`
        : 'wikicommons-art-scraper/1.0 (contact: developer@example.com)',
    };
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180000); // 3 minute timeout
    
    const res = await fetch(SPARQL_ENDPOINT, {
      method: 'POST',
      headers,
      body: query,
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!res.ok) {
      if (res.status === 429) {
        throw new Error('Wikidata rate limit (429)');
      }
      throw new Error(`Wikidata query failed: ${res.status} ${res.statusText}`);
    }
    
    const data = (await res.json()) as {
      results: { bindings: Array<Record<string, { type: string; value: string }>> };
    };
    
    const bindings = data.results?.bindings ?? [];
    console.log(`  ✓ Found ${bindings.length} artists\n`);
    
    const artists: string[] = [];
    
    for (const binding of bindings) {
      const artistLabel = binding.artistLabel?.value;
      
      if (!artistLabel) continue;
      
      // Skip anonymous/unknown artists
      if (shouldSkipArtist(artistLabel)) {
        continue;
      }
      
      const normalized = normalizeArtistName(artistLabel);
      if (normalized && !artists.includes(normalized)) {
        artists.push(normalized);
      }
    }
    
    return artists;
  } catch (err) {
    if (err instanceof Error && err.message.includes('429')) {
      throw err;
    }
    throw new Error(`Failed to query Wikidata: ${(err as Error).message}`);
  }
}

async function main() {
  try {
    console.log('='.repeat(60));
    console.log('Batch Processing: Top 50 European Artists (Met Museum)');
    console.log('='.repeat(60));
    console.log();
    
    // Get top 50 artists
    const artists = await getTop50Artists();
    
    if (artists.length === 0) {
      console.log('No artists found');
      return;
    }
    
    console.log(`Processing ${artists.length} artists:\n`);
    artists.forEach((name, i) => {
      console.log(`  ${(i + 1).toString().padStart(2)}. ${name}`);
    });
    console.log();
    
    // Process each artist
    const results: Array<{ artist: string; result: { attempted: number; uploaded: number; skipped: number; errors: number } }> = [];
    
    for (let i = 0; i < artists.length; i++) {
      const artist = artists[i];
      const num = i + 1;
      
      console.log(`\n${'='.repeat(60)}`);
      console.log(`[${num}/${artists.length}] Processing: ${artist}`);
      console.log('='.repeat(60));
      
      try {
        const result = await fetchAndStoreArtworks({
          artist,
          source: 'metmuseum',
        });
        
        results.push({
          artist,
          result: {
            attempted: result.attempted,
            uploaded: result.uploaded,
            skipped: result.skipped,
            errors: result.errors.length,
          },
        });
        
        console.log(`\n✓ Completed: ${artist}`);
        console.log(`  Uploaded: ${result.uploaded} | Skipped: ${result.skipped} | Errors: ${result.errors.length}`);
      } catch (err) {
        console.error(`\n✗ Error processing ${artist}: ${(err as Error).message}`);
        results.push({
          artist,
          result: {
            attempted: 0,
            uploaded: 0,
            skipped: 0,
            errors: 1,
          },
        });
      }
      
      // Small delay between artists to avoid overwhelming APIs
      if (i + 1 < artists.length) {
        console.log('\n  Waiting 2 seconds before next artist...\n');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    // Final summary
    console.log(`\n${'='.repeat(60)}`);
    console.log('Batch Processing Complete');
    console.log('='.repeat(60));
    
    const totalAttempted = results.reduce((sum, r) => sum + r.result.attempted, 0);
    const totalUploaded = results.reduce((sum, r) => sum + r.result.uploaded, 0);
    const totalSkipped = results.reduce((sum, r) => sum + r.result.skipped, 0);
    const totalErrors = results.reduce((sum, r) => sum + r.result.errors, 0);
    
    console.log(`\nTotal Results:`);
    console.log(`  Artists processed: ${results.length}`);
    console.log(`  Total attempted: ${totalAttempted}`);
    console.log(`  Total uploaded: ${totalUploaded} ✓`);
    console.log(`  Total skipped: ${totalSkipped}`);
    console.log(`  Total errors: ${totalErrors}`);
    
    console.log(`\nPer-Artist Summary:`);
    results.forEach((r, i) => {
      const num = (i + 1).toString().padStart(2);
      const name = r.artist.padEnd(35);
      console.log(`  ${num}. ${name} | Uploaded: ${r.result.uploaded.toString().padStart(3)} | Skipped: ${r.result.skipped.toString().padStart(3)} | Errors: ${r.result.errors.toString().padStart(2)}`);
    });
    
    console.log(`\n${'='.repeat(60)}\n`);
  } catch (err) {
    console.error('\n✗ Error:', (err as Error).message);
    process.exit(1);
  }
}

main();
