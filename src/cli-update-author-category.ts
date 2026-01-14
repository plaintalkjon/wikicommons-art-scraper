#!/usr/bin/env node
/**
 * Update quote author category
 * Usage: npm run build && node dist/cli-update-author-category.js "Isaac Asimov" "author"
 */

import { ensureQuoteAuthor } from './db';
import { supabase } from './config';

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error('Usage: node cli-update-author-category.js <author-name> <category>');
    console.error('Example: node cli-update-author-category.js "Isaac Asimov" "author"');
    process.exit(1);
  }

  const authorName = args[0];
  const category = args[1];

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Update Quote Author Category`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Author: ${authorName}`);
  console.log(`New Category: ${category}`);
  console.log(`${'='.repeat(60)}\n`);

  try {
    // Get current author info
    const { data: current, error: lookupError } = await supabase
      .from('quote_authors')
      .select('id, name, category')
      .eq('name', authorName)
      .maybeSingle();

    if (lookupError && lookupError.code !== 'PGRST116') {
      throw new Error(`Failed to lookup author: ${lookupError.message}`);
    }

    if (!current) {
      console.error(`❌ Author "${authorName}" not found in database`);
      process.exit(1);
    }

    console.log(`Current category: ${current.category}`);
    console.log(`Updating to: ${category}...`);

    // Update category using ensureQuoteAuthor (which updates if different)
    await ensureQuoteAuthor(authorName, category);

    // Verify the update
    const { data: updated, error: verifyError } = await supabase
      .from('quote_authors')
      .select('id, name, category')
      .eq('name', authorName)
      .single();

    if (verifyError) {
      throw new Error(`Failed to verify update: ${verifyError.message}`);
    }

    console.log(`\n✅ Successfully updated!`);
    console.log(`   Author: ${updated.name}`);
    console.log(`   Category: ${updated.category}`);
    console.log(`   ID: ${updated.id}\n`);

  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}`);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

