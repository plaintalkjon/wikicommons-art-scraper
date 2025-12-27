import crypto from 'crypto';
import sizeOf from 'image-size';
import { bytesFromArrayBuffer } from './utils';
import { DownloadedImage, ImageVariant } from './types';
import { getWikimediaAccessToken } from './wikimediaAuth';
import { config } from './config';
import { bandwidthThrottler } from './bandwidthThrottle';
import { rateLimiter } from './rateLimiter';

const gentleMode =
  (process.env.GENTLE_MODE || '').toLowerCase() === '1' ||
  (process.env.GENTLE_MODE || '').toLowerCase() === 'true';

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
  const maxRetries = gentleMode ? 4 : 3;
  let lastError: Error | null = null;
  
  while (retryCount <= maxRetries) {
    try {
      // Check rate limits before starting download
      await rateLimiter.waitIfNeeded();
      await bandwidthThrottler.waitIfNeeded();
      
      const res = await fetch(variant.url, { headers });
      
      // Handle rate limiting (429)
      if (res.status === 429) {
        const retryAfter = res.headers.get('Retry-After');
        let delayMs: number;
        
        if (retryAfter) {
          // Respect Retry-After header (can be in seconds or HTTP-date)
          const retryAfterNum = parseInt(retryAfter, 10);
          if (!isNaN(retryAfterNum)) {
            // It's a number (seconds)
            delayMs = retryAfterNum * 1000;
          } else {
            // It's an HTTP-date, parse it
            const retryDate = new Date(retryAfter);
            if (!isNaN(retryDate.getTime())) {
              delayMs = Math.max(0, retryDate.getTime() - Date.now());
            } else {
              // Fallback to exponential backoff
              delayMs = Math.min(1000 * Math.pow(2, retryCount), 60000); // Max 60s
            }
          }
          // Add some buffer and ensure minimum delay
          delayMs = Math.max(delayMs + 1000, gentleMode ? 20000 : 5000); // At least 20s in gentle mode
        } else {
          // Exponential backoff with longer delays
          if (gentleMode) {
            // Start with 20s and grow; add jitter to avoid thundering herd
            delayMs = Math.min(20000 * Math.pow(2, retryCount), 180000); // up to 3 minutes
            delayMs += Math.floor(Math.random() * 5000);
          } else {
            delayMs = Math.min(5000 * Math.pow(2, retryCount), 60000); // 5s, 10s, 20s, max 60s
          }
        }
        
        if (retryCount < maxRetries) {
          console.log(
            `  ⚠ Rate limited (429), waiting ${Math.ceil(delayMs / 1000)}s before retry ${retryCount + 1}/${maxRetries}...${
              gentleMode ? ' [gentle mode]' : ''
            }`,
          );
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

      // Extract dimensions from image buffer
      // If variant already has dimensions (from Wikimedia API), use those
      // Otherwise, extract from the downloaded image
      let width = variant.width;
      let height = variant.height;
      
      if (width === 0 || height === 0) {
        try {
          const dimensions = sizeOf(buffer);
          if (dimensions.width && dimensions.height) {
            width = dimensions.width;
            height = dimensions.height;
          }
        } catch (err) {
          // If we can't extract dimensions, keep the original (0x0)
          // This will be caught by size validation later
          console.log(`  ⚠ Could not extract image dimensions: ${(err as Error).message}`);
        }
      }

      // Record download for bandwidth throttling (25 Mbps limit)
      await bandwidthThrottler.recordDownload(buffer.byteLength);
      
      // Small delay after successful download to be respectful of rate limits
      if (gentleMode) {
        const delayMs = 2000 + Math.floor(Math.random() * 2000); // 2-4s pause
        await new Promise(resolve => setTimeout(resolve, delayMs));
      } else {
        await new Promise(resolve => setTimeout(resolve, 200)); // Small delay between downloads
      }

      return {
        ...variant,
        width,
        height,
        buffer,
        sha256,
        ext,
        fileSize: buffer.byteLength,
      };
    } catch (err) {
      lastError = err as Error;
      
      // If it's a network error and we have retries left, try again
      if (retryCount < maxRetries && !lastError.message.includes('429')) {
        let delayMs = 1000 * Math.pow(2, retryCount); // Exponential backoff
        if (gentleMode) {
          delayMs = Math.min(5000 + 5000 * retryCount, 30000); // 5-30s with steps
          delayMs += Math.floor(Math.random() * 2000);
        }
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

