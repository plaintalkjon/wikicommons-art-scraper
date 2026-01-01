#!/usr/bin/env node
/**
 * List the top art tags by usage count in Supabase.
 *
 * Usage examples:
 *   npm run list-tags -- --limit 100                  # Top 100 tags (default)
 *   npm run list-tags -- --limit 50 --csv tags.csv    # Top 50 tags as CSV
 *   npm run list-tags -- --json                       # JSON output
 */

import { writeFile } from 'fs/promises';
import { supabase } from './config';
import { parseArgs } from './utils';

type TagCount = {
  name: string;
  count: number;
};

function toCsv(rows: TagCount[]): string {
  const headers = ['name', 'count'];
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push([r.name, r.count].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  }
  return lines.join('\n');
}

async function addTagNamesToCsv(csvPath: string, csvData: Array<{tag_id: string, count: number, name: string}>) {
  const tagIds = csvData.map(row => row.tag_id);
  const tagNameMap = new Map<string, string>();
  const nameBatchSize = 50; // Very small batches

  for (let i = 0; i < tagIds.length; i += nameBatchSize) {
    const batchTagIds = tagIds.slice(i, i + nameBatchSize);

    try {
      const { data: tagData, error } = await supabase
        .from('tags')
        .select('id, name')
        .in('id', batchTagIds);

      if (!error && tagData) {
        for (const tag of tagData) {
          tagNameMap.set(tag.id, tag.name);
        }
      }
    } catch (err) {
      console.log(`Error fetching batch ${Math.floor(i/nameBatchSize) + 1}: ${err}`);
    }
  }

  // Update CSV data with names
  const updatedCsvData = csvData.map(row => ({
    ...row,
    name: tagNameMap.get(row.tag_id) || row.name
  }));

  // Write updated CSV
  const csv = 'tag_id,count,name\n' + updatedCsvData.map(row =>
    `"${row.tag_id.replace(/"/g, '""')}","${row.count}","${row.name.replace(/"/g, '""')}"`
  ).join('\n');

  await writeFile(csvPath, csv, 'utf8');
  console.log(`Updated CSV with ${tagNameMap.size} tag names`);
}

async function main() {
  const args = parseArgs();
  const limit = args.limit ? parseInt(args.limit as string, 10) : 100;
  const outJson = Boolean(args.json);
  const debug = Boolean(args.debug);

  // Get comprehensive tag counts by sampling all available data
  console.log('Getting comprehensive tag counts by sampling available data...');

  // Collect all unique tag_ids by sampling the art_tags table
  const allTagIds = new Set<string>();
  const artTagsBatchSize = 1000;
  let offset = 0;
  let totalRecordsSampled = 0;

  console.log('Sampling art_tags table to collect unique tag IDs...');
  while (allTagIds.size < 10000) { // Safety limit on unique tags
    const { data: batch, error } = await supabase
      .from('art_tags')
      .select('tag_id')
      .range(offset, offset + artTagsBatchSize - 1);

    if (error) {
      console.error(`Error at offset ${offset}:`, error.message);
      break;
    }

    if (!batch || batch.length === 0) {
      console.log('No more records');
      break;
    }

    for (const record of batch) {
      allTagIds.add(record.tag_id);
    }

    totalRecordsSampled += batch.length;
    offset += artTagsBatchSize;

    console.log(`Sampled ${totalRecordsSampled} records, found ${allTagIds.size} unique tags`);

    if (batch.length < artTagsBatchSize) break; // Last batch
  }

  const uniqueTagIds = Array.from(allTagIds);
  console.log(`Collected ${uniqueTagIds.length} unique tag IDs from sampling ${totalRecordsSampled} records`);

  // Count each tag accurately
  console.log('Counting each tag accurately...');
  const tagIdCountMap = new Map<string, number>();

  for (let i = 0; i < uniqueTagIds.length; i++) {
    const tagId = uniqueTagIds[i];

    if (i > 0 && i % 100 === 0) {
      console.log(`Counted ${i}/${uniqueTagIds.length} tags...`);
    }

    const { count, error } = await supabase
      .from('art_tags')
      .select('*', { count: 'exact', head: true })
      .eq('tag_id', tagId);

    if (error) {
      console.warn(`Error counting tag ${tagId}: ${error.message}`);
      continue;
    }

    tagIdCountMap.set(tagId, count || 0);
  }

  console.log(`Successfully counted all ${tagIdCountMap.size} tags with accurate totals`);

  // Export to CSV immediately if requested (don't wait for tag names)
  const outCsv = args.csv as string | undefined;
  if (outCsv) {
    console.log('Exporting all tag counts to CSV...');

    // Create CSV data with tag IDs and counts
    const csvData = Array.from(tagIdCountMap.entries())
      .sort((a: [string, number], b: [string, number]) => b[1] - a[1])
      .map(([tagId, count]: [string, number]) => ({ tag_id: tagId, count, name: 'pending' }));

    // Export with tag IDs first
    const csv = 'tag_id,count,name\n' + csvData.map(row =>
      `"${row.tag_id.replace(/"/g, '""')}","${row.count}","${row.name}"`
    ).join('\n');

    await writeFile(outCsv, csv, 'utf8');
    console.log(`CSV exported to ${outCsv} with ${csvData.length} tags`);

    // Try to add tag names if possible
    console.log('Attempting to add tag names to CSV...');
    await addTagNamesToCsv(outCsv, csvData);

    return; // Exit early if CSV export was requested
  }

  if (debug) {
    console.log('Top tag ID counts:');
    Array.from(tagIdCountMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .forEach(([tagId, count]) => {
        console.log(`  ${tagId}: ${count}`);
      });
  }

  // Try to get tag names (this part was failing before)
  console.log('Attempting to fetch tag names...');

  // Get tag names for the tag_ids (in batches to avoid URL length limits)
  const tagIds = Array.from(tagIdCountMap.keys());
  const tagNameMap = new Map<string, string>();
  const nameBatchSize = 100; // Very small batches for tag names

  let nameFetchSuccess = true;
  for (let i = 0; i < tagIds.length && nameFetchSuccess; i += nameBatchSize) {
    const batchTagIds = tagIds.slice(i, i + nameBatchSize);
    console.log(`Fetching tag names batch ${Math.floor(i/nameBatchSize) + 1}/${Math.ceil(tagIds.length/nameBatchSize)} (${batchTagIds.length} tags)`);

    try {
      const { data: tagData, error: tagError } = await supabase
        .from('tags')
        .select('id, name')
        .in('id', batchTagIds);

      if (tagError) {
        console.log(`Failed to fetch tag names: ${tagError.message}`);
        nameFetchSuccess = false;
        break;
      }

      if (tagData) {
        for (const tag of tagData) {
          tagNameMap.set(tag.id, tag.name);
        }
      }
    } catch (err) {
      console.log(`Error fetching tag names batch: ${err}`);
      nameFetchSuccess = false;
      break;
    }
  }

  // Create tag display mapping (names if available, otherwise IDs)
  let tagCountMap: Map<string, number>;

  if (nameFetchSuccess && tagNameMap.size > 0) {
    console.log(`Fetched names for ${tagNameMap.size} tags`);
    tagCountMap = new Map<string, number>();
    for (const [tagId, count] of tagIdCountMap) {
      const tagName = tagNameMap.get(tagId);
      if (tagName) {
        tagCountMap.set(tagName, count);
      } else {
        // Fallback to tag ID if name not found
        tagCountMap.set(tagId, count);
      }
    }
  } else {
    console.log('Could not fetch tag names, using tag IDs for display');
    tagCountMap = tagIdCountMap;
  }

  // Sort by count descending and take top N
  const tagCounts: TagCount[] = Array.from(tagCountMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);

  // If JSON output requested
  if (outJson) {
    console.log(JSON.stringify(tagCounts, null, 2));
    return;
  }

  // If CSV output requested
  if (outCsv) {
    const csv = toCsv(tagCounts);
    await writeFile(outCsv, csv, 'utf8');
    console.log(`CSV written to ${outCsv} (${tagCounts.length} tags)`);
    return;
  }

  // Default: console output
  console.log(`Top ${tagCounts.length} art tags by usage (from sample of ${tagIdCountMap.size} tags):`);
  console.log('─'.repeat(70));
  console.log('Note: Rankings are based on a limited sample due to Supabase query limits.');
  tagCounts.forEach((tag, index) => {
    console.log(`${(index + 1).toString().padStart(3, ' ')}. ${tag.name.padEnd(30, ' ')} (${tag.count} artworks)`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
