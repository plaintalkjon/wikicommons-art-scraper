// HEALTH CHECK FUNCTION - Monitors accounts that haven't posted in 6+ hours
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey",
};

/**
 * Build full Mastodon handle for display
 */
function buildMastodonHandle(username: string, baseUrl: string): string {
  const cleanUsername = username.replace(/^@+/, '').split('@')[0];
  const domain = baseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '').split('/')[0];
  return `@${cleanUsername}@${domain}`;
}

serve(async (req) => {
  console.log("🏥 HEALTH CHECK: Starting at", new Date().toISOString());

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Missing required environment variables");
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse query parameters
    const url = new URL(req.url);
    const intervalHours = parseInt(url.searchParams.get("interval_hours") ?? "6") || 6;

    const now = new Date();
    const cutoffTime = new Date(now.getTime() - intervalHours * 60 * 60 * 1000);

    console.log(`🏥 HEALTH CHECK: Checking accounts due before ${cutoffTime.toISOString()}`);

    // Get all active accounts that are due to post (all types: artist, tag, philosopher, mtg, yugioh)
    const { data: dueAccounts, error } = await supabase
      .from("mastodon_accounts")
      .select("id, account_username, account_type, active, last_posted_at, mastodon_base_url, artist_id, tag_id, author_id")
      .eq("active", true)
      .in("account_type", ["artist", "tag", "quote", "mtg", "yugioh"])
      .or(`last_posted_at.is.null,last_posted_at.lt.${cutoffTime.toISOString()}`)
      .order("account_type", { ascending: true })
      .order("last_posted_at", { ascending: true, nullsFirst: true });

    if (error) {
      console.error("🏥 HEALTH CHECK ERROR: Failed to fetch accounts:", error);
      throw new Error(`Failed to fetch accounts: ${error.message}`);
    }

    const accounts = dueAccounts || [];
    console.log(`🏥 HEALTH CHECK: Found ${accounts.length} accounts due to post`);

    // Group by account type
    const byType: Record<string, typeof accounts> = {
      artist: [],
      tag: [],
      quote: [],
      mtg: [],
      yugioh: [],
    };

    accounts.forEach(account => {
      if (account.account_type in byType) {
        byType[account.account_type].push(account);
      } else {
        // Handle any unknown account types
        if (!byType['other']) {
          byType['other'] = [];
        }
        byType['other'].push(account);
      }
    });

    // Build summary
    const summary: string[] = [];
    summary.push(`\n🏥 HEALTH CHECK SUMMARY (${now.toISOString()})`);
    summary.push(`═══════════════════════════════════════════════════════════`);
    summary.push(`Total accounts due to post: ${accounts.length}`);
    summary.push(`  - Artist accounts: ${byType.artist.length}`);
    summary.push(`  - Tag accounts: ${byType.tag.length}`);
    summary.push(`  - Quote accounts: ${byType.quote.length}`);
    summary.push(`  - MTG accounts: ${byType.mtg.length}`);
    summary.push(`  - Yu-Gi-Oh accounts: ${byType.yugioh.length}`);
    if (byType['other']) {
      summary.push(`  - Other accounts: ${byType['other'].length}`);
    }
    summary.push(``);

    // Log each account with details
    if (accounts.length > 0) {
      summary.push(`📋 ACCOUNTS DUE TO POST:`);
      summary.push(``);

      Object.entries(byType).forEach(([type, typeAccounts]) => {
        if (typeAccounts.length === 0) return;

        summary.push(`${type.toUpperCase()} (${typeAccounts.length}):`);
        
        typeAccounts.forEach(account => {
          const handle = buildMastodonHandle(account.account_username, account.mastodon_base_url);
          const hoursAgo = account.last_posted_at 
            ? ((now.getTime() - new Date(account.last_posted_at).getTime()) / (1000 * 60 * 60)).toFixed(1)
            : 'NEVER';
          
          summary.push(`  - ${handle} (${hoursAgo}h ago)`);
        });
        
        summary.push(``);
      });
    } else {
      summary.push(`✅ All accounts are up to date!`);
      summary.push(``);
    }

    // Check for accounts with missing foreign keys (only for types that require them)
    const missingKeys: string[] = [];
    accounts.forEach(account => {
      if (account.account_type === 'artist' && !account.artist_id) {
        missingKeys.push(`${buildMastodonHandle(account.account_username, account.mastodon_base_url)} - missing artist_id`);
      } else if (account.account_type === 'tag' && !account.tag_id) {
        missingKeys.push(`${buildMastodonHandle(account.account_username, account.mastodon_base_url)} - missing tag_id`);
      } else if (account.account_type === 'quote' && !account.author_id) {
        missingKeys.push(`${buildMastodonHandle(account.account_username, account.mastodon_base_url)} - missing author_id`);
      }
      // Note: MTG and Yu-Gi-Oh accounts don't require foreign keys
    });

    if (missingKeys.length > 0) {
      summary.push(`⚠️  ACCOUNTS WITH MISSING FOREIGN KEYS:`);
      missingKeys.forEach(key => summary.push(`  - ${key}`));
      summary.push(``);
    }

    const summaryText = summary.join('\n');
    console.log(summaryText);

    return new Response(
      JSON.stringify({
        success: true,
        timestamp: now.toISOString(),
        interval_hours: intervalHours,
        total_due: accounts.length,
        by_type: {
          artist: byType.artist.length,
          tag: byType.tag.length,
          quote: byType.quote.length,
          mtg: byType.mtg.length,
          yugioh: byType.yugioh.length,
          ...(byType['other'] ? { other: byType['other'].length } : {}),
        },
        accounts: accounts.map(acc => ({
          username: buildMastodonHandle(acc.account_username, acc.mastodon_base_url),
          type: acc.account_type,
          last_posted_at: acc.last_posted_at,
          hours_ago: acc.last_posted_at 
            ? ((now.getTime() - new Date(acc.last_posted_at).getTime()) / (1000 * 60 * 60)).toFixed(1)
            : null,
        })),
        missing_keys: missingKeys,
        summary: summaryText,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error: any) {
    console.error("🏥 HEALTH CHECK FATAL ERROR:", error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

