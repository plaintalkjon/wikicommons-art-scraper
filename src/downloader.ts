import crypto from 'crypto';
import { bytesFromArrayBuffer } from './utils';
import { DownloadedImage, ImageVariant } from './types';

export async function downloadImage(variant: ImageVariant): Promise<DownloadedImage> {
  const res = await fetch(variant.url);
  if (!res.ok) {
    throw new Error(`Failed to download image ${variant.url}: ${res.status} ${res.statusText}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const buffer = bytesFromArrayBuffer(arrayBuffer);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const ext = extensionFromMime(variant.mime);

  return {
    ...variant,
    buffer,
    sha256,
    ext,
    fileSize: buffer.byteLength,
  };
}

function extensionFromMime(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/tiff': 'tif',
    'image/svg+xml': 'svg',
  };
  return map[mime] ?? 'img';
}

