const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';

// Note: Wikidata SPARQL endpoint doesn't use OAuth, but we can still use
// the User-Agent header with client ID for better rate limits

export interface WikidataItemTags {
  genre?: string; // P136
  movement?: string; // P135
  inceptionDate?: string; // P571
}

/**
 * Remove accents/diacritics from a string
 */
function removeAccents(str: string): string {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Generate name variations for searching
 * Returns an array of name variations to try
 */
function generateNameVariations(name: string): string[] {
  const variations: string[] = [name]; // Always try original first
  
  const parts = name.trim().split(/\s+/);
  
  // If name has 2-3 parts, try reversed order (e.g., "Hu Yefo" -> "Yefo Hu")
  if (parts.length === 2) {
    variations.push(`${parts[1]} ${parts[0]}`);
  } else if (parts.length === 3) {
    // Try "Last First Middle" and "Last Middle First"
    variations.push(`${parts[2]} ${parts[0]} ${parts[1]}`);
    variations.push(`${parts[2]} ${parts[1]} ${parts[0]}`);
  }
  
  // Try with different capitalization (title case)
  variations.push(
    ...variations.map(v => 
      v.split(' ').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      ).join(' ')
    )
  );
  
  // Try without accents (e.g., "Géricault" -> "Gericault")
  const withoutAccents = removeAccents(name);
  if (withoutAccents !== name) {
    variations.push(withoutAccents);
    // Also try reversed without accents
    const partsNoAccent = withoutAccents.trim().split(/\s+/);
    if (partsNoAccent.length === 2) {
      variations.push(`${partsNoAccent[1]} ${partsNoAccent[0]}`);
    }
  }
  
  // Try adding common accents to words that might need them
  // Common patterns: "Theodore" -> "Théodore", "Gericault" -> "Géricault"
  const accentVariations: string[] = [];
  const accentMap: Record<string, string> = {
    'e': 'é',
    'a': 'à',
    'o': 'ô',
  };
  
  // Try adding accents to common patterns (simple heuristic)
  if (name.includes('Theodore')) {
    accentVariations.push(name.replace(/Theodore/gi, 'Théodore'));
  }
  if (name.includes('Gericault')) {
    accentVariations.push(name.replace(/Gericault/gi, 'Géricault'));
  }
  if (accentVariations.length > 0) {
    variations.push(...accentVariations);
    // Also try reversed with accents
    accentVariations.forEach(v => {
      const parts = v.trim().split(/\s+/);
      if (parts.length === 2) {
        variations.push(`${parts[1]} ${parts[0]}`);
      }
    });
  }
  
  // Remove duplicates and return
  return Array.from(new Set(variations));
}

/**
 * Search for artist QID using a specific name variation
 */
async function searchArtistQIDByName(name: string): Promise<string | null> {
  // Search by both main label (rdfs:label) and alternative labels (skos:altLabel)
  // Also try without language restriction, and try case-insensitive matching
  const escapedName = name.replace(/"/g, '\\"');
  const query = `
    SELECT DISTINCT ?item WHERE {
      {
        ?item rdfs:label "${escapedName}"@en .
      }
      UNION
      {
        ?item skos:altLabel "${escapedName}"@en .
      }
      UNION
      {
        ?item rdfs:label "${escapedName}" .
        FILTER(LANG(?item) = "" || LANG(?item) = "en")
      }
      UNION
      {
        ?item skos:altLabel "${escapedName}" .
        FILTER(LANG(?item) = "" || LANG(?item) = "en")
      }
    }
    LIMIT 1
  `;

  try {
    const { config } = await import('./config');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s per variation
    
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
      return null; // Timeout for this variation, try next
    }
    if (err instanceof Error && err.message.includes('429')) {
      throw err; // Rate limit - propagate up
    }
    return null;
  }
}

/**
 * Find artist Wikidata QID from artist name
 * Tries multiple name variations including reversed order and aliases
 * Returns the QID (e.g., "Q5582") or null if not found
 */
export async function findArtistQID(artistName: string): Promise<string | null> {
  const variations = generateNameVariations(artistName);
  
  console.log(`  → Trying ${variations.length} name variation(s): ${variations.join(', ')}`);
  
  // Try each variation in order
  for (let i = 0; i < variations.length; i++) {
    const variation = variations[i];
    if (i > 0) {
      console.log(`  → Trying variation ${i + 1}/${variations.length}: "${variation}"`);
    }
    
    try {
      const qid = await searchArtistQIDByName(variation);
      if (qid) {
        if (i > 0) {
          console.log(`  ✓ Found match with variation "${variation}"`);
        }
        return qid;
      }
    } catch (err) {
      // If we hit a rate limit, propagate it up
      if (err instanceof Error && err.message.includes('429')) {
        throw err;
      }
      // Otherwise, continue to next variation
    }
  }
  
  return null;
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
    const seenItems = new Set<string>(); // Track items we've already processed
    
    console.log(`  → Found ${bindings.length} bindings (may include duplicates from multiple collections/images)`);
    
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
      
      // Deduplicate: only process each item once
      if (seenItems.has(itemQid)) {
        continue; // Skip if we've already processed this artwork
      }
      
      const commonsTitle = extractCommonsTitle(imageUrl);
      if (commonsTitle) {
        seenItems.add(itemQid); // Mark as seen
        artworks.push({
          itemQid,
          imageUrl,
          commonsTitle,
        });
      }
    }
    
    console.log(`  ✓ Found ${artworks.length} unique artworks with extractable Commons titles`);
    if (bindings.length > artworks.length) {
      console.log(`  → Deduplicated ${bindings.length - artworks.length} duplicate entries (from multiple collections/images)`);
    }
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
 * @deprecated This function is no longer used. We now use artist-specific queries via findArtworksByArtist()
 * This is a stub that returns an empty Map. It may be removed in a future version.
 */
export async function batchFindItemsWithCollections(): Promise<Map<string, string>> {
  console.warn('batchFindItemsWithCollections() is deprecated. Use findArtworksByArtist() instead.');
  return new Map<string, string>();
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

