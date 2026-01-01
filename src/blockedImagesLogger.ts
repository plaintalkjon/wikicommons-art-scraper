/**
 * Logger for tracking persistently blocked images to identify patterns
 */

import * as fs from 'fs';
import * as path from 'path';

export interface BlockedImageRecord {
  timestamp: string;
  artist: string;
  title: string;
  url: string;
  width: number;
  height: number;
  mimeType: string;
  museum?: string;
  sourceItem?: string;
  error: string;
  retryCount: number;
  userAgent?: string;
}

const LOG_FILE = path.join(process.cwd(), 'blocked-images-log.jsonl');

export class BlockedImagesLogger {
  private static instance: BlockedImagesLogger;

  static getInstance(): BlockedImagesLogger {
    if (!BlockedImagesLogger.instance) {
      BlockedImagesLogger.instance = new BlockedImagesLogger();
    }
    return BlockedImagesLogger.instance;
  }

  logBlockedImage(record: BlockedImageRecord): void {
    try {
      const logEntry = JSON.stringify({
        ...record,
        timestamp: new Date().toISOString()
      }) + '\n';

      fs.appendFileSync(LOG_FILE, logEntry);
    } catch (err) {
      console.warn('Failed to log blocked image:', err);
    }
  }

  // Extract domain from URL for pattern analysis
  static extractDomain(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      return 'unknown';
    }
  }

  // Extract museum name from URL patterns
  static extractMuseum(url: string): string | undefined {
    const domain = this.extractDomain(url);

    // Common museum domains
    if (domain.includes('metmuseum.org')) return 'Metropolitan Museum';
    if (domain.includes('getty.edu')) return 'J. Paul Getty Museum';
    if (domain.includes('nga.gov')) return 'National Gallery of Art';
    if (domain.includes('artic.edu')) return 'Art Institute of Chicago';
    if (domain.includes('musee-orsay.fr')) return 'Musée d\'Orsay';
    if (domain.includes('louvre.fr')) return 'Louvre';
    if (domain.includes('hermitage.org')) return 'Hermitage Museum';
    if (domain.includes('rijksmuseum.nl')) return 'Rijksmuseum';
    if (domain.includes('googleusercontent.com') || domain.includes('ggpht.com')) return 'Google Art Project';
    if (domain.includes('wikimedia.org')) return 'Wikimedia Commons';

    return undefined;
  }

  // Analyze patterns from logged data
  analyzePatterns(): void {
    try {
      const logData = fs.readFileSync(LOG_FILE, 'utf8');
      const records: BlockedImageRecord[] = logData
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line));

      console.log('\n🔍 BLOCKED IMAGES ANALYSIS');
      console.log('=' .repeat(50));

      // By museum
      const byMuseum = records.reduce((acc, record) => {
        const museum = record.museum || 'Unknown';
        acc[museum] = (acc[museum] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      console.log('\n🏛️  BLOCKS BY MUSEUM/SOURCE:');
      Object.entries(byMuseum)
        .sort(([,a], [,b]) => b - a)
        .forEach(([museum, count]) => {
          console.log(`  ${museum}: ${count} blocks`);
        });

      // By error type
      const byError = records.reduce((acc, record) => {
        const errorType = record.error.includes('429') ? 'Rate Limited (429)' : 'Other';
        acc[errorType] = (acc[errorType] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      console.log('\n❌ BLOCKS BY ERROR TYPE:');
      Object.entries(byError).forEach(([error, count]) => {
        console.log(`  ${error}: ${count} blocks`);
      });

      // By artist
      const byArtist = records.reduce((acc, record) => {
        acc[record.artist] = (acc[record.artist] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      console.log('\n🎨 BLOCKS BY ARTIST (top 10):');
      Object.entries(byArtist)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10)
        .forEach(([artist, count]) => {
          console.log(`  ${artist}: ${count} blocks`);
        });

      console.log(`\n📊 TOTAL BLOCKED IMAGES LOGGED: ${records.length}`);
      console.log('=' .repeat(50));

    } catch (err) {
      console.log('No blocked images log found or analysis failed');
    }
  }
}
