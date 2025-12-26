#!/usr/bin/env node
/**
 * Count European artists with more than 15 Met paintings
 */

const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';

async function countArtistsOver15(): Promise<number> {
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
        HAVING (?paintingCount > 15)
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
    
    const res = await fetch(WIKIDATA_SPARQL, {
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
    if (bindings.length > 0 && bindings[0].count) {
      return parseInt(bindings[0].count.value, 10);
    }
    
    return 0;
  } catch (err) {
    throw new Error(`Failed to query Wikidata: ${(err as Error).message}`);
  }
}

async function getTopArtists(limit: number = 20): Promise<Array<{ name: string; count: number }>> {
  const query = `
    SELECT ?artist ?artistLabel (COUNT(?metId) AS ?count) WHERE {
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
    HAVING (COUNT(?metId) > 15)
    ORDER BY DESC(COUNT(?metId))
    LIMIT ${limit}
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
    
    const res = await fetch(WIKIDATA_SPARQL, {
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
    
    const artists: Array<{ name: string; count: number }> = [];
    const bindings = data.results?.bindings ?? [];
    
    for (const binding of bindings) {
      const name = binding.artistLabel?.value;
      const countStr = binding.count?.value;
      if (name && countStr) {
        artists.push({
          name,
          count: parseInt(countStr, 10),
        });
      }
    }
    
    return artists;
  } catch (err) {
    throw new Error(`Failed to query Wikidata: ${(err as Error).message}`);
  }
}

async function main() {
  console.log('Counting European artists with more than 15 Met paintings...\n');
  
  try {
    const total = await countArtistsOver15();
    console.log(`Total artists with >15 paintings: ${total}\n`);
    
    if (total > 0) {
      console.log('Top 20 artists by painting count:');
      const topArtists = await getTopArtists(20);
      topArtists.forEach((artist, i) => {
        const num = (i + 1).toString().padStart(2);
        const name = artist.name.padEnd(40);
        console.log(`  ${num}. ${name} (${artist.count} paintings)`);
      });
    }
  } catch (err) {
    console.error('Error:', (err as Error).message);
    process.exit(1);
  }
}

main();
