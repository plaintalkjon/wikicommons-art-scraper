#!/usr/bin/env node
import { fetchAndStoreArtworks } from './pipeline';
import { parseArgs } from './utils';

async function main() {
  const args = parseArgs();
  const artist = (args.artist as string) ?? 'Vincent van Gogh';
  const source = (args.source as 'wikimedia' | 'nga') || 'wikimedia';
  const limit = args.limit ? Number(args.limit) : undefined;
  const dryRun = Boolean(args['dry-run'] ?? args.dryRun);
  const maxUploads = args['max-uploads'] ? Number(args['max-uploads']) : undefined;
  const media =
    args.media && typeof args.media === 'string'
      ? (args.media as string)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
  const excludeDrawings = args['exclude-drawings'] !== undefined ? Boolean(args['exclude-drawings']) : true;
  console.log(
    `Fetching artworks for: ${artist} from ${source} (${dryRun ? 'dry run' : 'uploading'})` +
      `${maxUploads ? ` [max uploads: ${maxUploads}]` : ''}` +
      `${media && media.length ? ` [media filter: ${media.join(', ')}]` : ''}` +
      `${excludeDrawings ? ' [exclude drawings]' : ''}`,
  );
  const result = await fetchAndStoreArtworks({ artist, source, limit, dryRun, maxUploads, media, excludeDrawings });

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

