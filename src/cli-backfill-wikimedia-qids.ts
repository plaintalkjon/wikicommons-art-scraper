#!/usr/bin/env node
/**
 * Backfill Wikidata QIDs for existing Wikimedia Commons sources
 * Uses source_title (Commons file title) to query Wikidata for matching QIDs
 */

import { supabase } from './supabaseClient';
import { config } from './config';

const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
const BATCH_SIZE = 50; // Process in batches
const DELAY_BETWEEN_BATCHES = 1000; // 1 second delay to respect rate limits

/**
 * Get Wikidata QID from Commons API using page ID or title
 * Uses Commons API pageprops to get wikibase_item
 */
async function findQIDFromCommonsAPI(pageId: number | null, title: string | null): Promise<string | null> {
  const API_ENDPOINT = 'https://commons.wikimedia.org/w/api.php';
  
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
    
    const res = await fetch(`${API_ENDPOINT}?${params.toString()}`, {
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
      // QID comes as "Q123456" format, return as-is
      return qid;
    }
    
    return null;
  } catch (err) {
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
 * Fetch all Wikimedia sources without QIDs (handles pagination)
 */
async function fetchAllSourcesWithoutQIDs(): Promise<Array<{ id: string; source_pageid: number | null; source_title: string | null; source_url: string | null }>> {
  const allSources: Array<{ id: string; source_pageid: number | null; source_title: string | null; source_url: string | null }> = [];
  let from = 0;
  const pageSize = 1000; // Supabase default limit
  
  while (true) {
    const { data, error } = await supabase
      .from('art_sources')
      .select('id, source_pageid, source_title, source_url')
      .eq('source', 'wikimedia')
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
  console.log('Backfilling Wikidata QIDs for Wikimedia Commons sources...\n');
  
  // First, get a count
  console.log('→ Counting Wikimedia sources without QIDs...');
  const { count, error: countError } = await supabase
    .from('art_sources')
    .select('*', { count: 'exact', head: true })
    .eq('source', 'wikimedia')
    .or('wikidata_qid.is.null,wikidata_qid.eq.');
  
  if (countError) {
    console.error(`✗ Error counting sources: ${countError.message}`);
    process.exit(1);
  }
  
  if (count === 0) {
    console.log('✓ No Wikimedia sources found without QIDs');
    return;
  }
  
  console.log(`✓ Found ${count} Wikimedia sources to backfill\n`);
  
  // Get all Wikimedia sources without QIDs (with pagination)
  console.log('→ Fetching sources (this may take a moment for large datasets)...');
  let sources: Array<{ id: string; source_pageid: number | null; source_title: string | null; source_url: string | null }>;
  
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
  
  let processed = 0;
  let found = 0;
  let notFound = 0;
  let errors = 0;
  const errorsList: Array<{ id: string; title: string; error: string }> = [];
  
  // Process in batches
  for (let i = 0; i < sources.length; i += BATCH_SIZE) {
    const batch = sources.slice(i, i + BATCH_SIZE);
    
    console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(sources.length / BATCH_SIZE)} (${i + 1}-${Math.min(i + BATCH_SIZE, sources.length)} of ${sources.length})...`);
    
    for (const source of batch) {
      processed++;
      const title = source.source_title || null;
      const pageId = source.source_pageid || null;
      
      try {
        // Try Commons API first (more reliable)
        const qid = await findQIDFromCommonsAPI(pageId, title);
        
        if (qid) {
          await updateSourceWithQID(source.id, qid);
          found++;
          // Only log individual finds if we're processing a small batch
          if (sources.length <= 50) {
            console.log(`  ✓ Found QID ${qid} for: ${title || `page-${pageId}`}`);
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
        errorsList.push({
          id: source.id,
          title: title || `page-${pageId}`,
          error: errorMsg,
        });
        
        // If it's a rate limit, wait longer
        if (errorMsg.includes('429')) {
          console.log(`  ⚠ Rate limit hit, waiting 5 seconds...`);
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
      
      // Small delay between individual queries (Commons API is more lenient)
      await new Promise(resolve => setTimeout(resolve, 200));
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
  
  if (errorsList.length > 0) {
    console.log(`\nErrors:`);
    errorsList.slice(0, 10).forEach(err => {
      console.log(`  - ${err.title}: ${err.error}`);
    });
    if (errorsList.length > 10) {
      console.log(`  ... and ${errorsList.length - 10} more errors`);
    }
  }
  
  if (notFound > 0) {
    console.log(`\nNote: ${notFound} sources did not have matching Wikidata items.`);
    console.log(`This is normal - not all Commons files have Wikidata entries.`);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

