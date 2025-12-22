/**
 * CLI script to clean up artwork titles by removing:
 * - Artist names
 * - Museum names and locations
 * - IDs and accession numbers
 * - Years
 * - File extensions and "File:" prefixes
 * - Unnecessary punctuation
 */

import { supabase } from './supabaseClient';

// Common museum names and abbreviations to remove
const MUSEUM_PATTERNS = [
  'Cincinnati Art Museum',
  'Norton Simon Museum',
  'Pushkin Museum',
  'The Hermitage',
  'Hermitage Museum',
  'LACMA',
  'Mauritshuis',
  'Musée d\'Orsay',
  'Musee d\'Orsay',
  'National Gallery',
  'Metropolitan Museum',
  'Metropolitan Museum of Art',
  'Museum of Fine Arts',
  'Art Institute of Chicago',
  'National Museum',
  'Kunsthistorisches Museum',
  'Belvedere',
  'Österreichische Galerie Belvedere',
  'Wallace Collection',
  'National Galleries of Scotland',
  'Kröller-Müller Museum',
  'Führermuseum',
  'Prado',
  'Galerie Borghèse',
  'Museum of Fine Arts, Boston',
  'Washington National Gallery',
  'Fondation Louis Vuitton',
  'Google Art Project',
  'Art Project',
  'Van Gogh Museum',
  'Yale University Art Gallery',
];

// Common patterns for IDs and accession numbers
const ID_PATTERNS = [
  /\s*-\s*\d{1,6}\s*-\s*/g, // " - 926 - " or " - 2123 - "
  /\s*-\s*[A-Z]{1,4}\d{1,6}\s*-\s*/gi, // " - KMS959 - " or " - P01689 - "
  /\s*-\s*[A-Z]{1,4}\.\d+\s*-\s*/gi, // " - 2006.529 - "
  /\s*-\s*NARA\s*-\s*\d+\s*/gi, // " - NARA - 513538"
  /\s*-\s*PG\s*\d+\s*/gi, // " - PG 3181"
  /\s*-\s*P\d+\s*/gi, // " - P30"
  /\s*\(\d+\)\s*$/g, // "(1)" or "(2)" at end
  /\s*\(\d{4}\s*-\s*\d{4}\)\s*/g, // "(1577 - 1640)"
  /\s*\(\d{4}\)\s*/g, // "(1898)"
  /^\d+\s*/, // Leading numbers like "001", "0021"
  /\s*-\s*\d{4}\.\d+\s*-\s*[^-]+$/i, // Museum accession numbers
];

function cleanTitle(title: string, artistName?: string): string {
  let cleaned = title.trim();
  
  // Remove "File:" prefix
  cleaned = cleaned.replace(/^File:\s*/i, '');
  
  // Remove file extensions
  cleaned = cleaned.replace(/\.(jpg|jpeg|png|gif|tiff|tif|webp|svg)$/i, '');
  
  // Remove leading numbers and dashes (like "001", "0 Title")
  cleaned = cleaned.replace(/^\d+\s*[-.]?\s*/, '');
  
  // If title is just a number or very short after cleaning, it's probably not a real title
  // But we'll keep it for now and let the user decide
  
  // Remove parenthetical location info at start (like "(Albi)")
  cleaned = cleaned.replace(/^\([^)]+\)\s*[-.]?\s*/i, '');
  
  // Remove artist birth/death years in parentheses (various formats)
  cleaned = cleaned.replace(/\s*\(\d{4}\s*-\s*\d{4}\)\s*[-.]?\s*/g, '');
  cleaned = cleaned.replace(/\s*\(\d{1,2}\.\d{1,2}\.\d{4}\s*-\s*\d{1,2}\.\d{1,2}\.\d{4}\)\s*[-.]?\s*/g, ''); // "22.5.1733 - 15.4.1808"
  cleaned = cleaned.replace(/\s*\([^)]*\d{4}[^)]*\)\s*[-.]?\s*/g, ''); // Any parenthetical with years like "(American –1905)", "(French –1877)"
  cleaned = cleaned.replace(/\s*\([A-Za-z\s–-]+\d{0,4}\)\s*[-.]?\s*/g, ''); // "(American –1916)", "(French", "(Italian"
  cleaned = cleaned.replace(/\s*\([IVX]+\)\s*/g, ' '); // "(I)", "(II)", "(III)"
  // Remove incomplete parentheticals at start (like "(French - " or "(Italian - ")
  cleaned = cleaned.replace(/^\([A-Za-z\s]+[-–]\s*/i, '');
  cleaned = cleaned.replace(/\s*\([^)]*\)\s*[-.]?\s*/g, ''); // Any remaining parenthetical info
  
  // Remove quotes around title (handle both single and double quotes)
  cleaned = cleaned.replace(/^['"]\s*([^'"]+)\s*['"]\s*/, '$1');
  
  // Remove "by Artist Name" patterns (with various separators)
  if (artistName) {
    // Escape special regex characters in artist name
    const escapedName = artistName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Patterns: "by Artist Name", "Artist Name -", "Artist Name,", etc.
    cleaned = cleaned.replace(new RegExp(`\\s*by\\s+${escapedName}[,\\s-]*`, 'gi'), '');
    cleaned = cleaned.replace(new RegExp(`^${escapedName}\\s*[-:,\\s]+`, 'i'), '');
    cleaned = cleaned.replace(new RegExp(`\\s*,\\s*${escapedName}\\s*$`, 'i'), '');
    cleaned = cleaned.replace(new RegExp(`\\s*-\\s*${escapedName}\\s*$`, 'i'), '');
    
    // Handle variations like "Jean - Léon Gérôme" (with spaces around hyphens)
    const nameVariations = [
      artistName.replace(/\s*-\s*/g, '\\s*-\\s*'), // "Jean - Léon" -> "Jean\\s*-\\s*Léon"
      artistName.replace(/\s+/g, '\\s+'), // Multiple spaces
    ];
    for (const variation of nameVariations) {
      cleaned = cleaned.replace(new RegExp(`\\s*by\\s+${variation}[,\\s-]*`, 'gi'), '');
      cleaned = cleaned.replace(new RegExp(`^${variation}\\s*[-:,\\s]+`, 'i'), '');
      cleaned = cleaned.replace(new RegExp(`\\s*-\\s*${variation}\\s*[-:]`, 'gi'), ' ');
    }
    
    // Remove artist name from middle: "Title - Artist Name - More"
    cleaned = cleaned.replace(new RegExp(`\\s*-\\s*${escapedName}\\s*-\\s*`, 'gi'), ' - ');
    
    // Handle cases where artist name appears without "by": "Evariste Luminais - Title"
    cleaned = cleaned.replace(new RegExp(`^${escapedName}\\s*-\\s*`, 'i'), '');
    
    // Handle last name only patterns (common in some titles)
    const lastName = artistName.split(/\s+/).pop();
    if (lastName && lastName.length > 3) {
      const escapedLastName = lastName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      cleaned = cleaned.replace(new RegExp(`^${escapedLastName}\\s*-\\s*`, 'i'), '');
    }
  }
  
  // Remove "workshop of", "follower", "studio of", etc.
  cleaned = cleaned.replace(/\s*,\s*(workshop of|follower|studio of|attrib\.?|attributed to)\s+[^,]+/gi, '');
  cleaned = cleaned.replace(/\s*\(attrib\.?\)\s*/gi, ' ');
  cleaned = cleaned.replace(/\s*,\s*after\s+[^,]+/gi, ''); // "Title, after Artist"
  cleaned = cleaned.replace(/\s*\(after\s+[^)]+\)\s*/gi, ' '); // "Title (after Artist)"
  
  // Remove museum names and locations
  for (const museum of MUSEUM_PATTERNS) {
    const escaped = museum.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Remove with various separators: ", Museum", " - Museum", "Museum" at end
    cleaned = cleaned.replace(new RegExp(`\\s*[,;]\\s*${escaped}\\s*$`, 'gi'), '');
    cleaned = cleaned.replace(new RegExp(`\\s*-\\s*${escaped}\\s*$`, 'gi'), '');
    cleaned = cleaned.replace(new RegExp(`\\s*${escaped}\\s*$`, 'gi'), '');
  }
  
  // Remove additional museum/gallery patterns
  cleaned = cleaned.replace(/\s*(Royal Collection|Gemäldegalerie|Barnes Foundation|Minneapolis Institute of Arts|Detroit Institute of Arts|Saint Louis Art Museum|Royal Museum of Fine Arts Antwerp|Nationalmuseum|Van Gogh Museum|Yale University Art Gallery)[^,]*/gi, '');
  
  // Remove IDs and accession numbers
  for (const pattern of ID_PATTERNS) {
    cleaned = cleaned.replace(pattern, ' ');
  }
  
  // Remove more ID patterns (RCIN, KFMV, etc.)
  cleaned = cleaned.replace(/\s*RCIN\s*\d+\s*/gi, ' ');
  cleaned = cleaned.replace(/\s*KFMV\.\d+\s*/gi, ' ');
  cleaned = cleaned.replace(/\s*\.\d+\.\d+\s*/g, ' '); // ".141.6", ".289.1"
  cleaned = cleaned.replace(/\s*-\s*\d+\.\d+\.\d+\s*-\s*/g, ' '); // " - 68.41.11 - "
  cleaned = cleaned.replace(/\s*-\s*\d+\s*$/g, ''); // " - 736" at end
  cleaned = cleaned.replace(/\s*MET\s*[A-Z]{0,2}\d+\s*/gi, ' '); // "MET DP145903", "MET DP14"
  cleaned = cleaned.replace(/\s*\d+\s*-\s*(Royal|Museum|Gallery|Arts)/gi, ' '); // "317 - Royal Museum"
  cleaned = cleaned.replace(/\s*[sS]\d+[Vv]\d+\w*\s*/gi, ' '); // "s0074V1962", "s0097V1962r"
  cleaned = cleaned.replace(/\s*-\s*[sS]\d+[Vv]\d+\w*\s*/gi, ' '); // " - s0074V1962"
  
  // Remove years (4 digits, often at end with comma or dash)
  cleaned = cleaned.replace(/\s*,\s*\d{4}\s*[,\-]?/g, ' ');
  cleaned = cleaned.replace(/\s*-\s*\d{4}\s*[,\-]?/g, ' ');
  cleaned = cleaned.replace(/\s*\d{4}\s*$/g, ''); // Year at very end like "1865"
  cleaned = cleaned.replace(/\s*–\s*\d{4}\s*/g, ' '); // "–1905", "–1877" (en dash)
  cleaned = cleaned.replace(/\s+\d{4}\s+/g, ' '); // Year in middle like "Loch Lomond 1913"
  cleaned = cleaned.replace(/\s*,\s*between\s+\d{4}\s+and\s+\d{4}\s*/gi, ''); // "between 1628 and 1629"
  
  // Remove material/medium info (like "oil on panel", "oil on canvas")
  cleaned = cleaned.replace(/\s*,\s*(oil on (panel|canvas|wood)|watercolor|tempera|fresco)[^,]*/gi, '');
  
  // Remove common suffixes
  cleaned = cleaned.replace(/\s*-\s*(Google Art Project|Art Project)\s*/gi, '');
  
  // Clean up multiple spaces, dashes, commas
  cleaned = cleaned.replace(/\s+/g, ' ');
  cleaned = cleaned.replace(/\s*-\s*-\s*/g, ' - ');
  cleaned = cleaned.replace(/\s*,\s*,\s*/g, ', ');
  cleaned = cleaned.replace(/^\s*[-,\s]+|\s*[-,\s]+$/g, '');
  
  // Remove trailing punctuation (except if it's part of the title)
  cleaned = cleaned.replace(/^['"]+|['"]+$/g, '');
  
  // Remove leading/trailing dashes and spaces
  cleaned = cleaned.replace(/^[-–—\s]+|[-–—\s]+$/g, '');
  
  // Trim and capitalize first letter
  cleaned = cleaned.trim();
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  
  return cleaned;
}

async function main() {
  console.log('=== Cleaning Artwork Titles ===\n');

  // Fetch all artists for name removal
  const { data: artists, error: artistsError } = await supabase
    .from('artists')
    .select('id, name');
  
  if (artistsError) {
    console.error('Error fetching artists:', artistsError);
    process.exit(1);
  }
  
  const artistMap = new Map(artists?.map(a => [a.id, a.name]) || []);
  console.log(`Loaded ${artistMap.size} artist names for cleaning\n`);

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

  // Process in batches
  const BATCH_SIZE = 50;

  for (let i = 0; i < allArts.length; i += BATCH_SIZE) {
    const batch = allArts.slice(i, i + BATCH_SIZE);
    console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(allArts.length / BATCH_SIZE)}...`);

    for (const art of batch) {
      try {
        const artistName = art.artist_id ? artistMap.get(art.artist_id) : undefined;
        const cleaned = cleanTitle(art.title, artistName);
        
        // Only update if cleaned title is different and meaningful
        if (cleaned !== art.title && cleaned.length > 0 && cleaned.length < art.title.length * 1.5) {
          // Update the title
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
  console.log(`Errors: ${errors}`);
}

main().catch(console.error);
