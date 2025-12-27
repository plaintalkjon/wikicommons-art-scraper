/**
 * Request rate limiter to prevent hitting Wikimedia's rate limits
 * Tracks requests per time window and enforces delays
 */

import { config } from './config';

const gentleMode =
  (process.env.GENTLE_MODE || '').toLowerCase() === '1' ||
  (process.env.GENTLE_MODE || '').toLowerCase() === 'true';

interface RequestWindow {
  timestamp: number;
  count: number;
}

class RateLimiter {
  private requestHistory: RequestWindow[] = [];
  private readonly maxRequestsPerMinute: number;
  private readonly maxRequestsPerSecond: number;
  private readonly minDelayBetweenRequests: number; // milliseconds

  constructor() {
    // Conservative limits to avoid rate limiting
    // Authenticated: 5000/hour = ~83/minute = ~1.4/second
    // Default: 30 requests/minute, 1 request/second
    // Gentle mode: much slower to escape throttling (about 6/minute, 1 per 5s)
    this.maxRequestsPerMinute = gentleMode ? 6 : 30;
    this.maxRequestsPerSecond = gentleMode ? 1 : 1;
    this.minDelayBetweenRequests = gentleMode ? 5000 : 1000; // 5s vs 1s minimum between requests
  }

  /**
   * Wait if needed before making a request
   * Should be called before each API request
   */
  async waitIfNeeded(): Promise<void> {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const oneSecondAgo = now - 1000;

    // Clean up old requests
    this.requestHistory = this.requestHistory.filter(w => w.timestamp > oneMinuteAgo);

    // Count requests in last minute
    const requestsLastMinute = this.requestHistory.reduce((sum, w) => sum + w.count, 0);
    
    // Count requests in last second
    const requestsLastSecond = this.requestHistory
      .filter(w => w.timestamp > oneSecondAgo)
      .reduce((sum, w) => sum + w.count, 0);

    // Check per-second limit
    if (requestsLastSecond >= this.maxRequestsPerSecond) {
      const oldestInLastSecond = Math.min(
        ...this.requestHistory
          .filter(w => w.timestamp > oneSecondAgo)
          .map(w => w.timestamp)
      );
      let waitTime = 1000 - (now - oldestInLastSecond) + 100; // Add 100ms buffer
      if (gentleMode) {
        // Add jitter up to 500ms to avoid synchronized bursts
        waitTime += Math.floor(Math.random() * 500);
      }
      if (waitTime > 0) {
        console.log(`  ⏳ Rate limiter: ${requestsLastSecond} requests in last second, waiting ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    // Check per-minute limit
    if (requestsLastMinute >= this.maxRequestsPerMinute) {
      const oldestInLastMinute = Math.min(...this.requestHistory.map(w => w.timestamp));
      let waitTime = 60000 - (now - oldestInLastMinute) + 1000; // Add 1s buffer
      if (gentleMode) {
        // Add jitter up to 5s
        waitTime += Math.floor(Math.random() * 5000);
      }
      if (waitTime > 0) {
        console.log(`  ⏳ Rate limiter: ${requestsLastMinute} requests in last minute, waiting ${Math.ceil(waitTime / 1000)}s...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    // Ensure minimum delay since last request
    if (this.requestHistory.length > 0) {
      const lastRequest = Math.max(...this.requestHistory.map(w => w.timestamp));
      const timeSinceLastRequest = now - lastRequest;
      if (timeSinceLastRequest < this.minDelayBetweenRequests) {
        let waitTime = this.minDelayBetweenRequests - timeSinceLastRequest;
        if (gentleMode) {
          waitTime += Math.floor(Math.random() * 500); // jitter
        }
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    // Record this request
    this.requestHistory.push({ timestamp: Date.now(), count: 1 });
  }

  /**
   * Get current request rate (requests per minute)
   */
  getCurrentRate(): number {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const recentRequests = this.requestHistory.filter(w => w.timestamp > oneMinuteAgo);
    return recentRequests.reduce((sum, w) => sum + w.count, 0);
  }

  /**
   * Reset the rate limiter (useful for testing)
   */
  reset(): void {
    this.requestHistory = [];
  }
}

// Singleton instance
export const rateLimiter = new RateLimiter();








