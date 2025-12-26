#!/usr/bin/env node
/**
 * Backfill Wikidata QIDs for ALL existing sources (Wikimedia and Met Museum)
 * This preemptively fills QIDs to avoid duplication when processing new artworks
 */

import { supabase } from './supabaseClient';
import { config } from './config';

const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
const COMMONS_API_ENDPOINT = 'https://commons.wikimedia.org/w/api.php';
const BATCH_SIZE = 50; // Process in batches
const DELAY_BETWEEN_BATCHES = 1000; // 1 second delay to respect rate limits
const DELAY_BETWEEN_QUERIES = 200; // 200ms between individual queries

interface SourceRecord {
  id: string;
  source: string;
  source_pageid: number | null;
  source_title: string | null;
  source_url: string | null;
}

/**
 * Extract QID from source URL if it contains a Wikidata link
 */
function extractQIDFromURL(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(/wikidata\.org\/[^/]+\/(Q\d+)/i);
  return match ? match[1] : null;
}

/**
 * Get Wikidata QID from Commons API using page ID or title
 */
async function findQIDFromCommonsAPI(pageId: number | null, title: string | null, sourceUrl: string | null): Promise<string | null> {
  // First, try to extract QID from source URL if it's a Wikidata link
  const urlQID = extractQIDFromURL(sourceUrl);
  if (urlQID) {
    return urlQID;
  }
  
  try {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      prop: 'pageprops',
      ppprop: 'wikibase_item',
    });
    
    // Prefer page ID if available and valid (> 0), otherwise use title
    if (pageId && pageId > 0) {
      params.append('pageids', pageId.toString());
    } else if (title) {
      // Ensure title has "File:" prefix if missing
      const normalizedTitle = title.startsWith('File:') ? title : `File:${title}`;
      params.append('titles', normalizedTitle);
    } else {
      return null;
    }
    
    const res = await fetch(`${COMMONS_API_ENDPOINT}?${params.toString()}`, {
      headers: {
        'User-Agent': config.wikimediaClientId 
          ? `wikicommons-art-scraper/1.0 (OAuth client: ${config.wikimediaClientId})`
          : 'wikicommons-art-scraper/1.0 (contact: developer@example.com)',
      },
    });
    
    if (!res.ok) {
      return null;
    }
    
    const data = await res.json() as {
      query?: {
        pages?: Array<{
          pageprops?: {
            wikibase_item?: string;
          };
        }>;
      };
    };
    
    const page = data.query?.pages?.[0];
    const qid = page?.pageprops?.wikibase_item;
    
    if (qid) {
      return qid;
    }
    
    return null;
  } catch (err) {
    return null;
  }
}

/**
 * Get Wikidata QID from Met object ID using SPARQL
 * Queries Wikidata for items with P3634 (Met object ID) matching the given ID
 */
async function findQIDFromMetObjectID(metObjectID: number): Promise<string | null> {
  const query = `
    SELECT ?item WHERE {
      ?item wdt:P3634 ?metId .
      FILTER(?metId = ${metObjectID})
    }
    LIMIT 1
  `;
  
  try {
    const headers: HeadersInit = {
      'Content-Type': 'application/sparql-query',
      Accept: 'application/sparql-results+json',
      'User-Agent': config.wikimediaClientId 
        ? `wikicommons-art-scraper/1.0 (OAuth client: ${config.wikimediaClientId})`
        : 'wikicommons-art-scraper/1.0 (contact: developer@example.com)',
    };
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
    
    const res = await fetch(SPARQL_ENDPOINT, {
      method: 'POST',
      headers,
      body: query,
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!res.ok) {
      if (res.status === 429) {
        throw new Error('Wikidata rate limit (429)');
      }
      return null;
    }
    
    const data = (await res.json()) as {
      results: { bindings: Array<Record<string, { type: string; value: string }>> };
    };
    
    const binding = data.results?.bindings?.[0];
    if (binding?.item?.value) {
      const qid = binding.item.value.replace('http://www.wikidata.org/entity/', '');
      return qid;
    }
    
    return null;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return null; // Timeout
    }
    if (err instanceof Error && err.message.includes('429')) {
      throw err; // Rate limit - propagate
    }
    return null;
  }
}

/**
 * Update art_sources with Wikidata QID
 */
async function updateSourceWithQID(sourceId: string, wikidataQID: string): Promise<void> {
  const { error } = await supabase
    .from('art_sources')
    .update({ wikidata_qid: wikidataQID })
    .eq('id', sourceId);
  
  if (error) {
    throw new Error(`Failed to update source ${sourceId}: ${error.message}`);
  }
}

/**
 * Fetch all sources without QIDs (handles pagination)
 */
async function fetchAllSourcesWithoutQIDs(): Promise<SourceRecord[]> {
  const allSources: SourceRecord[] = [];
  let from = 0;
  const pageSize = 1000; // Supabase default limit
  
  while (true) {
    const { data, error } = await supabase
      .from('art_sources')
      .select('id, source, source_pageid, source_title, source_url')
      .or('wikidata_qid.is.null,wikidata_qid.eq.')
      .range(from, from + pageSize - 1);
    
    if (error) {
      throw new Error(`Failed to fetch sources: ${error.message}`);
    }
    
    if (!data || data.length === 0) {
      break;
    }
    
    allSources.push(...data);
    
    if (data.length < pageSize) {
      break; // Last page
    }
    
    from += pageSize;
  }
  
  return allSources;
}

async function main() {
  console.log('Backfilling Wikidata QIDs for ALL sources (Wikimedia and Met Museum)...\n');
  
  // First, get counts by source type
  console.log('→ Counting sources without QIDs...');
  const { count: totalCount, error: countError } = await supabase
    .from('art_sources')
    .select('*', { count: 'exact', head: true })
    .or('wikidata_qid.is.null,wikidata_qid.eq.');
  
  const { count: wikimediaCount } = await supabase
    .from('art_sources')
    .select('*', { count: 'exact', head: true })
    .in('source', ['wikimedia', 'wikimedia_commons', 'wikidata'])
    .or('wikidata_qid.is.null,wikidata_qid.eq.');
  
  const { count: metCount } = await supabase
    .from('art_sources')
    .select('*', { count: 'exact', head: true })
    .eq('source', 'metmuseum')
    .or('wikidata_qid.is.null,wikidata_qid.eq.');
  
  if (countError) {
    console.error(`✗ Error counting sources: ${countError.message}`);
    process.exit(1);
  }
  
  if (totalCount === 0) {
    console.log('✓ No sources found without QIDs');
    return;
  }
  
  console.log(`✓ Found ${totalCount} sources to backfill:`);
  console.log(`  - Wikimedia: ${wikimediaCount || 0}`);
  console.log(`  - Met Museum: ${metCount || 0}\n`);
  
  // Get all sources without QIDs (with pagination)
  console.log('→ Fetching sources (this may take a moment for large datasets)...');
  let sources: SourceRecord[];
  
  try {
    sources = await fetchAllSourcesWithoutQIDs();
  } catch (err) {
    console.error(`✗ Error fetching sources: ${(err as Error).message}`);
    process.exit(1);
  }
  
  if (!sources || sources.length === 0) {
    console.log('✓ No sources to process');
    return;
  }
  
  console.log(`✓ Fetched ${sources.length} sources to process\n`);
  
  // Group by source type for better reporting
  const wikimediaSources = sources.filter(s => s.source === 'wikimedia' || s.source === 'wikimedia_commons' || s.source === 'wikidata');
  const metSources = sources.filter(s => s.source === 'metmuseum');
  const otherSources = sources.filter(s => 
    s.source !== 'wikimedia' && 
    s.source !== 'wikimedia_commons' && 
    s.source !== 'wikidata' && 
    s.source !== 'metmuseum'
  );
  
  if (otherSources.length > 0) {
    console.log(`⚠ Warning: Found ${otherSources.length} sources with unknown source type: ${Array.from(new Set(otherSources.map(s => s.source))).join(', ')}`);
  }
  
  let processed = 0;
  let found = 0;
  let notFound = 0;
  let errors = 0;
  const errorsList: Array<{ id: string; source: string; identifier: string; error: string }> = [];
  
  // Process in batches
  for (let i = 0; i < sources.length; i += BATCH_SIZE) {
    const batch = sources.slice(i, i + BATCH_SIZE);
    
    console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(sources.length / BATCH_SIZE)} (${i + 1}-${Math.min(i + BATCH_SIZE, sources.length)} of ${sources.length})...`);
    
    for (const source of batch) {
      processed++;
      let qid: string | null = null;
      
      try {
        // Handle Wikimedia Commons sources (multiple source type names)
        if (source.source === 'wikimedia' || source.source === 'wikimedia_commons' || source.source === 'wikidata') {
          // Use Commons API for all Wikimedia/Commons sources
          qid = await findQIDFromCommonsAPI(source.source_pageid, source.source_title, source.source_url);
        } else if (source.source === 'metmuseum') {
          // Use Wikidata SPARQL by Met object ID
          if (source.source_pageid && source.source_pageid > 0) {
            qid = await findQIDFromMetObjectID(source.source_pageid);
          }
        } else {
          // Unknown source type, skip
          notFound++;
          continue;
        }
        
        if (qid) {
          await updateSourceWithQID(source.id, qid);
          found++;
          // Only log individual finds if we're processing a small batch
          if (sources.length <= 50) {
            const isWikimedia = source.source === 'wikimedia' || source.source === 'wikimedia_commons' || source.source === 'wikidata';
            const identifier = isWikimedia
              ? (source.source_title || `page-${source.source_pageid}`)
              : `Met object ${source.source_pageid}`;
            console.log(`  ✓ Found QID ${qid} for ${source.source}: ${identifier}`);
          }
        } else {
          notFound++;
        }
        
        // Progress updates
        if (processed % 50 === 0 || processed === sources.length) {
          const percent = ((processed / sources.length) * 100).toFixed(1);
          console.log(`  Progress: ${processed}/${sources.length} (${percent}%) | Found: ${found} | Not Found: ${notFound} | Errors: ${errors}`);
        }
      } catch (err) {
        errors++;
        const errorMsg = err instanceof Error ? err.message : String(err);
        const isWikimedia = source.source === 'wikimedia' || source.source === 'wikimedia_commons' || source.source === 'wikidata';
        const identifier = isWikimedia
          ? (source.source_title || `page-${source.source_pageid}`)
          : `Met object ${source.source_pageid}`;
        errorsList.push({
          id: source.id,
          source: source.source,
          identifier,
          error: errorMsg,
        });
        
        // If it's a rate limit, wait longer
        if (errorMsg.includes('429')) {
          console.log(`  ⚠ Rate limit hit, waiting 5 seconds...`);
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
      
      // Small delay between individual queries
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_QUERIES));
    }
    
    // Delay between batches
    if (i + BATCH_SIZE < sources.length) {
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
    }
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log('Backfill Complete');
  console.log(`${'='.repeat(60)}`);
  console.log(`Total processed: ${processed}`);
  console.log(`QIDs found and updated: ${found} ✓`);
  console.log(`QIDs not found: ${notFound}`);
  console.log(`Errors: ${errors}`);
  
  // Breakdown by source type
  const foundBySource = new Map<string, number>();
  const notFoundBySource = new Map<string, number>();
  
  // This is approximate since we don't track during processing, but we can estimate
  console.log(`\nBreakdown:`);
  console.log(`  Wikimedia: ${wikimediaSources.length} sources`);
  console.log(`  Met Museum: ${metSources.length} sources`);
  
  if (errorsList.length > 0) {
    console.log(`\nErrors:`);
    errorsList.slice(0, 10).forEach(err => {
      console.log(`  - ${err.source}: ${err.identifier}: ${err.error}`);
    });
    if (errorsList.length > 10) {
      console.log(`  ... and ${errorsList.length - 10} more errors`);
    }
  }
  
  if (notFound > 0) {
    console.log(`\nNote: ${notFound} sources did not have matching Wikidata items.`);
    console.log(`This is normal - not all Commons files or Met objects have Wikidata entries.`);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
