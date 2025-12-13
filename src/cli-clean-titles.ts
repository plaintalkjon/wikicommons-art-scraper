/**
 * CLI script to clean up artwork titles by removing filename artifacts
 * This is simpler and safer than fetching from Wikidata
 */

import { supabase } from './supabaseClient';

function cleanTitle(title: string): string {
  let cleaned = title;
  
  // Remove "File:" prefix
  cleaned = cleaned.replace(/^File:\s*/i, '');
  
  // Remove file extensions
  cleaned = cleaned.replace(/\.(jpg|jpeg|png|gif|tiff|tif|webp|svg)$/i, '');
  
  // Remove common museum codes and identifiers
  cleaned = cleaned.replace(/\s*-\s*(s\d+[VvMmAa]\d+|Google Art Project|Art Project)/gi, '');
  cleaned = cleaned.replace(/\s*-\s*\d{4}\.\d+\s*-\s*[^-]+$/i, ''); // Museum accession numbers
  cleaned = cleaned.replace(/\s*\(\d{4}\)\s*$/i, ''); // Years in parentheses at end
  
  // Remove artist name if it appears at the start (common pattern)
  cleaned = cleaned.replace(/^(Vincent\s+van\s+Gogh|Van\s+Gogh|Rembrandt|Peter\s+Paul\s+Rubens|John\s+Singer\s+Sargent)[\s\-:]+/i, '');
  
  // Clean up multiple spaces/hyphens
  cleaned = cleaned.replace(/\s+/g, ' ');
  cleaned = cleaned.replace(/\s*-\s*/g, ' - ');
  cleaned = cleaned.replace(/^\s+|\s+$/g, '');
  
  // Capitalize first letter
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  
  return cleaned;
}

async function main() {
  console.log('=== Cleaning Artwork Titles ===\n');

  // Fetch all artworks with pagination (Supabase default limit is 1000)
  const allArts: Array<{ id: string; title: string }> = [];
  let from = 0;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data: arts, error: fetchError } = await supabase
      .from('arts')
      .select('id, title')
      .order('id')
      .range(from, from + pageSize - 1);

    if (fetchError) {
      console.error('Error fetching arts:', fetchError);
      process.exit(1);
    }

    if (!arts || arts.length === 0) {
      hasMore = false;
    } else {
      allArts.push(...arts);
      from += pageSize;
      hasMore = arts.length === pageSize;
      console.log(`Fetched ${allArts.length} artworks so far...`);
    }
  }

  const arts = allArts;

  if (arts.length === 0) {
    console.log('No artworks found.');
    return;
  }

  console.log(`\nFound ${arts.length} total artworks.\n`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  // Process in batches
  const BATCH_SIZE = 50;

  for (let i = 0; i < arts.length; i += BATCH_SIZE) {
    const batch = arts.slice(i, i + BATCH_SIZE);
    console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(arts.length / BATCH_SIZE)}...`);

    for (const art of batch) {
      try {
        const cleaned = cleanTitle(art.title);
        
        // Only update if the cleaned title is different and better (shorter or doesn't look like filename)
        const isFilename = art.title.match(/\.(jpg|jpeg|png|gif|tiff|tif|webp|svg)$/i) || 
                          art.title.match(/^File:/i) ||
                          art.title.match(/-\s*(s\d+|Google|Art Project)/i);
        
        if (cleaned !== art.title && cleaned.length > 0 && (isFilename || cleaned.length < art.title.length)) {
          // Update the title
          const { error: updateError } = await supabase
            .from('arts')
            .update({ title: cleaned })
            .eq('id', art.id);

          if (updateError) {
            console.error(`  ✗ Error updating ${art.title}:`, updateError.message);
            errors++;
          } else {
            console.log(`  ✓ "${art.title.substring(0, 60)}..." → "${cleaned}"`);
            updated++;
          }
        } else {
          skipped++;
        }
      } catch (err) {
        console.error(`  ✗ Error processing ${art.title}:`, (err as Error).message);
        errors++;
      }
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Errors: ${errors}`);
}

main().catch(console.error);

