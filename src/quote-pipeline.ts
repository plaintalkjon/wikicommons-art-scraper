/**
 * Pipeline for fetching and storing philosopher quotes from Wikiquotes
 */

import { ensurePhilosopher, upsertQuote } from './db';
import { fetchPhilosopherQuotes, findPhilosopherQID, Quote } from './wikiquotes';

export interface FetchQuotesOptions {
  philosopher: string;
  limit?: number;
  dryRun?: boolean;
  sectionFilter?: string; // Optional: only fetch quotes from sections matching this name
}

export interface FetchQuotesResult {
  attempted: number;
  stored: number;
  skipped: number;
  errors: Array<{ quote: string; message: string }>;
}

export async function fetchAndStoreQuotes(
  options: FetchQuotesOptions,
): Promise<FetchQuotesResult> {
  const limit = options.limit ?? 1000; // Default to high limit, filter by quality

  console.log(`Fetching quotes for philosopher: ${options.philosopher}...`);

  // Look up philosopher QID from name
  console.log(`Looking up Wikidata QID for philosopher: ${options.philosopher}...`);
  let philosopherQid = await findPhilosopherQID(options.philosopher);

  // Special case for known philosophers
  if (!philosopherQid) {
    const knownPhilosophers: Record<string, string> = {
      'Friedrich Nietzsche': 'Q9358',
      'Nietzsche': 'Q9358',
      'Friedrich Wilhelm Nietzsche': 'Q9358',
      'Seneca': 'Q2054',
      'Lucius Annaeus Seneca': 'Q2054',
      'Seneca the Younger': 'Q2054',
    };
    philosopherQid = knownPhilosophers[options.philosopher] || null;
  }

  if (!philosopherQid) {
    throw new Error(`Could not find Wikidata QID for philosopher: ${options.philosopher}`);
  }
  console.log(`Found philosopher QID: ${philosopherQid}`);

  // Fetch quotes from Wikiquotes
  const quotes = await fetchPhilosopherQuotes(options.philosopher, options.sectionFilter);
  console.log(`Found ${quotes.length} quotes from Wikiquotes`);

  if (quotes.length === 0) {
    return {
      attempted: 0,
      stored: 0,
      skipped: 0,
      errors: [],
    };
  }

  // Ensure philosopher exists in database
  const philosopherId = await ensurePhilosopher(options.philosopher, philosopherQid);
  console.log(`Philosopher ID: ${philosopherId}`);

  let stored = 0;
  let skipped = 0;
  const errors: FetchQuotesResult['errors'] = [];
  const quotesToProcess = quotes.slice(0, limit);

  // Process quotes
  for (const quote of quotesToProcess) {
    try {
      // Skip quotes that are too long for Mastodon
      if (quote.characterCount > 500) {
        skipped += 1;
        continue;
      }

      if (!options.dryRun) {
        await upsertQuote({
          text: quote.text,
          philosopherId,
          source: quote.source,
          section: quote.section,
          characterCount: quote.characterCount,
        });
        stored += 1;
      } else {
        stored += 1; // Count in dry-run mode too
      }
    } catch (err) {
      const errorMessage = (err as Error).message;
      errors.push({ quote: quote.text.substring(0, 50), message: errorMessage });
      console.error(`Failed to store quote: ${errorMessage}`);
    }
  }

  console.log(`Completed. attempted=${quotesToProcess.length} stored=${stored} skipped=${skipped} errors=${errors.length}`);

  return {
    attempted: quotesToProcess.length,
    stored,
    skipped,
    errors,
  };
}
