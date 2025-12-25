import { promises as fs } from 'fs';
import path from 'path';

export interface FailedUpload {
  artist: string;
  title: string;
  imageUrl?: string;
  error: string;
  timestamp: string;
  retryCount: number;
}

const FAILURES_DIR = path.join(process.cwd(), '.failures');

/**
 * Get the path to the failure file for an artist
 */
function getFailureFile(artist: string): string {
  const artistSlug = artist.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return path.join(FAILURES_DIR, `${artistSlug}.json`);
}

/**
 * Ensure the failures directory exists
 */
async function ensureFailuresDir(): Promise<void> {
  try {
    await fs.mkdir(FAILURES_DIR, { recursive: true });
  } catch {
    // Directory already exists or creation failed
  }
}

/**
 * Load failures for an artist
 */
export async function loadFailures(artist: string): Promise<FailedUpload[]> {
  await ensureFailuresDir();
  const filePath = getFailureFile(artist);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}

/**
 * Save a failure
 */
export async function saveFailure(failure: FailedUpload): Promise<void> {
  await ensureFailuresDir();
  const failures = await loadFailures(failure.artist);
  
  // Check if this failure already exists (by title)
  const existingIndex = failures.findIndex(f => f.title === failure.title);
  if (existingIndex >= 0) {
    // Update existing failure with new error and increment retry count
    failures[existingIndex] = {
      ...failure,
      retryCount: failures[existingIndex].retryCount + 1,
    };
  } else {
    // Add new failure
    failures.push(failure);
  }
  
  const filePath = getFailureFile(failure.artist);
  await fs.writeFile(filePath, JSON.stringify(failures, null, 2), 'utf-8');
}

/**
 * Remove a failure (when it succeeds)
 */
export async function removeFailure(artist: string, title: string): Promise<void> {
  const failures = await loadFailures(artist);
  const filtered = failures.filter(f => f.title !== title);
  
  const filePath = getFailureFile(artist);
  if (filtered.length === 0) {
    // Delete file if no failures left
    try {
      await fs.unlink(filePath);
    } catch {
      // File doesn't exist, that's fine
    }
  } else {
    await fs.writeFile(filePath, JSON.stringify(filtered, null, 2), 'utf-8');
  }
}

/**
 * Get all artists with failures
 */
export async function getArtistsWithFailures(): Promise<string[]> {
  await ensureFailuresDir();
  try {
    const files = await fs.readdir(FAILURES_DIR);
    return files
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace(/\.json$/, ''));
  } catch {
    return [];
  }
}
