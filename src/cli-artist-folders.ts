#!/usr/bin/env node
/**
 * List all artists in database and count artworks for each.
 *
 * Usage examples:
 *   npm run artist-folders -- --csv artist-artworks.csv    # Export to CSV
 *   npm run artist-folders --                               # Display in console
 */

import { writeFile } from 'fs/promises';
import { supabase, config } from './config';
import { parseArgs } from './utils';

function toCsv(rows: Array<{folder: string, count: number}>): string {
  const headers = ['folder', 'file_count'];
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push([r.folder, r.count].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  }
  return lines.join('\n');
}

async function main() {
  const args = parseArgs();
  const outCsv = args.csv as string | undefined;

  console.log('Querying database for all artists...');

  // First get all artists
  const { data: artists, error: artistsError } = await supabase
    .from('artists')
    .select('id, name');

  if (artistsError) {
    throw new Error(`Failed to query artists: ${artistsError.message}`);
  }

  if (!artists || artists.length === 0) {
    console.log('No artists found in database.');
    return;
  }

  console.log(`Found ${artists.length} artists in database`);

  // Count artworks for each artist
  console.log('Counting artworks for each artist...');
  const artistArtworks: Array<{name: string, artwork_count: number}> = [];

  for (let i = 0; i < artists.length; i++) {
    const artist = artists[i];

    if (i > 0 && i % 100 === 0) {
      console.log(`Processed ${i}/${artists.length} artists...`);
    }

    const { count, error } = await supabase
      .from('arts')
      .select('*', { count: 'exact', head: true })
      .eq('artist_id', artist.id);

    if (error) {
      console.warn(`Error counting artworks for ${artist.name}: ${error.message}`);
      continue;
    }

    artistArtworks.push({
      name: artist.name,
      artwork_count: count || 0
    });
  }

  console.log(`Successfully counted artworks for all ${artistArtworks.length} artists`);

  // Sort by artwork count descending
  artistArtworks.sort((a, b) => b.artwork_count - a.artwork_count);

  console.log(`Processed ${artistArtworks.length} artists with artwork counts`);

  // Export to CSV if requested
  if (outCsv) {
    console.log('Exporting to CSV...');
    const csvData = artistArtworks.map(item => ({ folder: item.name, count: item.artwork_count }));
    const csv = toCsv(csvData);
    await writeFile(outCsv, csv, 'utf8');
    console.log(`CSV exported to ${outCsv} with ${artistArtworks.length} artists`);
    return;
  }

  // Display in console
  console.log('\nARTISTS BY ARTWORK COUNT');
  console.log('═'.repeat(50));
  console.log('Rank │ Artist Name                     │ Artworks');
  console.log('─────┼──────────────────────────────────┼──────────');

  artistArtworks.slice(0, 50).forEach((artist, index) => {
    const rank = (index + 1).toString().padStart(4, ' ');
    const name = artist.name.padEnd(32, ' ');
    const count = artist.artwork_count.toString().padStart(8, ' ');
    console.log(`${rank} │ ${name} │ ${count}`);
  });

  if (artistArtworks.length > 50) {
    console.log(`\n... and ${artistArtworks.length - 50} more artists`);
  }

  console.log(`\n📊 Database Statistics:`);
  console.log(`• Total artists: ${artistArtworks.length}`);
  console.log(`• Total artworks: ${artistArtworks.reduce((sum, a) => sum + a.artwork_count, 0)}`);
  console.log(`• Most prolific artist: ${artistArtworks[0]?.name} (${artistArtworks[0]?.artwork_count} artworks)`);
  console.log(`• Least prolific artist: ${artistArtworks[artistArtworks.length - 1]?.name} (${artistArtworks[artistArtworks.length - 1]?.artwork_count} artworks)`);

  // Show Vincent Van Gogh specifically
  const vangogh = artistArtworks.find(a => a.name.toLowerCase().includes('van gogh'));
  if (vangogh) {
    console.log(`• Vincent Van Gogh: ${vangogh.artwork_count} artworks`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
