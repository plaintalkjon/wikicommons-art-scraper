import { supabase } from './supabaseClient';

/**
 * Normalize artist name for consistent storage
 * Removes parenthetical notes, normalizes whitespace
 */
function normalizeArtistName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ' ')           // Multiple spaces to single
    .replace(/\([^)]*\)/g, '')      // Remove parenthetical notes
    .trim();
}

export async function ensureArtist(name: string): Promise<string> {
  // Normalize the name first
  const normalized = normalizeArtistName(name);
  
  // Try to get existing first
  const existing = await supabase
    .from('artists')
    .select('id')
    .eq('name', normalized)
    .maybeSingle();
  
  if (existing.error && existing.error.code !== 'PGRST116') {
    throw new Error(`Failed to lookup artist: ${existing.error.message}`);
  }
  
  if (existing.data?.id) {
    return existing.data.id;
  }

  // Use upsert to handle race conditions (if another process inserts between check and insert)
  // Note: Supabase doesn't support ON CONFLICT directly, so we'll use a try-catch approach
  const inserted = await supabase
    .from('artists')
    .insert({ name: normalized })
    .select('id')
    .single();
  
  if (inserted.error) {
    // If duplicate key error, try to fetch the existing artist
    if (inserted.error.code === '23505' || inserted.error.message.includes('duplicate key')) {
      const retry = await supabase
        .from('artists')
        .select('id')
        .eq('name', normalized)
        .single();
      
      if (retry.data?.id) {
        return retry.data.id;
      }
    }
    throw new Error(`Failed to insert artist: ${inserted.error.message}`);
  }
  
  if (!inserted.data?.id) {
    throw new Error(`Failed to insert artist: unknown error`);
  }
  
  return inserted.data.id;
}

export async function upsertArt(payload: {
  title: string;
  description?: string | null;
  imageUrl: string;
  artistId: string;
}): Promise<string> {
  // Since there's no unique constraint on title+artist, check first.
  const existing = await supabase
    .from('arts')
    .select('id')
    .eq('title', payload.title)
    .eq('artist_id', payload.artistId)
    .maybeSingle();
  if (existing.error && existing.error.code !== 'PGRST116') {
    throw new Error(`Failed to lookup art: ${existing.error.message}`);
  }
  if (existing.data?.id) {
    return existing.data.id;
  }

  const inserted = await supabase
    .from('arts')
    .insert({
      title: payload.title,
      description: payload.description ?? null,
      image_url: payload.imageUrl,
      artist_id: payload.artistId,
    })
    .select('id')
    .single();
  if (inserted.error || !inserted.data?.id) {
    throw new Error(`Failed to insert art: ${inserted.error?.message ?? 'unknown error'}`);
  }
  return inserted.data.id;
}

export async function upsertTags(tagNames: string[]): Promise<Array<{ id: string; name: string }>> {
  const unique = Array.from(new Set(tagNames.map((t) => t.trim()).filter(Boolean)));
  if (!unique.length) return [];
  const result = await supabase
    .from('tags')
    .upsert(unique.map((name) => ({ name })), { onConflict: 'name' })
    .select('id,name');
  if (result.error) {
    throw new Error(`Failed to upsert tags: ${result.error.message}`);
  }
  return result.data ?? [];
}

export async function linkArtTags(artId: string, tagIds: string[]): Promise<void> {
  if (!tagIds.length) return;
  const rows = tagIds.map((tagId) => ({ art_id: artId, tag_id: tagId }));
  const result = await supabase.from('art_tags').upsert(rows, { onConflict: 'art_id,tag_id' });
  if (result.error) {
    throw new Error(`Failed to link art tags: ${result.error.message}`);
  }
}

/**
 * Find existing artwork by Wikidata QID
 * Returns the art ID if found, null otherwise
 * 
 * Requires: art_sources table must have a wikidata_qid column (text/nullable)
 */
export async function findArtByWikidataQID(wikidataQID: string, artistId: string): Promise<string | null> {
  // Query art_sources for artworks with this Wikidata QID
  const sourcesResult = await supabase
    .from('art_sources')
    .select('art_id')
    .eq('wikidata_qid', wikidataQID)
    .limit(10); // Get multiple in case there are duplicates
  
  if (sourcesResult.error && sourcesResult.error.code !== 'PGRST116') {
    throw new Error(`Failed to lookup art by Wikidata QID: ${sourcesResult.error.message}`);
  }
  
  if (!sourcesResult.data || sourcesResult.data.length === 0) {
    return null;
  }
  
  // Get unique art IDs
  const artIds = Array.from(new Set(sourcesResult.data.map((s: any) => s.art_id).filter(Boolean)));
  
  if (artIds.length === 0) {
    return null;
  }
  
  // Check which art belongs to this artist
  const artsResult = await supabase
    .from('arts')
    .select('id')
    .eq('artist_id', artistId)
    .in('id', artIds)
    .limit(1)
    .maybeSingle();
  
  if (artsResult.error && artsResult.error.code !== 'PGRST116') {
    throw new Error(`Failed to lookup art by Wikidata QID: ${artsResult.error.message}`);
  }
  
  return artsResult.data?.id ?? null;
}

export async function upsertArtSource(payload: {
  artId: string;
  source: string;
  sourcePageId?: number;
  sourceTitle?: string;
  sourceUrl?: string;
  wikidataQID?: string;
}): Promise<void> {
  // Store Wikidata QID in dedicated wikidata_qid column
  // Requires: art_sources table must have a wikidata_qid column (text/nullable)
  const result = await supabase
    .from('art_sources')
    .upsert(
      {
        art_id: payload.artId,
        source: payload.source,
        source_pageid: payload.sourcePageId ?? null,
        source_title: payload.sourceTitle ?? null,
        source_url: payload.sourceUrl ?? null,
        wikidata_qid: payload.wikidataQID ?? null,
      },
      { onConflict: 'source,source_pageid' },
    );
  if (result.error) {
    throw new Error(`Failed to upsert art source: ${result.error.message}`);
  }
}

export async function insertArtAsset(payload: {
  artId: string;
  storagePath: string;
  publicUrl: string;
  width?: number;
  height?: number;
  fileSize?: number;
  mimeType?: string;
  sha256?: string;
}): Promise<void> {
  const result = await supabase.from('art_assets').upsert(
    {
      art_id: payload.artId,
      storage_path: payload.storagePath,
      public_url: payload.publicUrl,
      width: payload.width ?? null,
      height: payload.height ?? null,
      file_size: payload.fileSize ?? null,
      mime_type: payload.mimeType ?? null,
      sha256: payload.sha256 ?? null,
    },
    { onConflict: 'art_id,storage_path' },
  );
  if (result.error) {
    throw new Error(`Failed to upsert art asset: ${result.error.message}`);
  }
}

