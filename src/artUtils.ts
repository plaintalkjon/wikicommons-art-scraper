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

















