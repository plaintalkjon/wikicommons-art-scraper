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
    
    // Extract Met object IDs and fetch details
    const objectIDs = bindings
      .map(b => b.metId?.value)
      .filter((id): id is string => Boolean(id))
      .map(id => parseInt(id, 10))
      .filter(id => !isNaN(id));
    
    console.log(`  → Fetching object details for ${objectIDs.length} Met objects...`);
    
    const artworks: MetArtwork[] = [];
    const BATCH_SIZE = 10;
    const DELAY_BETWEEN_BATCHES = 200; // 200ms between batches = ~50 req/sec (well under 80/sec limit)
    
    for (let i = 0; i < objectIDs.length; i += BATCH_SIZE) {
      const batch = objectIDs.slice(i, i + BATCH_SIZE);
      
      const batchPromises = batch.map(async (objectID): Promise<MetArtwork | null> => {
        try {
          const object = await fetchObjectDetails(objectID);
          if (object && object.primaryImage) {
            return {
              objectID: object.objectID,
              title: object.title || `Object ${objectID}`,
              artistDisplayName: object.artistDisplayName,
              primaryImage: object.primaryImage,
              objectDate: object.objectDate,
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
 */
export async function fetchObjectDetails(objectID: number): Promise<MetObject | null> {
  const url = `${MET_API_BASE}/objects/${objectID}`;
  
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; wikicommons-art-scraper/1.0; +https://github.com/plaintalkjon/wikicommons-art-scraper)',
      },
    });
    
    if (!res.ok) {
      if (res.status === 404) {
        return null; // Object doesn't exist
      }
      if (res.status === 403) {
        // Object is restricted (not in public domain or access denied)
        return null;
      }
      if (res.status === 429) {
        throw new Error('Met Museum API rate limit (429)');
      }
      throw new Error(`Met Museum API error: ${res.status} ${res.statusText}`);
    }
    
    const object = await res.json() as MetObject;
    return object;
  } catch (err) {
    if (err instanceof Error && err.message.includes('429')) {
      throw err;
    }
    // For other errors, return null (object might be restricted)
    if (err instanceof Error && err.message.includes('403')) {
      return null;
    }
    throw new Error(`Failed to fetch Met object ${objectID}: ${(err as Error).message}`);
  }
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
