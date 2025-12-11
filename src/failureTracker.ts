import * as fs from 'fs';
import * as path from 'path';

export interface FailureRecord {
  artist: string;
  title: string;
  imageUrl?: string;
  error: string;
  timestamp: string;
  retryCount: number;
  lastRetry?: string;
}

const FAILURES_DIR = path.join(process.cwd(), 'failures');

/**
 * Ensure the failures directory exists
 */
function ensureFailuresDir(): void {
  if (!fs.existsSync(FAILURES_DIR)) {
    fs.mkdirSync(FAILURES_DIR, { recursive: true });
  }
}

/**
 * Get the failures file path for an artist
 */
function getFailuresFilePath(artist: string): string {
  ensureFailuresDir();
  const artistSlug = artist.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return path.join(FAILURES_DIR, `${artistSlug}.json`);
}

/**
 * Save a failure record for later retry
 */
export async function saveFailure(failure: FailureRecord): Promise<void> {
  const filePath = getFailuresFilePath(failure.artist);
  let failures: FailureRecord[] = [];
  
  // Load existing failures
  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      failures = JSON.parse(content);
    } catch {
      failures = [];
    }
  }
  
  // Check if this failure already exists (by title)
  const existingIndex = failures.findIndex(f => f.title === failure.title);
  if (existingIndex >= 0) {
    // Update existing failure with new error and increment retry count
    failures[existingIndex] = {
      ...failures[existingIndex],
      error: failure.error,
      timestamp: failure.timestamp,
      retryCount: failures[existingIndex].retryCount + 1,
      lastRetry: new Date().toISOString(),
    };
  } else {
    // Add new failure
    failures.push(failure);
  }
  
  // Save back to file
  fs.writeFileSync(filePath, JSON.stringify(failures, null, 2));
}

/**
 * Load failures for an artist
 */
export function loadFailures(artist: string): FailureRecord[] {
  const filePath = getFailuresFilePath(artist);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}

/**
 * Remove a failure (when it succeeds)
 */
export function removeFailure(artist: string, title: string): void {
  const filePath = getFailuresFilePath(artist);
  if (!fs.existsSync(filePath)) {
    return;
  }
  
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const failures: FailureRecord[] = JSON.parse(content);
    const filtered = failures.filter(f => f.title !== title);
    fs.writeFileSync(filePath, JSON.stringify(filtered, null, 2));
  } catch {
    // Ignore errors
  }
}

/**
 * Clear all failures for an artist
 */
export function clearFailures(artist: string): void {
  const filePath = getFailuresFilePath(artist);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}
