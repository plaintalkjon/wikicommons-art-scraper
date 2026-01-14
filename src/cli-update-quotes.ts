#!/usr/bin/env node
/**
 * Update quotes in the database from edited JSON.
 * 
 * Usage:
 *   npm run update-quotes -- --file edits.json
 *   npm run update-quotes -- --file edits.json --dry-run
 *
 * The JSON file should be an array of objects with:
 *   - id: quote UUID
 *   - originalText: original quote text (for verification)
 *   - editedText: new quote text
 *
 * Options:
 *   --file <path>    Path to JSON file with edits (or read from stdin)
 *   --dry-run        Show what would be updated without making changes
 */

import { readFile } from 'fs/promises';
import { supabase } from './config';
import { parseArgs } from './utils';

type QuoteEdit = {
  id: string;
  originalText: string;
  editedText: string;
};

async function main() {
  const args = parseArgs();
  const filePath = args.file as string | undefined;
  const dryRun = Boolean(args['dry-run']);

  let edits: QuoteEdit[];

  // Read edits from file or stdin
  if (filePath) {
    const content = await readFile(filePath, 'utf8');
    edits = JSON.parse(content);
  } else {
    // Read from stdin
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const content = Buffer.concat(chunks).toString('utf8');
    edits = JSON.parse(content);
  }

  if (!Array.isArray(edits) || edits.length === 0) {
    console.error('No edits found. Expected an array of edit objects.');
    process.exit(1);
  }

  console.log(`Found ${edits.length} quote edit(s) to process`);
  if (dryRun) {
    console.log('DRY RUN MODE - No changes will be made\n');
  }

  let successCount = 0;
  let errorCount = 0;
  const errors: Array<{ id: string; error: string }> = [];

  for (const edit of edits) {
    if (!edit.id || !edit.editedText) {
      console.error(`Skipping invalid edit: missing id or editedText`);
      errorCount++;
      continue;
    }

    try {
      // First, verify the quote exists and matches original text
      const { data: quote, error: fetchError } = await supabase
        .from('quotes')
        .select('id, text, author_id')
        .eq('id', edit.id)
        .single();

      if (fetchError || !quote) {
        const errorMsg = `Quote ${edit.id} not found`;
        console.error(`  ❌ ${errorMsg}`);
        errors.push({ id: edit.id, error: errorMsg });
        errorCount++;
        continue;
      }

      // Verify original text matches (optional check)
      if (edit.originalText && quote.text !== edit.originalText) {
        console.warn(`  ⚠️  Quote ${edit.id} text has changed since edit was made`);
        console.warn(`     Original (in edit): "${edit.originalText.substring(0, 50)}..."`);
        console.warn(`     Current (in DB):    "${quote.text.substring(0, 50)}..."`);
        // Continue anyway - user might want to update regardless
      }

      if (dryRun) {
        console.log(`  ✓ Would update quote ${edit.id}`);
        console.log(`    From: "${quote.text.substring(0, 80)}${quote.text.length > 80 ? '...' : ''}"`);
        console.log(`    To:   "${edit.editedText.substring(0, 80)}${edit.editedText.length > 80 ? '...' : ''}"`);
        successCount++;
        continue;
      }

      // Calculate new character count
      const characterCount = edit.editedText.length;

      // Update the quote
      const { error: updateError } = await supabase
        .from('quotes')
        .update({
          text: edit.editedText,
          character_count: characterCount,
        })
        .eq('id', edit.id);

      if (updateError) {
        const errorMsg = `Failed to update quote ${edit.id}: ${updateError.message}`;
        console.error(`  ❌ ${errorMsg}`);
        errors.push({ id: edit.id, error: errorMsg });
        errorCount++;
      } else {
        console.log(`  ✓ Updated quote ${edit.id}`);
        successCount++;
      }
    } catch (err: any) {
      const errorMsg = `Error processing quote ${edit.id}: ${err?.message ?? err}`;
      console.error(`  ❌ ${errorMsg}`);
      errors.push({ id: edit.id, error: errorMsg });
      errorCount++;
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('Summary:');
  console.log(`  Success: ${successCount}`);
  console.log(`  Errors:  ${errorCount}`);
  if (dryRun) {
    console.log('\nThis was a dry run. Re-run without --dry-run to apply changes.');
  }

  if (errors.length > 0) {
    console.log('\nErrors:');
    errors.forEach(({ id, error }) => {
      console.log(`  ${id}: ${error}`);
    });
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

