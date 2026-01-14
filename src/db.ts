import { supabase } from './config';

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
    throw new Error(`Failed to lookup art: ${artsResult.error.message}`);
  }
  
  return artsResult.data?.id ?? null;
}

/**
 * Batch check multiple artworks by Wikidata QIDs
 * Returns a Map of QID -> art_id for existing artworks
 * Much more efficient than checking individually
 */
export async function findArtsByWikidataQIDsBatch(
  wikidataQIDs: string[],
  artistId: string
): Promise<Map<string, string>> {
  if (wikidataQIDs.length === 0) return new Map();
  
  // Query art_sources for all QIDs at once
  const sourcesResult = await supabase
    .from('art_sources')
    .select('art_id, wikidata_qid')
    .in('wikidata_qid', wikidataQIDs);
  
  if (sourcesResult.error && sourcesResult.error.code !== 'PGRST116') {
    throw new Error(`Failed to batch lookup arts by Wikidata QIDs: ${sourcesResult.error.message}`);
  }
  
  if (!sourcesResult.data || sourcesResult.data.length === 0) {
    return new Map();
  }
  
  // Get unique art IDs
  const artIds = Array.from(new Set(sourcesResult.data.map((s: any) => s.art_id).filter(Boolean)));
  
  if (artIds.length === 0) {
    return new Map();
  }
  
  // Check which arts belong to this artist
  const artsResult = await supabase
    .from('arts')
    .select('id')
    .eq('artist_id', artistId)
    .in('id', artIds);
  
  if (artsResult.error) {
    throw new Error(`Failed to batch lookup arts: ${artsResult.error.message}`);
  }
  
  const validArtIds = new Set((artsResult.data ?? []).map((a: any) => a.id));
  
  // Build QID -> art_id map
  const qidMap = new Map<string, string>();
  for (const source of sourcesResult.data) {
    if (source.wikidata_qid && source.art_id && validArtIds.has(source.art_id)) {
      qidMap.set(source.wikidata_qid, source.art_id);
    }
  }
  
  return qidMap;
}

/**
 * Get Wikidata QID for an artist from existing artworks in the database
 * Returns the most common QID found, or null if none exists
 * This allows us to skip Wikidata lookup if we already have artworks for this artist
 */
export async function getArtistQIDFromDatabase(artistId: string): Promise<string | null> {
  // First get all artworks for this artist
  const { data: arts, error: artsError } = await supabase
    .from('arts')
    .select('id')
    .eq('artist_id', artistId)
    .limit(100);
  
  if (artsError || !arts || arts.length === 0) {
    return null;
  }
  
  const artIds = arts.map(a => a.id);
  
  // Get all art_sources with Wikidata QIDs for these artworks
  const { data: sources, error: sourcesError } = await supabase
    .from('art_sources')
    .select('wikidata_qid')
    .not('wikidata_qid', 'is', null)
    .in('art_id', artIds)
    .limit(100);
  
  if (sourcesError || !sources || sources.length === 0) {
    return null;
  }
  
  // Find most common QID
  const qidCounts = new Map<string, number>();
  sources.forEach(s => {
    if (s.wikidata_qid) {
      qidCounts.set(s.wikidata_qid, (qidCounts.get(s.wikidata_qid) || 0) + 1);
    }
  });
  
  if (qidCounts.size === 0) {
    return null;
  }
  
  // Return the most common QID
  let maxCount = 0;
  let mostCommonQID: string | null = null;
  qidCounts.forEach((count, qid) => {
    if (count > maxCount) {
      maxCount = count;
      mostCommonQID = qid;
    }
  });
  
  return mostCommonQID;
}

/**
 * Get count of existing artworks for an artist
 */
export async function getArtistArtworkCount(artistId: string): Promise<number> {
  const { count, error } = await supabase
    .from('arts')
    .select('*', { count: 'exact', head: true })
    .eq('artist_id', artistId);
  
  if (error || count === null) {
    return 0;
  }
  
  return count;
}

/**
 * Find existing artwork by NGA Object ID
 * Returns the art ID if found, null otherwise
 */

export async function upsertArtSource(payload: {
  artId: string;
  source: string;
  sourcePageId?: number | string | null;
  sourceTitle?: string;
  sourceUrl?: string;
  wikidataQID?: string;
}): Promise<void> {
  // Store Wikidata QID in dedicated wikidata_qid column
  // Requires: art_sources table must have a wikidata_qid column (text/nullable)
  // For sources with page IDs, use conflict resolution
  const upsertData = {
    art_id: payload.artId,
    source: payload.source,
    source_pageid: payload.sourcePageId ?? null,
    source_title: payload.sourceTitle ?? null,
    source_url: payload.sourceUrl ?? null,
    wikidata_qid: payload.wikidataQID ?? null,
  };

  const result = payload.sourcePageId !== null
    ? await supabase
        .from('art_sources')
        .upsert(upsertData, { onConflict: 'source,source_pageid' })
    : await supabase
        .from('art_sources')
        .insert(upsertData);
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

/**
 * Upload image to Supabase storage
 */
export async function uploadToStorage(path: string, image: { buffer: Buffer; mime: string }): Promise<{ path: string; publicUrl: string }> {
  const { config, supabase } = await import('./config');
  const { error } = await supabase.storage.from(config.supabaseBucket).upload(path, image.buffer, {
    contentType: image.mime,
    upsert: true,
  });
  if (error) {
    throw new Error(`Supabase upload failed for ${path}: ${error.message}`);
  }

  const { data } = supabase.storage.from(config.supabaseBucket).getPublicUrl(path);
  return { path, publicUrl: data.publicUrl };
}

/**
 * Upsert a quote for a quote author
 * Deduplicates by text + author_id + source
 */
export async function upsertQuote(payload: {
  text: string;
  authorId: string;
  source?: string | null;
}): Promise<string> {
  // Calculate character count
  const characterCount = payload.text.length;
  
  // Check for existing quote with same text, author, and source
  const existing = await supabase
    .from('quotes')
    .select('id')
    .eq('author_id', payload.authorId)
    .eq('text', payload.text)
    .eq('source', payload.source ?? null)
    .maybeSingle();
  
  if (existing.error && existing.error.code !== 'PGRST116') {
    throw new Error(`Failed to lookup quote: ${existing.error.message}`);
  }
  
  if (existing.data?.id) {
    // Update existing quote
    const updated = await supabase
      .from('quotes')
      .update({
        text: payload.text,
        source: payload.source ?? null,
        character_count: characterCount,
      })
      .eq('id', existing.data.id)
      .select('id')
      .single();
    
    if (updated.error) {
      throw new Error(`Failed to update quote: ${updated.error.message}`);
    }
    
    return updated.data!.id;
  }
  
  // Insert new quote
  const inserted = await supabase
    .from('quotes')
    .insert({
      text: payload.text,
      author_id: payload.authorId,
      source: payload.source ?? null,
      character_count: characterCount,
    })
    .select('id')
    .single();
  
  if (inserted.error || !inserted.data?.id) {
    throw new Error(`Failed to insert quote: ${inserted.error?.message ?? 'unknown error'}`);
  }
  
  return inserted.data.id;
}

/**
 * Ensure a quote author exists in the database
 * Returns the author ID
 */
export async function ensureQuoteAuthor(name: string, category: string = 'philosopher'): Promise<string> {
  // Try to get existing first
  const existing = await supabase
    .from('quote_authors')
    .select('id')
    .eq('name', name)
    .maybeSingle();
  
  if (existing.error && existing.error.code !== 'PGRST116') {
    throw new Error(`Failed to lookup quote author: ${existing.error.message}`);
  }
  
  if (existing.data?.id) {
    // Update category if it's different (allows changing category later)
    await supabase
      .from('quote_authors')
      .update({ category })
      .eq('id', existing.data.id);
    
    return existing.data.id;
  }

  // Insert new quote author
  const inserted = await supabase
    .from('quote_authors')
    .insert({ name: name.trim(), category })
    .select('id')
    .single();
  
  if (inserted.error) {
    // If duplicate key error, try to fetch the existing author
    if (inserted.error.code === '23505' || inserted.error.message.includes('duplicate key')) {
      const retry = await supabase
        .from('quote_authors')
        .select('id')
        .eq('name', name.trim())
        .single();
      
      if (retry.data?.id) {
        return retry.data.id;
      }
    }
    throw new Error(`Failed to insert quote author: ${inserted.error.message}`);
  }
  
  if (!inserted.data?.id) {
    throw new Error(`Failed to insert quote author: unknown error`);
  }
  
  return inserted.data.id;
}

