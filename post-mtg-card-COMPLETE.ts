// MTG CARD POSTING FUNCTION - Posts random Showcase frame cards
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
  frame: string; // This is the frame version/year, not the style
  frame_effects?: string[]; // This contains frame styles like "showcase", "extendedart", etc.
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
  return parts.join('');
}

console.log("🃏 MTG BOT: Script starting at", new Date().toISOString());

serve(async (req) => {
  const startTime = Date.now();
  console.log("🃏 MTG BOT: Function invoked with method:", req.method);

  if (req.method === "OPTIONS") {
    console.log("🃏 MTG BOT: Handling OPTIONS request");
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    console.log("🃏 MTG BOT: Starting main logic");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      console.error("🃏 MTG BOT ERROR: Missing environment variables");
      throw new Error("Missing required environment variables");
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const url = new URL(req.url);
    const accountUsername = url.searchParams.get("account");
    const intervalHours = parseInt(url.searchParams.get("interval_hours") ?? "6") || 6;

    console.log(`🃏 MTG BOT PARAMS: account=${accountUsername}, interval=${intervalHours}h`);

    let account: MastodonAccount | null = null;

    if (accountUsername) {
      console.log(`🃏 MTG BOT MANUAL: Processing specific account: ${accountUsername}`);
      const { data, error } = await supabase
        .from("mastodon_accounts")
        .select("*")
        .eq("account_username", accountUsername)
        .eq("account_type", "mtg")
        .eq("active", true)
        .single();

      if (error || !data) {
        throw new Error(`MTG account "${accountUsername}" not found or inactive`);
      }
      account = data;
    } else {
      const now = new Date();
      const intervalMs = intervalHours * 60 * 60 * 1000;
      const cutoffTime = new Date(now.getTime() - intervalMs);

      console.log(`🃏 MTG BOT SCHEDULE: Finding accounts due before ${cutoffTime.toISOString()}`);

      const { data: accounts, error } = await supabase
        .from("mastodon_accounts")
        .select("*")
        .eq("active", true)
        .eq("account_type", "mtg")
        .or(`last_posted_at.is.null,last_posted_at.lt.${cutoffTime.toISOString()}`)
        .order("last_posted_at", { ascending: true, nullsFirst: true })
        .limit(1);

      if (error) {
        console.error("🃏 MTG BOT ERROR: Database query failed:", error);
        throw new Error(`Failed to fetch accounts: ${error.message}`);
      }

      if (!accounts || accounts.length === 0) {
        console.log("🃏 MTG BOT EMPTY: No accounts due to post at this time");
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
        console.log(`🃏 MTG BOT FOUND: Account @${account.account_username}@${account.mastodon_base_url}`);
      }
    }

    if (!account) {
      throw new Error("No account found");
    }

    if (account.last_posted_at) {
      const lastPostTime = new Date(account.last_posted_at);
      const minutesSinceLastPost = (Date.now() - lastPostTime.getTime()) / (1000 * 60);
      if (minutesSinceLastPost < 5) {
        console.log(`🃏 MTG BOT SKIP: Posted ${minutesSinceLastPost.toFixed(1)} minutes ago`);
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

    console.log("🃏 MTG BOT: Fetching random Showcase card from Scryfall...");
    
    // Fetch random cards until we find a showcase frame one
    // Showcase cards are relatively rare, so we'll try many times
    const MAX_RETRIES = 50;
    let card: ScryfallCard | null = null;
    let attempts = 0;
    const seenFrames = new Set<string>();
    
    while (!card && attempts < MAX_RETRIES) {
      attempts++;
      console.log(`🃏 MTG BOT: Attempt ${attempts}/${MAX_RETRIES} - Fetching random card...`);
      
      try {
        const randomCardUrl = "https://api.scryfall.com/cards/random";
        
        const cardResponse = await fetch(randomCardUrl, {
          headers: {
            "User-Agent": "MTG-Card-Bot/1.0 (contact: developer@example.com)",
          },
        });

        if (!cardResponse.ok) {
          const errorText = await cardResponse.text();
          console.error(`🃏 MTG BOT ERROR: Scryfall API failed: ${cardResponse.status} ${errorText}`);
          if (attempts >= MAX_RETRIES) {
            throw new Error(`Scryfall API error: ${cardResponse.status} - ${errorText}`);
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }

        const cardData: any = await cardResponse.json();
        
        // Check for Scryfall error object
        if (cardData.object === "error") {
          console.error(`🃏 MTG BOT ERROR: Scryfall API error: ${cardData.code} - ${cardData.details || cardData.message}`);
          if (attempts >= MAX_RETRIES) {
            throw new Error(`Scryfall API error: ${cardData.code} - ${cardData.details || cardData.message}`);
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }
        
        const fetchedCard: ScryfallCard = cardData;
        const frameEffects = fetchedCard.frame_effects || [];
        const frameValue = fetchedCard.frame || 'unknown';
        
        // Track frame_effects we've seen for debugging
        frameEffects.forEach(effect => {
          if (!seenFrames.has(effect)) {
            seenFrames.add(effect);
            console.log(`🃏 MTG BOT DEBUG: New frame effect seen: "${effect}"`);
          }
        });
        
        console.log(`🃏 MTG BOT CARD: Found "${fetchedCard.name}" from ${fetchedCard.set_name} (Frame: ${frameValue}, Effects: ${frameEffects.join(', ') || 'none'})`);

        // Check if card has image_uris
        if (!fetchedCard.image_uris && (!fetchedCard.card_faces || fetchedCard.card_faces.length === 0 || !fetchedCard.card_faces[0].image_uris)) {
          console.log(`🃏 MTG BOT SKIP: Card has no image URIs. Retrying...`);
          await new Promise(resolve => setTimeout(resolve, 300));
          continue;
        }

        // Filter for showcase frame only - check frame_effects array
        if (!frameEffects.includes("showcase")) {
          // Log every 10th attempt to show progress
          if (attempts % 10 === 0) {
            console.log(`🃏 MTG BOT PROGRESS: ${attempts} attempts, seen frame effects: ${Array.from(seenFrames).join(', ') || 'none'}`);
          }
          await new Promise(resolve => setTimeout(resolve, 300));
          continue;
        }

        card = fetchedCard;
        console.log(`🃏 MTG BOT SUCCESS: Found Showcase card: "${card.name}"`);
      } catch (err: any) {
        console.error(`🃏 MTG BOT ERROR: Exception during card fetch: ${err.message}`);
        if (attempts >= MAX_RETRIES) {
          throw new Error(`Failed to fetch card after ${MAX_RETRIES} attempts: ${err.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
    }

    if (!card) {
      console.error(`🃏 MTG BOT ERROR: Tried ${attempts} times, seen frames: ${Array.from(seenFrames).join(', ')}`);
      throw new Error(`Failed to find Showcase card after ${MAX_RETRIES} attempts. Frames seen: ${Array.from(seenFrames).join(', ')}`);
    }

    // Always use 'large' image (should be PNG format), fallback to other formats
    let imageUrl: string | undefined;
    let imageFormat = "png";

    if (card.image_uris) {
      // Prefer large, then png, then normal
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
      // Handle double-faced cards
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

    console.log(`🃏 MTG BOT IMAGE: Using image URL: ${imageUrl.substring(0, 80)}...`);

    console.log("🃏 MTG BOT DOWNLOAD: Downloading image from Scryfall...");
    const imageResponse = await fetch(imageUrl);

    if (!imageResponse.ok) {
      const errorText = await imageResponse.text();
      console.error(`🃏 MTG BOT ERROR: Failed to download image: ${imageResponse.status} ${errorText}`);
      throw new Error(`Image download failed: ${imageResponse.status}`);
    }

    const imageBlob = await imageResponse.blob();
    console.log(`🃏 MTG BOT IMAGE: Downloaded ${imageBlob.size} bytes`);

    console.log(`🃏 MTG BOT MASTODON: Uploading media to ${account.mastodon_base_url}`);

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
      console.error(`🃏 MTG BOT ERROR: Failed to upload media: ${mediaResponse.status} ${errorText}`);
      throw new Error(`Mastodon media upload failed: ${mediaResponse.status}`);
    }

    const mediaData = await mediaResponse.json();
    const mediaId = mediaData.id;
    console.log(`🃏 MTG BOT MEDIA: Uploaded successfully, ID: ${mediaId}`);

    console.log("🃏 MTG BOT WAIT: Waiting 4 seconds for media processing...");
    await new Promise(resolve => setTimeout(resolve, 4000));

    console.log("🃏 MTG BOT POSTING: Creating status post");
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
      console.error(`🃏 MTG BOT ERROR: Failed to create status: ${statusResponse.status} ${errorText}`);
      throw new Error(`Mastodon status creation failed: ${statusResponse.status}`);
    }

    const statusResult = await statusResponse.json();
    console.log(`🃏 MTG BOT SUCCESS: Posted card - Status ID: ${statusResult.id}`);

    const now = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("mastodon_accounts")
      .update({ last_posted_at: now })
      .eq("id", account.id);

    if (updateError) {
      console.error(`🃏 MTG BOT ERROR: Failed to update account:`, updateError);
    }

    console.log(`🃏 MTG BOT COMPLETE: Successfully posted "${card.name}" for @${account.account_username}`);

    return new Response(
      JSON.stringify({
        success: true,
        processed: 1,
        card: {
          name: card.name,
          set: card.set_name,
          artist: card.artist,
        },
        message: `Posted ${card.name}`
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error) {
    console.error("🃏 MTG BOT FATAL ERROR:", error);
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

