#!/usr/bin/env node
import { fetchAndStoreArtworks } from './pipeline';
import { parseArgs } from './utils';

async function main() {
  const args = parseArgs();
  const artist = args.artist as string;
  const category = args.category as string;
  const source = (args.source as 'wikimedia') || 'wikimedia';
  const limit = args.limit ? Number(args.limit) : undefined;
  const dryRun = Boolean(args['dry-run'] ?? args.dryRun);
  const maxUploads = args['max-uploads'] ? Number(args['max-uploads']) : undefined;
  const concurrency = args.concurrency ? Number(args.concurrency) : undefined;
  const media =
    args.media && typeof args.media === 'string'
      ? (args.media as string)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
  const excludeDrawings = args['exclude-drawings'] !== undefined ? Boolean(args['exclude-drawings']) : true;
  
  // Determine collection name for category-based scraping
  const collectionName = category 
    ? (artist || category.replace(/^Category:/i, ''))
    : (artist || 'Vincent van Gogh');
  
  if (category) {
    console.log(
      `Fetching files from category: ${category} (${dryRun ? 'dry run' : 'uploading'})` +
        ` [collection: ${collectionName}]` +
        `${maxUploads ? ` [max uploads: ${maxUploads}]` : ''}` +
        `${concurrency ? ` [concurrency: ${concurrency}]` : ''}`,
    );
  } else {
    console.log(
      `Fetching artworks for: ${collectionName} from ${source} (${dryRun ? 'dry run' : 'uploading'})` +
        `${maxUploads ? ` [max uploads: ${maxUploads}]` : ''}` +
        `${concurrency ? ` [concurrency: ${concurrency}]` : ''}` +
        `${media && media.length ? ` [media filter: ${media.join(', ')}]` : ''}` +
        `${excludeDrawings ? ' [exclude drawings]' : ''}`,
    );
  }
  
  const result = await fetchAndStoreArtworks({ 
    artist: collectionName, 
    category,
    source, 
    limit, 
    dryRun, 
    maxUploads, 
    concurrency, 
    media, 
    excludeDrawings 
  });

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

