#!/usr/bin/env node
/**
 * Art Institute of Chicago importer (isolated from main pipeline).
 * - Searches public domain artworks with images
 * - Downloads IIIF at up to 2000px
 * - Uploads to Supabase using existing db helpers (source='artic')
 *
 * Usage:
 *   npm run artic-import -- --q "cats" --limit 10 --page 1 [--dry-run]
 */

import { parseArgs } from './utils';
import { searchArtic, buildIiifUrl, extractTags, ArticRecord } from './artic';
import { downloadImage } from './downloader';
import { ensureArtist, upsertArt, upsertArtSource, insertArtAsset, upsertTags, linkArtTags } from './db';
import { cleanTitle, normalizeTitle, buildStoragePath } from './artUtils';
import { supabase } from './config';
import { rateLimiter } from './rateLimiter';

async function main() {
  const args = parseArgs();
  const q = args.q === true || args.q === undefined ? '' : (args.q as string);
  const limit = args.limit ? parseInt(args.limit as string, 10) : 10;
  const page = args.page ? parseInt(args.page as string, 10) : 1;
  const dryRun = Boolean(args['dry-run'] ?? args.dryRun);
  const storageArtistOverride = (args['storage-artist'] as string) || undefined;
  const departments = args.departments
    ? String(args.departments)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
  const classifications = args.classifications
    ? String(args.classifications)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
  const publicDomainOnly = !(args['include-non-public'] || args.includeNonPublic);

  console.log(
    `AIC import: q="${q}", page=${page}, limit=${limit}, dryRun=${dryRun}, ${publicDomainOnly ? 'public domain only' : 'all rights'}` +
      `${departments ? ` departments=${departments.join('|')}` : ''}` +
      `${classifications ? ` classifications=${classifications.join('|')}` : ''}`,
  );
  const records: any[] = [];
  let currentPage = page;
  const perPage = Math.min(limit, 100); // cap per-page to keep responses manageable
  while (records.length < limit) {
    const batchLimit = Math.min(perPage, limit - records.length);
    const batch = await searchArtic({
      q,
      limit: batchLimit,
      page: currentPage,
      departments,
      classifications,
      publicDomainOnly,
    });
    if (!batch.length) break;
    records.push(...batch);
    if (batch.length < batchLimit) break; // no more pages
    currentPage += 1;
  }
  console.log(`Fetched ${records.length} records`);

  const artistCache = new Map<string, string>();
  const getArtistId = async (name: string) => {
    if (artistCache.has(name)) return artistCache.get(name)!;
    const id = await ensureArtist(name);
    artistCache.set(name, id);
    return id;
  };

  let uploaded = 0;
  let skipped = 0;
  let errors = 0;

  for (const rec of records) {
    const title = cleanTitle(normalizeTitle(rec.title ?? `Artic ${rec.id}`), rec.artist_title ?? 'Unknown artist');
    const artistName = rec.artist_title ?? 'Unknown artist';
    const artistId = await getArtistId(artistName);

    // Dedup by source pageid
    const existing = await supabase
      .from('art_sources')
      .select('id')
      .eq('source', 'artic')
      .eq('source_pageid', rec.id)
      .maybeSingle();
    if (existing.data?.id) {
      console.log(`Skip existing AIC id=${rec.id}`);
      skipped++;
      continue;
    }

    if (!rec.image_id) {
      console.log(`No image for id=${rec.id}, skipping`);
      skipped++;
      continue;
    }

    const iiifUrl = buildIiifUrl(rec.image_id, 2000);
    try {
      await rateLimiter.waitIfNeeded();
      const downloaded = await downloadImage({
        url: iiifUrl,
        width: 2000,
        height: 2000,
        mime: 'image/jpeg',
      });

      // Size checks: require at least 1280px on one side and 1800px on one side
      if (downloaded.width < 1280 && downloaded.height < 1280) {
        console.log(`Too small (${downloaded.width}x${downloaded.height}) id=${rec.id}, skipping`);
        skipped++;
        continue;
      }
      if (downloaded.width < 1800 && downloaded.height < 1800) {
        console.log(`Original below 1800px id=${rec.id}, skipping`);
        skipped++;
        continue;
      }

      if (dryRun) {
        console.log(`[DRY RUN] Would upload AIC id=${rec.id} "${title}"`);
        skipped++;
        continue;
      }

      const storageArtist = storageArtistOverride || artistName;
      const storagePath = buildStoragePath(storageArtist, { title, pageid: rec.id } as any, downloaded.ext);
      const { uploadToStorage } = await import('./db');
      const upload = await uploadToStorage(storagePath, downloaded);

      const artId = await upsertArt({
        title,
        description: rec.date_display ?? null,
        imageUrl: upload.publicUrl,
        artistId,
      });

      await upsertArtSource({
        artId,
        source: 'artic',
        sourcePageId: rec.id,
        sourceTitle: rec.title ?? undefined,
        sourceUrl: rec.web_url ?? `https://www.artic.edu/artworks/${rec.id}`,
        wikidataQID: undefined,
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

      const tags = extractTags(rec);
      if (tags.length) {
        const tagIds = await upsertTags(tags).then((rows) => rows.map((r) => r.id));
        await linkArtTags(artId, tagIds);
      }

      uploaded++;
      console.log(`Uploaded AIC id=${rec.id} "${title}"`);
    } catch (err) {
      console.log(`Failed AIC id=${rec.id}: ${(err as Error).message}`);
      errors++;
    }
  }

  console.log(`Done. uploaded=${uploaded}, skipped=${skipped}, errors=${errors}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

