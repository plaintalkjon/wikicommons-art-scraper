// Generic Mastodon poster for any artist - reads from Supabase Storage and Database
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Config: BUCKET (default: 'Art')
// Usage: ?artist=Artist Name (required)

import { createClient } from "npm:@supabase/supabase-js@2.46.1";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Legacy support: fallback to env vars if database lookup fails
const MASTODON_BASE_URL_LEGACY = Deno.env.get('MASTODON_BASE_URL') ?? 'https://mastodon.social'
const MASTODON_ACCESS_TOKEN_LEGACY = Deno.env.get('MASTODON_ACCESS_TOKEN')

// Default to 'Art' (capitalized) to match the scraper's SUPABASE_BUCKET
const BUCKET = Deno.env.get('BUCKET') ?? 'Art'

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) console.error('Missing Supabase env vars')

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const IMAGE_EXTS = new Set(['jpg','jpeg','png','webp','gif'])

/**
 * Slugify function to convert artist name to storage prefix
 */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

/**
 * Query database for storage paths for an artist
 * Prioritizes artworks that haven't been posted (NULL last_posted_at) or have oldest last_posted_at
 * Returns the selected path and whether all artworks have been posted
 */
async function getNextArtworkPath(artistName: string): Promise<{ path: string | null; allPosted: boolean }> {
  // First, get the artist ID
  const { data: artist, error: artistError } = await supabase
    .from('artists')
    .select('id')
    .eq('name', artistName)
    .single()
  
  if (artistError || !artist) {
    throw new Error(`Artist not found: ${artistName}`)
  }
  
  // Get all art IDs for this artist
  const { data: arts, error: artsError } = await supabase
    .from('arts')
    .select('id')
    .eq('artist_id', artist.id)
  
  if (artsError) {
    throw new Error(`Failed to fetch arts: ${artsError.message}`)
  }
  
  if (!arts || arts.length === 0) {
    return { path: null, allPosted: false }
  }
  
  const artIds = arts.map(a => a.id)
  const allAssets: Array<{ storage_path: string; last_posted_at: string | null }> = []
  const BATCH_SIZE = 100 // Supabase .in() has limits, so batch the queries
  
  // Batch the art IDs to avoid query size limits
  for (let i = 0; i < artIds.length; i += BATCH_SIZE) {
    const batch = artIds.slice(i, i + BATCH_SIZE)
    const { data: assets, error: assetsError } = await supabase
      .from('art_assets')
      .select('storage_path, last_posted_at')
      .in('art_id', batch)
    
    if (assetsError) {
      console.error(`Error fetching batch ${Math.floor(i / BATCH_SIZE) + 1}:`, assetsError)
      continue // Continue with other batches even if one fails
    }
    
    if (assets) {
      allAssets.push(...assets)
    }
  }
  
  // Filter to image files only
  const imageAssets = allAssets.filter(asset => {
    const ext = asset.storage_path.split('.').pop()?.toLowerCase()
    return ext && IMAGE_EXTS.has(ext)
  })
  
  if (imageAssets.length === 0) {
    return { path: null, allPosted: false }
  }
  
  // Sort: NULL last_posted_at first, then oldest last_posted_at
  imageAssets.sort((a, b) => {
    if (a.last_posted_at === null && b.last_posted_at === null) return 0
    if (a.last_posted_at === null) return -1 // NULL comes first
    if (b.last_posted_at === null) return 1
    // Both have timestamps, sort by oldest first
    return new Date(a.last_posted_at).getTime() - new Date(b.last_posted_at).getTime()
  })
  
  const selected = imageAssets[0]
  
  // Check if all artworks have been posted (no NULL last_posted_at)
  const hasUnposted = imageAssets.some(asset => asset.last_posted_at === null)
  const allPosted = !hasUnposted && selected.last_posted_at !== null
  
  return { path: selected.storage_path, allPosted }
}

/**
 * Reset all last_posted_at timestamps for an artist (when all artworks have been posted)
 */
async function resetArtistPostHistory(artistName: string): Promise<void> {
  try {
    // Get the artist ID
    const { data: artist, error: artistError } = await supabase
      .from('artists')
      .select('id')
      .eq('name', artistName)
      .single()
    
    if (artistError || !artist) {
      console.warn(`Could not reset post history: artist not found: ${artistName}`)
      return
    }
    
    // Get all art IDs for this artist in batches to avoid URL length issues
    const artIds: string[] = []
    let from = 0
    const pageSize = 100
    let hasMore = true
    
    while (hasMore) {
      const { data: arts, error: artsError } = await supabase
        .from('arts')
        .select('id')
        .eq('artist_id', artist.id)
        .range(from, from + pageSize - 1)
      
      if (artsError) {
        console.warn(`Error fetching arts batch:`, artsError)
        break
      }
      
      if (arts && arts.length > 0) {
        artIds.push(...arts.map(a => a.id))
        hasMore = arts.length === pageSize
        from += pageSize
      } else {
        hasMore = false
      }
    }
    
    if (artIds.length === 0) {
      console.warn(`Could not reset post history: no arts found for ${artistName}`)
      return
    }
    
    // Reset all last_posted_at to NULL in batches
    const BATCH_SIZE = 100
    let resetCount = 0
    
    for (let i = 0; i < artIds.length; i += BATCH_SIZE) {
      const batch = artIds.slice(i, i + BATCH_SIZE)
      const { error: updateError } = await supabase
        .from('art_assets')
        .update({ last_posted_at: null })
        .in('art_id', batch)
      
      if (updateError) {
        console.warn(`Error resetting batch ${Math.floor(i / BATCH_SIZE) + 1}:`, updateError)
      } else {
        resetCount += batch.length
      }
    }
    
    console.log(`Reset post history for ${artistName} - ${resetCount} artworks are now available again`)
  } catch (err) {
    console.error('Exception resetting post history:', err)
  }
}

/**
 * Update the last_posted_at timestamp for a specific artwork asset
 */
async function updateArtworkLastPosted(storagePath: string): Promise<void> {
  try {
    const { error: updateError } = await supabase
      .from('art_assets')
      .update({ last_posted_at: new Date().toISOString() })
      .eq('storage_path', storagePath)
    
    if (updateError) {
      console.warn(`Could not update last_posted_at for ${storagePath}:`, updateError)
    }
  } catch (err) {
    console.error('Exception updating artwork last_posted_at:', err)
  }
}

/**
 * List files from storage (alternative method)
 * This recursively walks the storage directory
 */
async function listAll(prefix: string): Promise<string[]> {
  const paths: string[] = []
  
  async function walk(dir: string) {
    try {
      const { data, error } = await supabase.storage.from(BUCKET).list(dir || undefined, { 
        limit: 1000, 
        sortBy: { column: 'name', order: 'asc' } 
      })
      
      if (error) {
        console.error(`Error listing ${dir}:`, error)
        throw error
      }
      
      for (const entry of data ?? []) {
        const childPath = dir ? `${dir}/${entry.name}` : entry.name
        
        if (entry.metadata && typeof entry.metadata === 'object' && 'size' in entry.metadata) {
          // It's a file
          const ext = entry.name.split('.').pop()?.toLowerCase()
          if (ext && IMAGE_EXTS.has(ext)) {
            paths.push(childPath)
          }
        } else if (entry.id === null || entry.metadata === null) {
          // Likely a folder (Supabase marks folders with null id/metadata)
          await walk(childPath)
        }
      }
    } catch (err) {
      console.error(`Error in walk(${dir}):`, err)
      throw err
    }
  }
  
  await walk(prefix)
  return paths
}

async function getImageBytes(path: string): Promise<{ bytes: Uint8Array, contentType: string }> {
  console.log(`Attempting to download from bucket: ${BUCKET}, path: ${path}`)
  const { data, error } = await supabase.storage.from(BUCKET).download(path)
  if (error) {
    console.error(`Error downloading ${path} from bucket ${BUCKET}:`, error)
    // Try to provide more helpful error message
    if (error.message?.includes('not found') || error.message?.includes('does not exist')) {
      throw new Error(`File not found in storage: ${path} (bucket: ${BUCKET})`)
    }
    throw new Error(`Storage error for ${path}: ${error.message || JSON.stringify(error)}`)
  }
  if (!data) {
    throw new Error(`No data returned for ${path}`)
  }
  const bytes = new Uint8Array(await data.arrayBuffer())
  const ext = path.split('.').pop()?.toLowerCase()
  const contentType =
    ext === 'png' ? 'image/png' :
    ext === 'webp' ? 'image/webp' :
    ext === 'gif' ? 'image/gif' :
    'image/jpeg'
  return { bytes, contentType }
}

/**
 * Get Mastodon credentials for an artist from the database
 * Falls back to environment variables if not found in database
 */
async function getMastodonCredentials(artistName: string): Promise<{ baseUrl: string; accessToken: string }> {
  try {
    // First, get the artist ID
    const { data: artist, error: artistError } = await supabase
      .from('artists')
      .select('id')
      .eq('name', artistName)
      .single()
    
    if (artistError || !artist) {
      console.warn(`Artist not found: ${artistName}, using legacy env vars`)
      if (!MASTODON_ACCESS_TOKEN_LEGACY) {
        throw new Error('No Mastodon credentials found (neither in database nor env vars)')
      }
      return {
        baseUrl: MASTODON_BASE_URL_LEGACY,
        accessToken: MASTODON_ACCESS_TOKEN_LEGACY
      }
    }
    
    // Get Mastodon account for this artist
    const { data: account, error: accountError } = await supabase
      .from('mastodon_accounts')
      .select('mastodon_base_url, mastodon_access_token')
      .eq('artist_id', artist.id)
      .eq('active', true)
      .single()
    
    if (accountError || !account) {
      console.warn(`No Mastodon account found for ${artistName}, using legacy env vars`)
      if (!MASTODON_ACCESS_TOKEN_LEGACY) {
        throw new Error(`No Mastodon account configured for ${artistName} and no legacy env vars`)
      }
      return {
        baseUrl: MASTODON_BASE_URL_LEGACY,
        accessToken: MASTODON_ACCESS_TOKEN_LEGACY
      }
    }
    
    return {
      baseUrl: account.mastodon_base_url,
      accessToken: account.mastodon_access_token
    }
  } catch (err) {
    console.error('Error fetching Mastodon credentials:', err)
    // Fallback to legacy env vars
    if (MASTODON_ACCESS_TOKEN_LEGACY) {
      return {
        baseUrl: MASTODON_BASE_URL_LEGACY,
        accessToken: MASTODON_ACCESS_TOKEN_LEGACY
      }
    }
    throw err
  }
}

async function uploadMediaToMastodon(bytes: Uint8Array, contentType: string, baseUrl: string, accessToken: string): Promise<string> {
  const form = new FormData()
  form.append('file', new Blob([bytes], { type: contentType }), 'image')

  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v2/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Media upload failed ${res.status}: ${text}`)
  }
  const json = await res.json()
  return json.id as string
}

async function getArtworkTitle(storagePath: string): Promise<string | null> {
  try {
    // Query database to get artwork title from storage path
    // First get the art_id from art_assets
    const { data: asset, error: assetError } = await supabase
      .from('art_assets')
      .select('art_id')
      .eq('storage_path', storagePath)
      .single()
    
    if (assetError || !asset) {
      console.error(`Error fetching asset for ${storagePath}:`, assetError)
      return null
    }
    
    // Then get the title from arts table
    const { data: art, error: artError } = await supabase
      .from('arts')
      .select('title')
      .eq('id', asset.art_id)
      .single()
    
    if (artError || !art) {
      console.error(`Error fetching art title:`, artError)
      return null
    }
    
    return art.title || null
  } catch (err) {
    console.error(`Exception fetching title:`, err)
    return null
  }
}

async function createStatusWithTitle(mediaId: string, title: string | null, baseUrl: string, accessToken: string): Promise<any> {
  const form = new URLSearchParams()
  
  // Include title in status if available, otherwise empty
  const statusText = title ? title : ''
  form.set('status', statusText)
  form.append('media_ids[]', mediaId)

  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/statuses`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Create status failed ${res.status}: ${text}`)
  }
  return res.json()
}

/**
 * Get all active artists from the mastodon_accounts table
 * Returns array of artist names
 */
async function getAllActiveArtists(): Promise<string[]> {
  try {
    // Get all active accounts
    const { data: accounts, error } = await supabase
      .from('mastodon_accounts')
      .select('artist_id')
      .eq('active', true)
    
    if (error || !accounts || accounts.length === 0) {
      console.error('Error fetching active artists:', error)
      return []
    }
    
    const artistIds = accounts.map(a => a.artist_id)
    
    // Get artist names
    const { data: artists, error: artistError } = await supabase
      .from('artists')
      .select('name, id')
      .in('id', artistIds)
    
    if (artistError || !artists) {
      console.error('Error fetching artist names:', artistError)
      return []
    }
    
    return artists.map(a => a.name)
  } catch (err) {
    console.error('Exception in getAllActiveArtists:', err)
    return []
  }
}

/**
 * Post artwork for a single artist
 * Returns success status and details
 */
async function postForArtist(artistName: string): Promise<{ success: boolean; error?: string; details?: any }> {
  try {
    console.log(`Processing post for artist: ${artistName}`)

    // Try up to 5 artworks in case some files don't exist in storage
    const maxAttempts = 5
    let lastError: string | null = null
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Get the next artwork to post (prioritizes unposted, then oldest)
      const { path: pick, allPosted } = await getNextArtworkPath(artistName)

      if (!pick) {
        return { success: false, error: `No images found in database for artist: ${artistName}` }
      }

      // If all artworks have been posted, reset and start over
      if (allPosted && attempt === 0) {
        console.log(`All artworks for ${artistName} have been posted. Resetting post history...`)
        await resetArtistPostHistory(artistName)
        // Continue to next iteration to get a fresh artwork after reset
        continue
      }

      console.log(`Selected artwork (attempt ${attempt + 1}): ${pick}`)

      try {
        // Get Mastodon credentials for this artist
        const credentials = await getMastodonCredentials(artistName)
        console.log(`Using Mastodon account for: ${artistName}`)

        // Get artwork title from database
        const artworkTitle = await getArtworkTitle(pick)
        if (artworkTitle) {
          console.log(`Found title: ${artworkTitle}`)
        }

        // Try to download the image - if it fails, mark it as posted and try next
        let payload
        try {
          payload = await getImageBytes(pick)
        } catch (storageError: any) {
          console.warn(`File not found in storage: ${pick}, marking as posted and trying next artwork`)
          // Mark this as posted so we don't try it again
          await updateArtworkLastPosted(pick)
          lastError = `File not found in storage: ${pick}`
          continue // Try next artwork
        }

        const mediaId = await uploadMediaToMastodon(payload.bytes, payload.contentType, credentials.baseUrl, credentials.accessToken)
        const status = await createStatusWithTitle(mediaId, artworkTitle, credentials.baseUrl, credentials.accessToken)

        // Update last_posted_at timestamp for this specific artwork
        await updateArtworkLastPosted(pick)

        // Also update the artist's last_posted_at in mastodon_accounts (for reference)
        await updateLastPostedAt(artistName)

        return {
          success: true,
          details: {
            media_id: mediaId,
            status_id: status.id,
            storage_path: pick,
            title: artworkTitle,
            artist: artistName,
            all_posted_reset: allPosted
          }
        }
      } catch (err: any) {
        // If it's a storage error, mark as posted and try next
        if (err.message?.includes('Storage') || err.message?.includes('not found') || err.message?.includes('does not exist')) {
          console.warn(`Storage error for ${pick}, marking as posted and trying next`)
          await updateArtworkLastPosted(pick)
          lastError = String(err)
          continue
        }
        // Other errors, throw them
        throw err
      }
    }
    
    // If we've tried maxAttempts and all failed
    return { success: false, error: lastError || `Failed after ${maxAttempts} attempts` }
  } catch (err) {
    console.error(`Error posting for ${artistName}:`, err)
    return { success: false, error: String(err) }
  }
}

/**
 * Update the last_posted_at timestamp for an artist
 */
async function updateLastPostedAt(artistName: string): Promise<void> {
  try {
    // Get artist ID
    const { data: artist, error: artistError } = await supabase
      .from('artists')
      .select('id')
      .eq('name', artistName)
      .single()
    
    if (artistError || !artist) {
      console.warn(`Could not update last_posted_at: artist not found: ${artistName}`)
      return
    }
    
    // Update last_posted_at
    const { error: updateError } = await supabase
      .from('mastodon_accounts')
      .update({ last_posted_at: new Date().toISOString() })
      .eq('artist_id', artist.id)
    
    if (updateError) {
      console.warn(`Could not update last_posted_at:`, updateError)
    }
  } catch (err) {
    console.error('Exception updating last_posted_at:', err)
  }
}

Deno.serve(async (req: Request) => {
  try {
    const url = new URL(req.url)
    const artistName = url.searchParams.get('artist')
    const overridePath = url.searchParams.get('path')
    const useDatabase = url.searchParams.get('use_db') !== 'false' // Default to true

    // If artist is specified, post for that artist only (backward compatible)
    if (artistName) {
      console.log(`Single artist mode: ${artistName}`)
      const result = await postForArtist(artistName)
      
      if (!result.success) {
        return new Response(JSON.stringify({ 
          error: result.error || 'Failed to post',
          artist: artistName
        }), { 
          status: 404, 
          headers: { 'Content-Type': 'application/json' } 
        })
      }
      
      return new Response(JSON.stringify({ 
        ok: true,
        mode: 'single',
        ...result.details
      }), {
        headers: { 'Content-Type': 'application/json', 'Connection': 'keep-alive' },
      })
    }

    // If no artist specified, post for ALL active artists
    console.log('No artist specified, posting for all active artists...')
    const activeArtists = await getAllActiveArtists()
    
    if (activeArtists.length === 0) {
      return new Response(JSON.stringify({ 
        error: 'No active artists found in mastodon_accounts table. Add artists using the add-artist-bot script or manually.' 
      }), { 
        status: 404, 
        headers: { 'Content-Type': 'application/json' } 
      })
    }

    console.log(`Found ${activeArtists.length} active artists: ${activeArtists.join(', ')}`)

    // Post for each artist (in parallel for speed, but with error handling)
    const results = await Promise.allSettled(
      activeArtists.map(artist => postForArtist(artist))
    )

    const successes: any[] = []
    const failures: any[] = []

    results.forEach((result, index) => {
      const artist = activeArtists[index]
      if (result.status === 'fulfilled' && result.value.success) {
        successes.push({ artist, ...result.value.details })
      } else {
        const error = result.status === 'fulfilled' 
          ? result.value.error 
          : String(result.reason)
        failures.push({ artist, error })
      }
    })

    return new Response(JSON.stringify({ 
      ok: true,
      mode: 'all',
      total_artists: activeArtists.length,
      successful: successes.length,
      failed: failures.length,
      successes,
      failures: failures.length > 0 ? failures : undefined
    }), {
      headers: { 'Content-Type': 'application/json', 'Connection': 'keep-alive' },
    })
  } catch (e) {
    console.error('Error:', e)
    return new Response(JSON.stringify({ error: String(e) }), { 
      status: 500, 
      headers: { 'Content-Type': 'application/json' } 
    })
  }
})

