const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';

// Note: Wikidata SPARQL endpoint doesn't use OAuth, but we can still use
// the User-Agent header with client ID for better rate limits

export interface WikidataPainting {
  title: string; // commons file title, e.g., "File:Starry Night.jpg"
  museum?: string;
  itemId?: string; // QID
  imageUrl?: string;
}

export async function fetchWikidataPaintings(options: {
  artistQid?: string;
  museums?: string[];
  limit?: number;
  includeCc0?: boolean;
  requireLicense?: boolean;
}): Promise<WikidataPainting[]> {
  const artistQid = options.artistQid ?? 'wd:Q5582'; // Vincent van Gogh
  const limit = options.limit ?? 100;
  const includeCc0 = options.includeCc0 ?? true;
  const requireLicense = options.requireLicense ?? false;

  const licenseFilter = requireLicense
    ? includeCc0
      ? `
      {
        ?item wdt:P6216 wd:Q19652 . # PD
      }
      UNION
      {
        ?item wdt:P6216 wd:Q6938433 . # CC0
      }
    `
      : `
      ?item wdt:P6216 wd:Q19652 . # PD
    `
    : '';

  const query = `
    SELECT ?item ?title ?image ?museumLabel WHERE {
      ?item wdt:P31 wd:Q3305213 ;          # instance of painting
            wdt:P170 ${artistQid} ;        # creator = artist
            wdt:P18 ?image ;               # has an image
            wdt:P195 ?museum .             # collection (museum) - any collection
      ${licenseFilter}
      OPTIONAL { ?item rdfs:label ?title FILTER (LANG(?title) = "en") }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    LIMIT ${limit}
  `;

  // Import config for User-Agent header
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
    throw new Error(`Wikidata SPARQL failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as {
    results: { bindings: Array<Record<string, { type: string; value: string }>> };
  };

  return (data.results?.bindings ?? []).map((b) => {
    const imageUrl = b.image?.value ?? '';
    const commonsTitle = urlToCommonsTitle(imageUrl);
    return {
      title: commonsTitle,
      museum: b.museumLabel?.value,
      itemId: b.item?.value ? b.item.value.replace('http://www.wikidata.org/entity/', '') : undefined,
      imageUrl,
    };
  });
}

function urlToCommonsTitle(url: string): string {
  // Commons file URLs look like .../commons/<hash>/<hash>/File_Name.ext
  // We want "File:File_Name.ext"
  try {
    const parts = url.split('/');
    const filename = parts[parts.length - 1];
    if (!filename) return '';
    return decodeURIComponent(`File:${filename}`);
  } catch {
    return '';
  }
}

export interface WikidataItemTags {
  genre?: string; // P136
  movement?: string; // P135
  inceptionDate?: string; // P571
}

/**
 * Find artist Wikidata QID from artist name
 * Returns the QID (e.g., "Q5582") or null if not found
 */
export async function findArtistQID(artistName: string): Promise<string | null> {
  // Simpler query - just search by label, let Wikidata handle the matching
  const query = `
    SELECT ?item WHERE {
      ?item rdfs:label "${artistName.replace(/"/g, '\\"')}"@en .
    }
    LIMIT 1
  `;

  try {
    const { config } = await import('./config');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    
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
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      if (res.status === 429) {
        throw new Error('Wikidata rate limit (429)');
      }
      return null;
    }

    const data = (await res.json()) as {
      results: { bindings: Array<Record<string, { type: string; value: string }>> };
    };
    
    const binding = data.results?.bindings?.[0];
    if (binding?.item?.value) {
      const qid = binding.item.value.replace('http://www.wikidata.org/entity/', '');
      return qid;
    }
    
    return null;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Wikidata query timeout (30s)');
    }
    if (err instanceof Error && err.message.includes('429')) {
      throw err;
    }
    return null;
  }
}

/**
 * Query artworks by a specific artist that have images (P18) and collections (P195)
 * Returns an array of artwork data with Wikidata QID and image URL
 * This directly uses Wikidata images instead of matching Commons files
 */
export interface WikidataArtwork {
  itemQid: string;
  imageUrl: string; // P18 property value (Commons file URL)
  commonsTitle: string; // Extracted Commons file title
}

export async function findArtworksByArtist(artistQID: string): Promise<WikidataArtwork[]> {
  const query = `
    SELECT ?item ?image WHERE {
      ?item wdt:P170 wd:${artistQID} .  # creator = artist
      ?item wdt:P18 ?image .             # has image
      ?item wdt:P195 ?collection .        # has collection
    }
  `;

  try {
    const { config } = await import('./config');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout
    
    const headers: HeadersInit = {
      'Content-Type': 'application/sparql-query',
      Accept: 'application/sparql-results+json',
      'User-Agent': config.wikimediaClientId 
        ? `wikicommons-art-scraper/1.0 (OAuth client: ${config.wikimediaClientId})`
        : 'wikicommons-art-scraper/1.0 (contact: developer@example.com)',
    };
    
    console.log(`  → Querying Wikidata for artworks by artist ${artistQID}...`);
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

    const artworks: WikidataArtwork[] = [];
    const bindings = data.results?.bindings ?? [];
    
    console.log(`  → Found ${bindings.length} artworks with images and collections`);
    
    // Helper function to extract Commons title from Wikidata P18 URL
    const extractCommonsTitle = (imageUrl: string): string | null => {
      // Wikidata P18 URLs are typically:
      // - http://commons.wikimedia.org/wiki/Special:FilePath/Filename.jpg
      // - https://upload.wikimedia.org/wikipedia/commons/thumb/.../Filename.jpg
      
      const filePathMatch = imageUrl.match(/Special:FilePath\/([^?#]+)/i);
      if (filePathMatch) {
        const filename = decodeURIComponent(filePathMatch[1]);
        // Ensure it has "File:" prefix
        return filename.startsWith('File:') ? filename : `File:${filename}`;
      }
      
      // Try upload.wikimedia.org pattern
      const uploadMatch = imageUrl.match(/commons\/(?:thumb\/)?[^/]+\/(?:[^/]+\/)?([^/?#]+)$/i);
      if (uploadMatch) {
        const filename = decodeURIComponent(uploadMatch[1]);
        return filename.startsWith('File:') ? filename : `File:${filename}`;
      }
      
      // Last resort: try to extract from URL
      const urlParts = imageUrl.split('/');
      const lastPart = urlParts[urlParts.length - 1];
      if (lastPart && lastPart.includes('.')) {
        const filename = decodeURIComponent(lastPart.split('?')[0].split('#')[0]);
        return filename.startsWith('File:') ? filename : `File:${filename}`;
      }
      
      return null;
    };
    
    for (const binding of bindings) {
      const imageUrl = binding.image?.value;
      const itemQid = binding.item?.value?.replace('http://www.wikidata.org/entity/', '');
      
      if (!imageUrl || !itemQid) continue;
      
      const commonsTitle = extractCommonsTitle(imageUrl);
      if (commonsTitle) {
        artworks.push({
          itemQid,
          imageUrl,
          commonsTitle,
        });
      }
    }
    
    console.log(`  ✓ Found ${artworks.length} artworks with extractable Commons titles`);
    return artworks;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Wikidata query timeout (60s)');
    }
    if (err instanceof Error && err.message.includes('429')) {
      throw err;
    }
    throw err;
  }
}

/**
 * Batch query: Get all Wikidata items that have images (P18) and collections (P195)
 * Returns a map of Commons filename -> Wikidata QID
 * @deprecated Use findArtworksByArtist() for better performance and accuracy
 */
const CACHE_FILE = '.wikidata-cache.json';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CacheEntry {
  timestamp: number;
  data: Array<[string, string]>; // Array of [filename, qid] pairs for Map reconstruction
}

export async function batchFindItemsWithCollections(): Promise<Map<string, string>> {
  // Try to load from cache first
  try {
    const { promises: fs } = await import('fs');
    const path = await import('path');
    const cachePath = path.join(process.cwd(), CACHE_FILE);
    
    try {
      const cacheContent = await fs.readFile(cachePath, 'utf-8');
      const cache: CacheEntry = JSON.parse(cacheContent);
      
      const age = Date.now() - cache.timestamp;
      if (age < CACHE_TTL_MS && cache.data) {
        console.log(`  → Loading Wikidata cache (${Math.round(age / 1000 / 60 / 60)} hours old, ${cache.data.length} items)`);
        return new Map(cache.data);
      }
    } catch {
      // Cache doesn't exist or is invalid, continue to fetch
    }
  } catch {
    // fs import failed (shouldn't happen in Node.js), continue to fetch
  }

  console.log(`  → Fetching Wikidata items with collections (P18 + P195)...`);
  console.log(`  → Note: We'll fetch as many as possible, but partial caching is acceptable.`);
  console.log(`  → Items not in cache will use individual queries (slower but works).`);
  
  const BATCH_SIZE = 100000;
  const MAX_BATCHES = 8; // Stop after 8 batches (800k items) to avoid timeout issues
  const filenameToQid = new Map<string, string>();
  let batchNumber = 0; // Declare outside try block for error handling
  let offset = 0; // Declare outside try block for error handling
  
  try {
    const { config } = await import('./config');
    
    const headers: HeadersInit = {
      'Content-Type': 'application/sparql-query',
      Accept: 'application/sparql-results+json',
      'User-Agent': config.wikimediaClientId 
        ? `wikicommons-art-scraper/1.0 (OAuth client: ${config.wikimediaClientId})`
        : 'wikicommons-art-scraper/1.0 (contact: developer@example.com)',
    };
    
    // Helper function to extract filename from URL
    const extractFilename = (imageUrl: string): string | null => {
      let filename: string | null = null;
      
      // Try Special:FilePath pattern first
      const filePathMatch = imageUrl.match(/Special:FilePath\/([^?#]+)/i);
      if (filePathMatch) {
        filename = decodeURIComponent(filePathMatch[1]);
      } else {
        // Try to extract from upload.wikimedia.org URLs
        const uploadMatch = imageUrl.match(/commons\/(?:thumb\/)?[^/]+\/(?:[^/]+\/)?([^/?#]+)$/i);
        if (uploadMatch) {
          filename = decodeURIComponent(uploadMatch[1]);
        } else {
          // Last resort: try to get the last part of the URL
          const urlParts = imageUrl.split('/');
          const lastPart = urlParts[urlParts.length - 1];
          if (lastPart && lastPart.includes('.')) {
            filename = decodeURIComponent(lastPart.split('?')[0].split('#')[0]);
          }
        }
      }
      
      return filename;
    };
    
    // Helper function to add filename variations to map
    const addToMap = (filename: string, itemQid: string) => {
      const normalizedFilename = filename.replace(/^File:/i, '').trim();
      if (normalizedFilename) {
        // Store both with and without "File:" prefix for flexible matching
        filenameToQid.set(normalizedFilename, itemQid);
        filenameToQid.set(`File:${normalizedFilename}`, itemQid);
        
        // Also try URL-encoded versions
        try {
          const encoded = encodeURIComponent(normalizedFilename);
          filenameToQid.set(encoded, itemQid);
          filenameToQid.set(`File:${encoded}`, itemQid);
        } catch {
          // Ignore encoding errors
        }
      }
    };
    
    // Fetch all batches with pagination
    offset = 0;
    let totalFetched = 0;
    batchNumber = 1;
    const startTime = Date.now();
    
    while (true) {
      const query = `
        SELECT ?item ?image WHERE {
          ?item wdt:P18 ?image .
          ?item wdt:P195 ?collection .
        }
        LIMIT ${BATCH_SIZE}
        OFFSET ${offset}
      `;
      
      const batchStartTime = Date.now();
      console.log(`  → [Batch ${batchNumber}] Starting fetch (offset ${offset.toLocaleString()}, timeout: 120s)...`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        console.error(`  ✗ [Batch ${batchNumber}] Request timeout after 120 seconds`);
        controller.abort();
      }, 120000); // 2 minute timeout per batch
      
      let res: Response;
      try {
        console.log(`  → [Batch ${batchNumber}] Sending SPARQL query to Wikidata...`);
        res = await fetch(SPARQL_ENDPOINT, {
          method: 'POST',
          headers,
          body: query,
          signal: controller.signal,
        });
        const fetchTime = ((Date.now() - batchStartTime) / 1000).toFixed(1);
        console.log(`  → [Batch ${batchNumber}] Received response (${res.status}) in ${fetchTime}s`);
      } catch (fetchErr) {
        clearTimeout(timeoutId);
        if (fetchErr instanceof Error && fetchErr.name === 'AbortError') {
          console.error(`  ✗ [Batch ${batchNumber}] Request was aborted (timeout or cancellation)`);
          throw new Error(`Wikidata batch ${batchNumber} query timeout (120s) at offset ${offset}`);
        }
        console.error(`  ✗ [Batch ${batchNumber}] Fetch error:`, fetchErr instanceof Error ? fetchErr.message : String(fetchErr));
        throw fetchErr;
      } finally {
        clearTimeout(timeoutId);
      }

      if (!res.ok) {
        let errorDetails = '';
        try {
          const errorText = await res.text();
          errorDetails = errorText;
          console.error(`  ✗ [Batch ${batchNumber}] Response error: ${res.status} ${res.statusText}`);
          console.error(`  ✗ [Batch ${batchNumber}] Error details: ${errorDetails.substring(0, 200)}`);
        } catch {
          console.error(`  ✗ [Batch ${batchNumber}] Failed to read error response`);
        }
        
        if (res.status === 429) {
          throw new Error(`Wikidata rate limit (429) on batch ${batchNumber} - try again later`);
        }
        if (res.status === 504) {
          throw new Error(`Wikidata gateway timeout (504) on batch ${batchNumber} at offset ${offset} - server may be overloaded`);
        }
        throw new Error(`Wikidata batch ${batchNumber} query failed: ${res.status} ${res.statusText}${errorDetails ? ` - ${errorDetails.substring(0, 100)}` : ''}`);
      }

      console.log(`  → [Batch ${batchNumber}] Parsing JSON response...`);
      let data: {
        results: { bindings: Array<Record<string, { type: string; value: string }>> };
      };
      try {
        data = (await res.json()) as typeof data;
      } catch (parseErr) {
        console.error(`  ✗ [Batch ${batchNumber}] Failed to parse JSON response:`, parseErr instanceof Error ? parseErr.message : String(parseErr));
        throw new Error(`Failed to parse Wikidata response for batch ${batchNumber}`);
      }

      const bindings = data.results?.bindings ?? [];
      const batchCount = bindings.length;
      console.log(`  → [Batch ${batchNumber}] Parsed ${batchCount.toLocaleString()} bindings from response`);
      
      if (batchCount === 0) {
        console.log(`  → [Batch ${batchNumber}] No results returned - reached end of data`);
        break;
      }
      
      console.log(`  → [Batch ${batchNumber}] Processing ${batchCount.toLocaleString()} items...`);
      let processedCount = 0;
      let skippedCount = 0;
      
      // Process this batch
      for (const binding of bindings) {
        const imageUrl = binding.image?.value;
        const itemQid = binding.item?.value?.replace('http://www.wikidata.org/entity/', '');
        
        if (!imageUrl || !itemQid) {
          skippedCount++;
          continue;
        }
        
        const filename = extractFilename(imageUrl);
        if (filename) {
          addToMap(filename, itemQid);
          processedCount++;
        } else {
          skippedCount++;
        }
      }
      
      totalFetched += batchCount;
      const batchTime = ((Date.now() - batchStartTime) / 1000).toFixed(1);
      const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
      console.log(`  ✓ [Batch ${batchNumber}] Complete in ${batchTime}s: ${batchCount.toLocaleString()} items (processed: ${processedCount.toLocaleString()}, skipped: ${skippedCount.toLocaleString()})`);
      console.log(`    Total progress: ${totalFetched.toLocaleString()} items, ${filenameToQid.size.toLocaleString()} filename variations (${elapsed} min elapsed)`);
      
      // Save cache after each batch to preserve progress
      console.log(`  → [Batch ${batchNumber}] Saving cache...`);
      try {
        const { promises: fs } = await import('fs');
        const path = await import('path');
        const cachePath = path.join(process.cwd(), CACHE_FILE);
        const cache: CacheEntry = {
          timestamp: Date.now(),
          data: Array.from(filenameToQid.entries()),
        };
        await fs.writeFile(cachePath, JSON.stringify(cache, null, 2), 'utf-8');
        const cacheSizeMB = (JSON.stringify(cache).length / 1024 / 1024).toFixed(1);
        console.log(`  ✓ [Batch ${batchNumber}] Cache saved (${cacheSizeMB} MB)`);
      } catch (cacheErr) {
        console.error(`  ✗ [Batch ${batchNumber}] Cache write failed:`, cacheErr instanceof Error ? cacheErr.message : String(cacheErr));
        // Continue even if cache write fails
      }
      
      offset += BATCH_SIZE;
      batchNumber++;
      
      // Stop if we've reached max batches (to avoid timeout issues with large OFFSET)
      if (batchNumber > MAX_BATCHES) {
        console.log(`  → Reached maximum batch limit (${MAX_BATCHES} batches = ${(MAX_BATCHES * BATCH_SIZE).toLocaleString()} items)`);
        console.log(`  → Partial cache is acceptable - remaining items will use individual queries`);
        break;
      }
      
      // Small delay between batches to be respectful
      console.log(`  → [Batch ${batchNumber}] Waiting 1s before next batch...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    if (batchNumber > MAX_BATCHES) {
      console.log(`  ✓ Finished fetching partial Wikidata cache: ${totalFetched.toLocaleString()} items, ${filenameToQid.size.toLocaleString()} filename variations`);
      console.log(`  → This is a partial cache (${Math.round((totalFetched / 892000) * 100)}% of estimated total)`);
      console.log(`  → Items not in cache will use individual queries when needed`);
    } else {
      console.log(`  ✓ Finished fetching all Wikidata items: ${totalFetched.toLocaleString()} items, ${filenameToQid.size.toLocaleString()} filename variations`);
    }

    // Final cache save
    try {
      const { promises: fs } = await import('fs');
      const path = await import('path');
      const cachePath = path.join(process.cwd(), CACHE_FILE);
      const cache: CacheEntry = {
        timestamp: Date.now(),
        data: Array.from(filenameToQid.entries()),
      };
      await fs.writeFile(cachePath, JSON.stringify(cache, null, 2), 'utf-8');
      console.log(`  ✓ Cached ${filenameToQid.size} Wikidata items to ${CACHE_FILE}`);
    } catch {
      // Cache write failed, but that's okay - continue with the data we have
    }

    return filenameToQid;
  } catch (err) {
    console.error(`  ✗ Error in batch fetching process:`);
    console.error(`    Error type: ${err instanceof Error ? err.constructor.name : typeof err}`);
    console.error(`    Error message: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof Error && err.stack) {
      console.error(`    Stack trace: ${err.stack.split('\n').slice(0, 3).join('\n')}`);
    }
    
    // Save whatever we have before throwing
    if (filenameToQid.size > 0) {
      console.log(`  → Attempting to save partial cache before error...`);
      try {
        const { promises: fs } = await import('fs');
        const path = await import('path');
        const cachePath = path.join(process.cwd(), CACHE_FILE);
        const cache: CacheEntry = {
          timestamp: Date.now(),
          data: Array.from(filenameToQid.entries()),
        };
        await fs.writeFile(cachePath, JSON.stringify(cache, null, 2), 'utf-8');
        const cacheSizeMB = (JSON.stringify(cache).length / 1024 / 1024).toFixed(1);
        console.log(`  ⚠ Saved partial cache: ${filenameToQid.size.toLocaleString()} filename variations (${cacheSizeMB} MB)`);
        console.log(`  ⚠ You can resume from this point - cache contains items up to offset ${(batchNumber - 1) * BATCH_SIZE}`);
      } catch (cacheErr) {
        console.error(`  ✗ Failed to save partial cache:`, cacheErr instanceof Error ? cacheErr.message : String(cacheErr));
      }
    } else {
      console.error(`  ✗ No data to save - cache is empty`);
    }
    
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Wikidata batch query timeout (120s)');
    }
    if (err instanceof Error && err.message.includes('429')) {
      throw err; // Re-throw rate limit errors immediately
    }
    throw err;
  }
}

/**
 * Find Wikidata item QID from a Commons file title
 * Returns the QID of the artwork that uses this image (P18 property)
 * @deprecated Use batchFindItemsWithCollections() for better performance
 */
export async function findItemFromCommonsFile(commonsTitle: string): Promise<string | null> {
  // Remove "File:" prefix if present
  const filename = commonsTitle.replace(/^File:/i, '');
  
  const query = `
    SELECT ?item WHERE {
      ?item wdt:P18 ?image .
      FILTER(CONTAINS(STR(?image), "${filename.replace(/"/g, '\\"')}"))
      ?item wdt:P195 ?collection .
    }
    LIMIT 1
  `;

  try {
    const { config } = await import('./config');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
    
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
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      if (res.status === 429) {
        throw new Error('Wikidata rate limit (429)');
      }
      return null;
    }

    const data = (await res.json()) as {
      results: { bindings: Array<Record<string, { type: string; value: string }>> };
    };
    
    const binding = data.results?.bindings?.[0];
    if (binding?.item?.value) {
      return binding.item.value.replace('http://www.wikidata.org/entity/', '');
    }
    return null;
  } catch (err) {
    if (err instanceof Error) {
      if (err.name === 'AbortError') {
        throw new Error('Wikidata query timeout (30s)');
      }
      if (err.message.includes('429') || err.message.includes('rate limit')) {
        throw err; // Re-throw rate limit errors immediately, don't wait
      }
    }
    throw err;
  }
}

/**
 * Check if a Wikidata item has a collection/museum (P195 property)
 */
export async function hasCollection(itemId: string): Promise<boolean> {
  if (!itemId || !itemId.startsWith('Q')) {
    return false;
  }

  const query = `
    ASK {
      wd:${itemId} wdt:P195 ?collection .
    }
  `;

  try {
    const { config } = await import('./config');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
    
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
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      return false;
    }

    const data = (await res.json()) as { boolean: boolean };
    return data.boolean ?? false;
  } catch (err) {
    if (err instanceof Error) {
      if (err.name === 'AbortError') {
        throw new Error('Wikidata query timeout (30s)');
      }
      if (err.message.includes('429') || err.message.includes('rate limit')) {
        throw err; // Re-throw rate limit errors immediately, don't wait
      }
    }
    throw err;
  }
}

/**
 * Fetch curated tags from Wikidata item properties:
 * - P136: genre (e.g., "landscape art")
 * - P135: movement (e.g., "Post-Impressionism")
 * - P571: inception/creation date (e.g., "1889")
 */
export async function fetchWikidataItemTags(itemId: string): Promise<WikidataItemTags> {
  if (!itemId || !itemId.startsWith('Q')) {
    return {};
  }

  const query = `
    SELECT ?genreLabel ?movementLabel ?inceptionDate WHERE {
      OPTIONAL { wd:${itemId} wdt:P136 ?genre . }
      OPTIONAL { wd:${itemId} wdt:P135 ?movement . }
      OPTIONAL { wd:${itemId} wdt:P571 ?inceptionDate . }
      SERVICE wikibase:label {
        bd:serviceParam wikibase:language "en" .
      }
    }
  `;

  try {
    // Import config for User-Agent header
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
      return {};
    }

    const data = (await res.json()) as {
      results: { bindings: Array<Record<string, { type: string; value: string; 'xml:lang'?: string }>> };
    };

    const tags: WikidataItemTags = {};

    for (const binding of data.results?.bindings ?? []) {
      if (binding.genreLabel?.value && !tags.genre) {
        tags.genre = binding.genreLabel.value;
      }
      if (binding.movementLabel?.value && !tags.movement) {
        tags.movement = binding.movementLabel.value;
      }
      if (binding.inceptionDate?.value && !tags.inceptionDate) {
        // P571 returns dates in various formats, extract year if possible
        const dateValue = binding.inceptionDate.value;
        const yearMatch = dateValue.match(/\d{4}/);
        if (yearMatch) {
          tags.inceptionDate = yearMatch[0];
        } else {
          tags.inceptionDate = dateValue;
        }
      }
    }

    return tags;
  } catch {
    return {};
  }
}

