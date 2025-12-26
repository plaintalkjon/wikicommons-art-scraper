/**
 * Metropolitan Museum of Art (The Met) API integration
 * API Documentation: https://metmuseum.github.io/
 * 
 * Features:
 * - No authentication required
 * - 80 requests/second rate limit
 * - CC0 (public domain) images
 * - Tags with AAT and Wikidata links
 */

const MET_API_BASE = 'https://collectionapi.metmuseum.org/public/collection/v1';

export interface MetTag {
  term: string;
  AAT_URL?: string;
  Wikidata_URL?: string;
}

export interface MetObject {
  objectID: number;
  title: string;
  objectDate?: string;
  objectBeginDate?: number;
  objectEndDate?: number;
  medium?: string;
  dimensions?: string;
  department?: string;
  culture?: string;
  period?: string;
  dynasty?: string;
  reign?: string;
  portfolio?: string;
  artistRole?: string;
  artistPrefix?: string;
  artistDisplayName?: string;
  artistDisplayBio?: string;
  artistSuffix?: string;
  artistAlphaSort?: string;
  artistNationality?: string;
  artistBeginDate?: string;
  artistEndDate?: string;
  artistGender?: string;
  artistWikidata_URL?: string;
  artistULAN_URL?: string;
  measurements?: Array<{
    elementName?: string;
    elementDescription?: string;
    elementMeasurements?: {
      Height?: number;
      Width?: number;
      Depth?: number;
    };
  }>;
  creditLine?: string;
  geographyType?: string;
  city?: string;
  state?: string;
  county?: string;
  country?: string;
  region?: string;
  subregion?: string;
  locale?: string;
  locus?: string;
  excavation?: string;
  river?: string;
  classification?: string;
  rightsAndReproduction?: string;
  linkResource?: string;
  metadataDate?: string;
  repository?: string;
  objectURL?: string;
  tags?: MetTag[];
  objectWikidata_URL?: string;
  isTimelineWork?: boolean;
  GalleryNumber?: string;
  primaryImage?: string;
  primaryImageSmall?: string;
  additionalImages?: string[];
  constituents?: Array<{
    constituentID?: number;
    role?: string;
    name?: string;
    constituentULAN_URL?: string;
    constituentWikidata_URL?: string;
    gender?: string;
  }>;
}

export interface MetArtwork {
  objectID: number;
  title: string;
  artistDisplayName?: string;
  primaryImage?: string;
  objectDate?: string;
  wikidataQID?: string; // Wikidata QID for the artwork (required for tags)
}

/**
 * Find Met Museum artworks by artist using Wikidata as the search engine
 * This bypasses the blocked Met search endpoint by using Wikidata's P3634 (Met object ID) property
 * Returns array of Met artworks with object IDs and image URLs
 */
export async function findArtworksByArtist(artistQID: string): Promise<MetArtwork[]> {
  console.log(`  → Querying Wikidata for artworks in Met Museum collection...`);
  console.log(`  → Looking for items with: creator=${artistQID}, Met object ID (P3634), Met collection (P195=Q160236)`);
  
  // Query Wikidata for artworks by this artist that have Met Museum object IDs
  // Note: We don't require P195 (collection) as not all items have it, but P3634 (Met object ID) is sufficient
  const query = `
    SELECT ?item ?metId WHERE {
      ?item wdt:P170 wd:${artistQID} .  # creator = artist
      ?item wdt:P3634 ?metId .           # has Met Museum object ID (this implies it's in the Met)
    }
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
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout
    
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
    console.log(`  → Found ${bindings.length} artworks in Met Museum collection`);
    
    if (bindings.length === 0) {
      return [];
    }
    
    // Extract Met object IDs and Wikidata QIDs, create mapping
    const objectIdToQID = new Map<number, string>();
    const objectIDs: number[] = [];
    
    for (const binding of bindings) {
      const metIdStr = binding.metId?.value;
      const itemQID = binding.item?.value?.replace('http://www.wikidata.org/entity/', '');
      
      if (metIdStr && itemQID) {
        const metId = parseInt(metIdStr, 10);
        if (!isNaN(metId)) {
          objectIdToQID.set(metId, itemQID);
          if (!objectIDs.includes(metId)) {
            objectIDs.push(metId);
          }
        }
      }
    }
    
    console.log(`  → Fetching object details for ${objectIDs.length} Met objects...`);
    
    const artworks: MetArtwork[] = [];
    const BATCH_SIZE = 5; // Reduced batch size to be more conservative
    const DELAY_BETWEEN_BATCHES = 1000; // 1 second between batches to avoid bot detection
    
    for (let i = 0; i < objectIDs.length; i += BATCH_SIZE) {
      const batch = objectIDs.slice(i, i + BATCH_SIZE);
      
      const batchPromises = batch.map(async (objectID): Promise<MetArtwork | null> => {
        try {
          // Use fewer retries during batch discovery (faster, but may miss some)
          // Retries will happen again during processing if needed
          const object = await fetchObjectDetails(objectID, 1, 500); // 1 retry, 500ms delay
          if (object && object.primaryImage) {
            const wikidataQID = objectIdToQID.get(objectID);
            if (!wikidataQID) {
              // Skip artworks without Wikidata QID (required for tags)
              console.log(`  ⚠ Skipping object ${objectID}: no Wikidata QID found`);
              return null;
            }
            
            return {
              objectID: object.objectID,
              title: object.title || `Object ${objectID}`,
              artistDisplayName: object.artistDisplayName,
              primaryImage: object.primaryImage,
              objectDate: object.objectDate,
              wikidataQID,
            };
          }
          // Object might be restricted (403) or have no image - silently skip
          return null;
        } catch (err) {
          // Only log non-403 errors (403s are expected for restricted objects)
          if (!(err instanceof Error && err.message.includes('403'))) {
            console.log(`  ⚠ Failed to fetch object ${objectID}: ${(err as Error).message}`);
          }
          return null;
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      const validArtworks = batchResults.filter((a): a is MetArtwork => a !== null);
      artworks.push(...validArtworks);
      
      // Small delay between batches to stay under rate limit
      if (i + BATCH_SIZE < objectIDs.length) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
      }
    }
    
    console.log(`  ✓ Retrieved ${artworks.length} artworks with images from Met Museum`);
    return artworks;
  } catch (err) {
    if (err instanceof Error && err.message.includes('429')) {
      throw err;
    }
    throw new Error(`Failed to find Met Museum artworks: ${(err as Error).message}`);
  }
}

/**
 * Fetch detailed object information by object ID
 * Returns null if object is restricted (403) or doesn't exist (404)
 * Includes retry logic with exponential backoff for 403 errors (bot protection)
 */
export async function fetchObjectDetails(
  objectID: number,
  retries: number = 3,
  baseDelay: number = 1000
): Promise<MetObject | null> {
  const url = `${MET_API_BASE}/objects/${objectID}`;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Add delay before request (except first attempt)
      if (attempt > 0) {
        const delay = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff: 1s, 2s, 4s
        console.log(`    → Retry attempt ${attempt}/${retries} after ${delay}ms delay...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.metmuseum.org/',
        },
      });
      
      if (!res.ok) {
        if (res.status === 404) {
          return null; // Object doesn't exist
        }
        if (res.status === 403) {
          // Bot protection - retry with delay if attempts remain
          if (attempt < retries) {
            continue; // Retry
          }
          // Final attempt failed - return null
          return null;
        }
        if (res.status === 429) {
          // Rate limit - check for Retry-After header
          const retryAfter = res.headers.get('Retry-After');
          if (retryAfter && attempt < retries) {
            const delay = parseInt(retryAfter, 10) * 1000;
            console.log(`    → Rate limited, waiting ${delay}ms (Retry-After: ${retryAfter}s)...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue; // Retry
          }
          throw new Error('Met Museum API rate limit (429)');
        }
        throw new Error(`Met Museum API error: ${res.status} ${res.statusText}`);
      }
      
      const object = await res.json() as MetObject;
      return object;
    } catch (err) {
      // Network errors - retry if attempts remain
      if (attempt < retries && err instanceof Error && !err.message.includes('429')) {
        continue; // Retry
      }
      
      if (err instanceof Error && err.message.includes('429')) {
        throw err;
      }
      
      // Final attempt failed
      if (attempt === retries) {
        throw new Error(`Failed to fetch Met object ${objectID} after ${retries + 1} attempts: ${(err as Error).message}`);
      }
    }
  }
  
  return null; // All retries exhausted
}

/**
 * Normalize Met Museum tags to simple string array
 * Extracts the term from each tag object
 */
export function normalizeMetTags(tags: MetTag[] | undefined): string[] {
  if (!tags || !Array.isArray(tags)) {
    return [];
  }
  
  return tags
    .map(tag => tag.term?.toLowerCase().trim())
    .filter((term): term is string => Boolean(term));
}

/**
 * Extract all tags from a Met object including:
 * - department
 * - classification
 * - culture
 * - period
 * - medium
 * - tags array
 * 
 * Returns a normalized array of tag strings (lowercased, trimmed, deduplicated)
 */
export function extractAllMetTags(object: MetObject): string[] {
  const tags: string[] = [];
  
  // Department
  if (object.department) {
    tags.push(object.department.toLowerCase().trim());
  }
  
  // Classification
  if (object.classification) {
    tags.push(object.classification.toLowerCase().trim());
  }
  
  // Culture
  if (object.culture) {
    tags.push(object.culture.toLowerCase().trim());
  }
  
  // Period
  if (object.period) {
    tags.push(object.period.toLowerCase().trim());
  }
  
  // Medium
  if (object.medium) {
    tags.push(object.medium.toLowerCase().trim());
  }
  
  // Tags array
  const tagTerms = normalizeMetTags(object.tags);
  tags.push(...tagTerms);
  
  // Deduplicate and filter empty strings
  return Array.from(new Set(tags.filter(tag => tag.length > 0)));
}

/**
 * Extract image dimensions from Met object metadata
 * Returns width and height if available, otherwise null
 */
export function extractImageDimensions(object: MetObject): { width: number; height: number } | null {
  // Try to get dimensions from measurements
  if (object.measurements && object.measurements.length > 0) {
    const measurement = object.measurements[0];
    if (measurement.elementMeasurements) {
      const width = measurement.elementMeasurements.Width;
      const height = measurement.elementMeasurements.Height;
      if (width && height) {
        return { width, height };
      }
    }
  }
  
  // If no measurements, we'll need to download the image to get dimensions
  // This will be handled in the downloader
  return null;
}
