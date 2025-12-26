#!/usr/bin/env node
/**
 * Extract all unique artist names from Met Museum European Paintings department
 * Uses Wikidata-first approach: query for European artists, then verify department via Met API
 */

import { fetchObjectDetails } from './metmuseum';

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
    .replace(/\([^)]*\)/g, '') // Remove parenthetical notes like "(Rembrandt van Rijn)"
    .trim();
}

/**
 * Get all European artists with paintings in Met Museum from Wikidata
 * Filters by: artist nationality (P27) in Europe (Q46) OR artwork country (P17) in Europe
 * Returns array of { artistQID, artistLabel, metObjectIds }
 */
async function getEuropeanArtistsWithMetPaintings(): Promise<
  Array<{ artistQID: string; artistLabel: string; metObjectIds: number[] }>
> {
  console.log('Fetching European artists with Met paintings from Wikidata...');
  console.log('  → Querying for artists with paintings in Met (P3634) where artist/artwork is European');
  
  const query = `
    SELECT DISTINCT ?artist ?artistLabel ?metId WHERE {
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
    console.log(`  ✓ Found ${bindings.length} artist-artwork pairs`);
    
    // Group by artist
    const artistMap = new Map<string, { label: string; objectIds: number[] }>();
    
    for (const binding of bindings) {
      const artistQID = binding.artist?.value?.replace('http://www.wikidata.org/entity/', '');
      const artistLabel = binding.artistLabel?.value;
      const metIdStr = binding.metId?.value;
      
      if (!artistQID || !artistLabel || !metIdStr) continue;
      
      const metId = parseInt(metIdStr, 10);
      if (isNaN(metId)) continue;
      
      const existing = artistMap.get(artistQID);
      if (existing) {
        if (!existing.objectIds.includes(metId)) {
          existing.objectIds.push(metId);
        }
      } else {
        artistMap.set(artistQID, {
          label: artistLabel,
          objectIds: [metId],
        });
      }
    }
    
    // Convert to array
    const artists = Array.from(artistMap.entries()).map(([qid, data]) => ({
      artistQID: qid,
      artistLabel: data.label,
      metObjectIds: data.objectIds,
    }));
    
    console.log(`  ✓ Found ${artists.length} unique European artists with Met paintings`);
    return artists;
  } catch (err) {
    if (err instanceof Error && err.message.includes('429')) {
      throw err;
    }
    throw new Error(`Failed to query Wikidata: ${(err as Error).message}`);
  }
}

/**
 * Verify that an artist has at least one artwork in European Paintings department
 * Samples up to 3 objects per artist to verify department
 */
async function verifyEuropeanPaintingsArtist(
  artistLabel: string,
  metObjectIds: number[]
): Promise<{ verified: boolean; sampleObjectIds: number[] }> {
  // Sample up to 3 objects to verify department
  const sampleSize = Math.min(3, metObjectIds.length);
  const sampleIds = metObjectIds.slice(0, sampleSize);
  
  let verifiedCount = 0;
  const verifiedObjectIds: number[] = [];
  
  for (const objectID of sampleIds) {
    try {
      const object = await fetchObjectDetails(objectID);
      if (object && object.department === 'European Paintings' && object.primaryImage) {
        verifiedCount++;
        verifiedObjectIds.push(objectID);
      }
    } catch (err) {
      // Silently skip 403/404 errors
      if (!(err instanceof Error && (err.message.includes('403') || err.message.includes('404')))) {
        // Only log unexpected errors
        console.log(`  ⚠ Error verifying object ${objectID} for ${artistLabel}: ${(err as Error).message}`);
      }
    }
  }
  
  // If at least one sample is verified, include the artist
  return {
    verified: verifiedCount > 0,
    sampleObjectIds: verifiedObjectIds,
  };
}

/**
 * Extract unique artist names by verifying European Paintings department
 */
async function extractArtists(
  artists: Array<{ artistQID: string; artistLabel: string; metObjectIds: number[] }>
): Promise<Map<string, { count: number; objectIds: number[] }>> {
  console.log(`\nVerifying artists and extracting names...`);
  console.log(`  Processing ${artists.length} artists (sampling 2-3 objects per artist)...\n`);
  
  const artistMap = new Map<string, { count: number; objectIds: number[] }>();
  const DELAY_BETWEEN_ARTISTS = 200; // 200ms between artists = ~5 req/sec (well under 80/sec limit)
  
  let verified = 0;
  let skipped = 0;
  
  for (let i = 0; i < artists.length; i++) {
    const { artistQID, artistLabel, metObjectIds } = artists[i];
    
    // Skip anonymous/unknown artists
    if (shouldSkipArtist(artistLabel)) {
      skipped++;
      continue;
    }
    
    // Verify artist has European Paintings artworks
    const verification = await verifyEuropeanPaintingsArtist(artistLabel, metObjectIds);
    
    if (verification.verified) {
      const normalized = normalizeArtistName(artistLabel);
      if (normalized) {
        const existing = artistMap.get(normalized);
        if (existing) {
          // Merge object IDs (avoid duplicates)
          for (const objId of verification.sampleObjectIds) {
            if (!existing.objectIds.includes(objId)) {
              existing.objectIds.push(objId);
            }
          }
          existing.count = existing.objectIds.length;
        } else {
          artistMap.set(normalized, {
            count: verification.sampleObjectIds.length,
            objectIds: [...verification.sampleObjectIds],
          });
        }
        verified++;
      }
    } else {
      skipped++;
    }
    
    // Progress update every 50 artists
    if ((i + 1) % 50 === 0 || i + 1 === artists.length) {
      const progress = i + 1;
      const percent = ((progress / artists.length) * 100).toFixed(1);
      console.log(`  Progress: ${progress}/${artists.length} (${percent}%) | Verified: ${verified} | Skipped: ${skipped} | Unique artists: ${artistMap.size}`);
    }
    
    // Delay between artists
    if (i + 1 < artists.length) {
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_ARTISTS));
    }
  }
  
  console.log(`\n  ✓ Verified ${verified} artists with European Paintings artworks`);
  console.log(`  ✓ Skipped ${skipped} artists (no European Paintings or anonymous)`);
  console.log(`  ✓ Found ${artistMap.size} unique artist names`);
  
  return artistMap;
}


async function main() {
  try {
    console.log('Extracting European artists with Met paintings from Wikidata...\n');
    console.log('Skipping Met API verification - will filter during processing\n');
    
    // Get European artists with Met paintings from Wikidata
    const artists = await getEuropeanArtistsWithMetPaintings();
    
    if (artists.length === 0) {
      console.log('No European artists found with Met paintings');
      return;
    }
    
    // Extract unique artist names (skip verification - will happen during processing)
    const artistMap = new Map<string, { count: number; objectIds: number[] }>();
    
    for (const { artistQID, artistLabel, metObjectIds } of artists) {
      // Skip anonymous/unknown artists
      if (shouldSkipArtist(artistLabel)) {
        continue;
      }
      
      const normalized = normalizeArtistName(artistLabel);
      if (normalized) {
        const existing = artistMap.get(normalized);
        if (existing) {
          // Merge object IDs
          for (const objId of metObjectIds) {
            if (!existing.objectIds.includes(objId)) {
              existing.objectIds.push(objId);
            }
          }
          existing.count = existing.objectIds.length;
        } else {
          artistMap.set(normalized, {
            count: metObjectIds.length,
            objectIds: [...metObjectIds],
          });
        }
      }
    }
    
    if (artistMap.size === 0) {
      console.log('No artists found after filtering');
      return;
    }
    
    // Display summary
    console.log(`\n${'='.repeat(60)}`);
    console.log('Summary:');
    console.log(`${'='.repeat(60)}`);
    console.log(`Total European artists from Wikidata: ${artists.length}`);
    console.log(`Unique artist names (after normalization): ${artistMap.size}`);
    console.log(`\nTop 30 artists by Met artwork count:`);
    
    const sortedArtists = Array.from(artistMap.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 30);
    
    sortedArtists.forEach(([name, data], i) => {
      const num = (i + 1).toString().padStart(2);
      const paddedName = name.padEnd(40);
      console.log(`  ${num}. ${paddedName} (${data.count} Met artworks)`);
    });
    
    console.log(`\n✓ Artist extraction complete. Ready to process artists systematically.`);
    console.log(`\nNote: Department filtering will happen during processing when fetching Met object details.`);
  } catch (err) {
    console.error('\n✗ Error:', (err as Error).message);
    process.exit(1);
  }
}

main();
