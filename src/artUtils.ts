import { WikimediaImage } from './types';
import { slugify } from './utils';

/**
 * Normalize title by removing "File:" prefix and cleaning up
 */
export function normalizeTitle(title: string): string {
  return title.replace(/^File:/i, '').trim();
}

/**
 * Clean up artwork titles by removing filename artifacts, artist names, museum names, and IDs
 */
export function cleanTitle(title: string, artistName?: string): string {
  let cleaned = title.trim();
  
  // Remove "File:" prefix
  cleaned = cleaned.replace(/^File:\s*/i, '');
  
  // Remove file extensions
  cleaned = cleaned.replace(/\.(jpg|jpeg|png|gif|tiff|tif|webp|svg)$/i, '');
  
  // Remove leading numbers and dashes (like "001", "0 Title")
  cleaned = cleaned.replace(/^\d+\s*[-.]?\s*/, '');
  
  // Remove parenthetical location info at start (like "(Albi)")
  cleaned = cleaned.replace(/^\([^)]+\)\s*[-.]?\s*/i, '');
  
  // Remove artist birth/death years in parentheses
  cleaned = cleaned.replace(/\s*\(\d{4}\s*-\s*\d{4}\)\s*[-.]?\s*/g, '');
  
  // Remove quotes around title
  cleaned = cleaned.replace(/^['"]\s*([^'"]+)\s*['"]\s*/, '$1');
  
  // Remove "by Artist Name" patterns
  if (artistName) {
    const artistPattern = new RegExp(`\\s*by\\s+${artistName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
    cleaned = cleaned.replace(artistPattern, '');
  }
  
  // Remove common museum/institution suffixes
  cleaned = cleaned.replace(/\s*-\s*(museum|gallery|collection|institute|foundation).*$/i, '');
  
  // Remove location suffixes (common patterns)
  cleaned = cleaned.replace(/\s*,\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s*$/, '');
  
  // Remove file hash suffixes (like "abc123def")
  cleaned = cleaned.replace(/[a-f0-9]{8,}\s*$/i, '');
  
  // Remove duplicate spaces
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  return cleaned;
}

/**
 * Build storage path for an image
 */
export function buildStoragePath(artist: string, image: WikimediaImage, ext: string): string {
  const artistSlug = slugify(artist);
  const titleSlug = slugify(image.title.replace(/^File:/i, ''));
  const safeTitle = titleSlug || `image-${image.pageid}`;
  return `${artistSlug}/${safeTitle}.${ext}`;
}

/**
 * Normalize Wikidata tags into an array of tag names
 */
export function normalizeWikidataTags(
  tags: { genre?: string; movement?: string; inceptionDate?: string },
  museum?: string,
): string[] {
  const result: string[] = [];

  if (tags.genre) {
    result.push(tags.genre.toLowerCase().trim());
  }
  if (tags.movement) {
    result.push(tags.movement.toLowerCase().trim());
  }
  if (tags.inceptionDate) {
    result.push(tags.inceptionDate.toLowerCase().trim());
  }
  if (museum) {
    result.push(museum.toLowerCase().trim());
  }

  return Array.from(new Set(result.filter(Boolean)));
}

/**
 * Extract keywords from description text that could be useful as tags
 * Looks for common propaganda/agency/topic keywords
 */
function extractKeywordsFromDescription(description: string): string[] {
  const keywords: string[] = [];
  const lowerDesc = description.toLowerCase();
  
  // Agencies
  const agencies = [
    'office of war information',
    'owi',
    'nara',
    'national archives',
    'war production board',
    'treasury department',
  ];
  
  agencies.forEach(agency => {
    if (lowerDesc.includes(agency)) {
      keywords.push(agency);
    }
  });
  
  // Topics/themes
  const topics = [
    'recruitment',
    'war bonds',
    'conservation',
    'rationing',
    'victory',
    'enlist',
    'buy bonds',
    'save',
    'waste',
    'production',
    'defense',
    'patriotism',
    'unity',
  ];
  
  topics.forEach(topic => {
    if (lowerDesc.includes(topic)) {
      keywords.push(topic);
    }
  });
  
  return keywords;
}

/**
 * Extract year from text, prioritizing WWII years (1941-1945)
 * Looks in description, title, and dateCreated
 * Returns the most relevant year found, or null if only upload dates found
 */
function extractYear(
  description?: string,
  title?: string,
  dateCreated?: string,
  categories?: string[]
): string | null {
  // Priority: Look for WWII years (1941-1945) first
  const wwiiYears = ['1941', '1942', '1943', '1944', '1945'];
  
  // Combine all text sources (excluding dateCreated if it's recent)
  const descTitle = [description, title].filter(Boolean).join(' ');
  const categoryText = (categories || []).join(' ');
  const allText = [descTitle, categoryText].filter(Boolean).join(' ');
  
  // Look for WWII years in description/title/categories first (most reliable)
  for (const year of wwiiYears) {
    // Match year as standalone or in date ranges (e.g., "1942", "c. 1942", "1942-1943")
    const yearPattern = new RegExp(`\\b(?:c\\.?\\s*)?${year}(?:-\\d{4})?\\b`, 'i');
    if (yearPattern.test(allText)) {
      return year;
    }
  }
  
  // Look for any year in description/title/categories (1900-1999)
  const descTitleYearMatch = allText.match(/\b(19\d{2})\b/);
  if (descTitleYearMatch) {
    const year = descTitleYearMatch[1];
    const yearNum = parseInt(year);
    // Prefer years in WWII era (1930-1950)
    if (yearNum >= 1930 && yearNum <= 1950) {
      return year;
    }
    // Accept any year 1900-1999 from description/title/categories
    if (yearNum >= 1900 && yearNum < 2000) {
      return year;
    }
  }
  
  // Last resort: Check dateCreated, but only if it's not a recent upload date
  if (dateCreated) {
    const dateYearMatch = dateCreated.match(/\b(19\d{2}|20[0-1]\d)\b/);
    if (dateYearMatch) {
      const year = dateYearMatch[1];
      const yearNum = parseInt(year);
      // Only use dateCreated if it's in a reasonable range (not upload date)
      // Accept 1900-1999, reject 2000+ as likely upload dates
      if (yearNum >= 1900 && yearNum < 2000) {
        return year;
      }
      // If dateCreated is 2000+, it's likely an upload date, so ignore it
    }
  }
  
  // No valid year found
  return null;
}

/**
 * Normalize Commons categories and metadata into tags
 * - Removes "Category:" prefix
 * - Normalizes category names (lowercase, underscores to spaces)
 * - Extracts year intelligently (prioritizes WWII years 1941-1945)
 * - Extracts keywords from description
 * - Adds base tags for propaganda posters
 */
export function normalizeCommonsTags(
  categories: string[],
  description?: string,
  dateCreated?: string,
  title?: string,
  baseTags: string[] = ['propaganda poster', 'wwii', 'united states'],
): string[] {
  const tags: string[] = [];
  
  // Add base tags
  tags.push(...baseTags);
  
  // Extract year intelligently (prioritizes WWII years from description/title/categories)
  // Do this BEFORE normalizing categories so we can use raw category names
  const extractedYear = extractYear(description, title, dateCreated, categories);
  
  // Normalize and add Commons categories
  categories.forEach(cat => {
    // Remove "Category:" prefix if present
    let normalized = cat.replace(/^Category:/i, '').trim();
    // Replace underscores with spaces
    normalized = normalized.replace(/_/g, ' ');
    // Lowercase
    normalized = normalized.toLowerCase();
    // Remove any remaining "category" word
    normalized = normalized.replace(/\bcategory\b/g, '').trim();
    if (normalized) {
      tags.push(normalized);
    }
  });
  
  // Add extracted year tag (if found)
  if (extractedYear) {
    tags.push(extractedYear);
  }
  
  // Also try to extract year from category names (e.g., "1940s posters" -> "1940")
  // This is a fallback if extractYear didn't find a specific year
  if (!extractedYear) {
    const categoryYearMatch = categories.join(' ').match(/\b(19[3-5]\d)s?\b/i);
    if (categoryYearMatch) {
      const categoryYear = categoryYearMatch[1];
      const yearNum = parseInt(categoryYear);
      // Only add if it's in a reasonable range (1930-1950 for WWII era)
      if (yearNum >= 1930 && yearNum <= 1950) {
        tags.push(categoryYear);
      }
    }
  }
  
  // Extract keywords from description
  if (description) {
    const keywords = extractKeywordsFromDescription(description);
    tags.push(...keywords);
  }
  
  // Remove duplicates and empty strings
  return Array.from(new Set(tags.filter(Boolean)));
}



















