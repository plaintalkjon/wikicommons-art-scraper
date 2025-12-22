#!/usr/bin/env node
/**
 * CLI script to fetch and store philosopher quotes from Wikiquotes
 * Usage: npm run fetch-quotes -- --philosopher "Friedrich Nietzsche"
 */

import { fetchAndStoreQuotes } from './quote-pipeline';

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.replace(/^--/, '');
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        parsed[key] = next;
        i += 1;
      } else {
        parsed[key] = true;
      }
    }
  }
  return parsed;
}

async function main() {
  const args = parseArgs();
  const philosopher = (args.philosopher as string);
  const limit = args.limit ? Number(args.limit) : undefined;
  const dryRun = Boolean(args['dry-run'] ?? args.dryRun);
  const sectionFilter = args['section-filter'] as string | undefined;

  if (!philosopher) {
    console.error('Error: --philosopher is required');
    console.error('Usage: npm run fetch-quotes -- --philosopher "Friedrich Nietzsche" [--section-filter "Section Name"]');
    process.exit(1);
  }

  console.log(
    `Fetching quotes for: ${philosopher} (${dryRun ? 'dry run' : 'storing'})${limit ? ` [limit: ${limit}]` : ''}${sectionFilter ? ` [section: ${sectionFilter}]` : ''}`,
  );

  const result = await fetchAndStoreQuotes({ philosopher, limit, dryRun, sectionFilter });

  console.log(
    `Completed. attempted=${result.attempted} stored=${result.stored} skipped=${result.skipped} errors=${result.errors.length}`,
  );

  if (result.errors.length) {
    console.error('Errors:');
    for (const err of result.errors) {
      console.error(`- ${err.quote}...: ${err.message}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
