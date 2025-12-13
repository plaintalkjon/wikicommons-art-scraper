// Mastodon poster with artwork titles - reads from Supabase Storage and Database
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MASTODON_BASE_URL, MASTODON_ACCESS_TOKEN
// Config: BUCKET (default: 'Art'), PREFIX (default: 'vincent-van-gogh')
// Posts images with artwork titles from the database

import { createClient } from "npm:@supabase/supabase-js@2.46.1";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Legacy support: fallback to env vars if database lookup fails
const MASTODON_BASE_URL_LEGACY = Deno.env.get('MASTODON_BASE_URL') ?? 'https://mastodon.social'
const MASTODON_ACCESS_TOKEN_LEGACY = Deno.env.get('MASTODON_ACCESS_TOKEN')

// Default to 'Art' (capitalized) to match the scraper's SUPABASE_BUCKET
const BUCKET = Deno.env.get('BUCKET') ?? 'Art'
// Accept both `vincent-van-gogh` and `vincent-van-gogh/` by normalizing to no leading slash, no trailing slash.
const RAW_PREFIX = Deno.env.get('PREFIX') ?? 'vincent-van-gogh'
const PREFIX = RAW_PREFIX.replace(/^\/+/, '').replace(/\/+$/, '')

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) console.error('Missing Supabase env vars')

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const IMAGE_EXTS = new Set(['jpg','jpeg','png','webp','gif'])

/**
 * Alternative: Query database for storage paths instead of listing storage directly
 * This is more reliable and faster
 */
async function getStoragePathsFromDatabase(artistName: string): Promise<string[]> {
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
    return []
  }
  
  const artIds = arts.map(a => a.id)
  const allPaths: string[] = []
  const BATCH_SIZE = 100 // Supabase .in() has limits, so batch the queries
  
  // Batch the art IDs to avoid query size limits
  for (let i = 0; i < artIds.length; i += BATCH_SIZE) {
    const batch = artIds.slice(i, i + BATCH_SIZE)
    const { data: assets, error: assetsError } = await supabase
      .from('art_assets')
      .select('storage_path')
      .in('art_id', batch)
    
    if (assetsError) {
      console.error(`Error fetching batch ${Math.floor(i / BATCH_SIZE) + 1}:`, assetsError)
      continue // Continue with other batches even if one fails
    }
    
    if (assets) {
      allPaths.push(...assets.map(a => a.storage_path))
    }
  }
  
  // Filter to image files only
  return allPaths.filter(path => {
    const ext = path.split('.').pop()?.toLowerCase()
    return ext && IMAGE_EXTS.has(ext)
  })
}

/**
 * List files from storage (original method)
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
        
        // Check if it's a file (has metadata with size) or folder (null metadata/id)
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
  const { data, error } = await supabase.storage.from(BUCKET).download(path)
  if (error) {
    console.error(`Error downloading ${path}:`, error)
    throw error
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
  // Alt text intentionally omitted per requirement

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

Deno.serve(async (req: Request) => {
  try {
    const url = new URL(req.url)
    const overridePath = url.searchParams.get('path')
    const useDatabase = url.searchParams.get('use_db') === 'true'
    let artistName = url.searchParams.get('artist') // Optional: query by artist name instead of prefix
    // Default to Vincent van Gogh for this function
    if (!artistName) {
      artistName = 'Vincent van Gogh'
    }

    let candidates: string[] = []

    if (overridePath) {
      // Direct path override
      candidates = [overridePath.replace(/^\/+/, '')]
    } else if (useDatabase && artistName) {
      // Query database for storage paths (more reliable)
      console.log(`Querying database for artist: ${artistName}`)
      candidates = await getStoragePathsFromDatabase(artistName)
    } else {
      // List from storage using prefix
      console.log(`Listing storage: ${BUCKET}/${PREFIX}`)
      candidates = await listAll(PREFIX)
    }

    if (!candidates.length) {
      const errorMsg = useDatabase && artistName
        ? `No images found in database for artist: ${artistName}`
        : `No images found under ${BUCKET}/${PREFIX}`
      console.error(errorMsg)
      return new Response(JSON.stringify({ error: errorMsg }), { 
        status: 404, 
        headers: { 'Content-Type': 'application/json' } 
      })
    }

    console.log(`Found ${candidates.length} candidate images`)
    const pick = candidates[Math.floor(Math.random() * candidates.length)]
    console.log(`Selected: ${pick}`)

    // Get Mastodon credentials for this artist
    const credentials = await getMastodonCredentials(artistName)
    console.log(`Using Mastodon account for: ${artistName}`)

    // Get artwork title from database
    const artworkTitle = await getArtworkTitle(pick)
    if (artworkTitle) {
      console.log(`Found title: ${artworkTitle}`)
    } else {
      console.log(`No title found for ${pick}`)
    }

    const payload = await getImageBytes(pick)
    const mediaId = await uploadMediaToMastodon(payload.bytes, payload.contentType, credentials.baseUrl, credentials.accessToken)
    const status = await createStatusWithTitle(mediaId, artworkTitle, credentials.baseUrl, credentials.accessToken)

    return new Response(JSON.stringify({ 
      ok: true, 
      media_id: mediaId, 
      status_id: status.id, 
      storage_path: pick,
      title: artworkTitle,
      candidates_count: candidates.length
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
