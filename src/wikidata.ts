const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';

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

  const res = await fetch(SPARQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/sparql-query',
      Accept: 'application/sparql-results+json',
      'User-Agent': 'wikicommons-art-scraper/1.0 (contact: developer@example.com)',
    },
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
 * Find Wikidata item QID from a Commons file title
 * Returns the QID of the artwork that uses this image (P18 property)
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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
    
    const res = await fetch(SPARQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sparql-query',
        Accept: 'application/sparql-results+json',
        'User-Agent': 'wikicommons-art-scraper/1.0 (contact: developer@example.com)',
      },
      body: query,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
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
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Wikidata query timeout (30s)');
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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
    
    const res = await fetch(SPARQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sparql-query',
        Accept: 'application/sparql-results+json',
        'User-Agent': 'wikicommons-art-scraper/1.0 (contact: developer@example.com)',
      },
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
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Wikidata query timeout (30s)');
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
    const res = await fetch(SPARQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sparql-query',
        Accept: 'application/sparql-results+json',
        'User-Agent': 'wikicommons-art-scraper/1.0 (contact: developer@example.com)',
      },
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

