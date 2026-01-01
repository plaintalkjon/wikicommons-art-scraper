import { SmithsonianArtwork } from './types';
import { rateLimiter } from './rateLimiter';

const SMITHSONIAN_API_BASE = 'https://api.si.edu/openaccess/api/v1.0';
const SMITHSONIAN_API_KEY = process.env.SMITHSONIAN_API_KEY;

if (!SMITHSONIAN_API_KEY) {
  throw new Error('SMITHSONIAN_API_KEY environment variable is required');
}

/**
 * Search for artworks by artist in Smithsonian collections
 */
export async function searchSmithsonianArtworks(
  artist: string,
  limit: number = 100
): Promise<SmithsonianArtwork[]> {
  // More specific query to focus on artworks, not books/publications
  const query = encodeURIComponent(`"${artist}" AND (painting OR sculpture OR drawing OR print OR artwork)`);
  const url = `${SMITHSONIAN_API_BASE}/search?api_key=${SMITHSONIAN_API_KEY}&q=${query}&collection=edanmdm-saam&rows=${limit}`;

  await rateLimiter.waitIfNeeded();

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Smithsonian API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(`Smithsonian API error: ${data.error.message}`);
  }

  // Debug logging
  console.log(`  → API returned ${data.response?.rowCount || 0} total results`);
  console.log(`  → Found ${data.response?.rows?.length || 0} rows in this page`);

  // Process the search results
  const artworks: SmithsonianArtwork[] = [];

  if (data.response && data.response.rows) {
    for (const row of data.response.rows) {
      try {
        // Quick filter: skip obvious non-artworks based on title/content
        const title = row.title || '';
        const content = row.content?.freetext;

        // Skip books, publications, symposia, etc.
        if (content?.objectType) {
          const objectTypes = content.objectType.map((ot: any) => ot.content?.toLowerCase());
          if (objectTypes.some((type: string) =>
            type.includes('book') ||
            type.includes('publication') ||
            type.includes('symposium') ||
            type.includes('conference') ||
            type.includes('article') ||
            type.includes('periodical')
          )) {
            console.log(`  ⚠ Skipped ${row.id}: ${title} (non-artwork: ${objectTypes.join(', ')})`);
            continue;
          }
        }

        // Extract artwork information from the search result
        const artwork = await getSmithsonianArtworkDetails(row.id);
        if (artwork) {
          artworks.push(artwork);
          console.log(`  ✓ Added artwork: ${artwork.title}`);
        } else {
          console.log(`  ⚠ Skipped row ID: ${row.id} (no artwork data)`);
        }
      } catch (err) {
        console.warn(`Failed to get details for Smithsonian object ${row.id}:`, err);
      }
    }
  }

  return artworks;
}

/**
 * Get detailed information for a specific Smithsonian object
 */
export async function getSmithsonianArtworkDetails(objectId: string): Promise<SmithsonianArtwork | null> {
  const url = `${SMITHSONIAN_API_BASE}/content/${objectId}?api_key=${SMITHSONIAN_API_KEY}`;

  await rateLimiter.waitIfNeeded();

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Smithsonian API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(`Smithsonian API error: ${data.error.message}`);
  }

  // Extract artwork information from the detailed response
  const content = data.response?.content;

  if (!content) {
    return null;
  }

  // Check if it's actually an artwork
  const objectType = content.freetext?.objectType?.[0]?.content;
  if (!objectType || !objectType.toLowerCase().includes('painting') &&
      !objectType.toLowerCase().includes('sculpture') &&
      !objectType.toLowerCase().includes('drawing') &&
      !objectType.toLowerCase().includes('print')) {
    return null; // Skip non-artwork objects
  }

  // Extract title
  const title = content.descriptiveNonRepeating?.title?.content ||
                content.freetext?.title?.[0]?.content ||
                `Untitled (${objectId})`;

  // Extract artist/creator information
  let artistName = '';
  const name = content.freetext?.name?.[0]?.content;
  if (name) {
    artistName = name;
  }

  // Extract dimensions
  let width = 0;
  let height = 0;
  const measurements = content.freetext?.measurements?.[0]?.content;
  if (measurements) {
    // Parse dimensions like "20 x 30 cm" or "20 cm x 30 cm"
    const dimensionMatch = measurements.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i);
    if (dimensionMatch) {
      width = parseFloat(dimensionMatch[1]);
      height = parseFloat(dimensionMatch[2]);
    }
  }

  // Extract medium/classification
  const medium = content.freetext?.medium?.[0]?.content || '';
  const classification = objectType;

  // Extract date
  const date = content.freetext?.date?.[0]?.content || '';

  // Extract image URL
  let imageUrl = '';
  const media = content.descriptiveNonRepeating?.online_media?.media;
  if (media && media.length > 0) {
    // Find the largest image
    let maxSize = 0;
    for (const item of media) {
      if (item.thumbnail && item.thumbnail.length > 0) {
        // Use thumbnail as base URL and try to get full resolution
        const thumbnailUrl = item.thumbnail;
        const fullUrl = thumbnailUrl.replace(/_\d+\.jpg$/, '.jpg'); // Try to get full resolution
        imageUrl = fullUrl;
        break;
      }
    }
  }

  // Skip if no image
  if (!imageUrl) {
    return null;
  }

  return {
    objectId,
    title,
    artist: artistName,
    imageUrl,
    width,
    height,
    medium,
    classification,
    date,
    sourceUrl: `https://americanart.si.edu/art/${objectId}`,
  };
}

/**
 * Get the best image URL for a Smithsonian artwork
 */
export function getSmithsonianBestImageUrl(artwork: SmithsonianArtwork): string {
  return artwork.imageUrl;
}

/**
 * Get dimensions for a Smithsonian artwork
 */
export function getSmithsonianDimensions(artwork: SmithsonianArtwork): { width: number; height: number } | null {
  if (artwork.width > 0 && artwork.height > 0) {
    return { width: artwork.width, height: artwork.height };
  }
  return null;
}
