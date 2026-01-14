#!/usr/bin/env node
/**
 * Wikiquote Scraper
 * Scrapes quotes from Wikiquote pages and stores them in the database
 *
 * Usage:
 *   npm run wikiquote-scrape -- --philosopher "Marcus Aurelius" --url "https://en.wikiquote.org/wiki/Marcus_Aurelius"
 *   npm run wikiquote-scrape -- --philosopher "Marcus Aurelius" --url "https://en.wikiquote.org/wiki/Marcus_Aurelius" --dry-run
 */

import { parseArgs } from './utils';
import { fetchQuotesFromWikiquote, deduplicateQuotes, Quote } from './wikiquote';
import { ensureQuoteAuthor, upsertQuote } from './db';
import { supabase } from './config';

interface ScrapeOptions {
  philosopher: string;
  url: string;
  dryRun?: boolean;
}

async function main() {
  const args = parseArgs();
  
  const philosopher = args.philosopher as string;
  const url = args.url as string;
  const category = (args.category as string) || 'philosopher';
  const dryRun = Boolean(args['dry-run'] ?? args.dryRun);

  if (!philosopher) {
    console.error('❌ Error: --philosopher is required');
    console.error('Usage: npm run wikiquote-scrape -- --philosopher "Marcus Aurelius" --url "https://en.wikiquote.org/wiki/Marcus_Aurelius"');
    process.exit(1);
  }

  if (!url) {
    console.error('❌ Error: --url is required');
    console.error('Usage: npm run wikiquote-scrape -- --philosopher "Marcus Aurelius" --url "https://en.wikiquote.org/wiki/Marcus_Aurelius"');
    process.exit(1);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Wikiquote Scraper`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Philosopher: ${philosopher}`);
  console.log(`URL: ${url}`);
  console.log(`Category: ${category}`);
  console.log(`Dry run: ${dryRun ? 'YES' : 'NO'}`);
  console.log(`${'='.repeat(60)}\n`);

  try {
    // Step 1: Fetch quotes from Wikiquote
    console.log('📥 Step 1: Fetching quotes from Wikiquote...');
    let quotes = await fetchQuotesFromWikiquote(url);
    console.log(`✓ Fetched ${quotes.length} raw quotes\n`);

    // Step 2: Deduplicate quotes (keep first English translation per reference)
    console.log('🔄 Step 2: Deduplicating quotes...');
    quotes = deduplicateQuotes(quotes);
    console.log(`✓ After deduplication: ${quotes.length} unique quotes\n`);

    // Step 2.5: Filter quotes to Mastodon-compatible length (500 characters max)
    console.log('✂️  Step 2.5: Filtering quotes to Mastodon-compatible length (≤500 chars)...');
    const beforeFilter = quotes.length;
    quotes = quotes.filter(q => q.text.length <= 500);
    const filteredOut = beforeFilter - quotes.length;
    console.log(`✓ Filtered out ${filteredOut} quotes over 500 characters`);
    console.log(`✓ Remaining: ${quotes.length} Mastodon-compatible quotes\n`);

    // Step 3: Ensure quote author exists in database
    console.log('👤 Step 3: Ensuring quote author exists in database...');
    const authorId = await ensureQuoteAuthor(philosopher, category);
    console.log(`✓ Author ID: ${authorId}\n`);

    if (dryRun) {
      console.log('🔍 DRY RUN MODE - Showing quotes that would be inserted:\n');
      
      // Count quotes under 500 characters (Mastodon limit)
      const under500 = quotes.filter(q => q.text.length <= 500);
      const over500 = quotes.filter(q => q.text.length > 500);
      
      console.log(`📊 Character count analysis:`);
      console.log(`  Total quotes: ${quotes.length}`);
      console.log(`  Under 500 chars (Mastodon-compatible): ${under500.length}`);
      console.log(`  Over 500 chars: ${over500.length}`);
      console.log(`\n📝 Sample quotes (first 10):\n`);
      
      quotes.slice(0, 10).forEach((quote, index) => {
        const charCount = quote.text.length;
        const status = charCount <= 500 ? '✓' : '✗';
        console.log(`${index + 1}. [${charCount} chars] ${status} ${quote.text.substring(0, 80)}${quote.text.length > 80 ? '...' : ''}`);
      });
      
      if (over500.length > 0) {
        console.log(`\n⚠️  Quotes over 500 characters (first 5):\n`);
        over500.slice(0, 5).forEach((quote, index) => {
          console.log(`${index + 1}. [${quote.text.length} chars] ${quote.text.substring(0, 100)}...`);
        });
      }
      
      console.log(`\n✓ Would insert ${quotes.length} quotes (${under500.length} Mastodon-compatible)`);
      return;
    }

    // Step 4: Insert quotes into database
    console.log('💾 Step 4: Inserting quotes into database...');
    let inserted = 0;
    let updated = 0;
    let errors = 0;

    for (const quote of quotes) {
      try {
        // Check if quote already exists (by text + source) to track updates vs inserts
        const existing = await supabase
          .from('quotes')
          .select('id')
          .eq('author_id', authorId)
          .eq('text', quote.text)
          .eq('source', quote.source ?? null)
          .maybeSingle();

        const quoteId = await upsertQuote({
          text: quote.text,
          authorId: authorId,
          source: quote.source,
        });

        if (existing.data?.id) {
          updated++;
          console.log(`  ✓ Updated quote [${quote.source || 'no source'}]: ${quote.text.substring(0, 60)}...`);
        } else {
          inserted++;
          console.log(`  ✓ Inserted quote [${quote.source || 'no source'}]: ${quote.text.substring(0, 60)}...`);
        }
      } catch (error: any) {
        errors++;
        console.error(`  ❌ Error inserting quote: ${error.message}`);
      }
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Summary:`);
    console.log(`  Inserted: ${inserted}`);
    console.log(`  Updated: ${updated}`);
    console.log(`  Errors: ${errors}`);
    console.log(`  Total: ${quotes.length}`);
    console.log(`${'='.repeat(60)}\n`);

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

