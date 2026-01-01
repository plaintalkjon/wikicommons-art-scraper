import { rateLimiter } from './rateLimiter';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';

export interface GoogleArtsRecord {
  filename: string;
  sourceUrl: string;
  title?: string;
  artist?: string;
  tags?: string[];
  description?: string;
  date?: string;
  medium?: string;
  dimensions?: string;
  museum?: string;
}

export interface GoogleArtsArtwork {
  filename: string;
  sourceUrl: string;
  title: string;
  artist: string;
  tags: string[];
  description?: string;
  date?: string;
  medium?: string;
  dimensions?: string;
  museum?: string;
}

/**
 * Parse the GoogleImages.csv file to get filename-to-URL mappings
 */
export async function parseGoogleArtsCSV(csvPath: string): Promise<GoogleArtsRecord[]> {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV file not found: ${csvPath}`);
  }

  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const records: any[] = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  return records.map((record: any) => ({
    filename: record.filename || record.Filename || record.file || record.File,
    sourceUrl: record.page || record.Page || record.sourceUrl || record.SourceUrl || record.url || record.URL,
  })).filter((record: GoogleArtsRecord) => record.filename && record.sourceUrl);
}

/**
 * Scrape metadata from a Google Arts & Culture page
 */
export async function scrapeGoogleArtsPage(url: string): Promise<{
  title: string;
  artist: string;
  tags: string[];
  description?: string;
  date?: string;
  medium?: string;
  dimensions?: string;
  museum?: string;
} | null> {
  await rateLimiter.waitIfNeeded();

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    if (!response.ok) {
      const isRateLimit = response.status === 429;
      console.warn(`${isRateLimit ? '🚫 Rate limit' : 'Failed to fetch'} ${url}: ${response.status} ${response.statusText}`);
      // Throw error for rate limits so they can be handled differently
      if (isRateLimit) {
        throw new Error(`429 Too Many Requests`);
      }
      return null;
    }

    const html = await response.text();

    // Parse the page content
    const metadata = extractMetadataFromHTML(html);

    if (!metadata.title || !metadata.artist) {
      console.warn(`Could not extract required metadata from ${url}`);
      console.warn(`Title found: "${metadata.title}"`);
      console.warn(`Artist found: "${metadata.artist}"`);
      return null;
    }

    return metadata;
  } catch (error) {
    console.warn(`Error scraping ${url}:`, error);
    return null;
  }
}

/**
 * Extract metadata from Google Arts & Culture HTML
 */
function extractMetadataFromHTML(html: string): {
  title: string;
  artist: string;
  tags: string[];
  description?: string;
  date?: string;
  medium?: string;
  dimensions?: string;
  museum?: string;
} {
  const tags: string[] = [];

  // Extract title - look for various title patterns in Google Arts
  let title = '';
  const titlePatterns = [
    /<h1[^>]*>([^<]+)<\/h1>/i,
    /"name":\s*"([^"]+)"/i,
    /<title>([^<]+)<\/title>/i,
    /og:title" content="([^"]+)"/i,
  ];

  for (const pattern of titlePatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      title = match[1].trim();
      // Clean up common Google Arts title prefixes
      title = title.replace(/^Google Arts & Culture\s*-\s*/i, '');
      title = title.replace(/\s*\|\s*Google Arts & Culture$/i, '');
      break;
    }
  }

  // Extract artist - look for artist/creator information
  let artist = '';
  const artistPatterns = [
    // Google Arts entity links (most reliable)
    /href="\/entity\/([^\/]+)\/[^"]*\?categoryId=artist"/i,

    // Primary Google Arts JSON patterns
    /"author":\s*"([^"]+)"/i,
    /"author\\":\s*"([^"]+)"/i,  // Escaped quotes
    /"creator":\s*"([^"]+)"/i,
    /"artist":\s*"([^"]+)"/i,

    // JSON-LD structured data
    /"creator":\s*\[\s*{\s*"name":\s*"([^"]+)"/i,
    /"author":\s*\[\s*{\s*"name":\s*"([^"]+)"/i,

    // HTML meta tags
    /property="article:author" content="([^"]+)"/i,
    /name="author" content="([^"]+)"/i,

    // Common HTML patterns
    /artist["\s]*:\s*["\s]*([^"<\n,]+)/i,
    /by\s+([^<\n,]{3,50}?)(?:\s*[,\.\|\-\(\)]|$)/i,
    /painter["\s]*:\s*["\s]*([^"<\n,]+)/i,
    /creator["\s]*:\s*["\s]*([^"<\n,]+)/i,

    // Specific Google Arts patterns
    /<span[^>]*class="[^"]*artist[^"]*"[^>]*>([^<]+)<\/span>/i,
    /<a[^>]*href="[^"]*artist[^"]*"[^>]*>([^<]+)<\/a>/i,
  ];

  for (const pattern of artistPatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      artist = match[1].trim();

      // Special handling for Google Arts entity URLs (convert slug to proper name)
      if (pattern.source.includes('entity') && pattern.source.includes('categoryId=artist')) {
        // Convert slug format to title case: "james-abbott-mcneill-whistler" -> "James Abbott McNeill Whistler"
        artist = artist
          .split('-')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join(' ');
      }

      // Clean up artist name
      artist = artist.replace(/^by\s+/i, '');
      artist = artist.replace(/\s*\([^)]*\)\s*$/, ''); // Remove parentheses at end
      artist = artist.replace(/\s*,\s*$/, ''); // Remove trailing comma
      artist = artist.replace(/^\s*-\s*/, ''); // Remove leading dash
      artist = artist.replace(/\s+$/, ''); // Remove trailing spaces

      // Skip if artist name is too short or generic
      if (artist.length < 3 || /^unknown|anonymous|unnamed/i.test(artist)) {
        continue;
      }

      break;
    }
  }

  // Extract description
  let description = '';
  const descPatterns = [
    /"description":\s*"([^"]+)"/i,
    /og:description" content="([^"]+)"/i,
    /<meta name="description" content="([^"]+)"/i,
  ];

  for (const pattern of descPatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      description = match[1].trim();
      break;
    }
  }

  // Extract date
  let date = '';
  const datePatterns = [
    /"dateCreated":\s*"([^"]+)"/i,
    /date["\s]*:\s*["\s]*([^"<\n,]+)/i,
    /(\d{4}(?:\s*-\s*\d{4})?)/, // Simple year or year range
  ];

  for (const pattern of datePatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      date = match[1].trim();
      break;
    }
  }

  // Extract medium/materials
  let medium = '';
  const mediumPatterns = [
    /medium["\s]*:\s*["\s]*([^"<\n,]+)/i,
    /materials["\s]*:\s*["\s]*([^"<\n,]+)/i,
    /oil on canvas/i,
    /watercolor/i,
    /sculpture/i,
    /bronze/i,
    /marble/i,
  ];

  for (const pattern of mediumPatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      medium = match[1].trim();
      tags.push(medium.toLowerCase());
      break;
    } else if (match && !match[1]) {
      // For literal matches like "oil on canvas"
      medium = match[0].trim();
      tags.push(medium.toLowerCase());
      break;
    }
  }

  // Extract dimensions
  let dimensions = '';
  const dimensionPatterns = [
    /dimensions["\s]*:\s*["\s]*([^"<\n,]+)/i,
    /size["\s]*:\s*["\s]*([^"<\n,]+)/i,
    /(\d+(?:\.\d+)?\s*x\s*\d+(?:\.\d+)?\s*(?:cm|mm|in|inches)?)/i,
  ];

  for (const pattern of dimensionPatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      dimensions = match[1].trim();
      break;
    }
  }

  // Extract museum/institution
  let museum = '';
  const museumPatterns = [
    /"provider":\s*\[\s*{\s*"name":\s*"([^"]+)"/i,
    /museum["\s]*:\s*["\s]*([^"<\n,]+)/i,
    /institution["\s]*:\s*["\s]*([^"<\n,]+)/i,
    /collection["\s]*:\s*["\s]*([^"<\n,]+)/i,
  ];

  for (const pattern of museumPatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      museum = match[1].trim();
      tags.push(`museum:${museum.toLowerCase()}`);
      break;
    }
  }

  // Add general tags based on content analysis
  if (title) {
    // Extract potential style/art movement keywords from title
    const styleKeywords = ['impressionist', 'renaissance', 'baroque', 'abstract', 'cubist', 'surrealist', 'expressionist'];
    for (const keyword of styleKeywords) {
      if (title.toLowerCase().includes(keyword)) {
        tags.push(keyword);
      }
    }
  }

  // Add medium-based tags
  if (medium) {
    if (medium.toLowerCase().includes('oil')) tags.push('oil painting');
    if (medium.toLowerCase().includes('canvas')) tags.push('canvas');
    if (medium.toLowerCase().includes('watercolor')) tags.push('watercolor');
    if (medium.toLowerCase().includes('sculpture') || medium.toLowerCase().includes('bronze') || medium.toLowerCase().includes('marble')) {
      tags.push('sculpture');
    }
  }

  // Add date-based tags
  if (date) {
    const yearMatch = date.match(/(\d{4})/);
    if (yearMatch) {
      const year = parseInt(yearMatch[1]);
      if (year < 1500) tags.push('medieval');
      else if (year < 1800) tags.push('old masters');
      else if (year < 1900) tags.push('19th century');
      else if (year < 2000) tags.push('20th century');
      else tags.push('contemporary');
    }
  }

  return {
    title: title || 'Untitled',
    artist: artist || 'Unknown Artist',
    tags: Array.from(new Set(tags)), // Remove duplicates
    description,
    date,
    medium,
    dimensions,
    museum,
  };
}

/**
 * Process all records from CSV and scrape their metadata
 */
export async function scrapeGoogleArtsArtworks(
  csvPath: string,
  limit?: number
): Promise<GoogleArtsArtwork[]> {
  const records = await parseGoogleArtsCSV(csvPath);
  const artworks: GoogleArtsArtwork[] = [];

  console.log(`Found ${records.length} records in CSV`);

  const maxConcurrency = 3; // Limit concurrent requests
  const batches: GoogleArtsRecord[][] = [];

  // Split into batches for controlled concurrency
  for (let i = 0; i < records.length; i += maxConcurrency) {
    batches.push(records.slice(i, i + maxConcurrency));
  }

  for (const batch of batches) {
    if (limit && artworks.length >= limit) break;

    const promises = batch.map(async (record) => {
      if (limit && artworks.length >= limit) return;

      console.log(`Scraping: ${record.filename} -> ${record.sourceUrl}`);
      const metadata = await scrapeGoogleArtsPage(record.sourceUrl);

      if (metadata) {
        artworks.push({
          filename: record.filename,
          sourceUrl: record.sourceUrl,
          ...metadata,
        });
        console.log(`✓ Scraped: "${metadata.title}" by ${metadata.artist}`);
      } else {
        console.warn(`✗ Failed to scrape: ${record.filename}`);
      }
    });

    await Promise.all(promises);

    // Small delay between batches
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return artworks;
}

/**
 * Get the local image path for a Google Arts artwork
 */
export function getGoogleArtsImagePath(artwork: GoogleArtsArtwork, imagesDir: string): string {
  return path.join(imagesDir, artwork.filename);
}

/**
 * Check if the local image exists
 */
export function googleArtsImageExists(artwork: GoogleArtsArtwork, imagesDir: string): boolean {
  const imagePath = getGoogleArtsImagePath(artwork, imagesDir);
  return fs.existsSync(imagePath);
}
