import { config } from './config';
import { fetchImageInfoByTitle, pickBestVariant } from './wikimedia';
import { slugify } from './utils';
import { downloadImage } from './downloader';
import { uploadToStorage } from './storage';
import { WikimediaImage } from './types';
import { ensureArtist, insertArtAsset, linkArtTags, upsertArt, upsertArtSource, upsertTags } from './db';
import { fetchWikidataPaintings, fetchWikidataItemTags, findArtistQID } from './wikidata';
import { saveFailure } from './failureTracker';

export interface FetchOptions {
  artist: string;
  limit?: number;
  dryRun?: boolean;
  paintingsOnly?: boolean;
  maxUploads?: number;
}

export interface FetchResult {
  attempted: number;
  uploaded: number;
  skipped: number;
  errors: Array<{ title: string; message: string }>;
}

async function processInParallel<T>(
  items: T[],
  processor: (item: T) => Promise<void>,
  concurrency: number,
): Promise<void> {
  const executing = new Set<Promise<void>>();

  for (const item of items) {
    const promise = processor(item).finally(() => {
      executing.delete(promise);
    });

    executing.add(promise);

    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
}

export async function fetchAndStoreArtworks(options: FetchOptions): Promise<FetchResult> {
  const limit = options.limit ?? 50;
  const CONCURRENCY = 5; // Process 5 images in parallel
  
  // Look up artist QID from name
  console.log(`Looking up Wikidata QID for artist: ${options.artist}...`);
  let artistQid = await findArtistQID(options.artist);
  
  // Special case for known problematic artists
  if (!artistQid) {
    const knownArtists: Record<string, string> = {
      'Jean‑François Millet': 'Q148458',
      'Jean-François Millet': 'Q148458',
      'Jean Francois Millet': 'Q148458',
      'Jean-Francois Millet': 'Q148458',
      'Édouard Manet': 'Q40599',
      'Edouard Manet': 'Q40599',
      'Rembrandt van Rijn': 'Q5598',
      'Rembrandt': 'Q5598',
      'Rembrandt Harmenszoon van Rijn': 'Q5598',
      'Michelangelo Merisi da Caravaggio': 'Q42207',
      'Caravaggio': 'Q42207',
      'Michelangelo Merisi': 'Q42207',
      'Diego Velázquez': 'Q297',
      'Diego Velazquez': 'Q297',
      'Diego Rodríguez de Silva y Velázquez': 'Q297',
      'Jean Auguste Dominique Ingres': 'Q5592',
      'Jean-Auguste-Dominique Ingres': 'Q5592',
      'J.A.D. Ingres': 'Q5592',
      'Ingres': 'Q5592',
      'Antoine Calbet': 'Q585816',
      'Andoine Calbet': 'Q585816', // Common misspelling
      'Charles-Joseph Panckoucke': 'Q312858',
      'Évariste-Vital Luminais': 'Q2060248',
      'Evariste-Vital Luminais': 'Q2060248', // Without accent
      'Jean-Simon Berthélemy': 'Q317527',
      'Adolf Hirémy-Hirschl': 'Q331047',
      'Adolf Hirschl': 'Q331047', // Alternative name
      'François Lemoyne': 'Q732468',
      'François Le Moine': 'Q732468', // Alternative spelling
      'Francois Lemoyne': 'Q732468', // Without accent
      'Zdzisław Beksiński': 'Q169246',
      'Zdzislaw Beksinski': 'Q169246', // Without special characters
      'Jules Joseph Lefebvre': 'Q433973',
      'Edward Poynter': 'Q333995',
      'Sir Edward John Poynter': 'Q333995',
      'Edward John Poynter': 'Q333995',
      'Édouard Bernard Debat-Ponsan': 'Q305991',
      'Edouard Bernard Debat-Ponsan': 'Q305991', // Without accent
      'Édouard Debat-Ponsan': 'Q305991',
      'Edouard Debat-Ponsan': 'Q305991', // Without accent
      'Édouard-Marie-Guillaume Dubufe': 'Q17495238',
      'Edouard-Marie-Guillaume Dubufe': 'Q17495238', // Without accent
      'Édouard Dubufe': 'Q17495238', // Shortened name
      'Edouard Dubufe': 'Q17495238', // Shortened name without accent
      'Max Švabinský': 'Q159074',
      'Max Svabinsky': 'Q159074', // Without special character
      'Gustave Doré': 'Q6682',
      'Gustave Dore': 'Q6682', // Without accent
      'Vittorio Reggiani': 'Q21462984',
      'Vittorio Reggianini': 'Q21462984', // Full name
      'Gaston Bussière': 'Q1495565',
      'Gaston Bussiere': 'Q1495565', // Without accent
      'Eugène Delacroix': 'Q33477',
      'Eugene Delacroix': 'Q33477', // Without accent
      'Henri Camille Danger': 'Q15970232',
      'Henri-Camille Danger': 'Q15970232', // With hyphen
      'Caesar Van Everdingen': 'Q455013',
      'Caesar van Everdingen': 'Q455013', // Lowercase "van"
      'Georges-Antoine Rochegrosse': 'Q346846',
      'Georges Antoine Rochegrosse': 'Q346846', // Without hyphen
      'Hughes Taraval': 'Q113660692',
      'Hugues Taraval': 'Q113660692', // With 's' (correct spelling)
      'Jean-Hugues Taraval': 'Q113660692', // Full name
      'Leopold Schutzier': 'Q17456711',
      'Leopold Schmutzler': 'Q17456711', // Correct spelling
      'Edwin Longsden Long': 'Q534366',
      'Edwin Long': 'Q534366', // Shortened name
      'Carlo Maratti': 'Q312990',
      'Carlo Maratta': 'Q312990', // Alternative spelling
      'Tintoretto': 'Q9319',
      'Jacopo Tintoretto': 'Q9319', // Full name
      'Ernst Karl Eugen Koerner': 'Q99761',
      'Ernst Koerner': 'Q99761', // Shortened name
      'François Musin': 'Q1977323',
      'Francois Musin': 'Q1977323', // Without accent
      'Francisco de Goya': 'Q6640',
      'Francisco Goya': 'Q6640', // Without "de"
      'Goya': 'Q6640', // Shortened name
      'Mihály Zichy': 'Q742959',
      'Mihaly Zichy': 'Q742959', // Without accent
      'Paul Émile Chabas': 'Q338995',
      'Paul Emile Chabas': 'Q338995', // Without accent
      'Salvador Dali': 'Q5575',
      'Salvador Dalí': 'Q5575', // With accent
      'Sylvester Shchedrin': 'Q1861382',
      'Briton Riviere': 'Q2470305',
      'Herbert James': 'Q918605', // Herbert James Draper
      'Herbert James Draper': 'Q918605',
      'Alex Alemany': 'Q6172638',
      'Raffaelo Monti': 'Q7282537',
      'Raffaele Monti': 'Q7282537', // Correct spelling
      'Norman Lindsay': 'Q333348',
      'Jean-François Portaels': 'Q919158',
      'Jean Francois Portaels': 'Q919158', // Without accent
      'Gaspard Fossati': 'Q123442',
      'Gaspare Fossati': 'Q123442', // Correct spelling
      'François-Joseph Navez': 'Q647641',
      'Francois-Joseph Navez': 'Q647641', // Without accent
      'Leopold Carl Muller': 'Q640342',
      'Leopold Carl Müller': 'Q640342', // With umlaut
      'François de Nomé': 'Q309350',
      'Francois de Nome': 'Q309350', // Without accent
      'Théodore Gudin': 'Q555885',
      'Theodore Gudin': 'Q555885', // Without accent
      'Louis Icart': 'Q325041',
      'Peder Mørk Mønsted': 'Q448207',
      'Peder Mønsted': 'Q448207', // Without middle name
      'Peder Mork Monsted': 'Q448207', // Without special characters
      'Adolphe Valette': 'Q3237916',
      'Pierre Adolphe Valette': 'Q3237916', // Full name
      'André Castaigne': 'Q476298',
      'Andre Castaigne': 'Q476298', // Without accent
      'Jean-Léon Gérôme': 'Q212499',
      'Jean Leon Gerome': 'Q212499', // Without accents
      'Léon François Comerre': 'Q316527',
      'Leon Francois Comerre': 'Q316527', // Without accents
      'Léon Comerre': 'Q316527', // Shortened name
      'Louis Jean François Lagrenée': 'Q1871782',
      'Louis-Jean-François Lagrenée': 'Q1871782', // With hyphens
      'Louis Jean Francois Lagrenee': 'Q1871782', // Without accents
      'Louis Lagrenée': 'Q1871782', // Shortened name
      'Edmund Leighton': 'Q142420',
      'Edmund Blair Leighton': 'Q142420', // Full name
      'Jacques Raymond Brascassat': 'Q390581',
      'Jacques-Raymond Brascassat': 'Q390581', // With hyphen
    };
    artistQid = knownArtists[options.artist] || null;
  }
  
  if (!artistQid) {
    throw new Error(`Could not find Wikidata QID for artist: ${options.artist}`);
  }
  console.log(`Found artist QID: ${artistQid}`);
  
  // Always use Wikidata for discovery (museum-filtered paintings)
  const items = await fetchWikidataPaintings({ limit, artistQid: `wd:${artistQid}`, paintingsOnly: options.paintingsOnly });
  console.log(`Found ${items.length} paintings from Wikidata, fetching image info...`);
  
  // Fetch image info in batches to avoid rate limiting
  const validItems = items.filter((item) => item.title).slice(0, limit);
  
  const fetchWithMetadata = async (item: { title: string; museum?: string; itemId?: string }) => {
    const info = await fetchImageInfoByTitle(item.title);
    if (!info) return null;
    info.museum = item.museum;
    info.sourceItem = item.itemId;
    return info;
  };

  // Process in smaller batches with delays - simple and reliable
  const imageResults: (WikimediaImage | null)[] = [];
  const BATCH_SIZE = 3;
  const DELAY_MS = 1000; // 1 second between batches
  
  for (let i = 0; i < validItems.length; i += BATCH_SIZE) {
    const batch = validItems.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(batch.map(fetchWithMetadata));
    
    batchResults.forEach((result) => {
      if (result.status === 'fulfilled') {
        imageResults.push(result.value);
      } else {
        console.warn(`Failed to fetch: ${result.reason?.message || 'Unknown error'}`);
        imageResults.push(null);
      }
    });
    
    // Delay between batches (except after the last one)
    if (i + BATCH_SIZE < validItems.length) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      if ((i / BATCH_SIZE) % 20 === 0 && i > 0) {
        console.log(`Fetched info for ${Math.min(i + BATCH_SIZE, validItems.length)}/${validItems.length} items...`);
      }
    }
  }

  const images = imageResults.filter((img): img is WikimediaImage => img !== null);
  console.log(`Fetched info for ${images.length} images, processing...`);
  
  const artistId = await ensureArtist(options.artist);

  let uploaded = 0;
  let skipped = 0;
  const errors: FetchResult['errors'] = [];
  let processed = 0;

  // Process images in parallel batches
  const processImage = async (image: WikimediaImage): Promise<void> => {
    let reservedSlot = false;
    try {
      // Early exit if we've hit the upload limit (check before any processing)
      if (options.maxUploads && uploaded >= options.maxUploads) {
        processed += 1;
        return;
      }

      // When paintingsOnly is set, we already filtered at Wikidata level (P31 wd:Q3305213)
      // So we can skip the Commons category check - trust Wikidata's classification
      // Only apply the filter if NOT using paintingsOnly (for backward compatibility)
      if (!options.paintingsOnly && !isLikelyColorPainting(image)) {
        skipped += 1;
        processed += 1;
        if (processed % 10 === 0) {
          console.log(`Progress: ${processed}/${images.length} processed, ${uploaded} uploaded, ${skipped} skipped`);
        }
        return;
      }

      const variant = pickBestVariant(image);
      if (!variant) {
        skipped += 1;
        processed += 1;
        if (processed % 10 === 0) {
          console.log(`Progress: ${processed}/${images.length} processed, ${uploaded} uploaded, ${skipped} skipped`);
        }
        return;
      }

      // Reserve upload slot immediately (before any async work) to prevent race condition
      if (options.maxUploads) {
        const currentCount = uploaded;
        if (currentCount >= options.maxUploads) {
          processed += 1;
          return;
        }
        uploaded += 1; // Reserve the slot immediately
        reservedSlot = true;
        // If we went over (another process also incremented), release and skip
        if (uploaded > options.maxUploads) {
          uploaded -= 1;
          reservedSlot = false;
          processed += 1;
          return;
        }
      }

      const downloaded = await downloadImage(variant);
      const path = buildStoragePath(options.artist, image, downloaded.ext);

      if (!options.dryRun) {
        const upload = await uploadToStorage(path, downloaded);
        // Clean the title before storing
        const rawTitle = normalizeTitle(image.title);
        const cleanedTitle = cleanTitle(rawTitle);
        const artId = await upsertArt({
          title: cleanedTitle,
          description: image.description ?? null,
          imageUrl: upload.publicUrl,
          artistId,
        });

        // Always use Wikidata tags (genre, movement, inception date, artwork type)
        let normalizedTags: string[];
        if (image.sourceItem) {
          const wikidataTags = await fetchWikidataItemTags(image.sourceItem);
          // If no artwork type detected but we have a sourceItem, default to "painting"
          // (since current queries filter for paintings only; when we expand to sculptures, this will be detected)
          if (!wikidataTags.artworkType) {
            wikidataTags.artworkType = 'painting';
          }
          normalizedTags = normalizeWikidataTags(wikidataTags, image.museum);
        } else {
          // Fallback: if no sourceItem, use Commons categories (shouldn't happen with Wikidata source)
          // Default to "painting" for existing artworks
          const fallbackTags = normalizeTags(image.categories, image.museum);
          normalizedTags = ['painting', ...fallbackTags];
        }

        const tagIds = await upsertTags(normalizedTags).then((rows) => rows.map((r) => r.id));
        await linkArtTags(artId, tagIds);
        await upsertArtSource({
          artId,
          source: 'wikidata',
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
        // Slot was already reserved above, so uploaded counter is correct
      } else {
        // In dry-run mode, release the reserved slot since we didn't actually upload
        if (reservedSlot) {
          uploaded -= 1;
          reservedSlot = false;
        }
      }
      processed += 1;
      if (processed % 10 === 0 || processed === images.length) {
        console.log(`Progress: ${processed}/${images.length} processed, ${uploaded} uploaded, ${skipped} skipped`);
      }
    } catch (err) {
      // If we reserved a slot but failed, release it
      if (reservedSlot) {
        uploaded -= 1;
      }
      const errorMessage = (err as Error).message;
      errors.push({ title: image.title, message: errorMessage });
      
      // Save failure for later retry (only for download/upload errors, not skipped items)
      if (errorMessage.includes('Failed to download') || errorMessage.includes('Failed to insert') || errorMessage.includes('429') || errorMessage.includes('503')) {
        await saveFailure({
          artist: options.artist,
          title: image.title,
          imageUrl: image.original?.url || image.thumb?.url,
          error: errorMessage,
          timestamp: new Date().toISOString(),
          retryCount: 0,
        });
      }
      
      processed += 1;
    }
  };

  await processInParallel(images, processImage, CONCURRENCY);

  return {
    attempted: images.length,
    uploaded,
    skipped,
    errors,
  };
}

export function buildStoragePath(artist: string, image: WikimediaImage, ext: string): string {
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

export function normalizeTitle(title: string): string {
  return title.replace(/^File:/i, '').trim();
}

/**
 * Clean up artwork titles by removing filename artifacts
 * This is the same logic as cli-clean-titles.ts
 */
export function cleanTitle(title: string): string {
  let cleaned = title;
  
  // Remove "File:" prefix
  cleaned = cleaned.replace(/^File:\s*/i, '');
  
  // Remove file extensions
  cleaned = cleaned.replace(/\.(jpg|jpeg|png|gif|tiff|tif|webp|svg)$/i, '');
  
  // Remove common museum codes and identifiers
  cleaned = cleaned.replace(/\s*-\s*(s\d+[VvMmAa]\d+|Google Art Project|Art Project)/gi, '');
  cleaned = cleaned.replace(/\s*-\s*\d{4}\.\d+\s*-\s*[^-]+$/i, ''); // Museum accession numbers
  cleaned = cleaned.replace(/\s*\(\d{4}\)\s*$/i, ''); // Years in parentheses at end
  
  // Remove artist name if it appears at the start (common pattern)
  cleaned = cleaned.replace(/^(Vincent\s+van\s+Gogh|Van\s+Gogh|Rembrandt|Peter\s+Paul\s+Rubens|John\s+Singer\s+Sargent)[\s\-:]+/i, '');
  
  // Clean up multiple spaces/hyphens
  cleaned = cleaned.replace(/\s+/g, ' ');
  cleaned = cleaned.replace(/\s*-\s*/g, ' - ');
  cleaned = cleaned.replace(/^\s+|\s+$/g, '');
  
  // Capitalize first letter
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  
  return cleaned;
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

export function normalizeWikidataTags(
  tags: { genre?: string; movement?: string; inceptionDate?: string; artworkType?: string },
  museum?: string,
): string[] {
  const result: string[] = [];

  // Add artwork type first (painting or sculpture)
  if (tags.artworkType) {
    result.push(tags.artworkType.toLowerCase().trim());
  }

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


