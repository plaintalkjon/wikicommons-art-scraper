#!/usr/bin/env node
/**
 * Google Arts CSV Scraper
 * Scrapes metadata from Google Arts & Culture pages and saves to CSV
 *
 * Usage:
 *   npm run googlearts-scrape -- --csv downloads/GoogleImages.csv --output scraped-metadata.csv [--concurrency 3] [--resume]
 */

import { parseArgs } from './utils';
import { parseGoogleArtsCSV } from './googlearts';
import axios from 'axios';
import axiosRetry from 'axios-retry';
import * as cheerio from 'cheerio';
import pLimit from 'p-limit';
import * as fs from 'fs';
import * as path from 'path';
import { stringify } from 'csv-stringify/sync';

// Configure axios retry with exponential backoff
axiosRetry(axios, {
  retries: 5,
  retryDelay: (retryCount) => {
    const delay = Math.pow(2, retryCount) * 5000; // 10s, 20s, 40s, 80s, 160s
    console.log(`  🔄 Retry ${retryCount}/5 in ${delay/1000}s...`);
    return delay;
  },
  retryCondition: (error) => {
    // Retry on 429 (rate limit) and 5xx server errors
    return (error.response?.status === 429) ||
           (error.response?.status && error.response.status >= 500 && error.response.status < 600) ||
           error.code === 'ECONNRESET' ||
           error.code === 'ETIMEDOUT';
  }
});

// User agents for rotation
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

// Extract metadata directly from Google Arts URL patterns
function extractMetadataFromUrl(url: string): { title?: string; artist?: string; extractedFrom: string } {
  try {
    // Extract from URL path: /asset/{title}-{artist}/{id}
    const pathMatch = url.match(/\/asset\/([^\/]+)\//);
    if (!pathMatch) {
      return { extractedFrom: 'none' };
    }

    const slug = pathMatch[1];
    console.log(`  🔍 Analyzing URL slug: "${slug}"`);

    // Split by hyphens and decode URL encoding
    let words = decodeURIComponent(slug).split('-').filter(word => word.length > 0);

    // Remove common non-content words from the end
    const stopWords = ['painting', 'portrait', 'drawing', 'sculpture', 'photograph', 'print', 'etching', 'artwork', 'image', 'picture'];
    while (words.length > 0 && stopWords.includes(words[words.length - 1].toLowerCase())) {
      words.pop();
    }

    if (words.length < 2) {
      console.log(`  ❌ Slug too short: ${words.length} words`);
      return { extractedFrom: 'none' };
    }

    // Strategy 1: Look for artist patterns at the end (most common)
    // Artists often have 1-3 capitalized words at the end
    let artistWords: string[] = [];
    let titleWords: string[] = [...words];

    // More conservative artist detection
    // Look for patterns where we have 1-2 capitalized words at the end that look like names
    const potentialArtistWords = [];

    // Check last 1-2 words for artist pattern
    for (let i = words.length - 1; i >= Math.max(0, words.length - 2); i--) {
      const word = words[i];

      // Stop if word is too short or is a stop word
      if (word.length < 2) break;
      if (['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from'].includes(word.toLowerCase())) break;

      // Must be capitalized or contain known name prefixes
      const isNameLike = (
        /^[A-Z]/.test(word) ||
        word.toLowerCase().includes('van') ||
        word.toLowerCase().includes('der') ||
        word.toLowerCase().includes('de') ||
        word.toLowerCase().includes('von') ||
        word.toLowerCase().includes('di') ||
        word.toLowerCase().includes('da')
      );

      if (isNameLike) {
        potentialArtistWords.unshift(word);
      } else {
        break;
      }
    }

    // Only use as artist if we found 1-2 name-like words
    if (potentialArtistWords.length >= 1 && potentialArtistWords.length <= 2) {
      artistWords = potentialArtistWords;
      titleWords = words.slice(0, words.length - artistWords.length);
    }

    // If we didn't find any artist words, try known artist detection
    if (artistWords.length === 0) {
      const slugLower = slug.toLowerCase();

      // Known artists with their URL patterns (expanded list)
      const knownArtistPatterns = [
        // Famous artists
        { name: 'chagall', urlPattern: 'marc-chagall', fullName: 'Marc Chagall' },
        { name: 'chagall', urlPattern: 'chagall', fullName: 'Marc Chagall' },
        { name: 'picasso', urlPattern: 'pablo-picasso', fullName: 'Pablo Picasso' },
        { name: 'picasso', urlPattern: 'picasso', fullName: 'Pablo Picasso' },
        { name: 'monet', urlPattern: 'claude-monet', fullName: 'Claude Monet' },
        { name: 'monet', urlPattern: 'monet', fullName: 'Claude Monet' },
        { name: 'van gogh', urlPattern: 'vincent-van-gogh', fullName: 'Vincent van Gogh' },
        { name: 'van gogh', urlPattern: 'van-gogh', fullName: 'Vincent van Gogh' },
        { name: 'rembrandt', urlPattern: 'rembrandt', fullName: 'Rembrandt' },
        { name: 'da vinci', urlPattern: 'leonardo-da-vinci', fullName: 'Leonardo da Vinci' },
        { name: 'da vinci', urlPattern: 'da-vinci', fullName: 'Leonardo da Vinci' },
        { name: 'michelangelo', urlPattern: 'michelangelo', fullName: 'Michelangelo' },

        // More famous artists
        { name: 'cezanne', urlPattern: 'paul-cezanne', fullName: 'Paul Cézanne' },
        { name: 'cezanne', urlPattern: 'cezanne', fullName: 'Paul Cézanne' },
        { name: 'matisse', urlPattern: 'henri-matisse', fullName: 'Henri Matisse' },
        { name: 'matisse', urlPattern: 'matisse', fullName: 'Henri Matisse' },
        { name: 'kandinsky', urlPattern: 'wassily-kandinsky', fullName: 'Wassily Kandinsky' },
        { name: 'kandinsky', urlPattern: 'kandinsky', fullName: 'Wassily Kandinsky' },
        { name: 'munch', urlPattern: 'edvard-munch', fullName: 'Edvard Munch' },
        { name: 'munch', urlPattern: 'munch', fullName: 'Edvard Munch' },
        { name: 'warhol', urlPattern: 'andy-warhol', fullName: 'Andy Warhol' },
        { name: 'warhol', urlPattern: 'warhol', fullName: 'Andy Warhol' },
        { name: 'dali', urlPattern: 'salvador-dali', fullName: 'Salvador Dalí' },
        { name: 'dali', urlPattern: 'dali', fullName: 'Salvador Dalí' },
        { name: 'magritte', urlPattern: 'rene-magritte', fullName: 'René Magritte' },
        { name: 'magritte', urlPattern: 'magritte', fullName: 'René Magritte' },

        // Renaissance artists
        { name: 'raphael', urlPattern: 'raphael', fullName: 'Raphael' },
        { name: 'titian', urlPattern: 'titian', fullName: 'Titian' },
        { name: 'vermeer', urlPattern: 'johannes-vermeer', fullName: 'Johannes Vermeer' },
        { name: 'vermeer', urlPattern: 'vermeer', fullName: 'Johannes Vermeer' },
        { name: 'rubens', urlPattern: 'peter-paul-rubens', fullName: 'Peter Paul Rubens' },
        { name: 'rubens', urlPattern: 'rubens', fullName: 'Peter Paul Rubens' },

        // Impressionists
        { name: 'renoir', urlPattern: 'pierre-auguste-renoir', fullName: 'Pierre-Auguste Renoir' },
        { name: 'renoir', urlPattern: 'renoir', fullName: 'Pierre-Auguste Renoir' },
        { name: 'degas', urlPattern: 'edgar-degas', fullName: 'Edgar Degas' },
        { name: 'degas', urlPattern: 'degas', fullName: 'Edgar Degas' },
        { name: 'manet', urlPattern: 'edouard-manet', fullName: 'Édouard Manet' },
        { name: 'manet', urlPattern: 'manet', fullName: 'Édouard Manet' },

        // Modern artists
        { name: 'pollock', urlPattern: 'jackson-pollock', fullName: 'Jackson Pollock' },
        { name: 'pollock', urlPattern: 'pollock', fullName: 'Jackson Pollock' },
        { name: 'rothko', urlPattern: 'mark-rothko', fullName: 'Mark Rothko' },
        { name: 'rothko', urlPattern: 'rothko', fullName: 'Mark Rothko' },
        { name: 'klimt', urlPattern: 'gustav-klimt', fullName: 'Gustav Klimt' },
        { name: 'klimt', urlPattern: 'klimt', fullName: 'Gustav Klimt' },
      ];

      for (const artist of knownArtistPatterns) {
        if (slugLower.includes(artist.urlPattern)) {
          const artistIndex = slugLower.indexOf(artist.urlPattern);
          const beforeArtist = slug.substring(0, artistIndex).replace(/-$/, '');

          if (beforeArtist) {
            titleWords = beforeArtist.split('-').filter(w => w.length > 0);
          }
          artistWords = [artist.fullName]; // Use the full proper name
          break;
        }
      }
    }

    // Process the results
    let artist = '';
    let title = '';

    if (artistWords.length > 0) {
      artist = artistWords
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');

      // Fix common name capitalizations
      artist = artist.replace(/\bVan\b/g, 'van');
      artist = artist.replace(/\bDer\b/g, 'der');
      artist = artist.replace(/\bDe\b/g, 'de');
      artist = artist.replace(/\bDi\b/g, 'di');
      artist = artist.replace(/\bDa\b/g, 'da');
      artist = artist.replace(/\bVon\b/g, 'von');
    }

    if (titleWords.length > 0) {
      title = titleWords
        .map(word => {
          // Handle special cases
          if (word.toLowerCase() === 'and') return 'and';
          if (word.toLowerCase() === 'the') return 'the';
          if (word.toLowerCase() === 'of') return 'of';
          return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        })
        .join(' ');

      // Clean up common prefixes
      title = title.replace(/^The\s+/i, 'The ');
      title = title.replace(/^And\s+/i, 'And ');
    }

    const result = {
      title: title || undefined,
      artist: artist || undefined,
      extractedFrom: 'url'
    };

    if (result.title && result.artist) {
      console.log(`  ✅ Extracted: "${result.title}" by ${result.artist}`);
    } else {
      console.log(`  ⚠️  Partial extraction: title="${result.title}" artist="${result.artist}"`);
    }

    return result;

  } catch (error) {
    console.log(`  ❌ URL extraction error: ${error}`);
    return { extractedFrom: 'error' };
  }
}

let userAgentIndex = 0;

function getNextUserAgent(): string {
  const userAgent = USER_AGENTS[userAgentIndex];
  userAgentIndex = (userAgentIndex + 1) % USER_AGENTS.length;
  return userAgent;
}

// Google Search fallback for metadata extraction
async function searchGoogleForMetadata(url: string): Promise<{ title?: string; artist?: string; description?: string; date?: string; medium?: string; dimensions?: string; museum?: string }> {
  try {
    console.log(`  🔍 Searching Google for metadata...`);

    // Search Google for the URL to get metadata from search snippets
    const searchQuery = encodeURIComponent(`"${url}"`);
    const searchUrl = `https://www.google.com/search?q=${searchQuery}&num=5`;

    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent': getNextUserAgent(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
      },
      timeout: 10000
    });

    const $ = cheerio.load(response.data);

    // Extract metadata from search result snippets
    let metadata: any = {};

    // Look for structured data in search results
    $('div.g, div[data-ved]').each((_, element) => {
      const text = $(element).text();

      // Look for patterns like "Title: ... Creator: ... Date Created: ..."
      const titleMatch = text.match(/Title:\s*([^,\n]+)/i);
      if (titleMatch && titleMatch[1] && !metadata.title) {
        metadata.title = titleMatch[1].trim();
      }

      const creatorMatch = text.match(/Creator:\s*([^,\n]+)/i);
      if (creatorMatch && creatorMatch[1] && !metadata.artist) {
        metadata.artist = creatorMatch[1].trim();
      }

      const dateMatch = text.match(/Date Created:\s*([^,\n]+)/i);
      if (dateMatch && dateMatch[1] && !metadata.date) {
        metadata.date = dateMatch[1].trim();
      }

      const dimensionsMatch = text.match(/Physical Dimensions:\s*([^,\n]+)/i);
      if (dimensionsMatch && dimensionsMatch[1] && !metadata.dimensions) {
        metadata.dimensions = dimensionsMatch[1].trim();
      }
    });

    if (Object.keys(metadata).length > 0) {
      console.log(`  📊 Google search found: ${Object.keys(metadata).join(', ')}`);
    }

    return metadata;

  } catch (error: any) {
    // Don't fail completely on Google search errors - just return empty metadata
    console.log(`  ⚠️ Google search failed (continuing): ${error.message}`);
    return {};
  }
}

interface ScrapedMetadata {
  url: string;
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  filename: string;
  title?: string;
  artist?: string;
  tags?: string;
  description?: string;
  date?: string;
  medium?: string;
  dimensions?: string;
  museum?: string;
  scraped_at: string;
  error?: string;
}

async function scrapeGoogleArtsMetadata(url: string): Promise<Omit<ScrapedMetadata, 'url' | 'filename' | 'scraped_at'>> {
  // Step 1: Extract basic metadata from URL (most reliable, no network calls)
  const urlMetadata = extractMetadataFromUrl(url);

  if (urlMetadata.title && urlMetadata.artist) {
    console.log(`  🔗 URL extracted: "${urlMetadata.title}" by ${urlMetadata.artist}`);
    return {
      status: 'SUCCESS',
      title: urlMetadata.title,
      artist: urlMetadata.artist,
      tags: '',
      description: '',
      date: '',
      medium: '',
      dimensions: '',
      museum: ''
    };
  }

  // Step 2: Google Search fallback (your original idea!)
  console.log(`  🔍 URL extraction failed, trying Google search...`);
  const googleMetadata = await searchGoogleForMetadata(url);

  if (googleMetadata.title && googleMetadata.artist) {
    console.log(`  🌐 Google search found: "${googleMetadata.title}" by ${googleMetadata.artist}`);
    return {
      status: 'SUCCESS',
      title: googleMetadata.title,
      artist: googleMetadata.artist,
      tags: '',
      description: googleMetadata.description || '',
      date: googleMetadata.date || '',
      medium: googleMetadata.medium || '',
      dimensions: googleMetadata.dimensions || '',
      museum: googleMetadata.museum || ''
    };
  }

  // Step 3: Final fallback to web scraping if both URL and Google search fail
  console.log(`  🌐 Google search failed, trying direct web scrape...`);
  try {
    const userAgent = getNextUserAgent();
    console.log(`  🌐 Using User-Agent: ${userAgent.split(' ').slice(0, 3).join(' ')}...`);

    const response = await axios.get(url, {
      timeout: 30000, // 30 second timeout (axios-retry will handle retries)
      headers: {
        'User-Agent': userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });

    const $ = cheerio.load(response.data);

    // Extract metadata using Cheerio selectors
    const metadata = extractMetadataWithCheerio($);

    return {
      status: 'SUCCESS',
      ...metadata
    };

  } catch (error: any) {
    return {
      status: 'FAILED',
      error: `All extraction methods failed: ${error.message || error.code || 'Unknown error'}`
    };
  }
}

function extractMetadataWithCheerio($: cheerio.CheerioAPI) {
  // Title extraction - multiple fallbacks
  let title = '';
  const titleSelectors = [
    'h1',
    '.title',
    'title',
    'meta[property="og:title"]',
    'meta[name="title"]',
    // Look for structured data
    'script[type="application/ld+json"]'
  ];

  for (const selector of titleSelectors) {
    if (selector === 'script[type="application/ld+json"]') {
      // Try to extract from JSON-LD
      $('script[type="application/ld+json"]').each((_, element) => {
        try {
          const jsonData = JSON.parse($(element).html() || '{}');
          if (jsonData.name) {
            title = jsonData.name;
            return false;
          }
        } catch (e) {
          // Ignore JSON parse errors
        }
      });
    } else if (selector.startsWith('meta')) {
      const content = $(selector).attr('content');
      if (content && content.trim()) {
        title = content.trim();
        break;
      }
    } else {
      const text = $(selector).first().text().trim();
      if (text) {
        title = text;
        break;
      }
    }
  }

  // Clean up Google Arts prefixes
  title = title.replace(/^Google Arts & Culture\s*-\s*/i, '');
  title = title.replace(/\s*\|\s*Google Arts & Culture$/i, '');

  // Artist extraction
  let artist = '';

  // First priority: entity links (most reliable)
  $('a[href*="categoryId=artist"]').each((_, element) => {
    const href = $(element).attr('href');
    if (href && href.includes('/entity/')) {
      const match = href.match(/\/entity\/([^\/]+)/);
      if (match && match[1]) {
        // Convert slug to title case
        artist = match[1]
          .split('-')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join(' ');
        return false; // Break out of each loop
      }
    }
  });

  // Fallback artist selectors
  if (!artist) {
    const artistSelectors = [
      'meta[name="author"]',
      'meta[property="article:author"]',
      '.artist',
      '[data-artist]',
      // Look for common patterns in text
      'span:contains("by ")',
      'p:contains("by ")'
    ];

    for (const selector of artistSelectors) {
      if (selector.includes('meta')) {
        const content = $(selector).attr('content');
        if (content && content.trim()) {
          artist = content.trim();
          break;
        }
      } else {
        const text = $(selector).first().text().trim();
        if (text) {
          // Extract artist name from "by Artist Name" patterns
          const byMatch = text.match(/by\s+([^,\n]{3,50}?)(?:\s*[,\.\|\-\(\)]|$)/i);
          if (byMatch) {
            artist = byMatch[1].trim();
          } else {
            artist = text;
          }
          break;
        }
      }
    }
  }

  // Description
  let description = '';
  const descSelectors = [
    'meta[name="description"]',
    'meta[property="og:description"]',
    'meta[name="twitter:description"]',
    // Look for description in structured content
    '.description',
    '[data-description]',
    'p:contains("Description")'
  ];

  for (const selector of descSelectors) {
    if (selector.includes('meta')) {
      const content = $(selector).attr('content');
      if (content && content.trim() && content.length > 20) {
        description = content.trim();
        break;
      }
    } else {
      const text = $(selector).first().text().trim();
      if (text && text.length > 20) {
        description = text;
        break;
      }
    }
  }

  // Tags - look for various categorization elements
  const tags: string[] = [];
  const tagSelectors = [
    '.tag',
    '.category',
    '.genre',
    '[data-category]',
    '.style',
    '.movement'
  ];

  tagSelectors.forEach(selector => {
    $(selector).each((_, element) => {
      const tag = $(element).text().trim();
      if (tag && tag.length < 50 && tag.length > 2) {
        tags.push(tag);
      }
    });
  });

  // Date/Period
  let date = '';
  const dateSelectors = [
    'meta[property="article:published_time"]',
    'time',
    '.date',
    '[data-date]',
    '.year',
    '.period'
  ];

  for (const selector of dateSelectors) {
    if (selector.includes('meta')) {
      const content = $(selector).attr('content');
      if (content) {
        // Extract just the year if it's a full date
        const yearMatch = content.match(/(\d{4})/);
        if (yearMatch) {
          date = yearMatch[1];
        } else {
          date = content;
        }
        break;
      }
    } else {
      const text = $(selector).first().text().trim();
      if (text) {
        // Look for year patterns
        const yearMatch = text.match(/(\d{4})/);
        if (yearMatch) {
          date = yearMatch[1];
        } else if (/^\d{4}/.test(text)) {
          date = text;
        }
        if (date) break;
      }
    }
  }

  // Medium/Material
  let medium = '';
  const mediumSelectors = [
    '.medium',
    '.material',
    '[data-medium]',
    '.technique',
    '.support'
  ];

  for (const selector of mediumSelectors) {
    const text = $(selector).first().text().trim();
    if (text && text.length > 3) {
      medium = text;
      break;
    }
  }

  // Dimensions
  let dimensions = '';
  const dimensionSelectors = [
    '.dimensions',
    '.size',
    '[data-dimensions]',
    '.measurements'
  ];

  for (const selector of dimensionSelectors) {
    const text = $(selector).first().text().trim();
    if (text && /\d/.test(text)) { // Must contain numbers
      dimensions = text;
      break;
    }
  }

  // Museum/Institution
  let museum = '';
  const museumSelectors = [
    '.museum',
    '.institution',
    '.collection',
    '[data-museum]',
    '.credit',
    '.provenance'
  ];

  for (const selector of museumSelectors) {
    const text = $(selector).first().text().trim();
    if (text && text.length > 5) {
      museum = text;
      break;
    }
  }

  return {
    title,
    artist,
    tags: tags.join('; '),
    description,
    date,
    medium,
    dimensions,
    museum
  };
}

async function main() {
  const args = parseArgs();
  const csvPath = args.csv as string;
  const outputPath = (args.output as string) || 'scraped-metadata.csv';
  const concurrency = parseInt(args.concurrency as string) || 1;
  const limit = args.limit ? parseInt(args.limit as string, 10) : undefined;
  const resume = Boolean(args.resume ?? false);

  if (!csvPath) {
    console.error('Usage: npm run googlearts-scrape -- --csv <input-csv> --output <output-csv> [--concurrency 3] [--resume]');
    process.exit(1);
  }

  console.log('🔄 Google Arts Metadata Scraper');
  console.log(`📁 Input CSV: ${csvPath}`);
  console.log(`📤 Output CSV: ${outputPath}`);
  console.log(`⚡ Concurrency: ${concurrency}`);
  console.log(`🔄 Resume Mode: ${resume}`);
  console.log(`🎯 Tier 1: URL pattern extraction (instant, no network)`);
  console.log(`🔍 Tier 2: Google search snippets (your original idea!)`);
  console.log(`🌐 Tier 3: Direct web scraping (axios-retry + user-agent rotation)`);
  console.log('');

  // Load existing results if resuming
  let existingResults: Map<string, ScrapedMetadata> = new Map();
  if (resume && fs.existsSync(outputPath)) {
    console.log('📖 Loading existing results for resume...');
    const existingCsv = fs.readFileSync(outputPath, 'utf-8');
    const records = existingCsv.split('\n').slice(1).filter(line => line.trim());

    for (const line of records) {
      try {
        const record = JSON.parse('[' + line.split(',').map(field => `"${field.replace(/"/g, '\\"')}"`).join(',') + ']');
        // This is a simplified parse - in production you'd want proper CSV parsing
        const [url, status, filename, title, artist, tags, description, date, medium, dimensions, museum, scraped_at, error] = record;
        existingResults.set(url, {
          url, status: status as any, filename, title, artist, tags, description,
          date, medium, dimensions, museum, scraped_at, error
        });
      } catch (e) {
        // Skip malformed lines
      }
    }
    console.log(`📊 Loaded ${existingResults.size} existing results\n`);
  }

  // Parse input CSV
  const records = await parseGoogleArtsCSV(csvPath);
  console.log(`📊 Found ${records.length} artworks to process\n`);

  // Apply limit if specified
  const recordsToProcess = limit ? records.slice(0, limit) : records;
  console.log(`🎯 Will process: ${recordsToProcess.length} artworks\n`);

  // Create concurrency limiter
  const limiter = pLimit(concurrency);

  // Setup CSV output stream
  const csvHeaders = [
    'url', 'status', 'filename', 'title', 'artist', 'tags', 'description',
    'date', 'medium', 'dimensions', 'museum', 'scraped_at', 'error'
  ];

  let csvContent = stringify([csvHeaders], { header: false });
  if (!resume || !fs.existsSync(outputPath)) {
    fs.writeFileSync(outputPath, csvContent);
  } else {
    // Load existing content to append
    csvContent = fs.readFileSync(outputPath, 'utf-8');
  }

  // Process records
  let processed = 0;
  let successful = 0;
  let failed = 0;
  let skipped = 0;

  const startTime = Date.now();

  for (let i = 0; i < recordsToProcess.length; i++) {
    const record = recordsToProcess[i];
    const progress = ((i + 1) / recordsToProcess.length * 100).toFixed(1);

    console.log(`[${i + 1}/${records.length}] ${progress}% Processing: ${record.filename}`);

    // Skip if already processed in resume mode
    if (resume && existingResults.has(record.sourceUrl)) {
      console.log(`  ⏭️  Already processed: ${record.filename}`);
      skipped++;
      continue;
    }

    try {
      // Create limited promise for scraping
      const result = await limiter(async () => {
        const scrapedData = await scrapeGoogleArtsMetadata(record.sourceUrl);
        return {
          url: record.sourceUrl,
          filename: record.filename,
          scraped_at: new Date().toISOString(),
          ...scrapedData
        } as ScrapedMetadata;
      });

      // Append to CSV
      const csvRow = [
        result.url,
        result.status,
        result.filename,
        result.title || '',
        result.artist || '',
        result.tags || '',
        result.description || '',
        result.date || '',
        result.medium || '',
        result.dimensions || '',
        result.museum || '',
        result.scraped_at,
        result.error || ''
      ];

      const csvLine = stringify([csvRow], { header: false });
      fs.appendFileSync(outputPath, csvLine);

      if (result.status === 'SUCCESS') {
        console.log(`  ✅ Scraped: "${result.title}" by ${result.artist || 'Unknown'}`);
        successful++;
      } else {
        console.log(`  ❌ Failed: ${result.error}`);
        failed++;
      }

    } catch (error) {
      console.log(`  💥 Error processing ${record.filename}: ${error}`);
      failed++;
    }

    processed++;

    // Progress update every 10 items
    if (processed % 10 === 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = processed / elapsed;
      const eta = ((records.length - i) / rate) / 60;
      console.log(`  📊 Progress: ${processed}/${records.length} (${rate.toFixed(1)} items/sec, ETA: ${eta.toFixed(1)} min)`);
    }

    // Conservative delay between requests to be respectful to Google Arts
    await new Promise(resolve => setTimeout(resolve, 2000)); // 2 seconds between each request
  }

  const totalTime = (Date.now() - startTime) / 1000;
  console.log('\n' + '='.repeat(60));
  console.log('GOOGLE ARTS SCRAPING SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total processed: ${processed}`);
  console.log(`Successful scrapes: ${successful}`);
  console.log(`Failed scrapes: ${failed}`);
  console.log(`Skipped (already done): ${skipped}`);
  console.log(`Total time: ${totalTime.toFixed(1)} seconds`);
  console.log(`Average rate: ${(processed / totalTime).toFixed(1)} items/second`);
  console.log(`Success rate: ${processed > 0 ? ((successful / processed) * 100).toFixed(1) : 0}%`);
  console.log(`\n📊 Results saved to: ${outputPath}`);

  if (successful > 0) {
    console.log('\n🎉 Scraping completed! Ready for upload phase.');
    console.log(`Run: npm run googlearts-upload -- --csv ${outputPath} --images /path/to/images`);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
