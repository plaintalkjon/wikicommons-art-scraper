/**
 * Bandwidth throttling to stay under Wikimedia's 25 Mbps limit
 * 25 Mbps = 3.125 MB/s = 3,125,000 bytes/second
 */

const MAX_BANDWIDTH_BPS = 25 * 1024 * 1024 / 8; // 25 Mbps in bytes per second (3,125,000)
const WINDOW_MS = 1000; // 1 second sliding window

interface BandwidthWindow {
  bytes: number;
  startTime: number;
}

class BandwidthThrottler {
  private windows: BandwidthWindow[] = [];
  private totalBytes = 0;

  /**
   * Check if we can start a new download without exceeding bandwidth limit
   * Should be called BEFORE starting a download
   * Returns the number of milliseconds to wait before starting, or 0 if OK to proceed
   */
  async waitIfNeeded(estimatedBytes?: number): Promise<void> {
    const now = Date.now();
    
    // Remove windows older than 1 second
    this.windows = this.windows.filter(w => now - w.startTime < WINDOW_MS);
    
    // Calculate total bytes in the last second
    const bytesInLastSecond = this.windows.reduce((sum, w) => sum + w.bytes, 0);
    
    // If we're already at or near the limit, wait
    // Use 90% of limit as threshold to be safe
    const threshold = MAX_BANDWIDTH_BPS * 0.9;
    
    if (bytesInLastSecond >= threshold) {
      // Calculate how much we need to wait
      const excessBytes = bytesInLastSecond - threshold;
      const waitMs = Math.ceil((excessBytes / MAX_BANDWIDTH_BPS) * 1000);
      
      if (waitMs > 0) {
        console.log(`  ⚠ Bandwidth: ${(bytesInLastSecond / 1024 / 1024 * 8).toFixed(2)} Mbps (limit: 25 Mbps), waiting ${waitMs}ms before download`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
        
        // Clean up old windows after waiting
        const afterWait = Date.now();
        this.windows = this.windows.filter(w => afterWait - w.startTime < WINDOW_MS);
      }
    }
  }

  /**
   * Record bytes downloaded (call AFTER download completes)
   */
  async recordDownload(bytes: number): Promise<void> {
    const now = Date.now();
    
    // Remove windows older than 1 second
    this.windows = this.windows.filter(w => now - w.startTime < WINDOW_MS);
    
    // Add current download to window
    this.windows.push({ bytes, startTime: now });
  }

}

// Singleton instance
export const bandwidthThrottler = new BandwidthThrottler();



