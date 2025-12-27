/**
 * Art Institute of Chicago (AIC) API helper
 * Docs: https://api.artic.edu/docs/
 */

export interface ArticRecord {
  id: number;
  title: string | null;
  artist_title: string | null;
  date_display: string | null;
  classification_titles: string[];
  style_titles: string[];
  department_title: string | null;
  place_of_origin: string | null;
  medium_display: string | null;
  image_id: string | null;
  is_public_domain: boolean;
  api_link?: string;
  web_url?: string;
}

export interface ArticSearchOptions {
  q?: string;
  limit?: number;
  page?: number;
  departments?: string[];
  classifications?: string[];
  publicDomainOnly?: boolean;
}

const BASE = 'https://api.artic.edu/api/v1';
const FIELDS = [
  'id',
  'title',
  'artist_title',
  'date_display',
  'classification_titles',
  'style_titles',
  'department_title',
  'place_of_origin',
  'medium_display',
  'image_id',
  'is_public_domain',
  'api_link',
  'web_url',
];

export async function searchArtic(options: ArticSearchOptions = {}): Promise<ArticRecord[]> {
  const q = options.q ?? '';
  const limit = options.limit ?? 20;
  const page = options.page ?? 1;
  const departments = options.departments;
  const classifications = options.classifications;
  const publicDomainOnly = options.publicDomainOnly !== undefined ? options.publicDomainOnly : true;

  // Use POST search to avoid URL encoding complexities
  const params = new URLSearchParams();
  params.set('fields', FIELDS.join(','));
  params.set('limit', String(limit));
  params.set('page', String(page));
  const url = `${BASE}/artworks/search?${params.toString()}`;

  const body = {
    q,
    query: {
      bool: {
        must: [
          ...(publicDomainOnly ? [{ term: { is_public_domain: true } }] : []),
          { exists: { field: 'image_id' } },
          ...(departments && departments.length
            ? [{ terms: { 'department_title.keyword': departments } }]
            : []),
          ...(classifications && classifications.length
            ? [{ terms: { 'classification_titles.keyword': classifications } }]
            : []),
        ],
      },
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`AIC search failed: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as { data: ArticRecord[] };
  return json.data ?? [];
}

export function buildIiifUrl(imageId: string, maxSize = 2000): string {
  return `https://www.artic.edu/iiif/2/${imageId}/full/!${maxSize},${maxSize}/0/default.jpg`;
}

export function extractTags(rec: ArticRecord): string[] {
  const tags: string[] = [];
  const push = (val?: string | null) => {
    if (!val) return;
    const t = val.trim().toLowerCase();
    if (t) tags.push(t);
  };
  rec.classification_titles?.forEach(push);
  rec.style_titles?.forEach(push);
  push(rec.department_title);
  push(rec.place_of_origin);
  if (rec.medium_display) {
    // Split medium_display on punctuation for more granular tags
    rec.medium_display.split(/[;,]/).forEach(push);
  }
  if (rec.date_display) {
    // Try to extract a year token
    const m = rec.date_display.match(/\b(\d{3,4})\b/);
    if (m) push(m[1]);
    push(rec.date_display);
  }
  return Array.from(new Set(tags.filter(Boolean)));
}

