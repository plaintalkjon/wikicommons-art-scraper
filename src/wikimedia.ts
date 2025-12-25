import { config } from './config';
import { WikimediaImage, ImageVariant } from './types';
import { getWikimediaAccessToken } from './wikimediaAuth';

const API_ENDPOINT = 'https://commons.wikimedia.org/w/api.php';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1500;
const MIN_VARIANT_WIDTH = 1280;
const MIN_ORIGINAL_WIDTH = 1800;

interface CategoryOptions {
  artist: string;
  categoryTitle?: string;
  limit?: number;
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

export async function fetchImagesForArtist(options: CategoryOptions): Promise<WikimediaImage[]> {
  const limit = options.limit ?? 10000;
  
  // If a specific category is provided, use it; otherwise use the most general category
  // The artist name category is recursive and includes all subcategories (Paintings by, Sculptures by, etc.)
  const gcmtitle = options.categoryTitle ?? `Category:${options.artist}`;
  
  return fetchImagesFromCategory(gcmtitle, limit);
}

async function fetchImagesFromCategory(gcmtitle: string, limit: number): Promise<WikimediaImage[]> {
  let gcmcontinue: string | undefined;
  const results: WikimediaImage[] = [];

  while (results.length < limit) {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      generator: 'categorymembers',
      gcmtitle,
      gcmtype: 'file',
      gcmlimit: '50',
      prop: 'imageinfo|categories|info',
      inprop: 'url',
      cllimit: 'max',
      iiprop: 'url|size|mime|extmetadata',
      iiurlwidth: '1600',
      iiurlheight: '1600',
      origin: '*',
    });

    if (gcmcontinue) {
      params.set('gcmcontinue', gcmcontinue);
    }

    const url = `${API_ENDPOINT}?${params.toString()}`;
    const res = await fetchWithRetry(url);
    const data = (await res.json()) as QueryResponse;

    const pages = data.query?.pages ?? [];
    for (const page of pages) {
      if (results.length >= limit) break;
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

      results.push({
        pageid: page.pageid,
        title: page.title,
        pageUrl: page.fullurl ?? page.canonicalurl ?? '',
        original,
        thumb,
        categories,
        description,
        license,
        dateCreated,
      });
    }

    if (!data.continue?.gcmcontinue) break;
    gcmcontinue = data.continue.gcmcontinue;
  }

  return results;
}

export async function fetchImageInfoByTitle(title: string): Promise<WikimediaImage | null> {
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

  return {
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
  let best = filtered[0];
  let bestScore = Math.abs(best.width - target);
  for (const candidate of filtered.slice(1)) {
    const score = Math.abs(candidate.width - target);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function isBadMime(mime: string): boolean {
  const lower = (mime || '').toLowerCase();
  return lower.includes('svg') || lower.includes('gif');
}

