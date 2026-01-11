// CONSOLIDATED MTG CARD POSTING FUNCTION - Supports multiple bot types
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
  image_status?: string;
  scryfall_uri: string;
}

type BotType = "showcase" | "commander" | "secret-lair" | "auto";

interface CardFetchStrategy {
  fetchCard(maxRetries: number): Promise<ScryfallCard | null>;
  getLogPrefix(): string;
}

// Showcase Strategy: Fetches cards with showcase frame effects
class ShowcaseStrategy implements CardFetchStrategy {
  getLogPrefix() {
    return "🃏 MTG SHOWCASE";
  }

  async fetchCard(maxRetries: number): Promise<ScryfallCard | null> {
    let attempts = 0;
    const seenFrames = new Set<string>();

    while (attempts < maxRetries) {
      attempts++;
      console.log(`${this.getLogPrefix()}: Attempt ${attempts}/${maxRetries} - Fetching random card...`);

      try {
        const randomCardUrl = "https://api.scryfall.com/cards/random";

        const cardResponse = await fetch(randomCardUrl, {
          headers: {
            "User-Agent": "MTG-Card-Bot/1.0 (contact: developer@example.com)",
          },
        });

        if (!cardResponse.ok) {
          const errorText = await cardResponse.text();
          console.error(`${this.getLogPrefix()} ERROR: Scryfall API failed: ${cardResponse.status} ${errorText}`);
          if (attempts >= maxRetries) {
            throw new Error(`Scryfall API error: ${cardResponse.status} - ${errorText}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }

        const cardData: any = await cardResponse.json();

        if (cardData.object === "error") {
          console.error(`${this.getLogPrefix()} ERROR: Scryfall API error: ${cardData.code} - ${cardData.details || cardData.message}`);
          if (attempts >= maxRetries) {
            throw new Error(`Scryfall API error: ${cardData.code} - ${cardData.details || cardData.message}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }

        const fetchedCard: ScryfallCard = cardData;
        const frameEffects = fetchedCard.frame_effects || [];
        const frameValue = fetchedCard.frame || "unknown";

        // Track frame_effects we've seen for debugging
        frameEffects.forEach((effect) => {
          if (!seenFrames.has(effect)) {
            seenFrames.add(effect);
            console.log(`${this.getLogPrefix()} DEBUG: New frame effect seen: "${effect}"`);
          }
        });

        console.log(`${this.getLogPrefix()} CARD: Found "${fetchedCard.name}" from ${fetchedCard.set_name} (Frame: ${frameValue}, Effects: ${frameEffects.join(", ") || "none"})`);

        // Check if card has image_uris
        if (!fetchedCard.image_uris && (!fetchedCard.card_faces || fetchedCard.card_faces.length === 0 || !fetchedCard.card_faces[0].image_uris)) {
          console.log(`${this.getLogPrefix()} SKIP: Card has no image URIs. Retrying...`);
          await new Promise((resolve) => setTimeout(resolve, 300));
          continue;
        }

        // Filter for showcase frame only - check frame_effects array
        if (!frameEffects.includes("showcase")) {
          if (attempts % 10 === 0) {
            console.log(`${this.getLogPrefix()} PROGRESS: ${attempts} attempts, seen frame effects: ${Array.from(seenFrames).join(", ") || "none"}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 300));
          continue;
        }

        console.log(`${this.getLogPrefix()} SUCCESS: Found Showcase card: "${fetchedCard.name}"`);
        return fetchedCard;
      } catch (err: any) {
        console.error(`${this.getLogPrefix()} ERROR: Exception during card fetch: ${err.message}`);
        if (attempts >= maxRetries) {
          throw new Error(`Failed to fetch card after ${maxRetries} attempts: ${err.message}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
    }

    console.error(`${this.getLogPrefix()} ERROR: Tried ${attempts} times, seen frames: ${Array.from(seenFrames).join(", ")}`);
    return null;
  }
}

// Commander Strategy: Fetches cards with EDHREC rank < 1000
class CommanderStrategy implements CardFetchStrategy {
  getLogPrefix() {
    return "⚔️ MTG COMMANDER";
  }

  async fetchCard(maxRetries: number): Promise<ScryfallCard | null> {
    let attempts = 0;
    const seenRanks: number[] = [];

    while (attempts < maxRetries) {
      attempts++;
      console.log(`${this.getLogPrefix()}: Attempt ${attempts}/${maxRetries} - Fetching random card...`);

      try {
        const randomCardUrl = "https://api.scryfall.com/cards/random";

        const cardResponse = await fetch(randomCardUrl, {
          headers: {
            "User-Agent": "MTG-Commander-Bot/1.0 (contact: developer@example.com)",
          },
        });

        if (!cardResponse.ok) {
          const errorText = await cardResponse.text();
          console.error(`${this.getLogPrefix()} ERROR: Scryfall API failed: ${cardResponse.status} ${errorText}`);
          if (attempts >= maxRetries) {
            throw new Error(`Scryfall API error: ${cardResponse.status} - ${errorText}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }

        const cardData: any = await cardResponse.json();

        if (cardData.object === "error") {
          console.error(`${this.getLogPrefix()} ERROR: Scryfall API error: ${cardData.code} - ${cardData.details || cardData.message}`);
          if (attempts >= maxRetries) {
            throw new Error(`Scryfall API error: ${cardData.code} - ${cardData.details || cardData.message}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }

        const fetchedCard: ScryfallCard = cardData;
        const edhrecRank = fetchedCard.edhrec_rank;

        // Track ranks we've seen for debugging
        if (edhrecRank !== undefined && edhrecRank !== null && !seenRanks.includes(edhrecRank)) {
          seenRanks.push(edhrecRank);
          if (seenRanks.length <= 10) {
            console.log(`${this.getLogPrefix()} DEBUG: Card with EDHREC rank: ${edhrecRank}`);
          }
        }

        console.log(`${this.getLogPrefix()} CARD: Found "${fetchedCard.name}" from ${fetchedCard.set_name} (EDHREC Rank: ${edhrecRank || "N/A"})`);

        // Check if card has image_uris
        if (!fetchedCard.image_uris && (!fetchedCard.card_faces || fetchedCard.card_faces.length === 0 || !fetchedCard.card_faces[0].image_uris)) {
          console.log(`${this.getLogPrefix()} SKIP: Card has no image URIs. Retrying...`);
          await new Promise((resolve) => setTimeout(resolve, 300));
          continue;
        }

        // Filter for EDHREC rank < 1000
        if (edhrecRank === undefined || edhrecRank === null) {
          console.log(`${this.getLogPrefix()} SKIP: Card has no EDHREC rank. Retrying...`);
          await new Promise((resolve) => setTimeout(resolve, 300));
          continue;
        }

        if (edhrecRank >= 1000) {
          if (attempts % 10 === 0) {
            console.log(`${this.getLogPrefix()} PROGRESS: ${attempts} attempts, seen ranks: ${seenRanks.slice(0, 5).join(", ")}...`);
          }
          await new Promise((resolve) => setTimeout(resolve, 300));
          continue;
        }

        console.log(`${this.getLogPrefix()} SUCCESS: Found card with EDHREC rank ${fetchedCard.edhrec_rank}: "${fetchedCard.name}"`);
        return fetchedCard;
      } catch (err: any) {
        console.error(`${this.getLogPrefix()} ERROR: Exception during card fetch: ${err.message}`);
        if (attempts >= maxRetries) {
          throw new Error(`Failed to fetch card after ${maxRetries} attempts: ${err.message}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
    }

    console.error(`${this.getLogPrefix()} ERROR: Tried ${attempts} times, seen ranks: ${seenRanks.slice(0, 10).join(", ")}...`);
    return null;
  }
}

// Secret Lair Strategy: Fetches cards with set code "SLD"
class SecretLairStrategy implements CardFetchStrategy {
  getLogPrefix() {
    return "🎨 MTG SECRET LAIR";
  }

  async fetchCard(maxRetries: number): Promise<ScryfallCard | null> {
    let attempts = 0;
    const seenSets = new Set<string>();

    while (attempts < maxRetries) {
      attempts++;
      console.log(`${this.getLogPrefix()}: Attempt ${attempts}/${maxRetries} - Fetching random card...`);

      try {
        const randomCardUrl = "https://api.scryfall.com/cards/random";

        const cardResponse = await fetch(randomCardUrl, {
          headers: {
            "User-Agent": "MTG-SecretLair-Bot/1.0 (contact: developer@example.com)",
          },
        });

        if (!cardResponse.ok) {
          const errorText = await cardResponse.text();
          console.error(`${this.getLogPrefix()} ERROR: Scryfall API failed: ${cardResponse.status} ${errorText}`);
          if (attempts >= maxRetries) {
            throw new Error(`Scryfall API error: ${cardResponse.status} - ${errorText}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }

        const cardData: any = await cardResponse.json();

        if (cardData.object === "error") {
          console.error(`${this.getLogPrefix()} ERROR: Scryfall API error: ${cardData.code} - ${cardData.details || cardData.message}`);
          if (attempts >= maxRetries) {
            throw new Error(`Scryfall API error: ${cardData.code} - ${cardData.details || cardData.message}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }

        const fetchedCard: ScryfallCard = cardData;
        const setCode = fetchedCard.set || "";

        // Track sets we've seen for debugging
        if (setCode && !seenSets.has(setCode)) {
          seenSets.add(setCode);
          if (seenSets.size <= 10) {
            console.log(`${this.getLogPrefix()} DEBUG: Card with set code: ${setCode}`);
          }
        }

        console.log(`${this.getLogPrefix()} CARD: Found "${fetchedCard.name}" from ${fetchedCard.set_name} (Set Code: ${setCode})`);

        // Check if card has image_uris
        if (!fetchedCard.image_uris && (!fetchedCard.card_faces || fetchedCard.card_faces.length === 0 || !fetchedCard.card_faces[0].image_uris)) {
          console.log(`${this.getLogPrefix()} SKIP: Card has no image URIs. Retrying...`);
          await new Promise((resolve) => setTimeout(resolve, 300));
          continue;
        }

        // Filter for Secret Lair set code "sld" (lowercase in API)
        if (setCode.toLowerCase() !== "sld") {
          if (attempts % 10 === 0) {
            console.log(`${this.getLogPrefix()} PROGRESS: ${attempts} attempts, seen set codes: ${Array.from(seenSets).slice(0, 5).join(", ")}...`);
          }
          await new Promise((resolve) => setTimeout(resolve, 300));
          continue;
        }

        console.log(`${this.getLogPrefix()} SUCCESS: Found Secret Lair card: "${fetchedCard.name}"`);
        return fetchedCard;
      } catch (err: any) {
        console.error(`${this.getLogPrefix()} ERROR: Exception during card fetch: ${err.message}`);
        if (attempts >= maxRetries) {
          throw new Error(`Failed to fetch card after ${maxRetries} attempts: ${err.message}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
    }

    console.error(`${this.getLogPrefix()} ERROR: Tried ${attempts} times, seen set codes: ${Array.from(seenSets).slice(0, 10).join(", ")}...`);
    return null;
  }
}

// Helper functions
function getFileExtension(url: string): string {
  if (url.includes(".png")) return "png";
  if (url.includes(".jpg")) return "jpg";
  return "png";
}

function formatCardPost(card: ScryfallCard, botType: BotType): string {
  const parts: string[] = [];
  parts.push(card.name);
  if (card.set_name) {
    parts.push(`\n${card.set_name}`);
  }
  if (card.artist) {
    parts.push(`\nArt by ${card.artist}`);
  }
  if (botType === "commander" && card.edhrec_rank) {
    parts.push(`\nEDHREC Rank: ${card.edhrec_rank}`);
  }
  return parts.join("");
}

function detectBotType(accountUsername: string, botTypeParam: string | null): BotType {
  if (botTypeParam) {
    return botTypeParam as BotType;
  }
  // Auto-detect from username
  const usernameLower = accountUsername.toLowerCase();
  if (usernameLower.includes("commander")) {
    return "commander";
  }
  if (usernameLower.includes("secretlair") || usernameLower.includes("secret-lair")) {
    return "secret-lair";
  }
  if (usernameLower.includes("showcase")) {
    return "showcase";
  }
  return "showcase"; // Default
}

function getCardFetchStrategy(botType: BotType): CardFetchStrategy {
  switch (botType) {
    case "commander":
      return new CommanderStrategy();
    case "secret-lair":
      return new SecretLairStrategy();
    case "showcase":
    default:
      return new ShowcaseStrategy();
  }
}

function extractImageUrl(card: ScryfallCard): { url: string; format: string } | null {
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
    return null;
  }

  return { url: imageUrl, format: imageFormat };
}

async function postToMastodon(
  account: MastodonAccount,
  card: ScryfallCard,
  botType: BotType,
  logPrefix: string
): Promise<{ success: boolean; statusId?: string; error?: string }> {
  try {
    // Extract image URL
    const imageInfo = extractImageUrl(card);
    if (!imageInfo) {
      throw new Error(`No image URL found for card "${card.name}"`);
    }

    console.log(`${logPrefix} IMAGE: Using image URL: ${imageInfo.url.substring(0, 80)}...`);

    // Download image
    console.log(`${logPrefix} DOWNLOAD: Downloading image from Scryfall...`);
    const imageResponse = await fetch(imageInfo.url);

    if (!imageResponse.ok) {
      const errorText = await imageResponse.text();
      console.error(`${logPrefix} ERROR: Failed to download image: ${imageResponse.status} ${errorText}`);
      throw new Error(`Image download failed: ${imageResponse.status}`);
    }

    const imageBlob = await imageResponse.blob();
    console.log(`${logPrefix} IMAGE: Downloaded ${imageBlob.size} bytes`);

    // Upload to Mastodon
    console.log(`${logPrefix} MASTODON: Uploading media to ${account.mastodon_base_url}`);
    const formData = new FormData();
    formData.append("file", imageBlob, `mtg-card.${imageInfo.format}`);

    const mediaResponse = await fetch(`${account.mastodon_base_url}/api/v1/media`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${account.mastodon_access_token}`,
      },
      body: formData,
    });

    const mediaResponseText = await mediaResponse.text();
    
    if (!mediaResponse.ok) {
      console.error(`${logPrefix} ERROR: Failed to upload media: ${mediaResponse.status} ${mediaResponseText}`);
      throw new Error(`Mastodon media upload failed: ${mediaResponse.status} - ${mediaResponseText}`);
    }

    let mediaData;
    try {
      console.log(`${logPrefix} MEDIA RESPONSE TEXT: ${mediaResponseText.substring(0, 200)}`);
      mediaData = JSON.parse(mediaResponseText);
    } catch (parseError) {
      console.error(`${logPrefix} ERROR: Failed to parse media response:`, parseError);
      throw new Error(`Invalid JSON response from Mastodon media upload: ${mediaResponseText.substring(0, 100)}`);
    }
    console.log(`${logPrefix} MEDIA: Upload response:`, JSON.stringify(mediaData));
    
    if (!mediaData.id) {
      throw new Error(`Media upload response missing ID: ${JSON.stringify(mediaData)}`);
    }
    
    const mediaId = mediaData.id;
    console.log(`${logPrefix} MEDIA: Uploaded successfully, ID: ${mediaId}, State: ${mediaData.state || 'unknown'}`);

    // Wait for media processing - check state and poll if needed
    let mediaProcessed = mediaData.state === 'processed' || !mediaData.state;
    let waitAttempts = 0;
    const maxWaitAttempts = 10; // 10 attempts * 2 seconds = 20 seconds max
    
    while (!mediaProcessed && waitAttempts < maxWaitAttempts) {
      waitAttempts++;
      console.log(`${logPrefix} WAIT: Media processing... (attempt ${waitAttempts}/${maxWaitAttempts}, state: ${mediaData.state})`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      
      // Check media status
      const statusCheckResponse = await fetch(`${account.mastodon_base_url}/api/v1/media/${mediaId}`, {
        headers: {
          Authorization: `Bearer ${account.mastodon_access_token}`,
        },
      });
      
      if (statusCheckResponse.ok) {
        const statusData = await statusCheckResponse.json();
        console.log(`${logPrefix} MEDIA STATUS: State: ${statusData.state || 'unknown'}`);
        if (statusData.state === 'processed' || !statusData.state) {
          mediaProcessed = true;
        } else if (statusData.state === 'failed') {
          throw new Error(`Media processing failed: ${statusData.error || 'Unknown error'}`);
        }
      } else {
        console.log(`${logPrefix} WARNING: Could not check media status, assuming processed`);
        mediaProcessed = true; // Assume processed if we can't check
      }
    }
    
    if (!mediaProcessed) {
      console.log(`${logPrefix} WARNING: Media may still be processing, but proceeding with post`);
    }

    // Create status post
    console.log(`${logPrefix} POSTING: Creating status post`);
    const postText = formatCardPost(card, botType);
    console.log(`${logPrefix} POST TEXT: "${postText}"`);
    console.log(`${logPrefix} MEDIA ID: ${mediaId}`);

    const statusData = {
      status: postText,
      media_ids: [mediaId],
      visibility: "public",
    };

    console.log(`${logPrefix} STATUS DATA:`, JSON.stringify(statusData));

    const statusResponse = await fetch(`${account.mastodon_base_url}/api/v1/statuses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${account.mastodon_access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(statusData),
    });

    const statusResponseText = await statusResponse.text();
    console.log(`${logPrefix} STATUS RESPONSE: ${statusResponse.status} - ${statusResponseText.substring(0, 200)}`);

    if (!statusResponse.ok) {
      console.error(`${logPrefix} ERROR: Failed to create status: ${statusResponse.status} ${statusResponseText}`);
      throw new Error(`Mastodon status creation failed: ${statusResponse.status} - ${statusResponseText}`);
    }

    let statusResult;
    try {
      statusResult = JSON.parse(statusResponseText);
    } catch (parseError) {
      console.error(`${logPrefix} ERROR: Failed to parse status response: ${statusResponseText}`);
      throw new Error(`Invalid JSON response from Mastodon: ${statusResponseText.substring(0, 100)}`);
    }

    if (!statusResult.id) {
      console.error(`${logPrefix} ERROR: Status response missing ID:`, JSON.stringify(statusResult));
      throw new Error(`Status creation response missing ID: ${JSON.stringify(statusResult)}`);
    }

    console.log(`${logPrefix} SUCCESS: Posted card - Status ID: ${statusResult.id}, URL: ${statusResult.url || 'N/A'}`);

    return { success: true, statusId: statusResult.id };
  } catch (error: any) {
    console.error(`${logPrefix} FATAL ERROR in postToMastodon:`, error);
    console.error(`${logPrefix} ERROR STACK:`, error.stack);
    return { success: false, error: error.message || String(error) };
  }
}

console.log("🃏 MTG BOT: Consolidated function starting at", new Date().toISOString());

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

    // Parse query parameters
    const url = new URL(req.url);
    const accountUsername = url.searchParams.get("account");
    const botTypeParam = url.searchParams.get("bot_type");
    const intervalHours = parseInt(url.searchParams.get("interval_hours") ?? "6") || 6;
    const maxAccounts = parseInt(url.searchParams.get("max_accounts") ?? "10") || 10;

    // Get Mastodon accounts to process
    let accountsToProcess: MastodonAccount[] = [];

    if (accountUsername) {
      // Manual: process specific account
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
      accountsToProcess = [data];
    } else {
      // Automatic: find all accounts due to post
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
        .limit(maxAccounts);

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
            message: "No accounts due to post",
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      accountsToProcess = accounts || [];
      console.log(`🃏 MTG BOT FOUND: ${accountsToProcess.length} account(s) due to post`);
      if (accountsToProcess.length > 0) {
        console.log(`🃏 MTG BOT ACCOUNTS: ${accountsToProcess.map(acc => `@${acc.account_username}`).join(", ")}`);
      }
    }

    // Process each account
    let processedCount = 0;
    const results: Array<{ account: string; bot_type: string; card?: any; error?: string }> = [];

    for (const account of accountsToProcess) {
      // Check timeout (leave buffer for response)
      const elapsedMs = Date.now() - startTime;
      if (elapsedMs > 50000) {
        console.log(`🃏 MTG BOT TIMEOUT: Stopping early after ${elapsedMs}ms to avoid function timeout`);
        break;
      }

      try {
        console.log(`🃏 MTG BOT PROCESSING: @${account.account_username}`);

        // Detect bot type
        const botType = detectBotType(account.account_username, botTypeParam);
        const strategy = getCardFetchStrategy(botType);
        const logPrefix = strategy.getLogPrefix();

        console.log(`${logPrefix}: Bot type detected: ${botType} for account ${account.account_username}`);

        // Skip if posted recently (prevent double-posting)
        if (account.last_posted_at) {
          const lastPostTime = new Date(account.last_posted_at);
          const minutesSinceLastPost = (Date.now() - lastPostTime.getTime()) / (1000 * 60);
          if (minutesSinceLastPost < 5) {
            console.log(`${logPrefix} SKIP: Posted ${minutesSinceLastPost.toFixed(1)} minutes ago`);
            results.push({
              account: account.account_username,
              bot_type: botType,
              error: "Posted too recently",
            });
            continue;
          }
        }

        // Fetch card using appropriate strategy
        const MAX_RETRIES = botType === "commander" ? 50 : 50;
        console.log(`${logPrefix}: Fetching card with ${botType} strategy...`);

        const card = await strategy.fetchCard(MAX_RETRIES);

        if (!card) {
          throw new Error(`Failed to find card after ${MAX_RETRIES} attempts`);
        }

        // Post to Mastodon
        console.log(`${logPrefix} STARTING: Posting to Mastodon for @${account.account_username}`);
        const postResult = await postToMastodon(account, card, botType, logPrefix);

        if (!postResult.success) {
          const errorMsg = postResult.error || "Failed to post to Mastodon";
          console.error(`${logPrefix} POST FAILED: ${errorMsg}`);
          throw new Error(errorMsg);
        }
        
        console.log(`${logPrefix} POST SUCCESS: Status ID ${postResult.statusId}`);

        // Update last_posted_at
        const now = new Date().toISOString();
        const { error: updateError } = await supabase
          .from("mastodon_accounts")
          .update({ last_posted_at: now })
          .eq("id", account.id);

        if (updateError) {
          console.error(`${logPrefix} ERROR: Failed to update account:`, updateError);
        }

        console.log(`${logPrefix} COMPLETE: Successfully posted "${card.name}" for @${account.account_username}`);
        processedCount++;

        results.push({
          account: account.account_username,
          bot_type: botType,
          card: {
            name: card.name,
            set: card.set_name,
            artist: card.artist,
            edhrec_rank: card.edhrec_rank,
          },
        });
      } catch (error: any) {
        console.error(`🃏 MTG BOT ERROR processing @${account.account_username}:`, error.message);
        results.push({
          account: account.account_username,
          bot_type: detectBotType(account.account_username, botTypeParam),
          error: error.message,
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed: processedCount,
        total_accounts: accountsToProcess.length,
        results: results,
        message: `Processed ${processedCount} of ${accountsToProcess.length} account(s)`,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("🃏 MTG BOT FATAL ERROR:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
