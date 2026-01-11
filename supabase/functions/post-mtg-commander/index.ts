// MTG COMMANDER CARD POSTING FUNCTION - Posts random cards with EDHREC rank < 1000
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
  account_type: string;
  active: boolean;
  last_posted_at: string | null;
}

interface ScryfallCard {
  id: string;
  name: string;
  set_name: string;
  set: string;
  artist?: string;
  edhrec_rank?: number;
  image_uris?: {
    png?: string;
    normal?: string;
    large?: string;
    art_crop?: string;
    border_crop?: string;
  };
  card_faces?: Array<{
    name: string;
    image_uris?: {
      png?: string;
      normal?: string;
      large?: string;
      art_crop?: string;
      border_crop?: string;
    };
  }>;
  frame: string;
  frame_effects?: string[];
  image_status: string;
  scryfall_uri: string;
}

function getFileExtension(url: string): string {
  if (url.includes('.png')) return 'png';
  if (url.includes('.jpg')) return 'jpg';
  return 'png';
}

function formatCardPost(card: ScryfallCard): string {
  const parts: string[] = [];
  parts.push(card.name);
  if (card.set_name) {
    parts.push(`\n${card.set_name}`);
  }
  if (card.artist) {
    parts.push(`\nArt by ${card.artist}`);
  }
  if (card.edhrec_rank) {
    parts.push(`\nEDHREC Rank: ${card.edhrec_rank}`);
  }
  return parts.join('');
}

console.log("⚔️ MTG COMMANDER BOT: Script starting at", new Date().toISOString());

serve(async (req) => {
  const startTime = Date.now();
  console.log("⚔️ MTG COMMANDER BOT: Function invoked with method:", req.method);

  if (req.method === "OPTIONS") {
    console.log("⚔️ MTG COMMANDER BOT: Handling OPTIONS request");
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    console.log("⚔️ MTG COMMANDER BOT: Starting main logic");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      console.error("⚔️ MTG COMMANDER BOT ERROR: Missing environment variables");
      throw new Error("Missing required environment variables");
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const url = new URL(req.url);
    const accountUsername = url.searchParams.get("account");
    const intervalHours = parseInt(url.searchParams.get("interval_hours") ?? "6") || 6;

    console.log(`⚔️ MTG COMMANDER BOT PARAMS: account=${accountUsername}, interval=${intervalHours}h`);

    let account: MastodonAccount | null = null;

    if (accountUsername) {
      console.log(`⚔️ MTG COMMANDER BOT MANUAL: Processing specific account: ${accountUsername}`);
      const { data, error } = await supabase
        .from("mastodon_accounts")
        .select("*")
        .eq("account_username", accountUsername)
        .eq("account_type", "mtg")
        .eq("active", true)
        .single();

      if (error || !data) {
        throw new Error(`MTG Commander account "${accountUsername}" not found or inactive`);
      }
      account = data;
    } else {
      const now = new Date();
      const intervalMs = intervalHours * 60 * 60 * 1000;
      const cutoffTime = new Date(now.getTime() - intervalMs);

      console.log(`⚔️ MTG COMMANDER BOT SCHEDULE: Finding accounts due before ${cutoffTime.toISOString()}`);

      const { data: accounts, error } = await supabase
        .from("mastodon_accounts")
        .select("*")
        .eq("active", true)
        .eq("account_type", "mtg")
        .eq("account_username", "CuratedMTGCommander")
        .or(`last_posted_at.is.null,last_posted_at.lt.${cutoffTime.toISOString()}`)
        .order("last_posted_at", { ascending: true, nullsFirst: true })
        .limit(1);

      if (error) {
        console.error("⚔️ MTG COMMANDER BOT ERROR: Database query failed:", error);
        throw new Error(`Failed to fetch accounts: ${error.message}`);
      }

      if (!accounts || accounts.length === 0) {
        console.log("⚔️ MTG COMMANDER BOT EMPTY: No accounts due to post at this time");
        return new Response(
          JSON.stringify({
            success: true,
            processed: 0,
            message: "No accounts due to post"
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      if (accounts && accounts.length > 0) {
        account = accounts[0];
        console.log(`⚔️ MTG COMMANDER BOT FOUND: Account @${account.account_username}@${account.mastodon_base_url}`);
      }
    }

    if (!account) {
      throw new Error("No account found");
    }

    if (account.last_posted_at) {
      const lastPostTime = new Date(account.last_posted_at);
      const minutesSinceLastPost = (Date.now() - lastPostTime.getTime()) / (1000 * 60);
      if (minutesSinceLastPost < 5) {
        console.log(`⚔️ MTG COMMANDER BOT SKIP: Posted ${minutesSinceLastPost.toFixed(1)} minutes ago`);
        return new Response(
          JSON.stringify({
            success: true,
            processed: 0,
            message: "Account posted too recently"
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    console.log("⚔️ MTG COMMANDER BOT: Fetching random card with EDHREC rank < 1000...");
    
    const MAX_RETRIES = 50;
    let card: ScryfallCard | null = null;
    let attempts = 0;
    const seenRanks: number[] = [];
    
    while (!card && attempts < MAX_RETRIES) {
      attempts++;
      console.log(`⚔️ MTG COMMANDER BOT: Attempt ${attempts}/${MAX_RETRIES} - Fetching random card...`);
      
      try {
        const randomCardUrl = "https://api.scryfall.com/cards/random";
        
        const cardResponse = await fetch(randomCardUrl, {
          headers: {
            "User-Agent": "MTG-Commander-Bot/1.0 (contact: developer@example.com)",
          },
        });

        if (!cardResponse.ok) {
          const errorText = await cardResponse.text();
          console.error(`⚔️ MTG COMMANDER BOT ERROR: Scryfall API failed: ${cardResponse.status} ${errorText}`);
          if (attempts >= MAX_RETRIES) {
            throw new Error(`Scryfall API error: ${cardResponse.status} - ${errorText}`);
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }

        const cardData: any = await cardResponse.json();
        
        if (cardData.object === "error") {
          console.error(`⚔️ MTG COMMANDER BOT ERROR: Scryfall API error: ${cardData.code} - ${cardData.details || cardData.message}`);
          if (attempts >= MAX_RETRIES) {
            throw new Error(`Scryfall API error: ${cardData.code} - ${cardData.details || cardData.message}`);
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }
        
        const fetchedCard: ScryfallCard = cardData;
        const edhrecRank = fetchedCard.edhrec_rank;
        
        // Track ranks we've seen for debugging
        if (edhrecRank !== undefined && edhrecRank !== null && !seenRanks.includes(edhrecRank)) {
          seenRanks.push(edhrecRank);
          if (seenRanks.length <= 10) { // Only log first 10 unique ranks
            console.log(`⚔️ MTG COMMANDER BOT DEBUG: Card with EDHREC rank: ${edhrecRank}`);
          }
        }
        
        console.log(`⚔️ MTG COMMANDER BOT CARD: Found "${fetchedCard.name}" from ${fetchedCard.set_name} (EDHREC Rank: ${edhrecRank || 'N/A'})`);

        // Check if card has image_uris
        if (!fetchedCard.image_uris && (!fetchedCard.card_faces || fetchedCard.card_faces.length === 0 || !fetchedCard.card_faces[0].image_uris)) {
          console.log(`⚔️ MTG COMMANDER BOT SKIP: Card has no image URIs. Retrying...`);
          await new Promise(resolve => setTimeout(resolve, 300));
          continue;
        }

        // Filter for EDHREC rank < 1000 (or null/undefined - some cards don't have EDHREC data)
        // Only accept cards with EDHREC rank less than 1000
        if (edhrecRank === undefined || edhrecRank === null) {
          console.log(`⚔️ MTG COMMANDER BOT SKIP: Card has no EDHREC rank. Retrying...`);
          await new Promise(resolve => setTimeout(resolve, 300));
          continue;
        }

        if (edhrecRank >= 1000) {
          if (attempts % 10 === 0) {
            console.log(`⚔️ MTG COMMANDER BOT PROGRESS: ${attempts} attempts, seen ranks: ${seenRanks.slice(0, 5).join(', ')}...`);
          }
          await new Promise(resolve => setTimeout(resolve, 300));
          continue;
        }

        card = fetchedCard;
        console.log(`⚔️ MTG COMMANDER BOT SUCCESS: Found card with EDHREC rank ${card.edhrec_rank}: "${card.name}"`);
      } catch (err: any) {
        console.error(`⚔️ MTG COMMANDER BOT ERROR: Exception during card fetch: ${err.message}`);
        if (attempts >= MAX_RETRIES) {
          throw new Error(`Failed to fetch card after ${MAX_RETRIES} attempts: ${err.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
    }

    if (!card) {
      console.error(`⚔️ MTG COMMANDER BOT ERROR: Tried ${attempts} times, seen ranks: ${seenRanks.slice(0, 10).join(', ')}...`);
      throw new Error(`Failed to find card with EDHREC rank < 1000 after ${MAX_RETRIES} attempts`);
    }

    // Always use 'large' image (should be PNG format), fallback to other formats
    let imageUrl: string | undefined;
    let imageFormat = "png";

    if (card.image_uris) {
      if (card.image_uris.large) {
        imageUrl = card.image_uris.large;
        imageFormat = "png";
      } else if (card.image_uris.png) {
        imageUrl = card.image_uris.png;
        imageFormat = "png";
      } else if (card.image_uris.normal) {
        imageUrl = card.image_uris.normal;
        imageFormat = "jpg";
      } else if (card.image_uris.border_crop) {
        imageUrl = card.image_uris.border_crop;
        imageFormat = "jpg";
      }
    } else if (card.card_faces && card.card_faces.length > 0) {
      const firstFace = card.card_faces[0];
      if (firstFace.image_uris) {
        if (firstFace.image_uris.large) {
          imageUrl = firstFace.image_uris.large;
          imageFormat = "png";
        } else if (firstFace.image_uris.png) {
          imageUrl = firstFace.image_uris.png;
          imageFormat = "png";
        } else if (firstFace.image_uris.normal) {
          imageUrl = firstFace.image_uris.normal;
          imageFormat = "jpg";
        } else if (firstFace.image_uris.border_crop) {
          imageUrl = firstFace.image_uris.border_crop;
          imageFormat = "jpg";
        }
      }
    }

    if (!imageUrl) {
      throw new Error(`No image URL found for card "${card.name}"`);
    }

    console.log(`⚔️ MTG COMMANDER BOT IMAGE: Using image URL: ${imageUrl.substring(0, 80)}...`);

    console.log("⚔️ MTG COMMANDER BOT DOWNLOAD: Downloading image from Scryfall...");
    const imageResponse = await fetch(imageUrl);

    if (!imageResponse.ok) {
      const errorText = await imageResponse.text();
      console.error(`⚔️ MTG COMMANDER BOT ERROR: Failed to download image: ${imageResponse.status} ${errorText}`);
      throw new Error(`Image download failed: ${imageResponse.status}`);
    }

    const imageBlob = await imageResponse.blob();
    console.log(`⚔️ MTG COMMANDER BOT IMAGE: Downloaded ${imageBlob.size} bytes`);

    console.log(`⚔️ MTG COMMANDER BOT MASTODON: Uploading media to ${account.mastodon_base_url}`);

    const formData = new FormData();
    formData.append('file', imageBlob, `mtg-card.${imageFormat}`);

    const mediaResponse = await fetch(`${account.mastodon_base_url}/api/v1/media`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${account.mastodon_access_token}`,
      },
      body: formData,
    });

    if (!mediaResponse.ok) {
      const errorText = await mediaResponse.text();
      console.error(`⚔️ MTG COMMANDER BOT ERROR: Failed to upload media: ${mediaResponse.status} ${errorText}`);
      throw new Error(`Mastodon media upload failed: ${mediaResponse.status}`);
    }

    const mediaData = await mediaResponse.json();
    const mediaId = mediaData.id;
    console.log(`⚔️ MTG COMMANDER BOT MEDIA: Uploaded successfully, ID: ${mediaId}`);

    console.log("⚔️ MTG COMMANDER BOT WAIT: Waiting 4 seconds for media processing...");
    await new Promise(resolve => setTimeout(resolve, 4000));

    console.log("⚔️ MTG COMMANDER BOT POSTING: Creating status post");
    const postText = formatCardPost(card);

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
      console.error(`⚔️ MTG COMMANDER BOT ERROR: Failed to create status: ${statusResponse.status} ${errorText}`);
      throw new Error(`Mastodon status creation failed: ${statusResponse.status}`);
    }

    const statusResult = await statusResponse.json();
    console.log(`⚔️ MTG COMMANDER BOT SUCCESS: Posted card - Status ID: ${statusResult.id}`);

    const now = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("mastodon_accounts")
      .update({ last_posted_at: now })
      .eq("id", account.id);

    if (updateError) {
      console.error(`⚔️ MTG COMMANDER BOT ERROR: Failed to update account:`, updateError);
    }

    console.log(`⚔️ MTG COMMANDER BOT COMPLETE: Successfully posted "${card.name}" for @${account.account_username}`);

    return new Response(
      JSON.stringify({
        success: true,
        processed: 1,
        card: {
          name: card.name,
          set: card.set_name,
          artist: card.artist,
          edhrec_rank: card.edhrec_rank,
        },
        message: `Posted ${card.name}`
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error) {
    console.error("⚔️ MTG COMMANDER BOT FATAL ERROR:", error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error.message 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

