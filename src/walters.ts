import { config } from './config';

export interface WaltersArtwork {
  ObjectID: string;
  ObjectNumber: string;
  ObjectName: string;
  DateBeginYear: number | null;
  DateEndYear: number | null;
  DateText: string | null;
  Title: string | null;
  Dimensions: string | null;
  Medium: string | null;
  Description: string | null;
  CollectionID: string;
  CreatorID: string | null;
  CreditLine: string | null;
  Classification: string | null;
  IsPublicDomain: boolean;
  ObjectURL: string;
  SortNumber: number;
  Period: string | null;
  Dynasty: string | null;
  Reign: string | null;
  Portfolio: string | null;
  PrimaryImageURL: string | null;
  // Add other fields as needed
}

export interface WaltersMedia {
  ObjectID: string;
  MediaXrefID: string;
  ImageURL: string;
  Filename: string;
  MediaType: string;
  MediaView: string;
  Rank: number;
  IsPrimary: boolean;
}

export interface WaltersCreator {
  id: string;
  sort_name: string;
  name: string;
  CreatorURL: string;
  gender: string | null;
  biography: string | null;
  date: string | null;
  CreatorArt: string | null;
}

// CSV download URLs from GitHub
const BASE_URL = 'https://raw.githubusercontent.com/WaltersArtMuseum/api-thewalters-org/main/';

export async function downloadWaltersArt(): Promise<WaltersArtwork[]> {
  const url = BASE_URL + 'art.csv';
  const response = await fetch(url);
  const csvText = await response.text();

  const lines = csvText.split('\n').filter(line => line.trim());
  const headers = lines[0].split(',').map(h => h.replace(/"/g, ''));

  const artworks: WaltersArtwork[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === headers.length) {
      const artwork: any = {};
      headers.forEach((header, index) => {
        let value: any = values[index]?.replace(/^"|"$/g, '') || null;

        // Type conversion
        if (header.includes('Year') && value) {
          value = parseInt(value) || null;
        } else if (header === 'IsPublicDomain') {
          value = value?.toLowerCase() === 'true';
        } else if (header === 'SortNumber') {
          value = parseInt(value) || 0;
        }

        artwork[header] = value;
      });
      artworks.push(artwork as WaltersArtwork);
    }
  }

  return artworks;
}

export async function downloadWaltersMedia(): Promise<WaltersMedia[]> {
  const url = BASE_URL + 'media.csv';
  const response = await fetch(url);
  const csvText = await response.text();

  const lines = csvText.split('\n').filter(line => line.trim());
  const headers = lines[0].split(',').map(h => h.replace(/"/g, ''));

  const media: WaltersMedia[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === headers.length) {
      const mediaItem: any = {};
      headers.forEach((header, index) => {
        let value: any = values[index]?.replace(/^"|"$/g, '') || null;

        // Type conversion
        if (header === 'Rank') {
          value = parseInt(value) || 0;
        } else if (header === 'IsPrimary') {
          value = value === '1';
        }

        mediaItem[header] = value;
      });
      media.push(mediaItem as WaltersMedia);
    }
  }

  return media;
}

export async function downloadWaltersCreators(): Promise<Map<string, WaltersCreator>> {
  const url = BASE_URL + 'creators.csv';
  const response = await fetch(url);
  const csvText = await response.text();

  const lines = csvText.split('\n').filter(line => line.trim());
  const headers = lines[0].split(',').map(h => h.replace(/"/g, ''));

  const creators = new Map<string, WaltersCreator>();
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length >= headers.length) {
      const creator: any = {};
      headers.forEach((header, index) => {
        let value: any = values[index]?.replace(/^"|"$/g, '') || null;
        creator[header] = value;
      });
      creators.set(creator.id, creator as WaltersCreator);
    }
  }

  return creators;
}

// Helper function to parse CSV lines (handles quoted fields)
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
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
      // Field separator
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  // Add final field
  result.push(current);

  return result;
}

export function buildImageUrl(media: WaltersMedia): string | undefined {
  return media.ImageURL || undefined;
}

export function extractTags(artwork: WaltersArtwork, creator?: WaltersCreator): string[] {
  const tags: string[] = [];

  const push = (val?: string | null) => {
    if (!val) return;
    const t = val.trim().toLowerCase();
    if (t) tags.push(t);
  };

  // Basic object info
  push(artwork.ObjectName);
  push(artwork.Classification);
  push(artwork.Medium);
  push(artwork.Period);
  push(artwork.Dynasty);
  push(artwork.Reign);
  push(artwork.Portfolio);

  // Creator info
  if (creator) {
    push(creator.name);
    push(creator.gender);
    if (creator.date) {
      const yearMatch = creator.date.match(/\b(\d{4})\b/);
      if (yearMatch) push(yearMatch[1]);
    }
  }

  // Date info
  if (artwork.DateBeginYear) {
    const century = Math.floor(artwork.DateBeginYear / 100) + 1;
    push(`${century}th century`);
    push(artwork.DateBeginYear.toString());
  }

  // Title keywords (simple extraction)
  if (artwork.Title) {
    artwork.Title.split(/[\s,;:]+/)
      .filter(word => word.length > 2)
      .slice(0, 5)
      .forEach(push);
  }

  return Array.from(new Set(tags.filter(Boolean)));
}
