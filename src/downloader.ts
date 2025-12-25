import crypto from 'crypto';
import { bytesFromArrayBuffer } from './utils';
import { DownloadedImage, ImageVariant } from './types';
import { getWikimediaAccessToken } from './wikimediaAuth';
import { config } from './config';
import { bandwidthThrottler } from './bandwidthThrottle';

/**
 * Download an image from Wikimedia Commons with proper authentication and rate limiting
 * Includes OAuth headers and User-Agent for better rate limit handling
 */
export async function downloadImage(variant: ImageVariant): Promise<DownloadedImage> {
  // Get OAuth token if available (helps with rate limits)
  const accessToken = await getWikimediaAccessToken();
  
  // Build headers with OAuth and User-Agent
  const headers: HeadersInit = {
    'User-Agent': config.wikimediaClientId 
      ? `wikicommons-art-scraper/1.0 (OAuth client: ${config.wikimediaClientId})`
      : 'wikicommons-art-scraper/1.0 (contact: developer@example.com)',
    'Accept-Encoding': 'gzip', // Recommended by Wikimedia for bandwidth efficiency
  };
  
  // Add OAuth token if available (may help with rate limits even for public files)
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }
  
  let retryCount = 0;
  const maxRetries = 3;
  let lastError: Error | null = null;
  
  while (retryCount <= maxRetries) {
    try {
      // Check bandwidth before starting download
      await bandwidthThrottler.waitIfNeeded();
      
      const res = await fetch(variant.url, { headers });
      
      // Handle rate limiting (429)
      if (res.status === 429) {
        const retryAfter = res.headers.get('Retry-After');
        const delayMs = retryAfter 
          ? parseInt(retryAfter, 10) * 1000 
          : Math.min(1000 * Math.pow(2, retryCount), 10000); // Exponential backoff, max 10s
        
        if (retryCount < maxRetries) {
          console.log(`  ⚠ Rate limited (429), waiting ${delayMs}ms before retry ${retryCount + 1}/${maxRetries}...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          retryCount++;
          continue;
        } else {
          throw new Error(`Failed to download image ${variant.url}: 429 Too Many Requests (rate limited after ${maxRetries} retries)`);
        }
      }
      
      if (!res.ok) {
        throw new Error(`Failed to download image ${variant.url}: ${res.status} ${res.statusText}`);
      }

      const arrayBuffer = await res.arrayBuffer();
      const buffer = bytesFromArrayBuffer(arrayBuffer);
      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
      const ext = extensionFromMime(variant.mime);

      // Record download for bandwidth throttling (25 Mbps limit)
      await bandwidthThrottler.recordDownload(buffer.byteLength);
      
      // Small delay after successful download to be respectful of rate limits
      await new Promise(resolve => setTimeout(resolve, 200)); // Small delay between downloads

      return {
        ...variant,
        buffer,
        sha256,
        ext,
        fileSize: buffer.byteLength,
      };
    } catch (err) {
      lastError = err as Error;
      
      // If it's a network error and we have retries left, try again
      if (retryCount < maxRetries && !lastError.message.includes('429')) {
        const delayMs = 1000 * Math.pow(2, retryCount); // Exponential backoff
        console.log(`  ⚠ Download error, retrying in ${delayMs}ms... (${retryCount + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        retryCount++;
        continue;
      }
      
      throw lastError;
    }
  }
  
  throw lastError || new Error(`Failed to download image after ${maxRetries} retries`);
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

