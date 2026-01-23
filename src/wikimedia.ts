import { config } from './config';
import { WikimediaImage, ImageVariant } from './types';
import { getWikimediaAccessToken } from './wikimediaAuth';
import { rateLimiter } from './rateLimiter';

const API_ENDPOINT = 'https://commons.wikimedia.org/w/api.php';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1500;
const MIN_VARIANT_WIDTH = 1280;
const MIN_ORIGINAL_WIDTH = 1800;

// In-memory cache for Commons file info (LRU-like, expires after 1 hour)
interface CacheEntry {
  image: WikimediaImage;
  timestamp: number;
}

const commonsCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function getCachedImage(title: string): WikimediaImage | null {
  const entry = commonsCache.get(title);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
    return entry.image;
  }
  if (entry) {
    commonsCache.delete(title); // Remove expired entry
  }
  return null;
}

function setCachedImage(title: string, image: WikimediaImage): void {
  // Limit cache size to prevent memory issues (keep last 1000 entries)
  if (commonsCache.size >= 1000) {
    // Remove oldest entry
    const oldestKey = Array.from(commonsCache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp)[0]?.[0];
    if (oldestKey) {
      commonsCache.delete(oldestKey);
    }
  }
  commonsCache.set(title, { image, timestamp: Date.now() });
}

interface ImageInfo {
  url?: string;
  descriptionurl?: string;
  canonicaltitle?: string;
  thumburl?: string;
  thumbwidth?: number;
  thumbheight?: number;
  width?: number;
  height?: number;
  mime?: string;
  extmetadata?: Record<string, { value?: string }>;
}

interface PageInfo {
  pageid: number;
  title: string;
  fullurl?: string;
  canonicalurl?: string;
  categories?: Array<{ title: string; hidden?: '' }>;
  imageinfo?: ImageInfo[];
}

interface QueryResponse {
  batchcomplete?: string;
  continue?: { gcmcontinue?: string; continue?: string };
  query?: {
    pages?: Array<PageInfo>;
  };
}

function toVariant(info: ImageInfo | undefined, preferThumb: boolean): ImageVariant | null {
  if (!info) return null;
  if (preferThumb && info.thumburl && info.thumbwidth && info.thumbheight) {
    return { url: info.thumburl, width: info.thumbwidth, height: info.thumbheight, mime: info.mime ?? 'image/jpeg' };
  }
  if (info.url && info.width && info.height) {
    return { url: info.url, width: info.width, height: info.height, mime: info.mime ?? 'image/jpeg' };
  }
  return null;
}


/**
 * Fetch image info using the modern Core REST API
 * Falls back to old API if Core REST API fails
 */
async function fetchImageInfoByTitleCoreREST(title: string): Promise<WikimediaImage | null> {
  try {
    const accessToken = await getWikimediaAccessToken();
    const encodedTitle = encodeURIComponent(title);
    const url = `https://api.wikimedia.org/core/v1/commons/file/${encodedTitle}`;
    
    const headers: HeadersInit = {
      'User-Agent': config.wikimediaClientId 
        ? `wikicommons-art-scraper/1.0 (OAuth client: ${config.wikimediaClientId})`
        : 'wikicommons-art-scraper/1.0 (contact: developer@example.com)',
    };
    
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }
    
    const res = await fetch(url, { headers });
    
    if (!res.ok) {
      // If Core REST API fails, fall back to old API
      return null;
    }
    
    const data = await res.json();
    
    // Convert Core REST API response to our format
    const original = data.original ? {
      url: data.original.url,
      width: data.original.width ?? 0,
      height: data.original.height ?? 0,
      mime: data.original.mediatype === 'BITMAP' ? 'image/jpeg' : 'image/png',
    } : null;
    
    const thumb = data.thumbnail ? {
      url: data.thumbnail.url,
      width: data.thumbnail.width ?? 0,
      height: data.thumbnail.height ?? 0,
      mime: data.thumbnail.mediatype === 'BITMAP' ? 'image/jpeg' : 'image/png',
    } : null;
    
    return {
      pageid: 0, // Core REST API doesn't provide pageid
      title: data.title,
      pageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(data.title)}`,
      original,
      thumb,
      categories: [], // Core REST API doesn't provide categories in this endpoint
      description: undefined,
      license: undefined,
      dateCreated: data.latest?.timestamp,
    };
  } catch (err) {
    // Fall back to old API on any error
    return null;
  }
}

export async function fetchImageInfoByTitle(title: string): Promise<WikimediaImage | null> {
  // Check cache first
  const cached = getCachedImage(title);
  if (cached) {
    return cached;
  }
  
  // Try Core REST API first (modern, better OAuth support)
  const coreRESTResult = await fetchImageInfoByTitleCoreREST(title);
  if (coreRESTResult) {
    setCachedImage(title, coreRESTResult);
    return coreRESTResult;
  }
  
  // Fall back to old Commons API
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    titles: title,
    prop: 'imageinfo|categories|info',
    inprop: 'url',
    cllimit: 'max',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: '4000',
    iiurlheight: '4000',
    origin: '*',
  });
  const url = `${API_ENDPOINT}?${params.toString()}`;
  const res = await fetchWithRetry(url);
  const data = (await res.json()) as QueryResponse;
  const page = data.query?.pages?.[0];
  if (!page) return null;

  const info = page.imageinfo?.[0];
  const thumb = toVariant(info, true);
  const original = toVariant(info, false);
  const categories = (page.categories ?? [])
    .filter((cat) => !cat.hidden)
    .map((cat) => cat.title.replace(/^Category:/, ''));

  const extmeta = info?.extmetadata ?? {};
  const license = extmeta.LicenseShortName?.value ?? extmeta.License?.value;
  const description = extmeta.ImageDescription?.value;
  const dateCreated = extmeta.DateTimeOriginal?.value ?? extmeta.DateTime?.value;

  const result: WikimediaImage = {
    pageid: page.pageid,
    title: page.title,
    pageUrl: page.fullurl ?? page.canonicalurl ?? '',
    original,
    thumb,
    categories,
    description,
    license,
    dateCreated,
  };
  
  // Cache the result
  setCachedImage(title, result);
  return result;
}

async function fetchWithRetry(url: string, useAuth = true): Promise<Response> {
  let attempt = 0;
  
  // Get OAuth token if available
  let accessToken: string | null = null;
  if (useAuth) {
    accessToken = await getWikimediaAccessToken();
  }
  let lastError: Error | undefined;

  while (attempt < MAX_RETRIES) {
    // Check rate limits before making request
    await rateLimiter.waitIfNeeded();
    
    // Build headers with OAuth token if available
    const headers: HeadersInit = {
      'User-Agent': config.wikimediaClientId 
        ? `wikicommons-art-scraper/1.0 (OAuth client: ${config.wikimediaClientId})`
        : 'wikicommons-art-scraper/1.0 (contact: developer@example.com)',
    };
    
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }
    
    const res = await fetch(url, {
      method: 'GET',
      headers,
    });
    
    if (res.ok) return res;

    lastError = new Error(`Wikimedia request failed: ${res.status} ${res.statusText}`);
    
    // For 429 (rate limit), throw immediately - don't retry
    if (res.status === 429) {
      throw new Error(`Wikimedia rate limit (429) - ${res.statusText}`);
    }
    
    // For 500+ errors, retry with exponential backoff
    if (res.status >= 500) {
      attempt += 1;
      await delay(RETRY_DELAY_MS * attempt);
      continue;
    }
    
    // For other errors, throw immediately
    throw lastError;
  }

  throw lastError ?? new Error('Wikimedia request failed after retries');
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function pickBestVariant(image: WikimediaImage): ImageVariant | null {
  // Require an original that is at least MIN_ORIGINAL_WIDTH (width or height) to ensure a high-quality source exists.
  if (!image.original || (image.original.width < MIN_ORIGINAL_WIDTH && image.original.height < MIN_ORIGINAL_WIDTH)) {
    return null;
  }

  const target = config.targetWidth;
  const candidates: ImageVariant[] = [];
  if (image.thumb) candidates.push(image.thumb);
  if (image.original) candidates.push(image.original);
  // Filter: must be at least MIN_VARIANT_WIDTH (width OR height) and not bad mime type
  const filtered = candidates.filter(
    (c) => (c.width >= MIN_VARIANT_WIDTH || c.height >= MIN_VARIANT_WIDTH) && !isBadMime(c.mime),
  );
  if (!filtered.length) return null;

  // Pick the variant closest to target (1280px) but not smaller than MIN_VARIANT_WIDTH
  // Prefer variants >= 1280px width, pick the smallest one that's >= 1280px
  const candidatesAtLeast1280 = filtered.filter(c => c.width >= target);
  if (candidatesAtLeast1280.length > 0) {
    // Pick the smallest width that's >= 1280px
    return candidatesAtLeast1280.reduce((best, candidate) => 
      candidate.width < best.width ? candidate : best
    );
  }
  // Fallback: if no variant >= 1280px width, pick the one with width closest to 1280px (but still >= 1280px height)
  return filtered[0];
}

function isBadMime(mime: string): boolean {
  const lower = (mime || '').toLowerCase();
  return lower.includes('svg') || lower.includes('gif');
}

/**
 * List all file members in a Wikimedia Commons category
 * Returns array of file titles (e.g., "File:Poster.jpg")
 * Handles pagination automatically with rate limiting
 */
export async function listCategoryMembers(categoryName: string, limit?: number): Promise<string[]> {
  const files: string[] = [];
  let continueToken: string | undefined;
  const maxFiles = limit ?? 10000;
  
  // Ensure category name has "Category:" prefix
  const categoryTitle = categoryName.startsWith('Category:') 
    ? categoryName 
    : `Category:${categoryName}`;
  
  console.log(`  → Fetching category members (max ${maxFiles} files)...`);
  
  while (files.length < maxFiles) {
    // Rate limit before each request
    await rateLimiter.waitIfNeeded();
    
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      list: 'categorymembers',
      cmtitle: categoryTitle,
      cmtype: 'file', // Only get files, not subcategories
      cmlimit: '500', // Max per request
      cmnamespace: '6', // File namespace
    });
    
    if (continueToken) {
      params.append('cmcontinue', continueToken);
    }
    
    const url = `${API_ENDPOINT}?${params.toString()}`;
    const res = await fetchWithRetry(url, true);
    const data = await res.json() as {
      continue?: { cmcontinue?: string };
      query?: { categorymembers?: Array<{ title: string }> };
    };
    
    const members = data.query?.categorymembers ?? [];
    for (const member of members) {
      if (files.length >= maxFiles) break;
      files.push(member.title);
    }
    
    if (files.length % 500 === 0 && files.length > 0) {
      console.log(`  → Fetched ${files.length} files so far...`);
    }
    
    // Check for pagination
    continueToken = data.continue?.cmcontinue;
    if (!continueToken || members.length === 0) {
      break;
    }
  }
  
  return files.slice(0, maxFiles);
}
