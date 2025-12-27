/**
 * National Gallery of Art (NGA) data fetcher
 * 
 * NGA provides open data via CSV files on GitHub:
 * https://github.com/NationalGalleryOfArt/opendata
 * 
 * CSV files:
 * - objects.csv: Artwork metadata
 * - constituents.csv: Artist information
 * - published_images.csv: Image URLs
 * - objects_constituents.csv: Artwork-artist relationships
 */

import { rateLimiter } from './rateLimiter';

const NGA_OPENDATA_BASE = 'https://raw.githubusercontent.com/NationalGalleryOfArt/opendata/main/data';

export interface NGAObject {
  objectid: string;
  title: string;
  displaydate?: string;
  beginyear?: string;
  endyear?: string;
  medium?: string;
  dimensions?: string;
  attribution?: string;
  classification?: string;
  culture?: string;
  period?: string;
  dynasty?: string;
  reign?: string;
  portfolio?: string;
  series?: string;
  volume?: string;
  watermark?: string;
  signed?: string;
  inscribed?: string;
  mark?: string;
  creditline?: string;
  dated?: string;
  yearbegin?: string;
  yearend?: string;
  verificationlevel?: string;
  standardreferencenumber?: string;
}

export interface NGAConstituent {
  constituentid: string;
  /**
   * Preferred display name (e.g., "Vincent van Gogh")
   * Sourced from forwarddisplayname/preferreddisplayname in CSV
   */
  name: string;
  constituenttype?: string;
  nationality?: string;
  gender?: string;
  begindate?: string;
  enddate?: string;
  ulanid?: string;
  wikidataid?: string;
  preferreddisplayname?: string;
  forwarddisplayname?: string;
  lastname?: string;
}

export interface NGAPublishedImage {
  objectid: string; // mapped from depictstmsobjectid
  imageid: string;
  iiifurl?: string;
  baseimageurl?: string;
  width?: string;
  height?: string;
  maxwidth?: string;
  maxheight?: string;
  thumbnailurl?: string;
  thumbnailwidth?: string;
  thumbnailheight?: string;
  displayorder?: string;
  // raw field from CSV (kept for clarity)
  depictstmsobjectid?: string;
}

export interface NGAObjectConstituent {
  objectid: string;
  constituentid: string;
  role?: string;
  displayorder?: string;
}

/**
 * IIIF image info returned by manifest fallback
 */
export interface NGAIIIFImageInfo {
  url: string;    // full image URL (IIIF full/full/0/default.jpg)
  width: number;  // pixel width if available
  height: number; // pixel height if available
}

/**
 * Download and parse a CSV file from NGA Open Data
 */
async function fetchCSV<T>(filename: string, parser: (row: Record<string, string>) => T): Promise<T[]> {
  await rateLimiter.waitIfNeeded();
  
  const url = `${NGA_OPENDATA_BASE}/${filename}`;
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch ${filename}: ${response.status} ${response.statusText}`);
  }
  
  const text = await response.text();
  const lines = text.split('\n').filter(line => line.trim());
  
  if (lines.length === 0) {
    return [];
  }
  
  // Parse CSV header
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  
  // Parse rows
  const rows: T[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === 0) continue;
    
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    
    rows.push(parser(row));
  }
  
  return rows;
}

/**
 * Parse a CSV line handling quoted fields
 */
function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i++; // Skip next quote
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // End of field
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  // Add last field
  values.push(current.trim());
  
  return values;
}

/**
 * Find artist by name in constituents CSV
 */
export async function findNGAArtist(name: string): Promise<NGAConstituent | null> {
  console.log(`  → Searching NGA constituents for: "${name}"...`);
  
  const constituents = await fetchCSV<NGAConstituent>('constituents.csv', (row) => ({
    constituentid: row.constituentid || '',
    // NGA CSV headers (as of Oct 2024): preferreddisplayname, forwarddisplayname, lastname
    // Use a best-effort, human-friendly display name
    name: row.forwarddisplayname || row.preferreddisplayname || row.lastname || row.name || '',
    forwarddisplayname: row.forwarddisplayname,
    preferreddisplayname: row.preferreddisplayname,
    lastname: row.lastname,
    constituenttype: row.constituenttype,
    nationality: row.nationality,
    gender: row.gender,
    begindate: row.begindate,
    enddate: row.enddate,
    ulanid: row.ulanid,
    wikidataid: row.wikidataid,
  }));
  
  const normalize = (v: string) => v.trim().toLowerCase();
  const target = normalize(name);

  // Try exact match on the normalized display name fields
  const exactMatch = constituents.find((c) => {
    if (!c.name) return false;
    return normalize(c.name) === target;
  });
  if (exactMatch) return exactMatch;

  // Try partial match but ignore empty names to avoid matching everything
  const partialMatch = constituents.find((c) => {
    if (!c.name) return false;
    const n = normalize(c.name);
    return n.includes(target) || target.includes(n);
  });
  
  return partialMatch || null;
}

/**
 * Find artworks by constituent ID
 */
export async function findArtworksByConstituent(constituentId: string): Promise<Array<{
  object: NGAObject;
  image: NGAPublishedImage | null;
}>> {
  console.log(`  → Finding artworks for constituent ID: ${constituentId}...`);
  
  // Fetch all required CSV files
  const [objects, images, relationships] = await Promise.all([
    fetchCSV<NGAObject>('objects.csv', (row) => ({
      objectid: row.objectid || '',
      title: row.title || '',
      displaydate: row.displaydate,
      beginyear: row.beginyear,
      endyear: row.endyear,
      medium: row.medium,
      dimensions: row.dimensions,
      attribution: row.attribution,
      classification: row.classification,
      culture: row.culture,
      period: row.period,
      dynasty: row.dynasty,
      reign: row.reign,
      portfolio: row.portfolio,
      series: row.series,
      volume: row.volume,
      watermark: row.watermark,
      signed: row.signed,
      inscribed: row.inscribed,
      mark: row.mark,
      creditline: row.creditline,
      dated: row.dated,
      yearbegin: row.yearbegin,
      yearend: row.yearend,
      verificationlevel: row.verificationlevel,
      standardreferencenumber: row.standardreferencenumber,
    })),
    fetchCSV<NGAPublishedImage>('published_images.csv', (row) => ({
      // The CSV uses depictstmsobjectid as the object id; map it so lookups work
      objectid: row.depictstmsobjectid || row.objectid || '',
      imageid: row.imageid || '',
      iiifurl: row.iiifurl,
      baseimageurl: row.baseimageurl,
      width: row.width,
      height: row.height,
      maxwidth: row.maxwidth,
      maxheight: row.maxheight,
      thumbnailurl: row.thumbnailurl,
      thumbnailwidth: row.thumbnailwidth,
      thumbnailheight: row.thumbnailheight,
      displayorder: row.displayorder,
      depictstmsobjectid: row.depictstmsobjectid,
    })),
    fetchCSV<NGAObjectConstituent>('objects_constituents.csv', (row) => ({
      objectid: row.objectid || '',
      constituentid: row.constituentid || '',
      role: row.role,
      displayorder: row.displayorder,
    })),
  ]);
  
  // Find all object IDs for this constituent
  const objectIds = relationships
    .filter(r => r.constituentid === constituentId)
    .map(r => r.objectid);
  
  if (objectIds.length === 0) {
    return [];
  }
  
  // Get objects and their images
  const artworks: Array<{ object: NGAObject; image: NGAPublishedImage | null }> = [];
  
  for (const objectId of objectIds) {
    const object = objects.find(o => o.objectid === objectId);
    if (!object) continue;
    
    // Find primary image (lowest displayorder or first available)
    const objectImages = images
      .filter(img => img.objectid === objectId)
      .sort((a, b) => {
        const orderA = parseInt(a.displayorder || '999', 10);
        const orderB = parseInt(b.displayorder || '999', 10);
        return orderA - orderB;
      });
    
    artworks.push({
      object,
      image: objectImages[0] || null,
    });
  }
  
  return artworks;
}

/**
 * Get best image URL from NGA published image
 * Prefers IIIF URL if available, falls back to baseimageurl
 */
export function getNGABestImageUrl(image: NGAPublishedImage): string | null {
  // Prefer IIIF URL if available
  if (image.iiifurl) {
    // For IIIF, we want full size - construct URL
    // Format: {iiifurl}/full/full/0/default.jpg
    const baseUrl = image.iiifurl.replace(/\/info\.json$/, '');
    return `${baseUrl}/full/full/0/default.jpg`;
  }
  
  // Fallback to base image URL
  if (image.baseimageurl) {
    return image.baseimageurl;
  }
  
  return null;
}

/**
 * Get image dimensions from NGA published image
 */
export function getNGADimensions(image: NGAPublishedImage): { width: number; height: number } | null {
  const width = image.width ? parseInt(image.width, 10) : null;
  const height = image.height ? parseInt(image.height, 10) : null;
  
  if (width && height && width > 0 && height > 0) {
    return { width, height };
  }
  
  // Try max dimensions
  const maxWidth = image.maxwidth ? parseInt(image.maxwidth, 10) : null;
  const maxHeight = image.maxheight ? parseInt(image.maxheight, 10) : null;
  
  if (maxWidth && maxHeight && maxWidth > 0 && maxHeight > 0) {
    return { width: maxWidth, height: maxHeight };
  }
  
  return null;
}

/**
 * Fetch IIIF manifest for an NGA object and extract a usable full-size image URL
 * Fallback path used when published_images.csv has no entry.
 */
export async function fetchIIIFImageForObject(objectId: string): Promise<NGAIIIFImageInfo | null> {
  const manifestUrl = `https://api.nga.gov/iiif/manifest/${objectId}`;
  
  try {
    await rateLimiter.waitIfNeeded();
    const manifestRes = await fetch(manifestUrl);
    if (!manifestRes.ok) {
      return null;
    }
    const manifest = await manifestRes.json();
    
    // IIIF v2: sequences[0].canvases[0].images[0].resource.service['@id']
    const canvasV2 = manifest?.sequences?.[0]?.canvases?.[0];
    const imageV2 = canvasV2?.images?.[0];
    const serviceV2 = imageV2?.resource?.service;
    
    // IIIF v3: items[0].items[0].body.service[0].id
    const canvasV3 = manifest?.items?.[0];
    const annoPage = canvasV3?.items?.[0];
    const anno = annoPage?.items?.[0];
    const body = anno?.body;
    const serviceV3 = Array.isArray(body?.service) ? body.service[0] : body?.service;
    
    const serviceId =
      serviceV2?.['@id'] ||
      serviceV2?.id ||
      serviceV3?.['@id'] ||
      serviceV3?.id ||
      imageV2?.resource?.['@id'] ||
      imageV2?.resource?.id;
    
    if (!serviceId) {
      return null;
    }
    
    // Normalize to base service (strip trailing /info.json if present)
    const baseService = serviceId.replace(/\/info\.json$/, '');
    const infoUrl = `${baseService}/info.json`;
    
    await rateLimiter.waitIfNeeded();
    const infoRes = await fetch(infoUrl);
    if (!infoRes.ok) {
      return null;
    }
    const info = await infoRes.json();
    
    const width = typeof info.width === 'number' ? info.width : 0;
    const height = typeof info.height === 'number' ? info.height : 0;
    const imageUrl = `${baseService}/full/full/0/default.jpg`;
    
    return { url: imageUrl, width, height };
  } catch {
    return null;
  }
}