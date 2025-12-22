// Generic Mastodon poster for artists and tag-based accounts
// Reads from Supabase Storage and Database
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Config: BUCKET (default: 'Art')
// Usage: 
//   - ?artist=Artist Name (post for specific artist)
//   - No params (post for all active accounts - both artist and tag accounts)

import { createClient } from "npm:@supabase/supabase-js@2.46.1";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Legacy support: fallback to env vars if database lookup fails
const MASTODON_BASE_URL_LEGACY = Deno.env.get('MASTODON_BASE_URL') ?? 'https://mastodon.social'
const MASTODON_ACCESS_TOKEN_LEGACY = Deno.env.get('MASTODON_ACCESS_TOKEN')

// Default to 'Art' (capitalized) to match the scraper's SUPABASE_BUCKET
const ART_BUCKET = Deno.env.get('BUCKET') ?? 'Art'

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) console.error('Missing Supabase env vars')

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const IMAGE_EXTS = new Set(['jpg','jpeg','png','webp','gif'])

/**
 * Check if a storage path is an image file
 * Handles both normal extensions (.jpg) and malformed ones (jpgjpg)
 */
function isImagePath(path: string): boolean {
  const lowerPath = path.toLowerCase()
  // Check if path ends with any image extension (with or without dot)
  for (const ext of IMAGE_EXTS) {
    if (lowerPath.endsWith(`.${ext}`) || lowerPath.endsWith(ext)) {
      return true
    }
  }
  return false
}

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
 * Get all tag IDs associated with a tag account
 * Reads from the mastodon_account_tags junction table
 */
async function getTagAccountTagIds(accountId: string): Promise<string[]> {
  try {
    // Get all tags associated with this account from the junction table
    const { data: accountTags, error } = await supabase
      .from('mastodon_account_tags')
      .select('tag_id')
      .eq('mastodon_account_id', accountId)
    
    if (error) {
      console.error(`Error fetching tags for account ${accountId}:`, error)
      return []
    }
    
    if (!accountTags || accountTags.length === 0) {
      // Fallback: try the legacy tag_id column if junction table is empty
      const { data: account } = await supabase
        .from('mastodon_accounts')
        .select('tag_id')
        .eq('id', accountId)
        .single()
      
      if (account?.tag_id) {
        return [account.tag_id]
      }
      
      return []
    }
    
    return accountTags.map(at => at.tag_id)
  } catch (err) {
    console.error('Exception in getTagAccountTagIds:', err)
    return []
  }
}

/**
 * Query database for storage paths for a tag account (using all tags associated with the account)
 * Prioritizes artworks that haven't been posted (NULL last_posted_at) or have oldest last_posted_at
 * Returns the selected path and whether all artworks have been posted
 */
async function getNextArtworkPathByTag(accountId: string): Promise<{ path: string | null; allPosted: boolean }> {
  // Get all tag IDs associated with this account from the junction table
  const tagIds = await getTagAccountTagIds(accountId)
  
  if (tagIds.length === 0) {
    return { path: null, allPosted: false }
  }
  
  // Get all art IDs that have any of these tags
  const { data: artTags, error: artTagsError } = await supabase
    .from('art_tags')
    .select('art_id')
    .in('tag_id', tagIds)
  
  if (artTagsError) {
    throw new Error(`Failed to fetch art_tags: ${artTagsError.message}`)
  }
  
  if (!artTags || artTags.length === 0) {
    return { path: null, allPosted: false }
  }
  
  // Get unique art IDs
  const artIds = [...new Set(artTags.map(at => at.art_id))]
  
  const allAssets: Array<{ storage_path: string; last_posted_at: string | null }> = []
  const BATCH_SIZE = 100
  
  // Batch the art IDs to avoid query size limits
  for (let i = 0; i < artIds.length; i += BATCH_SIZE) {
    const batch = artIds.slice(i, i + BATCH_SIZE)
    const { data: assets, error: assetsError } = await supabase
      .from('art_assets')
      .select('storage_path, last_posted_at')
      .in('art_id', batch)
    
    if (assetsError) {
      console.error(`Error fetching batch ${Math.floor(i / BATCH_SIZE) + 1}:`, assetsError)
      continue
    }
    
    if (assets) {
      allAssets.push(...assets)
    }
  }
  
  // Filter to image files only
  const imageAssets = allAssets.filter(asset => isImagePath(asset.storage_path))
  
  if (imageAssets.length === 0) {
    return { path: null, allPosted: false }
  }
  
  // Sort: NULL last_posted_at first, then oldest last_posted_at
  imageAssets.sort((a, b) => {
    if (a.last_posted_at === null && b.last_posted_at === null) return 0
    if (a.last_posted_at === null) return -1
    if (b.last_posted_at === null) return 1
    return new Date(a.last_posted_at).getTime() - new Date(b.last_posted_at).getTime()
  })
  
  const selected = imageAssets[0]
  
  // Check if all artworks have been posted
  const hasUnposted = imageAssets.some(asset => asset.last_posted_at === null)
  const allPosted = !hasUnposted && selected.last_posted_at !== null
  
  return { path: selected.storage_path, allPosted }
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
  const imageAssets = allAssets.filter(asset => isImagePath(asset.storage_path))
  
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
 * Reset all last_posted_at timestamps for a tag account (when all artworks have been posted)
 */
async function resetTagPostHistory(accountId: string): Promise<void> {
  try {
    // Get all tag IDs associated with this account
    const tagIds = await getTagAccountTagIds(accountId)
    
    if (tagIds.length === 0) {
      console.warn(`Could not reset post history: no tags found for account: ${accountId}`)
      return
    }
    
    // Get all art IDs with these tags
    const { data: artTags } = await supabase
      .from('art_tags')
      .select('art_id')
      .in('tag_id', tagIds)
    
    if (!artTags || artTags.length === 0) {
      console.warn(`Could not reset post history: no arts found for account: ${accountId}`)
      return
    }
    
    const artIds = [...new Set(artTags.map(at => at.art_id))]
    
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
    
    console.log(`Reset post history for account ${accountId} - ${resetCount} artworks are now available again`)
  } catch (err) {
    console.error('Exception resetting tag post history:', err)
  }
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
      // List from Art bucket
      const { data, error } = await supabase.storage.from(ART_BUCKET).list(dir || undefined, { 
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
  console.log(`Attempting to download from Art bucket, path: ${path}`)
  const { data, error } = await supabase.storage.from(ART_BUCKET).download(path)
  if (error) {
    console.error(`Error downloading ${path} from Art bucket:`, error)
    // Try to provide more helpful error message
    if (error.message?.includes('not found') || error.message?.includes('does not exist')) {
      throw new Error(`File not found in storage: ${path} (bucket: Art)`)
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
 * Get all active accounts from the mastodon_accounts table
 * Returns array of account identifiers (artist names for artist accounts, tag names for tag accounts)
 * along with timing metadata used for interval-based scheduling.
 */
async function getAllActiveAccounts(): Promise<Array<{
  type: 'artist' | 'tag' | 'philosopher'
  identifier: string
  accountId: string
  lastPostedAt: string | null
  createdAt: string
}>> {
  try {
    // Get all active accounts (artist, tag, and philosopher accounts)
    // Note: Don't select philosopher_id initially - it may not exist if schema hasn't been applied
    const { data: accounts, error } = await supabase
      .from('mastodon_accounts')
      .select('id, artist_id, tag_id, account_type, account_username, last_posted_at, created_at')
      .eq('active', true)
    
    if (error || !accounts || accounts.length === 0) {
      console.error('Error fetching active accounts:', error)
      return []
    }
    
    // Try to get philosopher_id for accounts that might be philosopher type
    // Only if the column exists (schema applied)
    const accountsWithPhilosopher = await Promise.all(accounts.map(async (acc: any) => {
      if (acc.account_type === 'philosopher') {
        try {
          const { data: accountDetail } = await supabase
            .from('mastodon_accounts')
            .select('philosopher_id')
            .eq('id', acc.id)
            .single()
          return { ...acc, philosopher_id: accountDetail?.philosopher_id || null }
        } catch {
          // Column doesn't exist yet - philosopher accounts won't work until schema is applied
          return { ...acc, philosopher_id: null }
        }
      }
      return { ...acc, philosopher_id: null }
    }))
    
    const accountsToProcess = accountsWithPhilosopher
    
    const result: Array<{
      type: 'artist' | 'tag' | 'philosopher'
      identifier: string
      accountId: string
      lastPostedAt: string | null
      createdAt: string
    }> = []
    
    // Process artist accounts
    const artistAccounts = accountsToProcess.filter((a: any) => a.account_type === 'artist' || (!a.account_type && a.artist_id))
    if (artistAccounts.length > 0) {
      const artistIds = artistAccounts.map((a: any) => a.artist_id).filter(Boolean) as string[]
      const { data: artists, error: artistError } = await supabase
        .from('artists')
        .select('name, id')
        .in('id', artistIds)
      
      if (!artistError && artists) {
        const artistMap = new Map(artists.map(a => [a.id, a.name]))
        artistAccounts.forEach((acc: any) => {
          const artistName = artistMap.get(acc.artist_id as string)
          if (artistName) {
            result.push({
              type: 'artist',
              identifier: artistName,
              accountId: acc.id as string,
              lastPostedAt: (acc.last_posted_at as string | null) ?? null,
              createdAt: (acc.created_at as string) || new Date().toISOString(),
            })
          }
        })
      }
    }
    
    // Process tag accounts (using junction table)
    const tagAccounts = accountsToProcess.filter((a: any) => a.account_type === 'tag')
    if (tagAccounts.length > 0) {
      const tagAccountIds = tagAccounts.map((a: any) => a.id as string)
      
      // Get tags for these accounts from the junction table
      const { data: accountTags, error: accountTagsError } = await supabase
        .from('mastodon_account_tags')
        .select('mastodon_account_id, tag_id')
        .in('mastodon_account_id', tagAccountIds)
      
      if (!accountTagsError && accountTags && accountTags.length > 0) {
        // Get unique tag IDs
        const tagIds = [...new Set(accountTags.map((at: any) => at.tag_id))]
        
        // Fetch tag names
        const { data: tags, error: tagsError } = await supabase
          .from('tags')
          .select('id, name')
          .in('id', tagIds)
        
        if (!tagsError && tags) {
          const tagMap = new Map(tags.map((t: any) => [t.id, t.name]))
          
          // Group tags by account
          const accountTagMap = new Map<string, string[]>()
          accountTags.forEach((at: any) => {
            const accountId = at.mastodon_account_id
            const tagName = tagMap.get(at.tag_id)
            if (tagName) {
              if (!accountTagMap.has(accountId)) {
                accountTagMap.set(accountId, [])
              }
              accountTagMap.get(accountId)!.push(tagName)
            }
          })
          
          // Add tag accounts to result (use first tag name as identifier, or account username)
          tagAccounts.forEach((acc: any) => {
            const tagNames = accountTagMap.get(acc.id) || []
            // Use first tag name, or account username, or a generic identifier
            const identifier = tagNames.length > 0 
              ? tagNames[0] 
              : (acc.account_username || `tag-account-${acc.id.substring(0, 8)}`)
            result.push({
              type: 'tag',
              identifier,
              accountId: acc.id as string,
              lastPostedAt: (acc.last_posted_at as string | null) ?? null,
              createdAt: (acc.created_at as string) || new Date().toISOString(),
            })
          })
        } else {
          // If we can't get tag names, use account username
          tagAccounts.forEach((acc: any) => {
            const identifier = acc.account_username || `tag-account-${acc.id.substring(0, 8)}`
            result.push({
              type: 'tag',
              identifier,
              accountId: acc.id as string,
              lastPostedAt: (acc.last_posted_at as string | null) ?? null,
              createdAt: (acc.created_at as string) || new Date().toISOString(),
            })
          })
        }
      } else {
        // No tags found or error - use account username as fallback
        tagAccounts.forEach((acc: any) => {
          const identifier = acc.account_username || `tag-account-${acc.id.substring(0, 8)}`
          result.push({
            type: 'tag',
            identifier,
            accountId: acc.id as string,
            lastPostedAt: (acc.last_posted_at as string | null) ?? null,
            createdAt: acc.created_at as string,
          })
        })
      }
    }
    
    // Process philosopher accounts
    const philosopherAccounts = accountsToProcess.filter((a: any) => a.account_type === 'philosopher' && a.philosopher_id)
    if (philosopherAccounts.length > 0) {
      const philosopherIds = philosopherAccounts.map((a: any) => a.philosopher_id).filter(Boolean) as string[]
      const { data: philosophers, error: philosopherError } = await supabase
        .from('philosophers')
        .select('name, id')
        .in('id', philosopherIds)
      
      if (!philosopherError && philosophers) {
        const philosopherMap = new Map(philosophers.map(p => [p.id, p.name]))
        philosopherAccounts.forEach((acc: any) => {
          const philosopherName = philosopherMap.get(acc.philosopher_id as string)
          if (philosopherName) {
            result.push({
              type: 'philosopher',
              identifier: philosopherName,
              accountId: acc.id as string,
              lastPostedAt: (acc.last_posted_at as string | null) ?? null,
              createdAt: (acc.created_at as string) || new Date().toISOString(),
            })
          }
        })
      }
    }
    
    return result
  } catch (err) {
    console.error('Exception in getAllActiveAccounts:', err)
    return []
  }
}

/**
 * Post artwork for a tag account
 * Returns success status and details
 */
async function postForTag(accountId: string): Promise<{ success: boolean; error?: string; details?: any }> {
  try {
    // Get account info including tag name for logging
    const { data: account, error: accountError } = await supabase
      .from('mastodon_accounts')
      .select('mastodon_base_url, mastodon_access_token, account_username')
      .eq('id', accountId)
      .eq('active', true)
      .single()
    
    if (accountError || !account) {
      throw new Error(`No Mastodon account found for account ID: ${accountId}`)
    }
    
    const accountName = account.account_username || `account-${accountId.substring(0, 8)}`
    console.log(`Processing post for tag account: ${accountName}`)
    
    const credentials = {
      baseUrl: account.mastodon_base_url,
      accessToken: account.mastodon_access_token
    }

    // Try up to 5 artworks in case some files don't exist in storage
    const maxAttempts = 5
    let lastError: string | null = null
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Get the next artwork to post (prioritizes unposted, then oldest)
      const { path: pick, allPosted } = await getNextArtworkPathByTag(accountId)

      if (!pick) {
        return { success: false, error: `No images found in database for tag account: ${accountName}` }
      }

      // If all artworks have been posted, reset and start over
      if (allPosted && attempt === 0) {
        console.log(`All artworks for tag account ${accountName} have been posted. Resetting post history...`)
        await resetTagPostHistory(accountId)
        // Continue to next iteration to get a fresh artwork after reset
        continue
      }

      console.log(`Selected artwork (attempt ${attempt + 1}): ${pick}`)

      try {
        // Log which Mastodon account we're using for this tag-based post
        console.log(`Using Mastodon tag account: ${accountName}`)

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

        // Also update the account's last_posted_at in mastodon_accounts (for reference)
        await updateLastPostedAtForAccount(accountId)

        return {
          success: true,
          details: {
            media_id: mediaId,
            status_id: status.id,
            storage_path: pick,
            title: artworkTitle,
            account: accountName,
            account_id: accountId,
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
    console.error(`Error posting for tag account ${accountId}:`, err)
    return { success: false, error: String(err) }
  }
}

/**
 * Get next quote for a philosopher account
 * Prioritizes quotes that haven't been posted (NULL posted_at) or have oldest posted_at
 */
async function getNextQuote(philosopherName: string, accountId: string): Promise<{ quoteId: string | null; quoteText: string | null; allPosted: boolean }> {
  try {
    // Get philosopher ID
    const { data: philosopher, error: philosopherError } = await supabase
      .from('philosophers')
      .select('id')
      .eq('name', philosopherName)
      .single()
    
    if (philosopherError || !philosopher) {
      throw new Error(`Philosopher not found: ${philosopherName}`)
    }
    
    // Get all quotes for this philosopher
    const { data: quotes, error: quotesError } = await supabase
      .from('quotes')
      .select('id, text')
      .eq('philosopher_id', philosopher.id)
    
    if (quotesError || !quotes || quotes.length === 0) {
      return { quoteId: null, quoteText: null, allPosted: false }
    }
    
    const quoteIds = quotes.map(q => q.id)
    
    // Get posting history for this account
    const { data: posts, error: postsError } = await supabase
      .from('quote_posts')
      .select('quote_id, posted_at')
      .eq('mastodon_account_id', accountId)
      .in('quote_id', quoteIds)
    
    if (postsError) {
      console.warn(`Error fetching quote posts: ${postsError.message}`)
    }
    
    const postedQuoteIds = new Set((posts || []).map(p => p.quote_id))
    
    // Find unposted quotes first
    const unpostedQuotes = quotes.filter(q => !postedQuoteIds.has(q.id))
    
    if (unpostedQuotes.length > 0) {
      // Pick a random unposted quote
      const selected = unpostedQuotes[Math.floor(Math.random() * unpostedQuotes.length)]
      return {
        quoteId: selected.id,
        quoteText: selected.text,
        allPosted: false
      }
    }
    
    // All quotes have been posted - find oldest posted quote
    if (posts && posts.length > 0) {
      posts.sort((a, b) => {
        const aTime = a.posted_at ? new Date(a.posted_at).getTime() : 0
        const bTime = b.posted_at ? new Date(b.posted_at).getTime() : 0
        return aTime - bTime
      })
      
      const oldestPost = posts[0]
      const selectedQuote = quotes.find(q => q.id === oldestPost.quote_id)
      
      if (selectedQuote) {
        return {
          quoteId: selectedQuote.id,
          quoteText: selectedQuote.text,
          allPosted: true
        }
      }
    }
    
    return { quoteId: null, quoteText: null, allPosted: false }
  } catch (err) {
    console.error('Exception in getNextQuote:', err)
    return { quoteId: null, quoteText: null, allPosted: false }
  }
}

/**
 * Reset quote post history for a philosopher account
 */
async function resetPhilosopherPostHistory(accountId: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('quote_posts')
      .delete()
      .eq('mastodon_account_id', accountId)
    
    if (error) {
      console.warn(`Error resetting quote post history: ${error.message}`)
    } else {
      console.log(`Reset quote post history for account ${accountId}`)
    }
  } catch (err) {
    console.error('Exception resetting quote post history:', err)
  }
}

/**
 * Record that a quote was posted
 */
async function recordQuotePost(quoteId: string, accountId: string, statusId: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('quote_posts')
      .upsert({
        quote_id: quoteId,
        mastodon_account_id: accountId,
        mastodon_status_id: statusId,
        posted_at: new Date().toISOString()
      }, { onConflict: 'quote_id,mastodon_account_id' })
    
    if (error) {
      console.warn(`Error recording quote post: ${error.message}`)
    }
  } catch (err) {
    console.error('Exception recording quote post:', err)
  }
}

/**
 * Format quote for Mastodon posting
 */
function formatQuoteForMastodon(quoteText: string, philosopherName: string, source?: string): string {
  let status = `"${quoteText}"`
  
  // Add attribution
  if (source) {
    status += `\n\n— ${philosopherName}, ${source}`
  } else {
    status += `\n\n— ${philosopherName}`
  }
  
  // Ensure it fits in 500 characters (Mastodon limit)
  if (status.length > 500) {
    // Truncate quote if needed, keeping attribution
    const attribution = source 
      ? `\n\n— ${philosopherName}, ${source}`
      : `\n\n— ${philosopherName}`
    const maxQuoteLength = 500 - attribution.length - 4 // 4 for quotes and newlines
    status = `"${quoteText.substring(0, maxQuoteLength)}..."${attribution}`
  }
  
  return status
}

/**
 * Post a status to Mastodon (text only, no media)
 */
async function postStatusToMastodon(status: string, baseUrl: string, accessToken: string): Promise<{ id: string }> {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/statuses`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status }),
  })
  
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Status post failed ${res.status}: ${text}`)
  }
  
  return await res.json()
}

/**
 * Post quote for a philosopher account
 */
async function postForPhilosopher(philosopherName: string, accountId: string): Promise<{ success: boolean; error?: string; details?: any }> {
  try {
    console.log(`Processing post for philosopher: ${philosopherName}`)
    
    // Get account credentials
    const { data: account, error: accountError } = await supabase
      .from('mastodon_accounts')
      .select('mastodon_base_url, mastodon_access_token, account_username')
      .eq('id', accountId)
      .eq('active', true)
      .single()
    
    if (accountError || !account) {
      throw new Error(`No Mastodon account found for philosopher: ${philosopherName}`)
    }
    
    const credentials = {
      baseUrl: account.mastodon_base_url,
      accessToken: account.mastodon_access_token
    }
    
    // Get next quote to post
    const { quoteId, quoteText, allPosted } = await getNextQuote(philosopherName, accountId)
    
    if (!quoteId || !quoteText) {
      return { success: false, error: `No quotes found for philosopher: ${philosopherName}` }
    }
    
    // If all quotes have been posted, reset and get a fresh one
    if (allPosted) {
      console.log(`All quotes for ${philosopherName} have been posted. Resetting post history...`)
      await resetPhilosopherPostHistory(accountId)
      // Get a fresh quote after reset
      const fresh = await getNextQuote(philosopherName, accountId)
      if (!fresh.quoteId || !fresh.quoteText) {
        return { success: false, error: `No quotes available after reset for: ${philosopherName}` }
      }
      // Use the fresh quote
      const status = formatQuoteForMastodon(fresh.quoteText, philosopherName)
      const result = await postStatusToMastodon(status, credentials.baseUrl, credentials.accessToken)
      
      // Record the post
      await recordQuotePost(fresh.quoteId, accountId, result.id)
      await updateLastPostedAtForAccount(accountId)
      
      return {
        success: true,
        details: {
          quote_id: fresh.quoteId,
          status_id: result.id,
          quote: fresh.quoteText.substring(0, 50) + '...',
          philosopher: philosopherName,
          account_id: accountId,
          all_posted_reset: true
        }
      }
    }
    
    // Format and post the quote
    const status = formatQuoteForMastodon(quoteText, philosopherName)
    const result = await postStatusToMastodon(status, credentials.baseUrl, credentials.accessToken)
    
    // Record the post
    await recordQuotePost(quoteId, accountId, result.id)
    await updateLastPostedAtForAccount(accountId)
    
    return {
      success: true,
      details: {
        quote_id: quoteId,
        status_id: result.id,
        quote: quoteText.substring(0, 50) + '...',
        philosopher: philosopherName,
        account_id: accountId,
        all_posted_reset: false
      }
    }
  } catch (err) {
    console.error(`Error posting for philosopher ${philosopherName}:`, err)
    return { success: false, error: String(err) }
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
 * Update the last_posted_at timestamp for an account (by account ID)
 */
async function updateLastPostedAtForAccount(accountId: string): Promise<void> {
  try {
    const { error: updateError } = await supabase
      .from('mastodon_accounts')
      .update({ last_posted_at: new Date().toISOString() })
      .eq('id', accountId)
    
    if (updateError) {
      console.warn(`Could not update last_posted_at for account ${accountId}:`, updateError)
    }
  } catch (err) {
    console.error('Exception updating last_posted_at:', err)
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

    // If no artist specified, use automatic, interval-based rotation across all active accounts
    console.log('No artist specified, using automatic interval-based account rotation...')
    const activeAccounts = await getAllActiveAccounts()
    
    if (activeAccounts.length === 0) {
      return new Response(JSON.stringify({ 
        error: 'No active accounts found in mastodon_accounts table. Add accounts using the add-artist-bot script or manually.' 
      }), { 
        status: 404, 
        headers: { 'Content-Type': 'application/json' } 
      })
    }

    // Determine which account(s) to process
    // Option 1: Manual offset/limit (for debugging / one-off runs)
    // Option 2: Interval-based scheduling: each account posts every N hours, independent of account count
    
    let accountsToProcess: Array<{
      type: 'artist' | 'tag' | 'philosopher'
      identifier: string
      accountId: string
      lastPostedAt: string | null
      createdAt: string
    }> = []
    
    const explicitOffset = url.searchParams.get('offset')
    const explicitLimit = url.searchParams.get('limit')
    
    if (explicitOffset !== null && explicitLimit !== null) {
      // Manual pagination mode
      const offset = parseInt(explicitOffset)
      const limit = parseInt(explicitLimit)
      accountsToProcess = activeAccounts.slice(offset, offset + limit)
      console.log(`Manual pagination: Processing accounts ${offset + 1}-${offset + accountsToProcess.length} of ${activeAccounts.length}`)
    } else {
      // Interval-based scheduling: each account should post every interval_hours
      // Default: interval_hours=6 → 4 posts per account per day
      const intervalHours = parseFloat(url.searchParams.get('interval_hours') || '6')
      const maxAccounts = parseInt(url.searchParams.get('max_accounts') || '10')
      const intervalMs = intervalHours * 60 * 60 * 1000
      const nowMs = Date.now()

      const dueAccounts = activeAccounts
        .map(acc => {
          const createdMs = acc.createdAt ? new Date(acc.createdAt).getTime() : nowMs
          const lastMs = acc.lastPostedAt ? new Date(acc.lastPostedAt).getTime() : null
          const referenceMs = lastMs ?? createdMs
          const nextDueMs = referenceMs + intervalMs
          return { ...acc, referenceMs, nextDueMs }
        })
        .filter(acc => acc.nextDueMs <= nowMs)

      // Oldest (or never-posted) accounts first
      dueAccounts.sort((a, b) => a.referenceMs - b.referenceMs)

      accountsToProcess = dueAccounts.slice(0, maxAccounts)

      console.log(
        `Interval rotation: interval_hours=${intervalHours}, max_accounts=${maxAccounts}, ` +
        `due_accounts=${dueAccounts.length}, processing=${accountsToProcess.length}: ` +
        accountsToProcess.map(a => `${a.type}:${a.identifier}`).join(', ')
      )
    }

    if (accountsToProcess.length === 0) {
      return new Response(JSON.stringify({ 
        ok: true,
        mode: 'rotation',
        message: 'No accounts due for posting at this time',
        total_accounts: activeAccounts.length,
        processed_accounts: 0,
        successful: 0,
        failed: 0
      }), { 
        status: 200, 
        headers: { 'Content-Type': 'application/json', 'Connection': 'keep-alive' } 
      })
    }

    // Post for each selected account (no delays needed - cron schedule handles spacing)
    const successes: any[] = []
    const failures: any[] = []

    for (const account of accountsToProcess) {
      try {
        const result = account.type === 'tag'
          ? await postForTag(account.accountId)
          : account.type === 'philosopher'
          ? await postForPhilosopher(account.identifier, account.accountId)
          : await postForArtist(account.identifier)
        
        if (result.success) {
          successes.push({ 
            type: account.type,
            identifier: account.identifier,
            ...result.details 
          })
        } else {
          failures.push({ 
            type: account.type,
            identifier: account.identifier,
            error: result.error 
          })
        }
      } catch (err) {
        failures.push({ 
          type: account.type,
          identifier: account.identifier,
          error: String(err)
        })
      }
    }

    return new Response(JSON.stringify({ 
      ok: true,
      mode: 'rotation',
      total_accounts: activeAccounts.length,
      processed_accounts: accountsToProcess.length,
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


