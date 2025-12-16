// Test script to see how many paintings would qualify with different MIN_ORIGINAL_WIDTH thresholds
const { fetchWikidataPaintings, findArtistQID } = require('./dist/wikidata');
const { fetchImageInfoByTitle, pickBestVariant } = require('./dist/wikimedia');

function testVariantWithThreshold(image, minOriginalWidth) {
  // Require an original that is at least minOriginalWidth
  if (!image.original || image.original.width < minOriginalWidth) {
    return null;
  }

  const MIN_VARIANT_WIDTH = 1280;
  const MAX_VARIANT_WIDTH = 4000;
  const target = 1280;

  const candidates = [];
  if (image.thumb) candidates.push(image.thumb);
  if (image.original) candidates.push(image.original);
  
  const filtered = candidates.filter(
    (c) => c.width >= MIN_VARIANT_WIDTH && c.width <= MAX_VARIANT_WIDTH && !isBadMime(c.mime),
  );
  if (!filtered.length) return null;

  let best = filtered[0];
  let bestScore = Math.abs(best.width - target);
  for (const candidate of filtered.slice(1)) {
    const score = Math.abs(candidate.width - target);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function isBadMime(mime) {
  const lower = (mime || '').toLowerCase();
  return lower.includes('svg') || lower.includes('gif');
}

async function main() {
  const artistName = 'William-Adolphe Bouguereau';
  
  console.log(`Testing width thresholds for ${artistName}`);
  console.log('='.repeat(60));
  
  const artistQid = await findArtistQID(artistName);
  if (!artistQid) {
    throw new Error(`Could not find Wikidata QID for artist: ${artistName}`);
  }
  
  const items = await fetchWikidataPaintings({ limit: 10000, artistQid: `wd:${artistQid}` });
  console.log(`Found ${items.length} paintings from Wikidata\n`);
  
  let qualified3000 = 0;
  let qualified1800 = 0;
  let skipped = 0;
  let errors = 0;
  const widthStats = [];
  
  // Process in small batches to avoid rate limits
  const BATCH_SIZE = 2;
  const DELAY_MS = 2000;
  
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    
    for (const item of batch) {
      if (!item.title) continue;
      
      try {
        const image = await fetchImageInfoByTitle(item.title);
        if (!image) {
          skipped++;
          continue;
        }
        
        const originalWidth = image.original?.width || 0;
        widthStats.push(originalWidth);
        
        const variant3000 = testVariantWithThreshold(image, 3000);
        const variant1800 = testVariantWithThreshold(image, 1800);
        
        if (variant3000) qualified3000++;
        if (variant1800) qualified1800++;
        if (!variant3000 && !variant1800) skipped++;
        
      } catch (err) {
        errors++;
        console.warn(`Error processing ${item.title}: ${err.message}`);
      }
    }
    
    if (i + BATCH_SIZE < items.length) {
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
      if ((i / BATCH_SIZE) % 5 === 0 && i > 0) {
        console.log(`  Processed ${i + batch.length}/${items.length}... (3000px: ${qualified3000}, 1800px: ${qualified1800})`);
      }
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('RESULTS SUMMARY:');
  console.log('='.repeat(60));
  console.log(`\nWith MIN_ORIGINAL_WIDTH = 3000px:`);
  console.log(`  Qualified: ${qualified3000}`);
  console.log(`\nWith MIN_ORIGINAL_WIDTH = 1800px:`);
  console.log(`  Qualified: ${qualified1800}`);
  
  const difference = qualified1800 - qualified3000;
  const percentageIncrease = qualified3000 > 0 ? ((difference / qualified3000) * 100).toFixed(1) : '0';
  console.log(`\nDifference: ${difference} additional paintings would qualify with 1800px threshold`);
  console.log(`Percentage increase: ${percentageIncrease}%`);
  
  // Show width distribution
  widthStats.sort((a, b) => a - b);
  const inRange1800_3000 = widthStats.filter(w => w >= 1800 && w < 3000).length;
  console.log(`\nPaintings with original width between 1800-3000px: ${inRange1800_3000}`);
  console.log(`Paintings with original width >= 3000px: ${widthStats.filter(w => w >= 3000).length}`);
  console.log(`Paintings with original width < 1800px: ${widthStats.filter(w => w < 1800).length}`);
}

main().catch(console.error);


