import { config, supabase } from '../config';

/**
 * Merge misnamed Goya assets:
 * - Move storage objects from `goya/` → `franciso-de-goya/`
 * - Update art_assets.storage_path/public_url
 * - Update arts.image_url pointing at old paths
 * - Reassign any Goya artist records to the canonical artist (franciso-de-goya)
 *
 * Run with: npm run merge-goya
 * Set DRY_RUN=1 to preview without writes.
 */
const OLD_PREFIX = 'goya/';
const NEW_PREFIX = 'franciso-de-goya/';
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

type ArtistRow = { id: string; name: string };
type ArtAssetRow = { id: string; art_id: string; storage_path: string; public_url: string | null };
type ArtRow = { id: string; image_url: string | null; artist_id: string };

async function findCanonicalArtist(): Promise<ArtistRow> {
  const { data, error } = await supabase.from('artists').select('id,name');
  if (error) throw new Error(`Failed to load artists: ${error.message}`);

  const rows = data ?? [];
  // Prefer explicit misspelled canonical, then the correct spelling.
  const canonical =
    rows.find((a) => a.name.toLowerCase().includes('franciso de goya')) ??
    rows.find((a) => a.name.toLowerCase().includes('francisco de goya'));
  if (!canonical) {
    throw new Error('Could not find canonical artist row for Franciso/Francisco de Goya');
  }
  return canonical;
}

async function moveStorageObject(oldPath: string, newPath: string): Promise<void> {
  if (DRY_RUN) {
    console.log(`[DRY] move ${oldPath} -> ${newPath}`);
    return;
  }
  const { error } = await supabase.storage.from(config.supabaseBucket).move(oldPath, newPath);
  if (error) {
    throw new Error(`Failed to move ${oldPath} -> ${newPath}: ${error.message}`);
  }
}

async function updateArtAsset(asset: ArtAssetRow, newPath: string): Promise<void> {
  const { data: publicUrlData } = supabase.storage.from(config.supabaseBucket).getPublicUrl(newPath);
  const newPublicUrl = publicUrlData.publicUrl;

  if (DRY_RUN) {
    console.log(`[DRY] update art_assets ${asset.id}: storage_path=${newPath}, public_url=${newPublicUrl}`);
    return;
  }

  const { error } = await supabase
    .from('art_assets')
    .update({ storage_path: newPath, public_url: newPublicUrl })
    .eq('id', asset.id);
  if (error) {
    throw new Error(`Failed to update art_assets ${asset.id}: ${error.message}`);
  }
}

async function reassignArtists(canonical: ArtistRow): Promise<void> {
  const { data, error } = await supabase.from('artists').select('id,name');
  if (error) throw new Error(`Failed to reload artists: ${error.message}`);
  const rows = (data ?? []) as ArtistRow[];
  const others = rows.filter((a) => a.id !== canonical.id && /goya/i.test(a.name));
  if (!others.length) return;

  const otherIds = others.map((a) => a.id);
  console.log(`Reassigning ${otherIds.length} artist id(s) to canonical ${canonical.id}`);

  if (DRY_RUN) {
    console.log(`[DRY] would update arts set artist_id=${canonical.id} where artist_id in [${otherIds.join(', ')}]`);
    return;
  }

  const { error: updErr } = await supabase.from('arts').update({ artist_id: canonical.id }).in('artist_id', otherIds);
  if (updErr) {
    throw new Error(`Failed to reassign arts to canonical artist: ${updErr.message}`);
  }

  // After reassignment, delete stray artist rows if they are now unused
  const { data: remaining, error: remErr } = await supabase
    .from('arts')
    .select('artist_id', { count: 'exact', head: true })
    .in('artist_id', otherIds);
  if (remErr) throw new Error(`Failed to check remaining arts for stray artists: ${remErr.message}`);
  const hasRemaining = (remaining as any)?.length || 0; // head:true returns empty array; count provided separately
  const totalRemaining = (remaining as any)?.count ?? 0;

  if (totalRemaining > 0 || hasRemaining > 0) {
    console.log(`Skipped deleting stray artist rows; ${totalRemaining || hasRemaining} art(s) still reference them.`);
    return;
  }

  if (DRY_RUN) {
    console.log(`[DRY] would delete artists with ids: [${otherIds.join(', ')}]`);
    return;
  }

  const { error: delErr } = await supabase.from('artists').delete().in('id', otherIds);
  if (delErr) throw new Error(`Failed to delete stray artist rows: ${delErr.message}`);
  console.log(`Deleted stray artist row(s): [${otherIds.join(', ')}]`);
}

async function updateArtImageUrls(artIds: string[]): Promise<void> {
  if (!artIds.length) return;

  const { data, error } = await supabase
    .from('arts')
    .select('id,image_url')
    .in('id', artIds);
  if (error) throw new Error(`Failed to load arts for image_url update: ${error.message}`);

  const rows = (data ?? []) as ArtRow[];
  for (const row of rows) {
    if (!row.image_url || !row.image_url.includes(`/${OLD_PREFIX}`)) continue;
    const newUrl = row.image_url.replace(`/${OLD_PREFIX}`, `/${NEW_PREFIX}`);
    if (DRY_RUN) {
      console.log(`[DRY] update arts ${row.id}: image_url=${newUrl}`);
      continue;
    }
    const { error: updErr } = await supabase.from('arts').update({ image_url: newUrl }).eq('id', row.id);
    if (updErr) throw new Error(`Failed to update arts ${row.id}: ${updErr.message}`);
  }
}

async function moveAssets(): Promise<void> {
  const { data, error } = await supabase
    .from('art_assets')
    .select('id,art_id,storage_path,public_url')
    .ilike('storage_path', `${OLD_PREFIX}%`);
  if (error) throw new Error(`Failed to load art_assets: ${error.message}`);

  const assets = (data ?? []) as ArtAssetRow[];
  if (!assets.length) {
    console.log(`No art_assets found under prefix ${OLD_PREFIX}`);
    return;
  }

  console.log(`Found ${assets.length} art_assets under ${OLD_PREFIX}`);
  const artIds = new Set<string>();

  for (const asset of assets) {
    const newPath = asset.storage_path.replace(OLD_PREFIX, NEW_PREFIX);
    await moveStorageObject(asset.storage_path, newPath);
    await updateArtAsset(asset, newPath);
    artIds.add(asset.art_id);
  }

  await updateArtImageUrls(Array.from(artIds));
}

async function removeOldFolder(): Promise<void> {
  if (DRY_RUN) {
    console.log(`[DRY] remove folder prefix ${OLD_PREFIX}`);
    return;
  }
  const { error } = await supabase.storage.from(config.supabaseBucket).remove([OLD_PREFIX]);
  if (error) {
    throw new Error(`Failed to remove old folder prefix ${OLD_PREFIX}: ${error.message}`);
  }
  console.log(`Removed old folder prefix ${OLD_PREFIX}`);
}

async function main() {
  console.log(`Starting merge: ${OLD_PREFIX} -> ${NEW_PREFIX} (bucket=${config.supabaseBucket})`);
  if (DRY_RUN) console.log('DRY_RUN enabled – no changes will be written.');

  const canonical = await findCanonicalArtist();
  console.log(`Canonical artist: ${canonical.name} (${canonical.id})`);

  await reassignArtists(canonical);
  await moveAssets();
  await removeOldFolder();

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

