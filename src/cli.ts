#!/usr/bin/env node
import { fetchAndStoreArtworks } from './pipeline';

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
  const artist = (args.artist as string) ?? 'Vincent van Gogh';
  const limit = args.limit ? Number(args.limit) : undefined;
  const dryRun = Boolean(args['dry-run'] ?? args.dryRun);
  const paintingsOnly = Boolean(args['paintings-only'] ?? args.paintingsOnly);
  const maxUploads = args['max-uploads'] ? Number(args['max-uploads']) : undefined;
  const source = (args.source as string) === 'wikimedia' ? 'wikimedia' : 'wikidata';

  console.log(
    `Fetching artworks for: ${artist} (${dryRun ? 'dry run' : 'uploading'})${paintingsOnly ? ' [paintings only]' : ''}${
      maxUploads ? ` [max uploads: ${maxUploads}]` : ''
    } [source: ${source}]`,
  );
  const result = await fetchAndStoreArtworks({ artist, limit, dryRun, paintingsOnly, maxUploads, source });

  console.log(
    `Completed. attempted=${result.attempted} uploaded=${result.uploaded} skipped=${result.skipped} errors=${result.errors.length}`,
  );
  if (result.errors.length) {
    console.error('Errors:');
    for (const err of result.errors) {
      console.error(`- ${err.title}: ${err.message}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

