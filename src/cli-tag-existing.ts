import { supabase } from './supabaseClient';
import { upsertTags, linkArtTags } from './db';

/**
 * Script to tag all existing artworks as "painting"
 * Since all existing artworks were fetched with the painting filter,
 * they should all be tagged as paintings.
 */
async function main() {
  console.log('Tagging all existing artworks as "painting"...');

  // First, ensure the "painting" tag exists
  const paintingTag = await upsertTags(['painting']);
  if (!paintingTag.length) {
    throw new Error('Failed to create "painting" tag');
  }
  const paintingTagId = paintingTag[0].id;
  console.log(`✓ Created/found "painting" tag (ID: ${paintingTagId})`);

  // Get all artworks
  const { data: artworks, error: fetchError } = await supabase
    .from('arts')
    .select('id, title');

  if (fetchError) {
    throw new Error(`Failed to fetch artworks: ${fetchError.message}`);
  }

  if (!artworks || artworks.length === 0) {
    console.log('No artworks found in database.');
    return;
  }

  console.log(`Found ${artworks.length} artworks to tag...`);

  // Check which artworks already have the painting tag
  const { data: existingLinks, error: linksError } = await supabase
    .from('art_tags')
    .select('art_id')
    .eq('tag_id', paintingTagId);

  if (linksError) {
    throw new Error(`Failed to check existing tags: ${linksError.message}`);
  }

  const alreadyTagged = new Set(existingLinks?.map((link) => link.art_id) ?? []);
  const toTag = artworks.filter((art) => !alreadyTagged.has(art.id));

  if (toTag.length === 0) {
    console.log('All artworks already have the "painting" tag.');
    return;
  }

  console.log(`${toTag.length} artworks need the "painting" tag (${alreadyTagged.size} already tagged).`);

  // Tag artworks in batches
  const BATCH_SIZE = 100;
  let tagged = 0;

  for (let i = 0; i < toTag.length; i += BATCH_SIZE) {
    const batch = toTag.slice(i, i + BATCH_SIZE);
    const tagLinks = batch.map((art) => ({
      art_id: art.id,
      tag_id: paintingTagId,
    }));

    // Use upsert with the composite primary key constraint
    // The constraint name is art_tags_pkey, but we can reference it by columns
    const { error: linkError } = await supabase
      .from('art_tags')
      .upsert(tagLinks, { onConflict: 'art_id,tag_id', ignoreDuplicates: false });

    if (linkError) {
      // If upsert fails, try individual inserts with error handling
      console.log(`Upsert failed for batch ${i / BATCH_SIZE + 1}, trying individual inserts...`);
      for (const link of tagLinks) {
        const { error: insertError } = await supabase
          .from('art_tags')
          .insert(link)
          .select();
        if (insertError && insertError.code !== '23505') { // 23505 is duplicate key, which is fine
          console.error(`Failed to insert link for art ${link.art_id}:`, insertError.message);
        } else {
          tagged += 1;
        }
      }
    } else {
      tagged += batch.length;
    }
    console.log(`Tagged ${tagged}/${toTag.length} artworks...`);
  }

  console.log(`\n✓ Successfully tagged ${tagged} artworks as "painting"!`);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});

