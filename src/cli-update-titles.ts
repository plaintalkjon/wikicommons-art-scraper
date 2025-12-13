/**
 * CLI script to update artwork titles from Wikidata
 * Fetches proper titles from Wikidata using the item IDs we already have
 */

import { supabase } from './supabaseClient';
import { fetchWikidataItemTitle } from './wikidata';

async function main() {
  console.log('=== Updating Artwork Titles from Wikidata ===\n');

  // Fetch all artworks with Wikidata source items
  // First get all art IDs with Wikidata sources
  const { data: sources, error: sourcesError } = await supabase
    .from('art_sources')
    .select('art_id, source_pageid')
    .eq('source', 'wikidata')
    .not('source_pageid', 'is', null);

  if (sourcesError) {
    console.error('Error fetching sources:', sourcesError);
    process.exit(1);
  }

  if (!sources || sources.length === 0) {
    console.log('No artworks with Wikidata sources found.');
    return;
  }

  // Create a map of art_id -> source_pageid for quick lookup
  const sourceMap = new Map<string, string>();
  sources.forEach(s => {
    if (s.art_id && s.source_pageid) {
      sourceMap.set(s.art_id, s.source_pageid);
    }
  });

  const artIds = Array.from(sourceMap.keys());
  
  // Fetch arts in batches (Supabase .in() has limits)
  const BATCH_SIZE_QUERY = 100;
  const allArts: Array<{ id: string; title: string }> = [];
  
  for (let i = 0; i < artIds.length; i += BATCH_SIZE_QUERY) {
    const batch = artIds.slice(i, i + BATCH_SIZE_QUERY);
    const { data: arts, error: fetchError } = await supabase
      .from('arts')
      .select('id, title')
      .in('id', batch);
    
    if (fetchError) {
      console.error('Error fetching arts batch:', fetchError);
      continue;
    }
    
    if (arts) {
      allArts.push(...arts);
    }
  }
  
  const arts = allArts;

  if (arts.length === 0) {
    console.log('No artworks with Wikidata sources found.');
    return;
  }

  console.log(`Found ${arts.length} artworks with Wikidata sources.\n`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  // Process in batches to avoid rate limiting
  const BATCH_SIZE = 10;
  const DELAY_MS = 1000; // 1 second delay between batches

  for (let i = 0; i < arts.length; i += BATCH_SIZE) {
    const batch = arts.slice(i, i + BATCH_SIZE);
    console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(arts.length / BATCH_SIZE)}...`);

    await Promise.all(
      batch.map(async (art) => {
        try {
          // Find the source for this art using the map
          const sourcePageId = sourceMap.get(art.id);
          
          if (!sourcePageId) {
            skipped++;
            return;
          }

          // Extract QID from source_pageid (might be "Q123" or just "123")
          let qid = String(sourcePageId);
          if (!qid.startsWith('Q')) {
            qid = `Q${qid}`;
          }

          // Fetch proper title from Wikidata
          const wikidataTitle = await fetchWikidataItemTitle(qid);

          if (!wikidataTitle) {
            console.log(`  ⚠️  No title found for ${art.title} (${qid})`);
            skipped++;
            return;
          }

          // Only update if the title is different and better (not just a filename)
          const currentTitle = art.title;
          const isFilename = currentTitle.includes('.jpg') || currentTitle.includes('.jpeg') || 
                            currentTitle.includes('.png') || currentTitle.includes('.tiff') ||
                            currentTitle.match(/^File:/i) || currentTitle.match(/-\s*(s\d+|Google|Art Project)/i);

          if (wikidataTitle !== currentTitle && (isFilename || wikidataTitle.length < currentTitle.length)) {
            // Update the title
            const { error: updateError } = await supabase
              .from('arts')
              .update({ title: wikidataTitle })
              .eq('id', art.id);

            if (updateError) {
              console.error(`  ✗ Error updating ${art.title}:`, updateError.message);
              errors++;
            } else {
              console.log(`  ✓ Updated: "${currentTitle.substring(0, 50)}..." → "${wikidataTitle}"`);
              updated++;
            }
          } else {
            skipped++;
          }
        } catch (err) {
          console.error(`  ✗ Error processing ${art.title}:`, (err as Error).message);
          errors++;
        }
      })
    );

    // Delay between batches to avoid rate limiting
    if (i + BATCH_SIZE < arts.length) {
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Errors: ${errors}`);
}

main().catch(console.error);

