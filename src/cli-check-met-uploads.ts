#!/usr/bin/env node
/**
 * Check recent Met Museum uploads from the database
 */

import { supabase } from './supabaseClient';

async function main() {
  console.log('Checking Met Museum uploads...\n');
  
  // Get recent Met Museum sources (last 24 hours)
  const oneDayAgo = new Date();
  oneDayAgo.setHours(oneDayAgo.getHours() - 24);
  
  const recentSources = await supabase
    .from('art_sources')
    .select(`
      id,
      art_id,
      source_title,
      source_url,
      wikidata_qid,
      arts!inner (
        id,
        title,
        created_at,
        artist_id,
        artists!inner (
          name
        )
      )
    `)
    .eq('source', 'metmuseum')
    .gte('arts.created_at', oneDayAgo.toISOString())
    .order('arts(created_at)', { ascending: false });
  
  if (recentSources.error) {
    console.error('Error:', recentSources.error.message);
    process.exit(1);
  }
  
  const sources = recentSources.data ?? [];
  
  console.log(`Recent Met Museum uploads (last 24 hours): ${sources.length}\n`);
  
  if (sources.length > 0) {
    console.log('Recent uploads:');
    sources.forEach((source: any, i: number) => {
      const art = source.arts;
      const artist = art?.artists;
      const date = art?.created_at ? new Date(art.created_at).toLocaleString() : 'Unknown';
      console.log(`  ${i + 1}. ${art?.title || source.source_title}`);
      console.log(`     Artist: ${artist?.name || 'Unknown'}`);
      console.log(`     QID: ${source.wikidata_qid || 'N/A'}`);
      console.log(`     Uploaded: ${date}`);
      console.log();
    });
  }
  
  // Get total count
  const totalCount = await supabase
    .from('art_sources')
    .select('id', { count: 'exact', head: true })
    .eq('source', 'metmuseum');
  
  console.log(`Total Met Museum artworks in database: ${totalCount.count ?? 0}`);
  
  // Get count by artist
  const artistCounts = await supabase
    .from('art_sources')
    .select(`
      arts!inner (
        artist_id,
        artists!inner (
          name
        )
      )
    `)
    .eq('source', 'metmuseum');
  
  if (artistCounts.data) {
    const artistMap = new Map<string, number>();
    artistCounts.data.forEach((source: any) => {
      const artistName = source.arts?.artists?.name;
      if (artistName) {
        artistMap.set(artistName, (artistMap.get(artistName) || 0) + 1);
      }
    });
    
    console.log(`\nArtists with Met Museum artworks: ${artistMap.size}`);
    console.log('\nTop 10 artists by artwork count:');
    Array.from(artistMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([name, count], i) => {
        console.log(`  ${i + 1}. ${name.padEnd(40)} (${count} artworks)`);
      });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
