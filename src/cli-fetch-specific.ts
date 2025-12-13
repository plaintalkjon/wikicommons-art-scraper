#!/usr/bin/env node
import { fetchImageInfoByTitle } from './wikimedia';
import { ensureArtist, upsertArt, insertArtAsset, upsertArtSource } from './db';
import { uploadToStorage } from './storage';
import { downloadImage } from './downloader';
import { buildStoragePath, normalizeTitle, cleanTitle } from './pipeline';
import { pickBestVariant } from './wikimedia';

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
  const artist = (args.artist as string);
  const fileTitle = (args.file as string);
  
  if (!artist || !fileTitle) {
    console.error('Error: --artist and --file are required');
    console.error('Usage: npm run fetch-specific -- --artist "Artist Name" --file "File:Image.jpg"');
    process.exit(1);
  }
  
  console.log(`Fetching specific artwork for: ${artist}`);
  console.log(`File: ${fileTitle}\n`);
  
  try {
    // Fetch image info
    const image = await fetchImageInfoByTitle(fileTitle);
    if (!image) {
      console.error(`Image not found: ${fileTitle}`);
      process.exit(1);
    }
    
    console.log(`✓ Found image: ${image.title}`);
    
    // Pick best variant
    const variant = pickBestVariant(image);
    if (!variant) {
      console.error('No suitable variant found');
      process.exit(1);
    }
    
    console.log(`✓ Selected variant: ${variant.width}x${variant.height}`);
    
    // Download image
    console.log('Downloading image...');
    const downloaded = await downloadImage(variant);
    const storagePath = buildStoragePath(artist, image, downloaded.ext);
    
    console.log(`✓ Downloaded: ${downloaded.width}x${downloaded.height}, ${(downloaded.fileSize / 1024 / 1024).toFixed(2)}MB`);
    
    // Upload to storage
    console.log('Uploading to storage...');
    const upload = await uploadToStorage(storagePath, downloaded);
    console.log(`✓ Uploaded to: ${upload.path}`);
    
    // Upsert art record
    const artistId = await ensureArtist(artist);
    const rawTitle = normalizeTitle(image.title);
    const cleanedTitle = cleanTitle(rawTitle);
    
    console.log(`Upserting art record: ${cleanedTitle}`);
    const artId = await upsertArt({
      title: cleanedTitle,
      description: image.description ?? null,
      imageUrl: upload.publicUrl,
      artistId,
    });
    console.log(`✓ Art record created/updated: ${artId}`);
    
    // Insert asset
    await insertArtAsset({
      artId,
      storagePath: upload.path,
      publicUrl: upload.publicUrl,
      width: downloaded.width,
      height: downloaded.height,
      fileSize: downloaded.fileSize,
      mimeType: downloaded.mime,
      sha256: downloaded.sha256,
    });
    console.log(`✓ Asset record created`);
    
    // Upsert source
    await upsertArtSource({
      artId,
      source: 'wikimedia',
      sourcePageId: image.pageid,
      sourceTitle: image.title,
      sourceUrl: image.pageUrl,
    });
    console.log(`✓ Source record created`);
    
    console.log(`\n✅ Successfully uploaded: ${cleanedTitle}`);
    
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

main().catch(console.error);
