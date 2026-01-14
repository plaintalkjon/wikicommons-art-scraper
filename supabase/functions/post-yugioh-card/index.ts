// YU-GI-OH CARD POSTING FUNCTION - Posts random staple cards
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

interface YugiohCardImage {
  id: number;
  image_url: string;
  image_url_small: string;
  image_url_cropped: string;
}

interface YugiohCard {
  id: number;
  name: string;
  type: string;
  frameType: string;
  desc: string;
  atk?: number;
  def?: number;
  level?: number;
  race?: string;
  attribute?: string;
  archetype?: string;
  card_images: YugiohCardImage[];
  ygoprodeck_url: string;
}

interface YugiohApiResponse {
  data: YugiohCard[];
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

// Helper functions
function getFileExtension(url: string): string {
  if (url.includes(".png")) return "png";
  if (url.includes(".jpg") || url.includes(".jpeg")) return "jpg";
  return "jpg";
}

/**
 * Fetch hashtags for an account from the database
 * Returns array of hashtag strings (e.g., ['#yugioh'])
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

async function formatCardPost(card: YugiohCard, accountId: string, supabase: any): Promise<string> {
  // Fetch hashtags from database
  const hashtags = await fetchAccountHashtags(accountId, supabase);
  const hashtagString = hashtags.length > 0 ? hashtags.join(' ') : '#yugioh'; // Fallback if no hashtags assigned
  return `${card.name}\n\n${hashtagString}`;
}

function extractImageUrl(card: YugiohCard): { url: string; format: string } | null {
  if (!card.card_images || card.card_images.length === 0) {
    return null;
  }
  
  // Use the first card image (usually the main one)
  const cardImage = card.card_images[0];
  
  // Prefer the full-size image, fall back to small if needed
  const imageUrl = cardImage.image_url || cardImage.image_url_small || cardImage.image_url_cropped;
  
  if (!imageUrl) {
    return null;
  }
  
  const format = getFileExtension(imageUrl);
  return { url: imageUrl, format };
}

async function fetchRandomStapleCard(): Promise<YugiohCard | null> {
  try {
    console.log("🃏 YU-GI-OH: Fetching all staple cards from YGOPRODeck API...");
    
    // Fetch all staple cards
    const stapleUrl = "https://db.ygoprodeck.com/api/v7/cardinfo.php?staple=yes";
    
    const response = await fetch(stapleUrl, {
      headers: {
        "User-Agent": "Yu-Gi-Oh-Card-Bot/1.0 (contact: developer@example.com)",
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`🃏 YU-GI-OH ERROR: API failed: ${response.status} ${errorText}`);
      throw new Error(`YGOPRODeck API error: ${response.status} - ${errorText}`);
    }
    
    const apiData: YugiohApiResponse = await response.json();
    
    if (!apiData.data || apiData.data.length === 0) {
      console.error("🃏 YU-GI-OH ERROR: No staple cards found in API response");
      return null;
    }
    
    console.log(`🃏 YU-GI-OH: Found ${apiData.data.length} staple cards`);
    
    // Filter cards that have images
    const cardsWithImages = apiData.data.filter((card) => {
      return card.card_images && card.card_images.length > 0 && card.card_images[0].image_url;
    });
    
    if (cardsWithImages.length === 0) {
      console.error("🃏 YU-GI-OH ERROR: No staple cards with images found");
      return null;
    }
    
    console.log(`🃏 YU-GI-OH: ${cardsWithImages.length} staple cards have images`);
    
    // Pick a random card
    const randomIndex = Math.floor(Math.random() * cardsWithImages.length);
    const selectedCard = cardsWithImages[randomIndex];
    
    console.log(`🃏 YU-GI-OH SUCCESS: Selected random staple card: "${selectedCard.name}"`);
    
    return selectedCard;
  } catch (err: any) {
    console.error(`🃏 YU-GI-OH ERROR: Exception during card fetch: ${err.message}`);
    throw err;
  }
}

async function postToMastodon(
  account: MastodonAccount,
  card: YugiohCard,
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
    console.log(`${logPrefix} DOWNLOAD: Downloading image from YGOPRODeck...`);
    const imageResponse = await fetch(imageInfo.url);
    
    if (!imageResponse.ok) {
      const errorText = await imageResponse.text();
      console.error(`${logPrefix} ERROR: Failed to download image: ${imageResponse.status} ${errorText}`);
      throw new Error(`Image download failed: ${imageResponse.status}`);
    }
    
    const imageBlob = await imageResponse.blob();
    console.log(`${logPrefix} IMAGE: Downloaded ${imageBlob.size} bytes`);
    
    // Upload to Mastodon
    const mastodonUrl = normalizeMastodonUrl(account.mastodon_base_url);
    console.log(`${logPrefix} MASTODON: Uploading media to ${mastodonUrl}`);
    const formData = new FormData();
    formData.append("file", imageBlob, `yugioh-card.${imageInfo.format}`);
    
    const mediaResponse = await fetch(`${mastodonUrl}/api/v1/media`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${account.mastodon_access_token}`,
      },
      body: formData,
    });
    
    if (!mediaResponse.ok) {
      const errorText = await mediaResponse.text();
      console.error(`${logPrefix} ERROR: Failed to upload media: ${mediaResponse.status} ${errorText}`);
      throw new Error(`Mastodon media upload failed: ${mediaResponse.status}`);
    }
    
    const mediaData = await mediaResponse.json();
    const mediaId = mediaData.id;
    console.log(`${logPrefix} MEDIA: Uploaded successfully, ID: ${mediaId}`);
    
    // Wait for processing
    console.log(`${logPrefix} WAIT: Waiting 4 seconds for media processing...`);
    await new Promise((resolve) => setTimeout(resolve, 4000));
    
    // Create status post
    console.log(`${logPrefix} POSTING: Creating status post`);
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );
    const postText = await formatCardPost(card, account.id, supabase);
    console.log(`${logPrefix} POST TEXT: "${postText}"`);
    
    const statusData = {
      status: postText,
      media_ids: [mediaId],
      visibility: "public",
    };
    
    const statusResponse = await fetch(`${mastodonUrl}/api/v1/statuses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${account.mastodon_access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(statusData),
    });
    
    if (!statusResponse.ok) {
      const errorText = await statusResponse.text();
      console.error(`${logPrefix} ERROR: Failed to create status: ${statusResponse.status} ${errorText}`);
      throw new Error(`Mastodon status creation failed: ${statusResponse.status}`);
    }
    
    const statusResult = await statusResponse.json();
    console.log(`${logPrefix} SUCCESS: Posted card - Status ID: ${statusResult.id}`);
    
    return { success: true, statusId: statusResult.id };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

console.log("🃏 YU-GI-OH BOT: Function starting at", new Date().toISOString());

serve(async (req) => {
  const startTime = Date.now();
  console.log("🃏 YU-GI-OH BOT: Function invoked with method:", req.method);
  
  if (req.method === "OPTIONS") {
    console.log("🃏 YU-GI-OH BOT: Handling OPTIONS request");
    return new Response("ok", { headers: corsHeaders });
  }
  
  try {
    console.log("🃏 YU-GI-OH BOT: Starting main logic");
    
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseKey) {
      console.error("🃏 YU-GI-OH BOT ERROR: Missing environment variables");
      throw new Error("Missing required environment variables");
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Parse query parameters
    const url = new URL(req.url);
    const accountUsername = url.searchParams.get("account");
    const intervalHours = parseInt(url.searchParams.get("interval_hours") ?? "6") || 6;
    const maxAccounts = parseInt(url.searchParams.get("max_accounts") ?? "10") || 10;
    
    // Get Mastodon accounts to process
    let accountsToProcess: MastodonAccount[] = [];
    
    if (accountUsername) {
      // Manual: process specific account
      console.log(`🃏 YU-GI-OH BOT MANUAL: Processing specific account: ${accountUsername}`);
      const { data, error } = await supabase
        .from("mastodon_accounts")
        .select("*")
        .eq("account_username", accountUsername)
        .eq("account_type", "yugioh")
        .eq("active", true)
        .single();
      
      if (error || !data) {
        throw new Error(`Yu-Gi-Oh account "${accountUsername}" not found or inactive`);
      }
      accountsToProcess = [data];
    } else {
      // Automatic: find all accounts due to post
      const now = new Date();
      const intervalMs = intervalHours * 60 * 60 * 1000;
      const cutoffTime = new Date(now.getTime() - intervalMs);
      
      console.log(`🃏 YU-GI-OH BOT SCHEDULE: Finding accounts due before ${cutoffTime.toISOString()}`);
      
      const { data: accounts, error } = await supabase
        .from("mastodon_accounts")
        .select("*")
        .eq("active", true)
        .eq("account_type", "yugioh")
        .or(`last_posted_at.is.null,last_posted_at.lt.${cutoffTime.toISOString()}`)
        .order("last_posted_at", { ascending: true, nullsFirst: true })
        .limit(maxAccounts);
      
      if (error) {
        console.error("🃏 YU-GI-OH BOT ERROR: Database query failed:", error);
        throw new Error(`Failed to fetch accounts: ${error.message}`);
      }
      
      if (!accounts || accounts.length === 0) {
        console.log("🃏 YU-GI-OH BOT EMPTY: No accounts due to post at this time");
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
      console.log(`🃏 YU-GI-OH BOT FOUND: ${accountsToProcess.length} account(s) due to post`);
      if (accountsToProcess.length > 0) {
        console.log(`🃏 YU-GI-OH BOT ACCOUNTS: ${accountsToProcess.map(acc => `@${acc.account_username}`).join(", ")}`);
      }
    }
    
    // Process each account
    let processedCount = 0;
    const results: Array<{ account: string; card?: any; error?: string }> = [];
    
    for (const account of accountsToProcess) {
      // Check timeout (leave buffer for response)
      const elapsedMs = Date.now() - startTime;
      if (elapsedMs > 50000) {
        console.log(`🃏 YU-GI-OH BOT TIMEOUT: Stopping early after ${elapsedMs}ms to avoid function timeout`);
        break;
      }
      
      try {
        console.log(`🃏 YU-GI-OH BOT PROCESSING: @${account.account_username}`);
        
        // Skip if posted recently (prevent double-posting)
        if (account.last_posted_at) {
          const lastPostTime = new Date(account.last_posted_at);
          const minutesSinceLastPost = (Date.now() - lastPostTime.getTime()) / (1000 * 60);
          if (minutesSinceLastPost < 5) {
            console.log(`🃏 YU-GI-OH BOT SKIP: Posted ${minutesSinceLastPost.toFixed(1)} minutes ago`);
            results.push({
              account: account.account_username,
              error: "Posted too recently",
            });
            continue;
          }
        }
        
        // Fetch random staple card
        console.log("🃏 YU-GI-OH BOT: Fetching random staple card...");
        const card = await fetchRandomStapleCard();
        
        if (!card) {
          throw new Error("Failed to fetch staple card");
        }
        
        // Post to Mastodon
        const postResult = await postToMastodon(account, card, "🃏 YU-GI-OH");
        
        if (!postResult.success) {
          throw new Error(postResult.error || "Failed to post to Mastodon");
        }
        
        // Update last_posted_at
        const now = new Date().toISOString();
        const { error: updateError } = await supabase
          .from("mastodon_accounts")
          .update({ last_posted_at: now })
          .eq("id", account.id);
        
        if (updateError) {
          console.error(`🃏 YU-GI-OH BOT ERROR: Failed to update account:`, updateError);
        }
        
        console.log(`🃏 YU-GI-OH BOT COMPLETE: Successfully posted "${card.name}" for @${account.account_username}`);
        processedCount++;
        
        results.push({
          account: account.account_username,
          card: {
            name: card.name,
            type: card.type,
            archetype: card.archetype,
            atk: card.atk,
            def: card.def,
            level: card.level,
          },
        });
      } catch (error: any) {
        console.error(`🃏 YU-GI-OH BOT ERROR processing @${account.account_username}:`, error.message);
        results.push({
          account: account.account_username,
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
    console.error("🃏 YU-GI-OH BOT FATAL ERROR:", error);
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

