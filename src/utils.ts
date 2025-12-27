/**
 * Remove accents/diacritics from a string
 * Converts characters like "ç", "é", "à", "æ" to their base letters "c", "e", "a", "a"
 */
export function removeAccents(str: string): string {
  return str
    .normalize('NFD') // Decompose characters (e.g., "é" -> "e" + combining acute)
    .replace(/[\u0300-\u036f]/g, '') // Remove combining diacritical marks
    .replace(/æ/g, 'a') // Handle æ (U+00E6) - single character, not decomposed by NFD
    .replace(/Æ/g, 'A')
    .normalize('NFC'); // Recompose to canonical form
}

export function slugify(value: string): string {
  // Remove accents first to avoid duplicate folders (e.g., "François" -> "Francois", "Édouard" -> "Edouard")
  const withoutAccents = removeAccents(value);
  return withoutAccents
    .toLowerCase()
    .trim()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

export function bytesFromArrayBuffer(buffer: ArrayBuffer): Buffer {
  return Buffer.from(new Uint8Array(buffer));
}

/**
 * Parse command line arguments
 */
export function parseArgs(): Record<string, string | boolean> {
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

