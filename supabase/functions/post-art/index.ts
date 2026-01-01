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
  account_type: 'artist' | 'tag' | 'philosopher';
  active: boolean;
  last_posted_at: string | null;
  artist_id?: string;
  tag_id?: string;
  philosopher_id?: string;
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

function formatQuote(quote: { text: string; author: string }): string {
  return `"${quote.text}"\n\n— ${quote.author}`;
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
    const offset = parseInt(url.searchParams.get("offset") ?? "0") || 0;
    const limit = parseInt(url.searchParams.get("limit") ?? "10") || 10;
    const intervalHours = parseInt(url.searchParams.get("interval_hours") ?? "6") || 6;
    const maxAccounts = parseInt(url.searchParams.get("max_accounts") ?? "3") || 3;

    console.log(`🚀 CRON PARAMS: artist=${artistParam}, interval=${intervalHours}h, max=${maxAccounts}`);

    let accountsToProcess: MastodonAccount[];

    if (artistParam) {
      console.log(`🚀 CRON MANUAL: Processing specific artist: ${artistParam}`);
      const { data: account, error } = await supabase
        .from("mastodon_accounts")
        .select("*")
        .eq("account_username", artistParam)
        .eq("account_type", "artist")
        .single();

      if (error || !account) {
        throw new Error(`Artist account "${artistParam}" not found`);
      }
      accountsToProcess = [account];
    } else {
      const now = new Date();
      const intervalMs = intervalHours * 60 * 60 * 1000;
      const cutoffTime = new Date(now.getTime() - intervalMs);

      console.log(`🚀 CRON SCHEDULE: Finding accounts due before ${cutoffTime.toISOString()}`);

      console.log(`🚀 CRON QUERY: offset=${offset}, limit=${limit}, cutoff=${cutoffTime.toISOString()}`);

      const { data: accounts, error } = await supabase
        .from("mastodon_accounts")
        .select("*")
        .eq("active", true)
        .or(`last_posted_at.is.null,last_posted_at.lt.${cutoffTime.toISOString()}`)
        .order("last_posted_at", { ascending: true, nullsFirst: true })
        .range(offset, offset + limit - 1);

      console.log(`🚀 CRON QUERY RESULT: data length=${accounts?.length || 0}, error=${JSON.stringify(error)}`);

      if (error) {
        console.error("🚀 CRON ERROR: Database query failed:", error);
        throw new Error(`Failed to fetch accounts: ${error.message}`);
      }

      accountsToProcess = accounts || [];
      console.log(`🚀 CRON FOUND: ${accountsToProcess.length} accounts due to post`);

      if (accountsToProcess.length > 0) {
        console.log(`🚀 CRON ACCOUNTS: ${accountsToProcess.map(acc => `@${acc.account_username} (${acc.account_type})`).join(', ')}`);
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
        console.log(`🚀 CRON PROCESSING: @${account.account_username}@${account.mastodon_base_url} (type: ${account.account_type})`);

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
          console.log(`🚀 CRON ARTIST: Found art IDs: ${artIds.join(', ')}`);

          // Check total assets
          const { count: totalAssets, error: assetCountError } = await supabase
            .from("art_assets")
            .select("*", { count: "exact", head: true })
            .in("art_id", artIds);

          console.log(`🚀 CRON ARTIST: Total assets for arts: ${totalAssets}, error: ${assetCountError}`);

          // Get next artwork (never posted first, then oldest)
          const { data: assets, error: assetsError } = await supabase
            .from("art_assets")
            .select("id, art_id, storage_path, last_posted_at")
            .in("art_id", artIds)
            .is("last_posted_at", null)
            .order("created_at", { ascending: true })
            .limit(1);

          console.log(`🚀 CRON ARTIST: Unposted assets found: ${assets?.length || 0}, error: ${assetsError}`);

          if (!assetsError && assets && assets.length > 0) {
            console.log(`🚀 CRON ARTIST: Using unposted asset: ${assets[0].id} (${assets[0].storage_path})`);
            artwork = assets[0];
          } else {
            console.log(`🚀 CRON ARTIST: No unposted assets, checking for repost candidates`);

            // Get least recently posted
            const { data: oldAssets, error: oldError } = await supabase
              .from("art_assets")
              .select("id, art_id, storage_path, last_posted_at")
              .in("art_id", artIds)
              .not("last_posted_at", "is", null)
              .order("last_posted_at", { ascending: true })
              .limit(1);

            console.log(`🚀 CRON ARTIST: Old assets found: ${oldAssets?.length || 0}, error: ${oldError}`);

            if (!oldError && oldAssets && oldAssets.length > 0) {
              console.log(`🚀 CRON ARTIST: Using old asset: ${oldAssets[0].id} (${oldAssets[0].storage_path})`);
              artwork = oldAssets[0];
            } else {
              console.log(`🚀 CRON ARTIST: No assets available at all`);
            }
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

          // Get next artwork (same logic as artist)
          const { data: assets, error: assetsError } = await supabase
            .from("art_assets")
            .select("id, art_id, storage_path, last_posted_at")
            .in("art_id", artIds)
            .is("last_posted_at", null)
            .order("created_at", { ascending: true })
            .limit(1);

          if (!assetsError && assets && assets.length > 0) {
            artwork = assets[0];
          } else {
            const { data: oldAssets, error: oldError } = await supabase
              .from("art_assets")
              .select("id, art_id, storage_path, last_posted_at")
              .in("art_id", artIds)
              .not("last_posted_at", "is", null)
              .order("last_posted_at", { ascending: true })
              .limit(1);

            if (!oldError && oldAssets && oldAssets.length > 0) {
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
                const profileUrl = `${artistBot.mastodon_base_url}/@${artistBot.account_username}`;
                postText += `\n\n@${artistBot.account_username}@${artistBot.mastodon_base_url}`;
              }
            }
          }

        } else if (account.account_type === 'philosopher') {
          console.log(`🚀 CRON PHILOSOPHER: Processing philosopher account, philosopher_id: ${account.philosopher_id}`);

          if (!account.philosopher_id) {
            console.log(`🚀 CRON SKIP: Philosopher account missing philosopher_id`);
            continue;
          }

          // Verify the philosopher actually exists
          const { data: philosopherCheck, error: philosopherCheckError } = await supabase
            .from("philosophers")
            .select("id, name")
            .eq("id", account.philosopher_id)
            .single();

          if (philosopherCheckError || !philosopherCheck) {
            console.log(`🚀 CRON SKIP: Philosopher ${account.philosopher_id} not found in database, error: ${philosopherCheckError}`);
            continue;
          }

          console.log(`🚀 CRON PHILOSOPHER: Philosopher verified: ${philosopherCheck.name} (ID: ${philosopherCheck.id})`);
          console.log(`🚀 CRON PHILOSOPHER: Getting quote for philosopher ${account.philosopher_id}`);

          // First check total quotes available
          const { count: totalQuotes, error: countError } = await supabase
            .from("quotes")
            .select("*", { count: "exact", head: true })
            .eq("philosopher_id", account.philosopher_id);

          console.log(`🚀 CRON PHILOSOPHER: Total quotes for philosopher: ${totalQuotes}, error: ${countError}`);

          // Get next quote (never posted first, then oldest)
          const { data: quotes, error: quotesError } = await supabase
            .from("quotes")
            .select("id, text, author, posted_at")
            .eq("philosopher_id", account.philosopher_id)
            .is("posted_at", null)
            .order("created_at", { ascending: true })
            .limit(1);

          console.log(`🚀 CRON PHILOSOPHER: Unposted quotes found: ${quotes?.length || 0}, error: ${quotesError}`);

          if (!quotesError && quotes && quotes.length > 0) {
            console.log(`🚀 CRON PHILOSOPHER: Using unposted quote: ${quotes[0].id}`);
            artwork = {
              id: quotes[0].id,
              art_id: '',
              storage_path: '',
              last_posted_at: null
            };
            postText = formatQuote(quotes[0]);
          } else {
            console.log(`🚀 CRON PHILOSOPHER: No unposted quotes, checking for repost candidates`);

            // Get least recently posted quote
            const { data: oldQuotes, error: oldError } = await supabase
              .from("quotes")
              .select("id, text, author, posted_at")
              .eq("philosopher_id", account.philosopher_id)
              .not("posted_at", "is", null)
              .order("posted_at", { ascending: true })
              .limit(1);

            console.log(`🚀 CRON PHILOSOPHER: Old quotes found: ${oldQuotes?.length || 0}, error: ${oldError}`);

            if (!oldError && oldQuotes && oldQuotes.length > 0) {
              console.log(`🚀 CRON PHILOSOPHER: Resetting all quotes and using: ${oldQuotes[0].id}`);

              // Reset all quotes for cycling
              const { error: resetError } = await supabase
                .from("quotes")
                .update({ posted_at: null })
                .eq("philosopher_id", account.philosopher_id);

              console.log(`🚀 CRON PHILOSOPHER: Reset error: ${resetError}`);

              artwork = {
                id: oldQuotes[0].id,
                art_id: '',
                storage_path: '',
                last_posted_at: null
              };
              postText = formatQuote(oldQuotes[0]);
            } else {
              console.log(`🚀 CRON PHILOSOPHER: No quotes available at all`);
            }
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

        // Handle philosopher accounts (text-only posts)
        if (account.account_type === 'philosopher') {
          console.log(`🚀 CRON POSTING: Philosopher quote to @${account.account_username}`);

          const statusResponse = await fetch(`${account.mastodon_base_url}/api/v1/statuses`, {
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
            console.error(`🚀 CRON ERROR: Failed to post philosopher quote: ${statusResponse.status} ${errorText}`);
            continue;
          }

          const statusResult = await statusResponse.json();
          console.log(`🚀 CRON SUCCESS: Posted philosopher quote - Status ID: ${statusResult.id}`);

          // Update tracking
          const now = new Date().toISOString();
          await supabase
            .from("quotes")
            .update({ posted_at: now })
            .eq("id", artwork.id);

          await supabase
            .from("quote_posts")
            .insert({
              quote_id: artwork.id,
              mastodon_account_id: account.id,
              posted_at: now,
            });

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
        console.log(`🚀 CRON MASTODON: Uploading media to ${account.mastodon_base_url}`);

        const formData = new FormData();
        formData.append('file', imageBlob, `artwork.${getFileExtension(artwork.storage_path)}`);

        const mediaResponse = await fetch(`${account.mastodon_base_url}/api/v1/media`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${account.mastodon_access_token}`,
          },
          body: formData,
        });

        if (!mediaResponse.ok) {
          const errorText = await mediaResponse.text();
          console.error(`🚀 CRON ERROR: Failed to upload media: ${mediaResponse.status} ${errorText}`);
          // Mark as posted to avoid infinite retries
          const now = new Date().toISOString();
          await supabase
            .from("art_assets")
            .update({ last_posted_at: now })
            .eq("id", artwork.id);
          continue;
        }

        const mediaData = await mediaResponse.json();
        const mediaId = mediaData.id;
        console.log(`🚀 CRON MEDIA: Uploaded successfully, ID: ${mediaId}`);

        // Wait for Mastodon to process the media (3-5 seconds)
        console.log(`🚀 CRON WAIT: Waiting 4 seconds for media processing...`);
        await new Promise(resolve => setTimeout(resolve, 4000));

        // Create status post
        console.log(`🚀 CRON POSTING: Creating status post`);

        const statusData = {
          status: postText,
          media_ids: [mediaId],
          visibility: 'public',
        };

        const statusResponse = await fetch(`${account.mastodon_base_url}/api/v1/statuses`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${account.mastodon_access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(statusData),
        });

        if (!statusResponse.ok) {
          const errorText = await statusResponse.text();
          console.error(`🚀 CRON ERROR: Failed to create status: ${statusResponse.status} ${errorText}`);
          // Mark as posted to avoid infinite retries
          const now = new Date().toISOString();
          await supabase
            .from("art_assets")
            .update({ last_posted_at: now })
            .eq("id", artwork.id);
          continue;
        }

        const statusResult = await statusResponse.json();
        console.log(`🚀 CRON SUCCESS: Posted artwork - Status ID: ${statusResult.id}`);

        // Update tracking
        const now = new Date().toISOString();

        const { error: updateAssetError } = await supabase
          .from("art_assets")
          .update({ last_posted_at: now })
          .eq("id", artwork.id);

        if (updateAssetError) {
          console.error(`🚀 CRON ERROR: Failed to update art_asset:`, updateAssetError);
        }

        const { error: updateAccountError } = await supabase
          .from("mastodon_accounts")
          .update({ last_posted_at: now })
          .eq("id", account.id);

        if (updateAccountError) {
          console.error(`🚀 CRON ERROR: Failed to update account:`, updateAccountError);
        }

        console.log(`🚀 CRON COMPLETE: Successfully posted for ${account.account_username}`);
        processedCount++;

      } catch (accountError) {
        console.error(`🚀 CRON ERROR: Failed to process account ${account.account_username}:`, accountError);
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