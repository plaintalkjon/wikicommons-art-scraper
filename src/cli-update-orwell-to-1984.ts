#!/usr/bin/env node
/**
 * Update George Orwell author name to "1984"
 */

import { supabase } from './config';

async function updateOrwellTo1984(): Promise<void> {
  console.log('🔄 Updating George Orwell to "1984"...');
  console.log('═'.repeat(70));
  console.log('');

  try {
    // First, find George Orwell
    const { data: author, error: authorError } = await supabase
      .from('quote_authors')
      .select('id, name, category')
      .eq('name', 'George Orwell')
      .maybeSingle();

    if (authorError) {
      throw new Error(`Failed to lookup author: ${authorError.message}`);
    }

    if (!author) {
      console.log('❌ George Orwell not found in quote_authors table');
      return;
    }

    console.log(`✅ Found author: ${author.name} (ID: ${author.id})`);
    console.log(`   Category: ${author.category || 'N/A'}`);
    console.log('');

    // Check how many quotes will be affected
    const { count: quoteCount, error: countError } = await supabase
      .from('quotes')
      .select('*', { count: 'exact', head: true })
      .eq('author_id', author.id);

    if (countError) {
      throw new Error(`Failed to count quotes: ${countError.message}`);
    }

    console.log(`📚 Quotes that will be affected: ${quoteCount || 0}`);
    console.log('');

    // Update the author name
    console.log('🔄 Updating author name from "George Orwell" to "1984"...');
    const { error: updateError } = await supabase
      .from('quote_authors')
      .update({ name: '1984' })
      .eq('id', author.id);

    if (updateError) {
      throw new Error(`Failed to update author: ${updateError.message}`);
    }

    console.log('✅ Successfully updated!');
    console.log('');

    // Verify the update
    const { data: updated, error: verifyError } = await supabase
      .from('quote_authors')
      .select('id, name, category')
      .eq('id', author.id)
      .single();

    if (verifyError) {
      throw new Error(`Failed to verify update: ${verifyError.message}`);
    }

    console.log('📋 Verification:');
    console.log(`   Author ID: ${updated.id}`);
    console.log(`   Name: ${updated.name}`);
    console.log(`   Category: ${updated.category || 'N/A'}`);
    console.log(`   Quotes: ${quoteCount || 0}`);
    console.log('');
    console.log('═'.repeat(70));
    console.log('✅ Update complete!');

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

updateOrwellTo1984().catch((err) => {
  console.error('❌ Unexpected error:', err);
  process.exit(1);
});
