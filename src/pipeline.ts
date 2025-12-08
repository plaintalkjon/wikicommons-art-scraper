import { config } from './config';
import { fetchImagesForArtist, fetchImageInfoByTitle, pickBestVariant } from './wikimedia';
import { slugify } from './utils';
import { downloadImage } from './downloader';
import { uploadToStorage } from './storage';
import { WikimediaImage } from './types';
import { ensureArtist, insertArtAsset, linkArtTags, upsertArt, upsertArtSource, upsertTags } from './db';
import { fetchWikidataPaintings, fetchWikidataItemTags } from './wikidata';

export interface FetchOptions {
  artist: string;
  limit?: number;
  dryRun?: boolean;
  paintingsOnly?: boolean;
  maxUploads?: number;
  source?: 'wikimedia' | 'wikidata';
}

export interface FetchResult {
  attempted: number;
  uploaded: number;
  skipped: number;
  errors: Array<{ title: string; message: string }>;
}

export async function fetchAndStoreArtworks(options: FetchOptions): Promise<FetchResult> {
  const limit = options.limit ?? 50;
  const source = options.source ?? 'wikidata';
  let images: WikimediaImage[] = [];

  if (source === 'wikidata') {
    const items = await fetchWikidataPaintings({ limit });
    const fetched: WikimediaImage[] = [];
    for (const item of items) {
      if (fetched.length >= limit) break;
      if (!item.title) continue;
      const info = await fetchImageInfoByTitle(item.title);
      if (!info) continue;
      info.museum = item.museum;
      info.sourceItem = item.itemId;
      fetched.push(info);
    }
    images = fetched;
  } else {
    images = await fetchImagesForArtist({ artist: options.artist, limit });
  }
  const artistId = await ensureArtist(options.artist);

  let uploaded = 0;
  let skipped = 0;
  const errors: FetchResult['errors'] = [];

  for (const image of images) {
    try {
      if (options.maxUploads && uploaded >= options.maxUploads) {
        break;
      }

      if (options.paintingsOnly && !isLikelyColorPainting(image)) {
        skipped += 1;
        continue;
      }

      const variant = pickBestVariant(image);
      if (!variant) {
        skipped += 1;
        continue;
      }

      const downloaded = await downloadImage(variant);
      const path = buildStoragePath(options.artist, image, downloaded.ext);

      if (!options.dryRun) {
        const upload = await uploadToStorage(path, downloaded);
        const artId = await upsertArt({
          title: normalizeTitle(image.title),
          description: image.description ?? null,
          imageUrl: upload.publicUrl,
          artistId,
        });

        // Use Wikidata tags if available, otherwise fall back to Commons categories
        let normalizedTags: string[];
        if (image.sourceItem && source === 'wikidata') {
          const wikidataTags = await fetchWikidataItemTags(image.sourceItem);
          normalizedTags = normalizeWikidataTags(wikidataTags, image.museum);
        } else {
          normalizedTags = normalizeTags(image.categories, image.museum);
        }

        const tagIds = await upsertTags(normalizedTags).then((rows) => rows.map((r) => r.id));
        await linkArtTags(artId, tagIds);
        await upsertArtSource({
          artId,
          source: source === 'wikidata' ? 'wikidata' : 'wikimedia',
          sourcePageId: image.pageid,
          sourceTitle: image.title,
          sourceUrl: image.pageUrl,
        });
        await insertArtAsset({
          artId,
          storagePath: upload.path,
          publicUrl: upload.publicUrl,
          width: downloaded.width,
          height: downloaded.height,
          fileSize: downloaded.fileSize,
          mimeType: downloaded.mime,
          sha256: downloaded.sha256,
        });
        uploaded += 1;
      }
    } catch (err) {
      errors.push({ title: image.title, message: (err as Error).message });
    }
  }

  return {
    attempted: images.length,
    uploaded,
    skipped,
    errors,
  };
}

function buildStoragePath(artist: string, image: WikimediaImage, ext: string): string {
  const artistSlug = slugify(artist);
  const titleSlug = slugify(image.title.replace(/^File:/i, ''));
  const safeTitle = titleSlug || `image-${image.pageid}`;
  return `${artistSlug}/${safeTitle}.${ext}`;
}

function isLikelyColorPainting(image: WikimediaImage): boolean {
  const cats = image.categories.map((c) => c.toLowerCase());
  const hasPainting = cats.some((c) => c.includes('painting'));
  if (!hasPainting) return false;

  const excludePatterns = [
    'drawing',
    'sketch',
    'etching',
    'engraving',
    'black-and-white',
    'black and white',
    'monochrome',
    'bw',
    'line art',
    'study',
  ];

  if (cats.some((c) => excludePatterns.some((p) => c.includes(p)))) {
    return false;
  }

  const mime = image.original?.mime ?? image.thumb?.mime ?? '';
  if (mime.includes('svg') || mime.includes('gif')) return false;

  return true;
}

function normalizeTitle(title: string): string {
  return title.replace(/^File:/i, '').trim();
}

function normalizeTags(categories: string[], museum?: string): string[] {
  const noise = [
    'cc-pd',
    'cc-zero',
    'pd-old',
    'public domain',
    'wikimedia',
    'hidden-category',
    'maintenance',
    'images from',
  ];

  const base = [...categories];
  if (museum) base.push(museum);

  const cleaned = base
    .map((c) => c.replace(/^Category:/i, '').trim().toLowerCase())
    .map((c) => c.replace(/\s+/g, ' '))
    .filter(Boolean)
    .filter((c) => !noise.some((n) => c.includes(n)))
    .filter((c) => c.length <= 80);

  return Array.from(new Set(cleaned));
}

function normalizeWikidataTags(
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

