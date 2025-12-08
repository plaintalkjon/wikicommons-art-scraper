#!/usr/bin/env node
import { supabase } from './supabaseClient';

async function main() {
  // Get the most recently uploaded artwork for Vincent van Gogh
  const artistRes = await supabase.from('artists').select('id').eq('name', 'Vincent van Gogh').single();
  if (artistRes.error || !artistRes.data) {
    console.error('Artist not found');
    process.exit(1);
  }

  const artRes = await supabase
    .from('arts')
    .select('id, title, created_at')
    .eq('artist_id', artistRes.data.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (artRes.error || !artRes.data) {
    console.error('No artwork found');
    process.exit(1);
  }

  const art = artRes.data;
  console.log(`\nArtwork: ${art.title}`);
  console.log(`Uploaded: ${art.created_at}\n`);

  // Get tags
  const tagsRes = await supabase
    .from('art_tags')
    .select('tag_id, tags(name)')
    .eq('art_id', art.id);

  if (tagsRes.error) {
    console.error('Error fetching tags:', tagsRes.error.message);
    process.exit(1);
  }

  const tags = (tagsRes.data ?? [])
    .map((row: any) => row.tags?.name)
    .filter(Boolean)
    .sort();

  console.log('Tags:');
  if (tags.length === 0) {
    console.log('  (no tags)');
  } else {
    tags.forEach((tag: string) => console.log(`  - ${tag}`));
  }
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

