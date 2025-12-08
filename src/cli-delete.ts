#!/usr/bin/env node
import { deleteArtByIds, findArtIdsByTitleAndArtist } from './deleteArt';

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
  const title = args.title as string;
  const artist = args.artist as string;
  const fuzzy = Boolean(args.fuzzy);
  const dryRun = Boolean(args['dry-run'] ?? args.dryRun);

  if (!title || !artist) {
    console.error('Usage: npm run delete-art -- --title "<title>" --artist "<artist>" [--fuzzy] [--dry-run]');
    process.exit(1);
  }

  const ids = await findArtIdsByTitleAndArtist(title, artist, fuzzy);
  if (!ids.length) {
    console.log('No matching artworks found.');
    return;
  }

  console.log(`Found ${ids.length} artwork(s) to delete. IDs: ${ids.join(', ')}`);
  if (dryRun) {
    console.log('Dry run: no rows deleted.');
    return;
  }

  const deleted = await deleteArtByIds(ids);
  console.log(`Deleted ${deleted} artwork(s) and related rows.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

