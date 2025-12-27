#!/usr/bin/env node
/**
 * List Art Institute of Chicago (AIC) artworks (metadata only).
 *
 * Usage:
 *   npm run artic-list -- --q "van gogh" --limit 10 --page 1
 */

import { parseArgs } from './utils';
import { searchArtic, buildIiifUrl, extractTags } from './artic';

async function main() {
  const args = parseArgs();
  const q = args.q === true || args.q === undefined ? '' : (args.q as string);
  const limit = args.limit ? parseInt(args.limit as string, 10) : 10;
  const page = args.page ? parseInt(args.page as string, 10) : 1;
  const departments = args.departments
    ? String(args.departments)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
  const classifications = args.classifications
    ? String(args.classifications)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
  const publicDomainOnly = !(args['include-non-public'] || args.includeNonPublic);

  console.log(
    `AIC search: q="${q}", page=${page}, limit=${limit} (${publicDomainOnly ? 'public domain only' : 'all rights'})` +
      `${departments ? ` departments=${departments.join('|')}` : ''}` +
      `${classifications ? ` classifications=${classifications.join('|')}` : ''}`,
  );
  const results = await searchArtic({ q, page, limit, departments, classifications, publicDomainOnly });
  console.log(`Found ${results.length} records`);

  for (const rec of results) {
    console.log('---');
    console.log(`ID: ${rec.id}`);
    console.log(`Title: ${rec.title ?? '(none)'}`);
    console.log(`Artist: ${rec.artist_title ?? 'Unknown artist'}`);
    console.log(`Date: ${rec.date_display ?? '(none)'}`);
    console.log(`Dept: ${rec.department_title ?? '(none)'}`);
    console.log(`Classification: ${(rec.classification_titles || []).join(', ') || '(none)'}`);
    console.log(`Styles: ${(rec.style_titles || []).join(', ') || '(none)'}`);
    console.log(`Place: ${rec.place_of_origin ?? '(none)'}`);
    console.log(`Medium: ${rec.medium_display ?? '(none)'}`);
    console.log(`Public domain: ${rec.is_public_domain}`);
    console.log(`Image ID: ${rec.image_id ?? '(none)'}`);
    if (rec.image_id) {
      console.log(`IIIF: ${buildIiifUrl(rec.image_id, 2000)}`);
    }
    const tags = extractTags(rec);
    console.log(`Tags: ${tags.length ? tags.join(', ') : '(none)'}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

