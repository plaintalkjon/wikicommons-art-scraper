/**
 * CLI script to remove numbers from artwork titles
 * Removes:
 * - Standalone numeric titles (e.g., "001", "0021", "028")
 * - Trailing numbers (e.g., "Title 86", "Title 222")
 * - IDs and accession numbers
 */

import { supabase } from './supabaseClient';

function removeNumbersFromTitle(title: string): string {
  let cleaned = title.trim();
  
  // Remove standalone numeric titles (just numbers)
  if (/^\d+$/.test(cleaned)) {
    return ''; // Mark for deletion/skip
  }
  
  // Don't remove dates from magazine covers (e.g., "Weird Tales September 1926", "Argosy 191705")
  // These are meaningful and should be kept - skip processing for magazine covers
  const isMagazineCover = /^(Weird Tales|Amazing Stories|Amazing stories|Adventure|Argosy|The Argosy)/i.test(cleaned);
  if (isMagazineCover) {
    // Only remove IDs from magazine covers, not dates
    cleaned = cleaned.replace(/\s*-\s*[sS]\d+[Vv]\d+\w*\s*/gi, ' '); // "Title - s0074V1962" -> "Title"
    return cleaned;
  }
  
  // For paintings: Remove trailing numbers and IDs (e.g., "Title 86", "Title 222", "Title - 926")
  // Remove trailing 1-6 digit numbers (likely IDs, not years - years are usually 4 digits but we'll be careful)
  cleaned = cleaned.replace(/\s+\d{1,6}\s*$/, ''); // "Title 86" -> "Title", "Title 028" -> "Title"
  cleaned = cleaned.replace(/\s*-\s*\d{1,6}\s*$/, ''); // "Title - 926" -> "Title"
  
  // Remove IDs like "s0074V1962", "GG 690", "NG.M.01862", etc.
  cleaned = cleaned.replace(/\s*-\s*[sS]\d+[Vv]\d+\w*\s*/gi, ' '); // "Title - s0074V1962" -> "Title"
  cleaned = cleaned.replace(/\s*-\s*[A-Z]{1,4}\s*\d+\s*/gi, ' '); // "Title - GG 690" -> "Title"
  cleaned = cleaned.replace(/\s*-\s*[A-Z]{1,4}\.[A-Z]?\.\d+\s*/gi, ' '); // "Title - NG.M.01862" -> "Title"
  cleaned = cleaned.replace(/\s*-\s*\d+\.\d+\s*/g, ' '); // "Title - 69.2" -> "Title"
  
  // Remove trailing single digits that are clearly not part of the title (e.g., "Olivenhain2", "Grünes Weizenfeld1")
  cleaned = cleaned.replace(/([a-zA-Z])\d+\s*$/, '$1'); // "Title2" -> "Title", "Title1" -> "Title"
  
  // Remove leading numbers (e.g., "028 Title" -> "Title", "001" -> "")
  cleaned = cleaned.replace(/^\d{1,6}\s+/, '');
  
  // Remove artist name followed by number (e.g., "Vincent Willem van Gogh 083" -> "Vincent Willem van Gogh")
  cleaned = cleaned.replace(/\s+\d{2,6}\s*$/, ''); // "Name 083" -> "Name", "Name 028" -> "Name"
  
  // Clean up multiple spaces
  cleaned = cleaned.replace(/\s+/g, ' ');
  cleaned = cleaned.trim();
  
  return cleaned;
}

async function main() {
  console.log('=== Removing Numbers from Artwork Titles ===\n');

  // Fetch all artworks with pagination
  const allArts: Array<{ id: string; title: string; artist_id: string }> = [];
  let from = 0;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data: arts, error: fetchError } = await supabase
      .from('arts')
      .select('id, title, artist_id')
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

  if (allArts.length === 0) {
    console.log('No artworks found.');
    return;
  }

  console.log(`\nFound ${allArts.length} total artworks.\n`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;
  let deleted = 0;

  // Process in batches
  const BATCH_SIZE = 50;

  for (let i = 0; i < allArts.length; i += BATCH_SIZE) {
    const batch = allArts.slice(i, i + BATCH_SIZE);
    console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(allArts.length / BATCH_SIZE)}...`);

    for (const art of batch) {
      try {
        // Check if title contains numbers
        if (!/\d/.test(art.title)) {
          skipped++;
          continue;
        }
        
        const cleaned = removeNumbersFromTitle(art.title);
        
        // If cleaned is empty (was just numbers), we could delete or skip
        // For now, let's skip these and log them
        if (cleaned === '' || cleaned.length === 0) {
          console.log(`  ⚠️  Skipping numeric-only title: "${art.title}" (would be empty after cleaning)`);
          deleted++;
          skipped++;
          continue;
        }
        
        // Only update if cleaned title is different
        if (cleaned !== art.title && cleaned.length > 0) {
          // Check if this would create a duplicate
          const { data: existing, error: checkError } = await supabase
            .from('arts')
            .select('id')
            .eq('title', cleaned)
            .eq('artist_id', art.artist_id)
            .neq('id', art.id)
            .maybeSingle();
          
          if (checkError && checkError.code !== 'PGRST116') {
            console.error(`  ✗ Error checking duplicate:`, checkError.message);
            errors++;
            continue;
          }
          
          if (existing) {
            // Would create duplicate - append a suffix to make it unique
            // Use the original number or a simple counter
            const originalNumber = art.title.match(/\d+/)?.[0] || '2';
            const uniqueTitle = `${cleaned} (${originalNumber})`;
            
            // Check if this unique title also exists
            const { data: existingUnique, error: uniqueCheckError } = await supabase
              .from('arts')
              .select('id')
              .eq('title', uniqueTitle)
              .eq('artist_id', art.artist_id)
              .neq('id', art.id)
              .maybeSingle();
            
            if (!existingUnique) {
              // Use the unique title
              const { error: updateError } = await supabase
                .from('arts')
                .update({ title: uniqueTitle })
                .eq('id', art.id);

              if (updateError) {
                console.error(`  ✗ Error updating:`, updateError.message);
                errors++;
              } else {
                if (updated < 10 || updated % 100 === 0) {
                  console.log(`  ✓ "${art.title.substring(0, 50)}${art.title.length > 50 ? '...' : ''}"`);
                  console.log(`    → "${uniqueTitle}" (appended number to avoid duplicate)`);
                }
                updated++;
              }
            } else {
              // Even the unique title exists - skip
              if (updated < 10 || updated % 100 === 0) {
                console.log(`  ⚠️  Skipping "${art.title.substring(0, 50)}..." (would duplicate)`);
              }
              skipped++;
            }
            continue;
          }
          
          const { error: updateError } = await supabase
            .from('arts')
            .update({ title: cleaned })
            .eq('id', art.id);

          if (updateError) {
            console.error(`  ✗ Error updating "${art.title.substring(0, 50)}...":`, updateError.message);
            errors++;
          } else {
            if (updated < 10 || updated % 100 === 0) {
              console.log(`  ✓ "${art.title.substring(0, 50)}${art.title.length > 50 ? '...' : ''}"`);
              console.log(`    → "${cleaned}"`);
            }
            updated++;
          }
        } else {
          skipped++;
        }
      } catch (err) {
        console.error(`  ✗ Error processing "${art.title.substring(0, 50)}...":`, (err as Error).message);
        errors++;
      }
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Numeric-only (skipped): ${deleted}`);
  console.log(`Errors: ${errors}`);
}

main().catch(console.error);
