#!/usr/bin/env node
/**
 * Check George Orwell quotes and their sources
 */

import { supabase } from './config';

async function checkOrwellQuotes(): Promise<void> {
  console.log('🔍 Checking George Orwell quotes...');
  console.log('═'.repeat(70));
  console.log('');

  try {
    // First, find George Orwell in quote_authors
    const { data: author, error: authorError } = await supabase
      .from('quote_authors')
      .select('id, name, category')
      .ilike('name', '%Orwell%')
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

    // Get all quotes for George Orwell
    const { data: quotes, error: quotesError } = await supabase
      .from('quotes')
      .select('id, text, source')
      .eq('author_id', author.id)
      .order('source', { ascending: true })
      .order('created_at', { ascending: true });

    if (quotesError) {
      throw new Error(`Failed to fetch quotes: ${quotesError.message}`);
    }

    if (!quotes || quotes.length === 0) {
      console.log('⚠️  No quotes found for George Orwell');
      return;
    }

    console.log(`📚 Total quotes: ${quotes.length}`);
    console.log('');

    // Group by source
    const bySource: Record<string, typeof quotes> = {};
    quotes.forEach(quote => {
      const source = quote.source || '(no source)';
      if (!bySource[source]) {
        bySource[source] = [];
      }
      bySource[source].push(quote);
    });

    console.log('📖 Quotes by source:');
    console.log('─'.repeat(70));
    
    Object.entries(bySource)
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([source, sourceQuotes]) => {
        console.log(`\n${source}:`);
        console.log(`   Total: ${sourceQuotes.length}`);
        
        // Show a sample quote
        if (sourceQuotes.length > 0) {
          const sample = sourceQuotes[0];
          const preview = sample.text.length > 100 
            ? sample.text.substring(0, 100) + '...' 
            : sample.text;
          console.log(`   Sample: "${preview}"`);
        }
      });

    console.log('');
    console.log('═'.repeat(70));
    
    // Check if all are from 1984
    const sources = Object.keys(bySource);
    const isOnly1984 = sources.length === 1 && (sources[0] === '1984' || sources[0].toLowerCase().includes('1984'));
    
    if (isOnly1984) {
      console.log('✅ All quotes are from 1984');
    } else {
      console.log('⚠️  Quotes are from multiple sources:');
      sources.forEach(source => {
        console.log(`   - ${source} (${bySource[source].length} quotes)`);
      });
    }

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkOrwellQuotes().catch((err) => {
  console.error('❌ Unexpected error:', err);
  process.exit(1);
});
