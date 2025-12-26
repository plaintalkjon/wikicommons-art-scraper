#!/usr/bin/env node
/**
 * Count total European artists with 1-15 Met paintings
 */

const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';

async function countTotalArtists(maxPaintings: number = 15): Promise<number> {
  // Use a subquery to count artists with the right number of paintings
  const query = `
    SELECT (COUNT(DISTINCT ?artist) AS ?count) WHERE {
      {
        SELECT DISTINCT ?artist (COUNT(?metId) AS ?paintingCount) WHERE {
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
        }
        GROUP BY ?artist
        HAVING (?paintingCount >= 1 && ?paintingCount <= ${maxPaintings})
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
    const timeoutId = setTimeout(() => controller.abort(), 180000);
    
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
    
    // The query returns one row with the count
    const bindings = data.results?.bindings ?? [];
    if (bindings.length > 0 && bindings[0].count) {
      return parseInt(bindings[0].count.value, 10);
    }
    
    return 0;
  } catch (err) {
    throw new Error(`Failed to query Wikidata: ${(err as Error).message}`);
  }
}

async function main() {
  const maxPaintings = parseInt(process.argv[2] || '15', 10);
  const batchSize = parseInt(process.argv[3] || '30', 10);
  
  console.log('Counting total European artists with 1-15 Met paintings...\n');
  
  try {
    const total = await countTotalArtists(maxPaintings);
    console.log(`Total artists: ${total}`);
    
    // Get processed count
    const { supabase } = await import('./supabaseClient');
    const res = await supabase
      .from('art_sources')
      .select('arts!inner(artist_id, artists!inner(name))')
      .eq('source', 'metmuseum');
    
    const processedArtists = new Set<string>();
    (res.data || []).forEach((source: any) => {
      const name = source.arts?.artists?.name;
      if (name) {
        processedArtists.add(name.toLowerCase().trim());
      }
    });
    
    const processed = processedArtists.size;
    const remaining = Math.max(0, total - processed);
    const batches = Math.ceil(remaining / batchSize);
    
    console.log(`\nProcessed artists: ${processed}`);
    console.log(`Remaining artists: ${remaining}`);
    console.log(`\nEstimated batches needed (${batchSize} per batch): ${batches}`);
    console.log(`\nNote: This is an estimate. Some artists may not have uploadable images.`);
  } catch (err) {
    console.error('Error:', (err as Error).message);
    process.exit(1);
  }
}

main();
