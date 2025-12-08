import { supabase } from './supabaseClient';

async function getArtistId(name: string): Promise<string | null> {
  const res = await supabase.from('artists').select('id').eq('name', name).maybeSingle();
  if (res.error && res.error.code !== 'PGRST116') {
    throw new Error(`Failed to lookup artist: ${res.error.message}`);
  }
  return res.data?.id ?? null;
}

export async function findArtIdsByTitleAndArtist(title: string, artist: string, fuzzy = false): Promise<string[]> {
  const artistId = await getArtistId(artist);
  if (!artistId) return [];

  const query = supabase.from('arts').select('id').eq('artist_id', artistId);
  const res = fuzzy ? await query.ilike('title', `%${title}%`) : await query.eq('title', title);
  if (res.error) {
    throw new Error(`Failed to lookup arts: ${res.error.message}`);
  }
  return res.data?.map((row) => row.id) ?? [];
}

export async function deleteArtByIds(ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  await supabase.from('art_tags').delete().in('art_id', ids);
  await supabase.from('art_assets').delete().in('art_id', ids);
  await supabase.from('art_sources').delete().in('art_id', ids);
  await supabase.from('arts').delete().in('id', ids);
  return ids.length;
}

