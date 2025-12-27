#!/usr/bin/env node
import { fetchAndStoreArtworks } from './pipeline';
import { parseArgs } from './utils';

async function main() {
  const args = parseArgs();
  const artist = (args.artist as string) ?? 'Vincent van Gogh';
  const limit = args.limit ? Number(args.limit) : undefined;
  const dryRun = Boolean(args['dry-run'] ?? args.dryRun);
  const maxUploads = args['max-uploads'] ? Number(args['max-uploads']) : undefined;
  console.log(
    `Fetching artworks for: ${artist} (${dryRun ? 'dry run' : 'uploading'})${
      maxUploads ? ` [max uploads: ${maxUploads}]` : ''
    }`,
  );
  const result = await fetchAndStoreArtworks({ artist, limit, dryRun, maxUploads });

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

