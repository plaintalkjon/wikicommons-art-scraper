#!/usr/bin/env node
/**
 * Delete NGA-uploaded artworks by providing a list of filenames/storage paths.
 * Usage:
 *   npm run delete-artworks -- --file /path/to/list.txt [--force] [--source nga]
 * Notes:
 *   - The list file should contain one filename or storage path per line.
 *   - Default mode is dry-run; pass --force to actually delete.
 *   - Matches only arts whose source matches --source (defaults to 'nga').
 */

import { promises as fs } from 'fs';
import path from 'path';
import { supabase, config } from './config';
import { parseArgs } from './utils';

type ArtAsset = { art_id: string; storage_path: string; public_url?: string };
type ArtSource = { art_id: string; source: string; source_title?: string };
type Art = { id: string; title: string; artist_id: string };

function chunk<T>(arr: T[], size: number): T[][] {
  const res: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    res.push(arr.slice(i, i + size));
  }
  return res;
}

function normalizeLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  return trimmed;
}

function normalizeFilename(value: string): { raw: string; basename: string; full: string | null } {
  const raw = value.trim();
  const base = path.basename(raw);
  // Treat entries with a slash as full storage paths; otherwise, only filename is provided.
  const full = raw.includes('/') ? raw : null;
  return { raw, basename: base, full };
}

async function loadList(filePath: string): Promise<Array<{ raw: string; basename: string; full: string | null }>> {
  const content = await fs.readFile(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const normalized = lines.map(normalizeLine).filter((v): v is string => Boolean(v));
  return normalized.map(normalizeFilename);
}

async function fetchAssetsByExact(paths: string[]): Promise<ArtAsset[]> {
  const results: ArtAsset[] = [];
  for (const group of chunk(paths, 200)) {
    const { data, error } = await supabase
      .from('art_assets')
      .select('art_id,storage_path,public_url')
      .in('storage_path', group);
    if (error) throw new Error(`Failed to fetch art_assets (exact): ${error.message}`);
    if (data) results.push(...data);
  }
  return results;
}

async function main() {
  const args = parseArgs();
  const listPath = (args.file || args.f) as string | undefined;
  const force = Boolean(args.force);
  const sourceArg = ((args.source as string) || 'nga').toLowerCase();
  const sourceAll = sourceArg === 'all';
  const source = sourceAll ? null : sourceArg;

  if (!listPath) {
    console.error('Missing required --file argument (path to list of filenames).');
    process.exit(1);
  }

  const entries = await loadList(listPath);
  if (!entries.length) {
    console.log('No filenames found in list; nothing to do.');
    return;
  }

  const exactPaths = Array.from(new Set(entries.map((e) => e.full).filter(Boolean) as string[]));
  const missingPaths = entries.filter((e) => !e.full).map((e) => e.raw);

  console.log(`Loaded ${entries.length} entries from ${listPath}`);
  if (exactPaths.length) console.log(`  Exact paths: ${exactPaths.length}`);
  if (missingPaths.length) {
    console.log(
      `  Skipped ${missingPaths.length} entries without a folder prefix (requires full storage path with '/'): ${missingPaths.join(
        ', ',
      )}`,
    );
  }

  const assetMatches: ArtAsset[] = [];
  if (exactPaths.length) {
    assetMatches.push(...(await fetchAssetsByExact(exactPaths)));
  }

  // Deduplicate by art_id + storage_path
  const assetMap = new Map<string, ArtAsset>();
  for (const a of assetMatches) {
    assetMap.set(`${a.art_id}:${a.storage_path}`, a);
  }
  const assets = Array.from(assetMap.values());

  if (!assets.length) {
    console.log('No matching art_assets found for provided filenames.');
    return;
  }

  const artIds = Array.from(new Set(assets.map((a) => a.art_id)));

  const { data: sources, error: srcErr } = await supabase
    .from('art_sources')
    .select('art_id,source,source_title')
    .in('art_id', artIds);
  if (srcErr) throw new Error(`Failed to fetch art_sources: ${srcErr.message}`);

  const { data: artsAll, error: artsErrAll } = await supabase
    .from('arts')
    .select('id,title,artist_id')
    .in('id', artIds);
  if (artsErrAll) throw new Error(`Failed to fetch arts: ${artsErrAll.message}`);

  // Helpful listing of all matches (any source) for discovery
  console.log('\nMatches found (all sources):');
  const byArtId = new Map<string, Art>();
  (artsAll ?? []).forEach((a) => byArtId.set(a.id, a as Art));
  const byArtSources = new Map<string, ArtSource[]>();
  (sources ?? []).forEach((s) => {
    const arr = byArtSources.get(s.art_id) ?? [];
    arr.push(s as ArtSource);
    byArtSources.set(s.art_id, arr);
  });
  assets.forEach((asset) => {
    const art = byArtId.get(asset.art_id);
    const srcs = byArtSources.get(asset.art_id) ?? [];
    const srcDesc = srcs.length
      ? srcs.map((s) => `${s.source}${s.source_title ? ` (${s.source_title})` : ''}`).join('; ')
      : 'unknown';
    console.log(`  - art_id=${asset.art_id} storage_path=${asset.storage_path} sources=[${srcDesc}] title=${art?.title ?? 'unknown'}`);
  });

  const sourceFilteredIds = sourceAll
    ? artIds
    : (sources?.filter((s) => s.source === source).map((s) => s.art_id) ?? []);

  const finalArtIds = artIds.filter((id) => sourceFilteredIds.includes(id));

  if (!finalArtIds.length) {
    console.log(sourceAll ? 'No artworks to delete.' : `No artworks matched the specified source (${source}).`);
    return;
  }

  const arts = (artsAll ?? []).filter((a) => finalArtIds.includes(a.id));

  // Filter assets to those arts after source filter
  const finalAssets = assets.filter((a) => finalArtIds.includes(a.art_id));
  const storagePaths = Array.from(new Set(finalAssets.map((a) => a.storage_path)));

  console.log('\nCandidates for deletion:');
  console.log(`  Arts: ${finalArtIds.length}`);
  console.log(`  Art assets: ${finalAssets.length}`);
  console.log(`  Storage objects: ${storagePaths.length}`);
  console.log('  Titles:');
  arts.forEach((art) => {
    console.log(`    - ${art.title} (id=${art.id})`);
  });

  if (!force) {
    console.log('\nDry run complete. No data deleted.');
    console.log('Re-run with --force to perform deletion.');
    return;
  }

  // Delete DB rows in dependency order: assets -> art_tags -> art_sources -> arts
  for (const group of chunk(finalArtIds, 200)) {
    const { error } = await supabase.from('art_assets').delete().in('art_id', group);
    if (error) throw new Error(`Failed to delete art_assets: ${error.message}`);
  }

  for (const group of chunk(finalArtIds, 200)) {
    const { error } = await supabase.from('art_tags').delete().in('art_id', group);
    if (error) throw new Error(`Failed to delete art_tags: ${error.message}`);
  }

  for (const group of chunk(finalArtIds, 200)) {
    const { error } = await supabase.from('art_sources').delete().in('art_id', group);
    if (error) throw new Error(`Failed to delete art_sources: ${error.message}`);
  }

  for (const group of chunk(finalArtIds, 200)) {
    const { error } = await supabase.from('arts').delete().in('id', group);
    if (error) throw new Error(`Failed to delete arts: ${error.message}`);
  }

  // Delete storage objects (chunked)
  for (const group of chunk(storagePaths, 100)) {
    const { error } = await supabase.storage.from(config.supabaseBucket).remove(group);
    if (error) throw new Error(`Failed to delete storage objects: ${error.message}`);
  }

  console.log('\nDeletion complete.');
  console.log(`  Deleted arts: ${finalArtIds.length}`);
  console.log(`  Deleted art_assets: ${finalAssets.length}`);
  console.log(`  Deleted storage objects: ${storagePaths.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


