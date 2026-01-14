// FULL MASTODON POSTING FUNCTION - Restored with all features
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey",
};

interface MastodonAccount {
  id: string;
  account_username: string;
  mastodon_base_url: string;
  mastodon_access_token: string;
  account_type: 'artist' | 'tag' | 'quote';
  active: boolean;
  last_posted_at: string | null;
  artist_id?: string;
  tag_id?: string;
  author_id?: string;
}

interface ArtAsset {
  id: string;
  art_id: string;
  storage_path: string;
  last_posted_at: string | null;
}

function getFileExtension(storagePath: string): string {
  const parts = storagePath.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : 'jpg';
}

/**
 * Fetch hashtags for an account from the database
 * Returns array of hashtag strings (e.g., ['#art', '#philosophy'])
 */
async function fetchAccountHashtags(accountId: string, supabase: any): Promise<string[]> {
  const { data: accountHashtags, error: hashtagError } = await supabase
    .from("mastodon_account_hashtags")
    .select(`
      hashtag_id,
      hashtags!inner(name)
    `)
    .eq("mastodon_account_id", accountId)
    .order("hashtags(name)", { ascending: true });

  if (!hashtagError && accountHashtags && accountHashtags.length > 0) {
    return accountHashtags.map((ah: any) => `#${ah.hashtags.name}`);
  }

  return [];
}

/**
 * Format quote text with hashtags
 * Fetches hashtags from mastodon_account_hashtags junction table
 * Falls back to category-based hashtag if no hashtags are assigned
 */
async function formatQuote(
  quote: { text: string; author: string; category?: string },
  accountId: string,
  supabase: any
): Promise<string> {
  // Try to fetch hashtags from junction table
  let hashtags = await fetchAccountHashtags(accountId, supabase);

  // Fallback to category-based hashtag if none assigned (backward compatibility)
  if (hashtags.length === 0) {
    let hashtag = '#philosophy';
    if (quote.category) {
      const categoryMap: Record<string, string> = {
        'philosopher': '#philosophy',
        'author': '#literature',
        'politics': '#politics',
        'scientist': '#science',
        'artist': '#art',
      };
      hashtag = categoryMap[quote.category.toLowerCase()] || `#${quote.category.toLowerCase()}`;
    }
    hashtags = [hashtag];
  }

  // Author name removed since account name already indicates who the quote is from
  const hashtagString = hashtags.join(' ');
  return `"${quote.text}"\n\n${hashtagString}`;
}

/**
 * Normalize Mastodon base URL to full API URL
 * Standard format: base URL is stored as "domain.com" (no protocol)
 * Returns: "https://domain.com" (with protocol, no trailing slash)
 */
function normalizeMastodonUrl(baseUrl: string): string {
  // Remove any existing protocol
  let url = baseUrl.replace(/^https?:\/\//, '');
  // Remove trailing slash
  url = url.replace(/\/$/, '');
  // Remove any path (keep only domain)
  const parts = url.split('/');
  const domain = parts[0];
  // Add https:// protocol
  return `https://${domain}`;
}

/**
 * Get display username (for logging)
 * Standard format: username is stored without @ symbols
 * Returns: username as-is (already normalized)
 */
function getDisplayUsername(username: string): string {
  // Username should already be normalized (no @ symbols)
  // But handle legacy data gracefully
  return username.replace(/^@+/, '').split('@')[0];
}

/**
 * Build full Mastodon handle for mentions
 * Standard format: username and domain are stored separately
 * Returns: "@username@domain"
 */
function buildMastodonHandle(username: string, baseUrl: string): string {
  const cleanUsername = getDisplayUsername(username);
  const domain = normalizeMastodonUrl(baseUrl).replace(/^https?:\/\//, '');
  return `@${cleanUsername}@${domain}`;
}

// DEBUG: Immediate logging to test if script loads
console.log("🚀 DEBUG: Script starting at", new Date().toISOString());
console.log("🚀 DEBUG: Deno version:", Deno.version);
console.log("🚀 DEBUG: Environment keys:", Object.keys(Deno.env.toObject()));

serve(async (req) => {
  const startTime = Date.now();
  console.log("🚀 CRON START: Function invoked with method:", req.method);
  console.log("🚀 CRON REQUEST: URL =", req.url);

  if (req.method === "OPTIONS") {
    console.log("🚀 CORS: Handling OPTIONS request");
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    console.log("🚀 CRON MAIN: Starting main logic");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    console.log("🚀 CRON ENV: SUPABASE_URL present:", !!supabaseUrl);
    console.log("🚀 CRON ENV: SUPABASE_SERVICE_ROLE_KEY present:", !!supabaseKey);

    if (!supabaseUrl || !supabaseKey) {
      console.error("🚀 CRON ERROR: Missing environment variables");
      throw new Error("Missing required environment variables");
    }

    console.log("🚀 CRON SUPABASE: Creating client");
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse query parameters
    const url = new URL(req.url);
    const artistParam = url.searchParams.get("artist");
    const accountParam = url.searchParams.get("account"); // New parameter for any account type
    const offset = parseInt(url.searchParams.get("offset") ?? "0") || 0;
    const limit = parseInt(url.searchParams.get("limit") ?? "10") || 10;
    const intervalHours = parseInt(url.searchParams.get("interval_hours") ?? "6") || 6;
    const maxAccounts = parseInt(url.searchParams.get("max_accounts") ?? "3") || 3;

    console.log(`🚀 CRON PARAMS: artist=${artistParam}, account=${accountParam}, interval=${intervalHours}h, max=${maxAccounts}`);

    let accountsToProcess: MastodonAccount[];

    // Support both 'artist' (backward compatibility) and 'account' (any type) parameters
    const usernameParam = accountParam || artistParam;
    
    if (usernameParam) {
      const accountType = artistParam ? "artist" : undefined; // If using 'artist' param, filter to artist type
      console.log(`🚀 CRON MANUAL: Processing specific account: ${usernameParam}${accountType ? ` (type: ${accountType})` : ''}`);
      
      let query = supabase
        .from("mastodon_accounts")
        .select("*")
        .eq("account_username", usernameParam)
        .eq("active", true);
      
      if (accountType) {
        query = query.eq("account_type", accountType);
      } else {
        // If using 'account' param, allow any type (artist, tag, quote)
        query = query.in("account_type", ["artist", "tag", "quote"]);
      }
      
      const { data: account, error } = await query.single();

      if (error || !account) {
        throw new Error(`Account "${usernameParam}" not found or inactive`);
      }
      accountsToProcess = [account];
    } else {
      const now = new Date();
      const intervalMs = intervalHours * 60 * 60 * 1000;
      const cutoffTime = new Date(now.getTime() - intervalMs);

      console.log(`🚀 CRON SCHEDULE: Finding accounts due before ${cutoffTime.toISOString()}`);

      console.log(`🚀 CRON QUERY: offset=${offset}, limit=${limit}, cutoff=${cutoffTime.toISOString()}`);

      // Query accounts that are due to post (never posted OR posted more than intervalHours ago)
      // Use separate queries and combine, as .or() filter can be unreliable with date comparisons
      // Only get artist, tag, and quote accounts (not mtg/yugioh)
      console.log(`🚀 CRON QUERY: Fetching never-posted accounts...`);
      const { data: neverPosted, error: neverPostedError } = await supabase
        .from("mastodon_accounts")
        .select("*")
        .eq("active", true)
        .in("account_type", ["artist", "tag", "quote"])
        .is("last_posted_at", null)
        .order("created_at", { ascending: true })
        .limit(limit * 2); // Get more to account for pagination

      console.log(`🚀 CRON QUERY: Fetching old-posted accounts (before ${cutoffTime.toISOString()})...`);
      const { data: oldPosted, error: oldPostedError } = await supabase
        .from("mastodon_accounts")
        .select("*")
        .eq("active", true)
        .in("account_type", ["artist", "tag", "quote"])
        .not("last_posted_at", "is", null)
        .lt("last_posted_at", cutoffTime.toISOString())
        .order("last_posted_at", { ascending: true })
        .limit(limit * 2); // Get more to account for pagination

      if (neverPostedError) {
        console.error("🚀 CRON ERROR: Failed to fetch never-posted accounts:", neverPostedError);
        throw new Error(`Failed to fetch never-posted accounts: ${neverPostedError.message}`);
      }
      if (oldPostedError) {
        console.error("🚀 CRON ERROR: Failed to fetch old-posted accounts:", oldPostedError);
        throw new Error(`Failed to fetch old-posted accounts: ${oldPostedError.message}`);
      }

      console.log(`🚀 CRON QUERY: Found ${neverPosted?.length || 0} never-posted, ${oldPosted?.length || 0} old-posted accounts`);

      // Combine results, prioritizing never-posted accounts
      const allAccounts = [
        ...(neverPosted || []),
        ...(oldPosted || [])
      ];

      // Remove duplicates (in case an account appears in both)
      const uniqueAccounts = allAccounts.filter((account, index, self) =>
        index === self.findIndex((a) => a.id === account.id)
      );

      // Sort: never-posted first, then by last_posted_at ascending
      uniqueAccounts.sort((a, b) => {
        if (!a.last_posted_at && !b.last_posted_at) return 0;
        if (!a.last_posted_at) return -1;
        if (!b.last_posted_at) return 1;
        return new Date(a.last_posted_at).getTime() - new Date(b.last_posted_at).getTime();
      });

      // Apply pagination
      const accounts = uniqueAccounts.slice(offset, offset + limit);

      console.log(`🚀 CRON QUERY RESULT: data length=${accounts?.length || 0}`);

      accountsToProcess = accounts || [];
      console.log(`🚀 CRON FOUND: ${accountsToProcess.length} accounts due to post`);

      if (accountsToProcess.length > 0) {
        console.log(`🚀 CRON ACCOUNTS: ${accountsToProcess.map(acc => buildMastodonHandle(acc.account_username, acc.mastodon_base_url) + ` (${acc.account_type})`).join(', ')}`);
      } else {
        console.log(`🚀 CRON EMPTY: No accounts due to post at this time`);
      }
    }

    let processedCount = 0;

    for (const account of accountsToProcess) {
      // Check if we're running out of time (leave 10 seconds buffer)
      const elapsedMs = Date.now() - startTime;
      if (elapsedMs > 50000) { // 50 seconds
        console.log(`🚀 CRON TIMEOUT: Stopping early after ${elapsedMs}ms to avoid function timeout`);
        break;
      }
      try {
        // Normalize Mastodon URL once at the start
        const mastodonUrl = normalizeMastodonUrl(account.mastodon_base_url);
        const displayHandle = buildMastodonHandle(account.account_username, account.mastodon_base_url);
        console.log(`🚀 CRON PROCESSING: ${displayHandle} (type: ${account.account_type})`);

        // Skip recently posted accounts (prevent double-posting)
        if (account.last_posted_at) {
          const lastPostTime = new Date(account.last_posted_at);
          const minutesSinceLastPost = (Date.now() - lastPostTime.getTime()) / (1000 * 60);
          if (minutesSinceLastPost < 5) {
            console.log(`🚀 CRON SKIP: Posted ${minutesSinceLastPost.toFixed(1)} minutes ago`);
            continue;
          }
        }

        let artwork: ArtAsset | null = null;
        let postText = '';

        if (account.account_type === 'artist') {
          console.log(`🚀 CRON ARTIST: Processing artist account, artist_id: ${account.artist_id}`);

          if (!account.artist_id) {
            console.log(`🚀 CRON SKIP: Artist account missing artist_id`);
            continue;
          }

          // Verify the artist actually exists
          const { data: artistCheck, error: artistCheckError } = await supabase
            .from("artists")
            .select("id, name")
            .eq("id", account.artist_id)
            .single();

          if (artistCheckError || !artistCheck) {
            console.log(`🚀 CRON SKIP: Artist ${account.artist_id} not found in database, error: ${artistCheckError}`);
            continue;
          }

          console.log(`🚀 CRON ARTIST: Artist verified: ${artistCheck.name} (ID: ${artistCheck.id})`);

          console.log(`🚀 CRON ARTIST: Getting artwork for artist ${account.artist_id}`);

          // First check total arts available
          const { count: totalArts, error: countError } = await supabase
            .from("arts")
            .select("*", { count: "exact", head: true })
            .eq("artist_id", account.artist_id);

          console.log(`🚀 CRON ARTIST: Total arts for artist: ${totalArts}, error: ${countError}`);

          const { data: arts, error: artsError } = await supabase
            .from("arts")
            .select("id")
            .eq("artist_id", account.artist_id);

          console.log(`🚀 CRON ARTIST: Arts query result: ${arts?.length || 0} arts, error: ${artsError}`);

          if (artsError || !arts || arts.length === 0) {
            console.log(`🚀 CRON SKIP: No arts found for artist`);
            continue;
          }

          const artIds = arts.map(art => art.id);
          console.log(`🚀 CRON ARTIST: Found ${artIds.length} art IDs`);

          if (artIds.length === 0) {
            console.log(`🚀 CRON SKIP: No art IDs found for artist`);
            continue;
          }

          // Batch query to avoid URL length limits
          // Query in chunks of 100 art IDs to avoid exceeding URL length
          const BATCH_SIZE = 100;
          let assets: any[] | null = null;
          let assetsError: any = null;

          // Try to find unposted assets by querying in batches
          for (let i = 0; i < artIds.length; i += BATCH_SIZE) {
            const batch = artIds.slice(i, i + BATCH_SIZE);
            const { data: batchAssets, error: batchError } = await supabase
              .from("art_assets")
              .select("id, art_id, storage_path, last_posted_at")
              .in("art_id", batch)
              .is("last_posted_at", null)
              .order("created_at", { ascending: true })
              .limit(1);

            if (batchError) {
              console.error(`🚀 CRON ARTIST ERROR: Batch ${i / BATCH_SIZE + 1} failed:`, JSON.stringify(batchError, null, 2));
              assetsError = batchError;
              continue;
            }

            if (batchAssets && batchAssets.length > 0) {
              assets = batchAssets;
              console.log(`🚀 CRON ARTIST: Found unposted asset in batch ${i / BATCH_SIZE + 1}`);
              break;
            }
          }

          if (assetsError && !assets) {
            console.error(`🚀 CRON ARTIST ERROR: All batches failed for unposted assets`);
          }
          console.log(`🚀 CRON ARTIST: Unposted assets found: ${assets?.length || 0}`);

          if (assets && assets.length > 0) {
            console.log(`🚀 CRON ARTIST: Using unposted asset: ${assets[0].id} (${assets[0].storage_path})`);
            artwork = assets[0];
          } else {
            console.log(`🚀 CRON ARTIST: No unposted assets, checking for repost candidates`);

            // Query old assets in batches
            let oldAssets: any[] | null = null;
            let oldError: any = null;

            for (let i = 0; i < artIds.length; i += BATCH_SIZE) {
              const batch = artIds.slice(i, i + BATCH_SIZE);
              const { data: batchOldAssets, error: batchOldError } = await supabase
                .from("art_assets")
                .select("id, art_id, storage_path, last_posted_at")
                .in("art_id", batch)
                .not("last_posted_at", "is", null)
                .order("last_posted_at", { ascending: true })
                .limit(1);

              if (batchOldError) {
                console.error(`🚀 CRON ARTIST ERROR: Batch ${i / BATCH_SIZE + 1} failed for old assets:`, JSON.stringify(batchOldError, null, 2));
                oldError = batchOldError;
                continue;
              }

              if (batchOldAssets && batchOldAssets.length > 0) {
                // Keep track of the oldest one across all batches
                if (!oldAssets || new Date(batchOldAssets[0].last_posted_at) < new Date(oldAssets[0].last_posted_at)) {
                  oldAssets = batchOldAssets;
                }
              }
            }

            if (oldError && !oldAssets) {
              console.error(`🚀 CRON ARTIST ERROR: All batches failed for old assets`);
            }
            console.log(`🚀 CRON ARTIST: Old assets found: ${oldAssets?.length || 0}`);

            if (oldAssets && oldAssets.length > 0) {
              console.log(`🚀 CRON ARTIST: Using old asset: ${oldAssets[0].id} (${oldAssets[0].storage_path})`);
              artwork = oldAssets[0];
            } else {
              console.log(`🚀 CRON ARTIST: No assets available at all`);
            }
          }
          
          // Set post text for artist accounts (hashtags)
          if (artwork) {
            const hashtags = await fetchAccountHashtags(account.id, supabase);
            postText = hashtags.length > 0 ? hashtags.join(' ') : '#art'; // Fallback to #art if no hashtags assigned
          }

        } else if (account.account_type === 'tag') {
          console.log(`🚀 CRON TAG: Processing tag account, tag_id: ${account.tag_id}`);

          let tagIdToUse = account.tag_id;

          // If no tag_id in the account, try to get it from the junction table
          if (!tagIdToUse) {
            console.log(`🚀 CRON TAG: No tag_id in account, checking junction table`);
            const { data: junctionData, error: junctionError } = await supabase
              .from("mastodon_account_tags")
              .select("tag_id")
              .eq("mastodon_account_id", account.id)
              .limit(1);

            if (!junctionError && junctionData && junctionData.length > 0) {
              tagIdToUse = junctionData[0].tag_id;
              console.log(`🚀 CRON TAG: Found tag_id ${tagIdToUse} in junction table`);
            }
          }

          if (!tagIdToUse) {
            console.log(`🚀 CRON SKIP: Tag account has no associated tags`);
            continue;
          }

          console.log(`🚀 CRON TAG: Getting artwork for tag ${tagIdToUse}`);

          const { data: taggedArts, error: tagError } = await supabase
            .from("art_tags")
            .select("art_id")
            .eq("tag_id", tagIdToUse);

          if (tagError || !taggedArts || taggedArts.length === 0) {
            console.log(`🚀 CRON SKIP: No tagged arts found`);
            continue;
          }

          const artIds = taggedArts.map(ta => ta.art_id);
          console.log(`🚀 CRON TAG: Found ${artIds.length} tagged arts`);

          if (artIds.length === 0) {
            console.log(`🚀 CRON SKIP: No art IDs found for tag`);
            continue;
          }

          // Batch query to avoid URL length limits
          // Query in chunks of 100 art IDs to avoid exceeding URL length
          const BATCH_SIZE = 100;
          let assets: any[] | null = null;
          let assetsError: any = null;

          // Try to find unposted assets by querying in batches
          for (let i = 0; i < artIds.length; i += BATCH_SIZE) {
            const batch = artIds.slice(i, i + BATCH_SIZE);
            const { data: batchAssets, error: batchError } = await supabase
              .from("art_assets")
              .select("id, art_id, storage_path, last_posted_at")
              .in("art_id", batch)
              .is("last_posted_at", null)
              .order("created_at", { ascending: true })
              .limit(1);

            if (batchError) {
              console.error(`🚀 CRON TAG ERROR: Batch ${i / BATCH_SIZE + 1} failed:`, JSON.stringify(batchError, null, 2));
              assetsError = batchError;
              continue;
            }

            if (batchAssets && batchAssets.length > 0) {
              assets = batchAssets;
              console.log(`🚀 CRON TAG: Found unposted asset in batch ${i / BATCH_SIZE + 1}`);
              break;
            }
          }

          if (assetsError && !assets) {
            console.error(`🚀 CRON TAG ERROR: All batches failed for unposted assets`);
          }

          if (assets && assets.length > 0) {
            artwork = assets[0];
          } else {
            // Query old assets in batches
            let oldAssets: any[] | null = null;
            let oldError: any = null;

            for (let i = 0; i < artIds.length; i += BATCH_SIZE) {
              const batch = artIds.slice(i, i + BATCH_SIZE);
              const { data: batchOldAssets, error: batchOldError } = await supabase
                .from("art_assets")
                .select("id, art_id, storage_path, last_posted_at")
                .in("art_id", batch)
                .not("last_posted_at", "is", null)
                .order("last_posted_at", { ascending: true })
                .limit(1);

              if (batchOldError) {
                console.error(`🚀 CRON TAG ERROR: Batch ${i / BATCH_SIZE + 1} failed for old assets:`, JSON.stringify(batchOldError, null, 2));
                oldError = batchOldError;
                continue;
              }

              if (batchOldAssets && batchOldAssets.length > 0) {
                // Keep track of the oldest one across all batches
                if (!oldAssets || new Date(batchOldAssets[0].last_posted_at) < new Date(oldAssets[0].last_posted_at)) {
                  oldAssets = batchOldAssets;
                }
              }
            }

            if (oldError && !oldAssets) {
              console.error(`🚀 CRON TAG ERROR: All batches failed for old assets`);
            }

            if (oldAssets && oldAssets.length > 0) {
              artwork = oldAssets[0];
            }
          }

          // Generate post text for tag accounts
          if (artwork) {
            const { data: artData, error: artError } = await supabase
              .from('arts')
              .select(`
                artist_id,
                artists!inner(name)
              `)
              .eq('id', artwork.art_id)
              .single();

            if (!artError && artData?.artists?.name) {
              postText = artData.artists.name;

              // Check for artist bot link
              const { data: artistBot, error: botError } = await supabase
                .from('mastodon_accounts')
                .select('account_username, mastodon_base_url')
                .eq('account_type', 'artist')
                .eq('artist_id', artData.artist_id)
                .eq('active', true)
                .single();

              if (!botError && artistBot) {
                // Build full Mastodon handle for mention
                const mention = buildMastodonHandle(artistBot.account_username, artistBot.mastodon_base_url);
                postText += `\n\n${mention}`;
              }
              
              // Add hashtags from database
              const hashtags = await fetchAccountHashtags(account.id, supabase);
              if (hashtags.length > 0) {
                postText += `\n\n${hashtags.join(' ')}`;
              } else {
                postText += '\n\n#art'; // Fallback to #art if no hashtags assigned
              }
            }
          }

        } else if (account.account_type === 'quote') {
          console.log(`🚀 CRON QUOTE: Processing quote account, author_id: ${account.author_id}`);

          if (!account.author_id) {
            console.log(`🚀 CRON SKIP: Quote account missing author_id`);
            continue;
          }

          // Verify the quote author actually exists and get category
          const { data: authorCheck, error: authorCheckError } = await supabase
            .from("quote_authors")
            .select("id, name, category")
            .eq("id", account.author_id)
            .single();

          if (authorCheckError || !authorCheck) {
            console.log(`🚀 CRON SKIP: Quote author ${account.author_id} not found in database, error: ${authorCheckError}`);
            continue;
          }

          console.log(`🚀 CRON QUOTE: Quote author verified: ${authorCheck.name} (ID: ${authorCheck.id})`);
          console.log(`🚀 CRON QUOTE: Getting quote for author ${account.author_id}`);

          // First check total quotes available
          const { count: totalQuotes, error: countError } = await supabase
            .from("quotes")
            .select("*", { count: "exact", head: true })
            .eq("author_id", account.author_id);

          console.log(`🚀 CRON QUOTE: Total quotes for author: ${totalQuotes}, error: ${countError}`);

          // Get next quote (never posted to this account first, then oldest)
          // Find quotes that haven't been posted to this account yet
          // Get all quotes for this author
          const { data: allQuotes, error: allQuotesError } = await supabase
            .from("quotes")
            .select("id")
            .eq("author_id", account.author_id);

          if (allQuotesError) {
            console.error(`🚀 CRON QUOTE ERROR: Failed to get all quotes:`, JSON.stringify(allQuotesError, null, 2));
            continue;
          }

          const allQuoteIds = (allQuotes || []).map(q => q.id);
          console.log(`🚀 CRON QUOTE: Total quotes for author: ${allQuoteIds.length}`);

          // Get quotes already posted to this account
          const { data: postedQuotes, error: postedQuotesError } = await supabase
            .from("quote_posts")
            .select("quote_id")
            .eq("mastodon_account_id", account.id);

          if (postedQuotesError) {
            console.error(`🚀 CRON QUOTE ERROR: Failed to get posted quotes:`, JSON.stringify(postedQuotesError, null, 2));
            continue;
          }

          const postedQuoteIds = new Set((postedQuotes || []).map(p => p.quote_id));
          let unpostedQuoteIds = allQuoteIds.filter(id => !postedQuoteIds.has(id));

          console.log(`🚀 CRON QUOTE: Posted quotes: ${postedQuoteIds.size}, Unposted quotes: ${unpostedQuoteIds.length}`);

          let selectedQuote: any = null;
          const MAX_MASTODON_LENGTH = 500;
          const MAX_RETRIES = 5; // Try up to 5 quotes before giving up
          let attempts = 0;

          // Try to find a quote that fits within Mastodon's character limit
          while (!selectedQuote && attempts < MAX_RETRIES && unpostedQuoteIds.length > 0) {
            attempts++;
            
            // Get next unposted quote with author info
            const { data: unpostedQuotes, error: unpostedError } = await supabase
              .from("quotes")
              .select(`
                id, 
                text,
                quote_authors!inner(name, category)
              `)
              .eq("author_id", account.author_id)
              .in("id", unpostedQuoteIds)
              .order("created_at", { ascending: true })
              .limit(1);

            if (unpostedError) {
              console.error(`🚀 CRON QUOTE ERROR: Failed to get unposted quote (attempt ${attempts}):`, JSON.stringify(unpostedError, null, 2));
              break;
            } else if (unpostedQuotes && unpostedQuotes.length > 0) {
              const candidateQuote = unpostedQuotes[0];
              const formattedText = await formatQuote({ 
                text: candidateQuote.text, 
                author: candidateQuote.quote_authors.name,
                category: candidateQuote.quote_authors.category || authorCheck?.category || 'philosopher'
              }, account.id, supabase);

              // Check if quote fits within Mastodon's character limit
              if (formattedText.length <= MAX_MASTODON_LENGTH) {
                selectedQuote = candidateQuote;
                console.log(`🚀 CRON QUOTE: Using unposted quote: ${selectedQuote.id} (${formattedText.length} chars)`);
              } else {
                console.log(`🚀 CRON QUOTE: Quote ${candidateQuote.id} too long (${formattedText.length} chars, limit: ${MAX_MASTODON_LENGTH}), marking as skipped`);
                
                // Mark this quote as "posted" so it won't be selected again
                const now = new Date().toISOString();
                const { error: skipError } = await supabase
                  .from("quote_posts")
                  .insert({
                    quote_id: candidateQuote.id,
                    mastodon_account_id: account.id,
                    mastodon_status_id: null, // No actual status ID since we didn't post
                    posted_at: now,
                  });

                if (skipError) {
                  console.error(`🚀 CRON QUOTE ERROR: Failed to mark long quote as skipped:`, skipError);
                  // Remove from list manually if DB insert failed
                  unpostedQuoteIds = unpostedQuoteIds.filter(id => id !== candidateQuote.id);
                } else {
                  // Remove from unposted list since it's now marked as posted
                  unpostedQuoteIds = unpostedQuoteIds.filter(id => id !== candidateQuote.id);
                  console.log(`🚀 CRON QUOTE: Quote marked as skipped, ${unpostedQuoteIds.length} unposted quotes remaining`);
                }
                
                // Continue to next quote
                continue;
              }
            } else {
              break; // No more quotes found
            }
          }

          if (attempts >= MAX_RETRIES && !selectedQuote) {
            console.log(`🚀 CRON QUOTE: Tried ${MAX_RETRIES} quotes, all too long. Moving to repost logic.`);
          }

          // If no unposted quotes, get the oldest posted quote for reposting
          if (!selectedQuote) {
            console.log(`🚀 CRON QUOTE: No unposted quotes, checking for repost candidates`);

            const { data: oldestPost, error: oldestError } = await supabase
              .from("quote_posts")
              .select(`
                quote_id,
                posted_at,
                quotes!inner(
                  id,
                  text,
                  quote_authors!inner(name, category)
                )
              `)
              .eq("mastodon_account_id", account.id)
              .order("posted_at", { ascending: true })
              .limit(1);

            if (oldestError) {
              console.error(`🚀 CRON QUOTE ERROR: Failed to query oldest post:`, JSON.stringify(oldestError, null, 2));
            } else if (oldestPost && oldestPost.length > 0) {
              const post = oldestPost[0] as any;
              selectedQuote = post.quotes;
              console.log(`🚀 CRON QUOTE: Using oldest posted quote for repost: ${selectedQuote.id}`);
            } else {
              console.log(`🚀 CRON QUOTE: No quotes available at all`);
            }
          }

          if (selectedQuote) {
            artwork = {
              id: selectedQuote.id,
              art_id: '',
              storage_path: '',
              last_posted_at: null
            };
            postText = await formatQuote({ 
              text: selectedQuote.text, 
              author: selectedQuote.quote_authors.name,
              category: selectedQuote.quote_authors.category || authorCheck?.category || 'philosopher'
            }, account.id, supabase);
          }
        } else {
          console.log(`🚀 CRON SKIP: Unsupported account type: ${account.account_type}`);
          continue;
        }

        if (!artwork) {
          console.log(`🚀 CRON SKIP: No content found for account`);
          continue;
        }

        console.log(`🚀 CRON CONTENT: Found ${account.account_type} content ${artwork.id}`);

        // Handle quote accounts (text-only posts)
        if (account.account_type === 'quote') {
          // Quote length is already checked during selection, but double-check here as safety
          const MAX_MASTODON_LENGTH = 500;
          if (postText.length > MAX_MASTODON_LENGTH) {
            console.log(`🚀 CRON QUOTE SKIP: Quote too long (${postText.length} chars, limit: ${MAX_MASTODON_LENGTH}) - this shouldn't happen!`);
            console.log(`🚀 CRON QUOTE SKIP: Marking quote ${artwork.id} as posted to skip it in future`);
            
            // Mark this quote as "posted" (even though we didn't post it) so it won't be selected again
            const now = new Date().toISOString();
            const { error: skipError } = await supabase
              .from("quote_posts")
              .insert({
                quote_id: artwork.id,
                mastodon_account_id: account.id,
                mastodon_status_id: null,
                posted_at: now,
              });

            if (skipError) {
              console.error(`🚀 CRON ERROR: Failed to mark long quote as skipped:`, skipError);
            }
            
            continue;
          }

          console.log(`🚀 CRON POSTING: Quote to ${buildMastodonHandle(account.account_username, account.mastodon_base_url)} (${postText.length} chars)`);

          const statusResponse = await fetch(`${mastodonUrl}/api/v1/statuses`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${account.mastodon_access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              status: postText,
              visibility: 'public',
            }),
          });

          if (!statusResponse.ok) {
            const errorText = await statusResponse.text();
            console.error(`🚀 CRON ERROR: Failed to post quote: ${statusResponse.status} ${errorText}`);
            
            // If it's a length error, mark the quote as skipped
            if (statusResponse.status === 422 && errorText.includes('character limit')) {
              console.log(`🚀 CRON QUOTE SKIP: Mastodon rejected quote due to length, marking as skipped`);
              const now = new Date().toISOString();
              await supabase
                .from("quote_posts")
                .insert({
                  quote_id: artwork.id,
                  mastodon_account_id: account.id,
                  mastodon_status_id: null,
                  posted_at: now,
                });
            }
            continue;
          }

          const statusResult = await statusResponse.json();
          console.log(`🚀 CRON SUCCESS: Posted quote - Status ID: ${statusResult.id}`);

          // Update tracking (quote_posts table tracks which quotes were posted to which accounts)
          const now = new Date().toISOString();
          const { error: insertPostError } = await supabase
            .from("quote_posts")
            .insert({
              quote_id: artwork.id,
              mastodon_account_id: account.id,
              mastodon_status_id: statusResult.id,
              posted_at: now,
            });

          if (insertPostError) {
            console.error(`🚀 CRON ERROR: Failed to insert quote_posts record:`, insertPostError);
          }

          await supabase
            .from("mastodon_accounts")
            .update({ last_posted_at: now })
            .eq("id", account.id);

          processedCount++;
          continue;
        }

        // Handle artist and tag accounts (image posts)
        console.log(`🚀 CRON DOWNLOAD: Downloading image ${artwork.storage_path}`);

        const { data: imageBlob, error: downloadError } = await supabase.storage
          .from('Art')
          .download(artwork.storage_path);

        if (downloadError) {
          console.error(`🚀 CRON ERROR: Failed to download image:`, downloadError);
          // Mark as posted to avoid infinite retries
          const now = new Date().toISOString();
          await supabase
            .from("art_assets")
            .update({ last_posted_at: now })
            .eq("id", artwork.id);
          continue;
        }

        console.log(`🚀 CRON IMAGE: Downloaded ${imageBlob.size} bytes`);

        // Upload to Mastodon
        console.log(`🚀 CRON MASTODON: Uploading media to ${mastodonUrl}`);

        const formData = new FormData();
        formData.append('file', imageBlob, `artwork.${getFileExtension(artwork.storage_path)}`);

        const mediaResponse = await fetch(`${mastodonUrl}/api/v1/media`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${account.mastodon_access_token}`,
          },
          body: formData,
        });

        const mediaResponseText = await mediaResponse.text();
        
        if (!mediaResponse.ok) {
          console.error(`🚀 CRON ERROR: Failed to upload media: ${mediaResponse.status} ${mediaResponseText}`);
          // Mark as posted to avoid infinite retries
          const now = new Date().toISOString();
          await supabase
            .from("art_assets")
            .update({ last_posted_at: now })
            .eq("id", artwork.id);
          continue;
        }

        let mediaData;
        try {
          console.log(`🚀 CRON MEDIA RESPONSE: ${mediaResponseText.substring(0, 200)}`);
          mediaData = JSON.parse(mediaResponseText);
        } catch (parseError) {
          console.error(`🚀 CRON ERROR: Failed to parse media response:`, parseError);
          console.error(`🚀 CRON MEDIA RESPONSE TEXT: ${mediaResponseText}`);
          // Mark as posted to avoid infinite retries
          const now = new Date().toISOString();
          await supabase
            .from("art_assets")
            .update({ last_posted_at: now })
            .eq("id", artwork.id);
          continue;
        }

        if (!mediaData.id) {
          console.error(`🚀 CRON ERROR: Media upload response missing ID:`, JSON.stringify(mediaData));
          // Mark as posted to avoid infinite retries
          const now = new Date().toISOString();
          await supabase
            .from("art_assets")
            .update({ last_posted_at: now })
            .eq("id", artwork.id);
          continue;
        }

        const mediaId = mediaData.id;
        console.log(`🚀 CRON MEDIA: Uploaded successfully, ID: ${mediaId}, State: ${mediaData.state || 'unknown'}`);

        // Wait for media processing - check state and poll if needed
        let mediaProcessed = mediaData.state === 'processed' || !mediaData.state;
        let mediaFailed = false;
        let waitAttempts = 0;
        const maxWaitAttempts = 10; // 10 attempts * 2 seconds = 20 seconds max
        
        while (!mediaProcessed && !mediaFailed && waitAttempts < maxWaitAttempts) {
          waitAttempts++;
          console.log(`🚀 CRON WAIT: Media processing... (attempt ${waitAttempts}/${maxWaitAttempts}, state: ${mediaData.state})`);
          await new Promise((resolve) => setTimeout(resolve, 2000));
          
          // Check media status
          const statusCheckResponse = await fetch(`${mastodonUrl}/api/v1/media/${mediaId}`, {
            headers: {
              Authorization: `Bearer ${account.mastodon_access_token}`,
            },
          });
          
          if (statusCheckResponse.ok) {
            const statusCheckText = await statusCheckResponse.text();
            let statusData;
            try {
              statusData = JSON.parse(statusCheckText);
            } catch (parseError) {
              console.log(`🚀 CRON WARNING: Could not parse media status response: ${statusCheckText.substring(0, 100)}`);
              // Assume processed if we can't parse
              mediaProcessed = true;
              continue;
            }
            
            console.log(`🚀 CRON MEDIA STATUS: State: ${statusData.state || 'unknown'}`);
            if (statusData.state === 'processed' || !statusData.state) {
              mediaProcessed = true;
            } else if (statusData.state === 'failed') {
              console.error(`🚀 CRON ERROR: Media processing failed: ${statusData.error || 'Unknown error'}`);
              // Mark as posted to avoid infinite retries
              const now = new Date().toISOString();
              await supabase
                .from("art_assets")
                .update({ last_posted_at: now })
                .eq("id", artwork.id);
              mediaFailed = true;
              break;
            }
          } else {
            const errorText = await statusCheckResponse.text();
            console.log(`🚀 CRON WARNING: Could not check media status (${statusCheckResponse.status}): ${errorText.substring(0, 100)}, assuming processed`);
            mediaProcessed = true; // Assume processed if we can't check
          }
        }
        
        if (mediaFailed) {
          console.log(`🚀 CRON SKIP: Skipping post due to media processing failure`);
          continue; // Skip to next account
        }
        
        if (!mediaProcessed) {
          console.log(`🚀 CRON WARNING: Media may still be processing, but proceeding with post`);
        }

        // Create status post
        console.log(`🚀 CRON POSTING: Creating status post`);
        console.log(`🚀 CRON POST TEXT: "${postText}"`);

        const statusData = {
          status: postText,
          media_ids: [mediaId],
          visibility: 'public',
        };

        const statusResponse = await fetch(`${mastodonUrl}/api/v1/statuses`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${account.mastodon_access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(statusData),
        });

        const statusResponseText = await statusResponse.text();
        console.log(`🚀 CRON STATUS RESPONSE: ${statusResponse.status} - ${statusResponseText.substring(0, 200)}`);

        if (!statusResponse.ok) {
          console.error(`🚀 CRON ERROR: Failed to create status: ${statusResponse.status} ${statusResponseText}`);
          // Mark as posted to avoid infinite retries
          const now = new Date().toISOString();
          await supabase
            .from("art_assets")
            .update({ last_posted_at: now })
            .eq("id", artwork.id);
          continue;
        }

        let statusResult;
        try {
          statusResult = JSON.parse(statusResponseText);
        } catch (parseError) {
          console.error(`🚀 CRON ERROR: Failed to parse status response: ${statusResponseText}`);
          // Mark as posted to avoid infinite retries
          const now = new Date().toISOString();
          await supabase
            .from("art_assets")
            .update({ last_posted_at: now })
            .eq("id", artwork.id);
          continue;
        }

        if (!statusResult.id) {
          console.error(`🚀 CRON ERROR: Status response missing ID:`, JSON.stringify(statusResult));
          // Mark as posted to avoid infinite retries
          const now = new Date().toISOString();
          await supabase
            .from("art_assets")
            .update({ last_posted_at: now })
            .eq("id", artwork.id);
          continue;
        }

        console.log(`🚀 CRON SUCCESS: Posted artwork - Status ID: ${statusResult.id}, URL: ${statusResult.url || 'N/A'}`);

        // Verify the post was actually created by checking if status ID exists
        if (!statusResult.id) {
          console.error(`🚀 CRON ERROR: Status creation succeeded but no ID returned:`, JSON.stringify(statusResult));
          // Don't update last_posted_at - let it retry
          continue;
        }

        // Update tracking - only if post was successful
        const now = new Date().toISOString();

        const { error: updateAssetError } = await supabase
          .from("art_assets")
          .update({ last_posted_at: now })
          .eq("id", artwork.id);

        if (updateAssetError) {
          console.error(`🚀 CRON ERROR: Failed to update art_asset:`, updateAssetError);
          // Don't update account timestamp if asset update failed - this prevents inconsistent state
          continue;
        }

        const { error: updateAccountError } = await supabase
          .from("mastodon_accounts")
          .update({ last_posted_at: now })
          .eq("id", account.id);

        if (updateAccountError) {
          console.error(`🚀 CRON ERROR: Failed to update account:`, updateAccountError);
          // Account update failed - this is bad but we already updated the asset
          // Log it but don't fail the whole operation
          // However, this means the account will be eligible again soon
        } else {
          console.log(`🚀 CRON COMPLETE: Successfully posted and updated tracking for ${buildMastodonHandle(account.account_username, account.mastodon_base_url)}`);
          processedCount++;
        }

      } catch (accountError) {
        console.error(`🚀 CRON ERROR: Failed to process account ${buildMastodonHandle(account.account_username, account.mastodon_base_url)}:`, accountError);
      }
    }

    console.log(`🚀 CRON FINISHED: Processed ${processedCount} accounts`);

    return new Response(
      JSON.stringify({
        success: true,
        processed: processedCount,
        message: `Processed ${processedCount} accounts`
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error) {
    console.error("🚀 CRON FATAL ERROR:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});