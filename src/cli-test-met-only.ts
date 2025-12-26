#!/usr/bin/env node
/**
 * Test Met-only scraping with 10 European artists (least paintings)
 * 
 * Usage:
 *   npm run test-met-only
 */

import { fetchAndStoreFromMetOnly } from './pipeline-met-only';
import { findArtworksByArtist } from './metmuseum';
import { findArtistQID } from './wikidata';

interface ArtistWithCount {
  name: string;
  qid: string;
  count: number;
}

/**
 * Get artists that already have Met Museum artworks in the database
 */
async function getProcessedArtists(): Promise<Set<string>> {
  const { supabase } = await import('./supabaseClient');
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
          processed.add(artistName.trim().toLowerCase());
        }
      });
    }
  } catch (err) {
    console.log(`  ⚠ Could not fetch processed artists: ${(err as Error).message}`);
  }
  
  return processed;
}

/**
 * Get European artists with Met paintings, ordered by count (ascending)
 * Returns top N artists with least paintings, excluding already processed ones
 */
async function getArtistsWithLeastPaintings(limit: number = 10): Promise<ArtistWithCount[]> {
  console.log(`Fetching ${limit} European artists with least Met paintings...\n`);
  
  // Get already processed artists
  console.log('  → Checking for already processed artists...');
  const processedArtists = await getProcessedArtists();
  console.log(`  ✓ Found ${processedArtists.size} artists already processed\n`);
  
  const query = `
    SELECT DISTINCT ?artist ?artistLabel (COUNT(?metId) AS ?count) WHERE {
      ?artwork wdt:P31 wd:Q3305213 .  # instance of painting
      ?artwork wdt:P195 wd:Q160236 .  # collection: Met Museum
      ?artwork wdt:P3634 ?metId .      # Met object ID
      ?artwork wdt:P170 ?artist .      # creator
      ?artist wdt:P31 wd:Q5 .          # instance of human
      {
        ?artist wdt:P27 ?country .     # nationality
        ?country wdt:P30 wd:Q46 .      # continent: Europe
      }
      UNION
      {
        ?artwork wdt:P17 ?country .    # country of origin
        ?country wdt:P30 wd:Q46 .      # continent: Europe
      }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
    }
    GROUP BY ?artist ?artistLabel
    HAVING (?count >= 1 && ?count <= 10)
    ORDER BY ASC(?count)
    LIMIT ${limit * 5}
  `;
  
  try {
    const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
    const { config } = await import('./config');
    
    const headers: HeadersInit = {
      'Content-Type': 'application/sparql-query',
      Accept: 'application/sparql-results+json',
      'User-Agent': config.wikimediaClientId 
        ? `wikicommons-art-scraper/1.0 (OAuth client: ${config.wikimediaClientId})`
        : 'wikicommons-art-scraper/1.0 (contact: developer@example.com)',
    };
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    
    const res = await fetch(SPARQL_ENDPOINT, {
      method: 'POST',
      headers,
      body: query,
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!res.ok) {
      throw new Error(`Wikidata query failed: ${res.status} ${res.statusText}`);
    }
    
    const data = (await res.json()) as {
      results: { bindings: Array<Record<string, { type: string; value: string }>> };
    };
    
    const bindings = data.results?.bindings ?? [];
    
    const artists: ArtistWithCount[] = [];
    for (const binding of bindings) {
      const artistQID = binding.artist?.value?.replace('http://www.wikidata.org/entity/', '');
      const artistLabel = binding.artistLabel?.value;
      const countStr = binding.count?.value;
      
      if (artistQID && artistLabel && countStr) {
        const count = parseInt(countStr, 10);
        if (!isNaN(count)) {
          artists.push({
            name: artistLabel,
            qid: artistQID,
            count,
          });
        }
      }
    }
    
    // Filter out already processed artists
    const unprocessed = artists.filter(artist => 
      !processedArtists.has(artist.name.trim().toLowerCase())
    );
    
    // Sort by count and take top N
    unprocessed.sort((a, b) => a.count - b.count);
    return unprocessed.slice(0, limit);
  } catch (err) {
    throw new Error(`Failed to get artists: ${(err as Error).message}`);
  }
}

async function main() {
  console.log('Met-Only Scraping Test Run\n');
  console.log('='.repeat(60));
  console.log('Finding 10 European artists with least Met paintings...\n');
  
  try {
    // Get 10 artists with least paintings
    const artists = await getArtistsWithLeastPaintings(10);
    
    if (artists.length === 0) {
      console.log('❌ No artists found');
      process.exit(1);
    }
    
    console.log('Selected artists:');
    artists.forEach((artist, i) => {
      console.log(`  ${(i + 1).toString().padStart(2)}. ${artist.name.padEnd(40)} (${artist.count} paintings)`);
    });
    console.log();
    
    // Collect all object IDs from these artists
    const allObjectIDs: number[] = [];
    const artistObjectMap = new Map<string, number[]>(); // artist name -> object IDs
    
    console.log('='.repeat(60));
    console.log('Fetching Met object IDs for each artist...\n');
    
    for (const artist of artists) {
      try {
        console.log(`Fetching artworks for: ${artist.name} (${artist.count} paintings)...`);
        
        // Use the existing findArtworksByArtist function, but we need to adapt it
        // Actually, we need to get object IDs without requiring Wikidata QID
        // Let's query Wikidata for the Met object IDs directly
        
        const query = `
          SELECT ?metId WHERE {
            ?artwork wdt:P31 wd:Q3305213 .
            ?artwork wdt:P195 wd:Q160236 .
            ?artwork wdt:P3634 ?metId .
            ?artwork wdt:P170 wd:${artist.qid} .
          }
          LIMIT ${artist.count + 10}
        `;
        
        const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
        const { config } = await import('./config');
        
        const headers: HeadersInit = {
          'Content-Type': 'application/sparql-query',
          Accept: 'application/sparql-results+json',
          'User-Agent': config.wikimediaClientId 
            ? `wikicommons-art-scraper/1.0 (OAuth client: ${config.wikimediaClientId})`
            : 'wikicommons-art-scraper/1.0 (contact: developer@example.com)',
        };
        
        const res = await fetch(SPARQL_ENDPOINT, {
          method: 'POST',
          headers,
          body: query,
        });
        
        if (!res.ok) {
          console.log(`  ⚠ Failed to fetch object IDs: ${res.status}`);
          continue;
        }
        
        const data = (await res.json()) as {
          results: { bindings: Array<Record<string, { type: string; value: string }>> };
        };
        
        const objectIDs: number[] = [];
        for (const binding of data.results?.bindings ?? []) {
          const metIdStr = binding.metId?.value;
          if (metIdStr) {
            const metId = parseInt(metIdStr, 10);
            if (!isNaN(metId)) {
              objectIDs.push(metId);
            }
          }
        }
        
        console.log(`  ✓ Found ${objectIDs.length} Met object IDs`);
        artistObjectMap.set(artist.name, objectIDs);
        allObjectIDs.push(...objectIDs);
        
        // Small delay between artists
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (err) {
        console.log(`  ✗ Error: ${(err as Error).message}`);
      }
    }
    
    console.log(`\n✓ Total object IDs collected: ${allObjectIDs.length}\n`);
    
    if (allObjectIDs.length === 0) {
      console.log('❌ No object IDs found');
      process.exit(1);
    }
    
    // Run Met-only scraper on these object IDs
    console.log('='.repeat(60));
    console.log('Running Met-only scraper...\n');
    
    const result = await fetchAndStoreFromMetOnly({
      departmentName: 'European Paintings',
      objectIDs: allObjectIDs,
      limit: allObjectIDs.length,
      dryRun: false, // Set to true for testing
    });
    
    console.log('\n' + '='.repeat(60));
    console.log('Test Run Complete');
    console.log('='.repeat(60));
    console.log(`  Artists processed: ${artists.length}`);
    console.log(`  Total objects: ${allObjectIDs.length}`);
    console.log(`  Attempted: ${result.attempted}`);
    console.log(`  Uploaded: ${result.uploaded} ✓`);
    console.log(`  Skipped: ${result.skipped}`);
    console.log(`  Errors: ${result.errors.length}`);
    console.log('='.repeat(60) + '\n');
    
    if (result.errors.length > 0) {
      console.log('Errors:');
      result.errors.slice(0, 10).forEach(err => {
        console.log(`  - ${err.title}: ${err.message}`);
      });
      if (result.errors.length > 10) {
        console.log(`  ... and ${result.errors.length - 10} more`);
      }
      console.log();
    }
    
  } catch (err) {
    console.error('Error:', (err as Error).message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
