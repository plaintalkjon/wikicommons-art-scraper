#!/usr/bin/env node
/**
 * Delete quotes from the database by ID.
 * 
 * Usage:
 *   npm run delete-quotes -- --ids "id1,id2,id3"
 *   npm run delete-quotes -- --file ids.txt
 *   npm run delete-quotes -- --file ids.txt --dry-run
 *
 * Options:
 *   --ids <comma-separated>  Comma-separated list of quote IDs
 *   --file <path>            Path to file with quote IDs (one per line)
 *   --dry-run                Show what would be deleted without making changes
 */

import { readFile } from 'fs/promises';
import { supabase } from './config';
import { parseArgs } from './utils';

async function main() {
  const args = parseArgs();
  const idsArg = args.ids as string | undefined;
  const filePath = args.file as string | undefined;
  const dryRun = Boolean(args['dry-run']);

  let quoteIds: string[];

  if (idsArg) {
    quoteIds = idsArg.split(',').map(id => id.trim()).filter(Boolean);
  } else if (filePath) {
    const content = await readFile(filePath, 'utf8');
    quoteIds = content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#'));
  } else {
    console.error('Error: Must provide either --ids or --file argument');
    process.exit(1);
  }

  if (quoteIds.length === 0) {
    console.error('No quote IDs provided');
    process.exit(1);
  }

  console.log(`Found ${quoteIds.length} quote ID(s) to delete`);
  if (dryRun) {
    console.log('DRY RUN MODE - No changes will be made\n');
  }

  // First, verify quotes exist and show what will be deleted
  const { data: quotes, error: fetchError } = await supabase
    .from('quotes')
    .select('id, text, author_id')
    .in('id', quoteIds);

  if (fetchError) {
    console.error(`Error fetching quotes: ${fetchError.message}`);
    process.exit(1);
  }

  const foundIds = new Set((quotes || []).map(q => q.id));
  const missingIds = quoteIds.filter(id => !foundIds.has(id));

  if (missingIds.length > 0) {
    console.warn(`\n⚠️  Warning: ${missingIds.length} quote ID(s) not found:`);
    missingIds.forEach(id => console.warn(`  - ${id}`));
  }

  if (quotes && quotes.length > 0) {
    console.log(`\n${dryRun ? 'Would delete' : 'Deleting'} ${quotes.length} quote(s):\n`);
    
    if (!dryRun) {
      // Delete quotes in batches
      const batchSize = 100;
      let deletedCount = 0;
      
      for (let i = 0; i < quotes.length; i += batchSize) {
        const batch = quotes.slice(i, i + batchSize);
        const batchIds = batch.map(q => q.id);
        
        const { error: deleteError } = await supabase
          .from('quotes')
          .delete()
          .in('id', batchIds);
        
        if (deleteError) {
          console.error(`Error deleting batch: ${deleteError.message}`);
          console.error(`Failed IDs: ${batchIds.join(', ')}`);
        } else {
          deletedCount += batch.length;
          console.log(`✓ Deleted batch ${Math.floor(i / batchSize) + 1}: ${batch.length} quote(s)`);
        }
      }
      
      console.log(`\n${'='.repeat(70)}`);
      console.log(`Successfully deleted ${deletedCount} quote(s)`);
      if (missingIds.length > 0) {
        console.log(`Skipped ${missingIds.length} ID(s) that were not found`);
      }
    } else {
      // Dry run - just show what would be deleted
      quotes.forEach((quote, index) => {
        const preview = quote.text.length > 60 
          ? quote.text.substring(0, 60) + '...' 
          : quote.text;
        console.log(`  ${index + 1}. ${quote.id}`);
        console.log(`     "${preview}"`);
      });
      console.log(`\n${'='.repeat(70)}`);
      console.log(`This was a dry run. Re-run without --dry-run to delete these quotes.`);
    }
  } else {
    console.log('No quotes found to delete.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

