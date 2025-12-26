#!/usr/bin/env node
/**
 * Process artists with more than 15 Met paintings
 * Processes one artist at a time, ordered from least to most paintings
 * Stops when a 403 error is encountered
 */

import { fetchAndStoreArtworks } from './pipeline';
import { supabase } from './supabaseClient';

const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';

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
 * Get artists that already have Met Museum artworks in the database
 */
async function getProcessedArtists(): Promise<Set<string>> {
  const processed = new Set<string>();
  
  try {
    const result = await supabase
      .from('art_sources')
      .select(`
        arts!inner (
          artist_id,
          artists!inner (
            name
          )
        )
      `)
      .eq('source', 'metmuseum');
    
    if (result.data) {
      result.data.forEach((source: any) => {
        const artistName = source.arts?.artists?.name;
        if (artistName) {
          processed.add(normalizeArtistName(artistName));
        }
      });
    }
  } catch (err) {
    console.log(`  ⚠ Could not fetch processed artists: ${(err as Error).message}`);
  }
  
  return processed;
}

/**
 * Get European artists with more than 15 Met paintings, ordered from least to most
 * Excludes artists that already have Met artworks in the database
 */
async function getArtistsWithManyPaintings(minPaintings: number = 16): Promise<Array<{ name: string; count: number }>> {
  console.log(`Fetching European artists with >${minPaintings - 1} Met paintings...\n`);
  
  // Get already processed artists
  console.log('  → Checking for already processed artists...');
  const processedArtists = await getProcessedArtists();
  console.log(`  ✓ Found ${processedArtists.size} artists already processed\n`);
  
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
    HAVING (COUNT(?metId) >= ${minPaintings})
    ORDER BY ASC(COUNT(?metId))
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
    
    const res = await fetch(WIKIDATA_SPARQL, {
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
    console.log(`  ✓ Found ${bindings.length} artists with >${minPaintings - 1} paintings\n`);
    
    const artists: Array<{ name: string; count: number }> = [];
    
    for (const binding of bindings) {
      const artistLabel = binding.artistLabel?.value;
      const countStr = binding.count?.value;
      
      if (!artistLabel || !countStr) continue;
      
      // Skip anonymous/unknown artists
      if (shouldSkipArtist(artistLabel)) {
        continue;
      }
      
      const normalized = normalizeArtistName(artistLabel);
      const count = parseInt(countStr, 10);
      
      if (normalized && !isNaN(count)) {
        // Skip if already processed
        if (processedArtists.has(normalized)) {
          continue;
        }
        
        // Check if we already have this artist in the current list
        if (!artists.find(a => a.name === normalized)) {
          artists.push({ name: normalized, count });
        }
      }
    }
    
    // Already sorted by count (ascending) from the query
    console.log(`  ✓ Selected ${artists.length} unprocessed artists for processing`);
    
    return artists;
  } catch (err) {
    if (err instanceof Error && err.message.includes('429')) {
      throw err;
    }
    throw new Error(`Failed to query Wikidata: ${(err as Error).message}`);
  }
}

async function main() {
  const minPaintings = parseInt(process.argv[2] || '16', 10);
  
  try {
    console.log('='.repeat(60));
    console.log('Batch Processing: Artists with Many Met Paintings (>15)');
    console.log('Processing one artist at a time, ordered from least to most');
    console.log('='.repeat(60));
    console.log();
    
    // Get artists with many paintings
    const artists = await getArtistsWithManyPaintings(minPaintings);
    
    if (artists.length === 0) {
      console.log('No unprocessed artists found with >15 paintings');
      return;
    }
    
    console.log(`Processing ${artists.length} artists:\n`);
    artists.forEach((artist, i) => {
      console.log(`  ${(i + 1).toString().padStart(3)}. ${artist.name.padEnd(40)} (${artist.count} paintings)`);
    });
    console.log();
    
    // Process each artist one at a time
    const results: Array<{ artist: string; paintings: number; result: { attempted: number; uploaded: number; skipped: number; errors: number; has403: boolean } }> = [];
    let encountered403 = false;
    
    for (let i = 0; i < artists.length && !encountered403; i++) {
      const artist = artists[i];
      const num = i + 1;
      
      console.log(`\n${'='.repeat(60)}`);
      console.log(`[${num}/${artists.length}] Processing: ${artist.name} (${artist.count} paintings)`);
      console.log('='.repeat(60));
      
      try {
        const result = await fetchAndStoreArtworks({
          artist: artist.name,
          source: 'metmuseum',
        });
        
        // Check for 403 errors in the result
        const has403 = result.errors.some(e => 
          e.message.includes('403') || 
          e.message.includes('Forbidden') ||
          e.message.includes('bot protection') ||
          e.message.includes('Incapsula')
        );
        
        results.push({
          artist: artist.name,
          paintings: artist.count,
          result: {
            attempted: result.attempted,
            uploaded: result.uploaded,
            skipped: result.skipped,
            errors: result.errors.length,
            has403,
          },
        });
        
        if (has403) {
          console.log(`\n${'='.repeat(60)}`);
          console.log(`⚠️  403 ERROR DETECTED for ${artist.name}`);
          console.log(`${'='.repeat(60)}`);
          console.log(`\nStopping processing due to bot protection.`);
          encountered403 = true;
          break;
        }
        
        console.log(`\n✓ Completed: ${artist.name}`);
        console.log(`  Uploaded: ${result.uploaded} | Skipped: ${result.skipped} | Errors: ${result.errors.length}`);
      } catch (err) {
        const errorMessage = (err as Error).message;
        const has403 = errorMessage.includes('403') || 
                       errorMessage.includes('Forbidden') ||
                       errorMessage.includes('bot protection') ||
                       errorMessage.includes('Incapsula');
        
        if (has403) {
          console.log(`\n${'='.repeat(60)}`);
          console.log(`⚠️  403 ERROR DETECTED for ${artist.name}`);
          console.log(`${'='.repeat(60)}`);
          console.log(`\nStopping processing due to bot protection.`);
          encountered403 = true;
        }
        
        console.error(`\n✗ Error processing ${artist.name}: ${errorMessage}`);
        results.push({
          artist: artist.name,
          paintings: artist.count,
          result: {
            attempted: 0,
            uploaded: 0,
            skipped: 0,
            errors: 1,
            has403,
          },
        });
        
        if (has403) {
          break;
        }
      }
      
      // Delay between artists to avoid overwhelming APIs
      if (i + 1 < artists.length && !encountered403) {
        console.log('\n  Waiting 5 seconds before next artist...\n');
        await new Promise(resolve => setTimeout(resolve, 5000));
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
    console.log(`  Stopped due to: ${encountered403 ? '403 Error (Bot Protection)' : 'All artists processed'}`);
    
    console.log(`\nPer-Artist Summary:`);
    results.forEach((r, i) => {
      const num = (i + 1).toString().padStart(3);
      const name = r.artist.padEnd(40);
      const paintings = r.paintings.toString().padStart(4);
      console.log(`  ${num}. ${name} | Paintings: ${paintings} | Uploaded: ${r.result.uploaded.toString().padStart(3)} | Skipped: ${r.result.skipped.toString().padStart(3)} | Errors: ${r.result.errors.toString().padStart(2)}${r.result.has403 ? ' [403]' : ''}`);
    });
    
    console.log(`\n${'='.repeat(60)}\n`);
  } catch (err) {
    console.error('\n✗ Error:', (err as Error).message);
    process.exit(1);
  }
}

main();
