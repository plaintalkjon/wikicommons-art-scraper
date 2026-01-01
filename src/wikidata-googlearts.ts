import { rateLimiter } from './rateLimiter';

export interface GoogleArtsWikiDataMatch {
  filename: string;
  googleUrl: string;
  wikiDataItem?: {
    qid: string;
    title: string;
    artist: string;
    description?: string;
    inception?: string;
    genre?: string[];
    materials?: string[];
    location?: string;
    image?: string;
  };
  confidence: 'high' | 'medium' | 'low' | 'none';
  searchTerms: string[];
}

export interface WikiDataArtwork {
  qid: string;
  title: string;
  artist: string;
  description?: string;
  inception?: string;
  genre?: string[];
  materials?: string[];
  location?: string;
  image?: string;
}

/**
 * Extract artist and title information from Google Arts URL
 */
export function extractArtistAndTitle(googleUrl: string): { artist: string; title: string; searchTerms: string[] } {
  let artist = '';
  let title = '';
  const searchTerms: string[] = [];

  // Extract from URL path
  const pathMatch = googleUrl.match(/\/asset\/([^\/]+)\//);
  if (pathMatch) {
    const slug = pathMatch[1];

    // Split by hyphens
    const words = slug.split('-').filter(word => word.length > 0);

    // Look for artist patterns at the end of the URL
    // Common patterns: artist-name, first-last, first-middle-last
    let artistWords: string[] = [];
    let potentialTitleWords: string[] = [...words];

    // Try to identify artist (usually 1-3 capitalized words at the end)
    for (let i = words.length - 1; i >= 0 && artistWords.length < 3; i--) {
      const word = words[i];

      // Skip common non-artist words
      if (['the', 'and', 'for', 'with', 'from', 'this', 'that', 'painting', 'portrait', 'still', 'life'].includes(word.toLowerCase())) {
        continue;
      }

      // Check if it looks like a name (capitalized or known artist pattern)
      if (word.length >= 2 && (
        /^[A-Z]/.test(word) || // Starts with capital
        word.includes('van') || word.includes('der') || word.includes('de') || // Dutch names
        word.includes('di') || word.includes('da') // Italian names
      )) {
        artistWords.unshift(word);
        potentialTitleWords.pop(); // Remove from title words
      } else {
        break; // Stop if we hit a non-name word
      }
    }

    // Process artist name
    if (artistWords.length > 0) {
      artist = artistWords
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
    }

    // Process title (remaining words)
    const stopWords = ['the', 'and', 'for', 'with', 'from', 'this', 'that', 'which', 'where', 'when', 'in', 'on', 'at', 'by', 'of', 'a', 'an', 'painting', 'portrait', 'still', 'life'];
    const titleWords = potentialTitleWords.filter(word =>
      word.length > 1 && !stopWords.includes(word.toLowerCase())
    );

    if (titleWords.length > 0) {
      title = titleWords
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
    }

    // Generate search terms
    searchTerms.push(title);
    if (artist) {
      searchTerms.push(artist);
      searchTerms.push(`${title} ${artist}`);
    }
    searchTerms.push(...titleWords.filter(word => word.length > 3));
    searchTerms.push(...artistWords.filter(word => word.length > 2));
  }

  return { artist, title, searchTerms: [...new Set(searchTerms)] };
}

/**
 * Extract search terms from Google Arts URL
 */
export function extractSearchTerms(googleUrl: string): string[] {
  const terms: string[] = [];

  // Extract from URL path
  const pathMatch = googleUrl.match(/\/asset\/([^\/]+)\//);
  if (pathMatch) {
    const slug = pathMatch[1];

    // Split by hyphens and process
    const words = slug.split('-').filter(word => word.length > 0);

    // Try to identify artist name (usually at the end, often multiple words)
    let artistWords: string[] = [];
    let titleWords: string[] = [];

    // Common artist name patterns in Google Arts URLs
    // Artists often appear as: firstname-lastname or firstname-middlename-lastname
    for (let i = words.length - 1; i >= 0; i--) {
      const word = words[i];
      if (word.length >= 3 && /^[A-Z]/.test(word.charAt(0).toUpperCase() + word.slice(1))) {
        // Looks like a proper name
        artistWords.unshift(word);
        if (artistWords.length >= 2) break; // Take up to 2 potential artist name parts
      } else {
        break; // Stop when we hit non-name words
      }
    }

    // Remaining words are likely title
    titleWords = words.slice(0, words.length - artistWords.length);

    // Filter out common stop words from title
    const stopWords = ['the', 'and', 'for', 'with', 'from', 'this', 'that', 'which', 'where', 'when', 'in', 'on', 'at', 'by', 'of'];
    titleWords = titleWords.filter(word => !stopWords.includes(word.toLowerCase()));

    // Convert to title case
    const titleCasedTitle = titleWords.map(word =>
      word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    );
    const titleCasedArtist = artistWords.map(word =>
      word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    );

    // Full title with artist
    if (titleCasedTitle.length > 0) {
      const fullTitle = titleCasedTitle.join(' ');
      terms.push(fullTitle);

      // Add with artist if we found one
      if (titleCasedArtist.length > 0) {
        terms.push(`${fullTitle} ${titleCasedArtist.join(' ')}`);
      }
    }

    // Artist name separately
    if (titleCasedArtist.length > 0) {
      terms.push(titleCasedArtist.join(' '));
    }

    // Individual significant words
    terms.push(...titleCasedTitle.filter(word => word.length > 3));
    terms.push(...titleCasedArtist.filter(word => word.length > 3));
  }

  return [...new Set(terms)]; // Remove duplicates
}

/**
 * Known artwork mappings from Google Arts URL slugs to WikiData QIDs
 */
const KNOWN_ARTWORK_MAPPINGS: Record<string, string> = {
  // URL slug -> QID
  'the-lovers-marc-chagall': 'Q4311775', // Marc Chagall's "The Lovers"
  'mona-lisa': 'Q12418',
  'the-starry-night': 'Q45585',
  'girl-with-a-pearl-earring': 'Q185372',
  'the-scream': 'Q207025',
  'guernica': 'Q175036',
  'the-persistence-of-memory': 'Q207223',
  'american-gothic': 'Q497402',
  'the-great-wave-off-kanagawa': 'Q169313'
};

/**
 * Known artwork QIDs for famous paintings (fallback search)
 */
const KNOWN_ARTWORKS: Record<string, string> = {
  'lovers marc chagall': 'Q4311775', // Marc Chagall's "The Lovers"
  'symphony white no 1 white girl': 'Q2704554', // Whistler's "Symphony in White"
  'mona lisa': 'Q12418',
  'the starry night': 'Q45585',
  'girl with a pearl earring': 'Q185372',
  'the scream': 'Q207025',
  'guernica': 'Q175036',
  'the persistence of memory': 'Q207223',
  'american gothic': 'Q497402',
  'the great wave off kanagawa': 'Q169313'
};

/**
 * Query WikiData for artwork information using search API
 */
/**
 * Find artist WikiData QID by name
 */
async function findArtistQID(artistName: string): Promise<string | null> {
  if (!artistName) return null;

  const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(artistName)}&language=en&type=item&limit=5&format=json`;

  try {
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'WikiCommons-Art-Scraper/1.0 (https://github.com/plaintalkjon/wikicommons-art-scraper)'
      }
    });

    if (!response.ok) return null;

    const data = await response.json();
    const searchResults = data.search || [];

    // Look for artist results (painters, sculptors, etc.)
    for (const result of searchResults) {
      const qid = result.id;
      const description = result.description || '';

      // Check if this is likely an artist
      if (description.toLowerCase().includes('artist') ||
          description.toLowerCase().includes('painter') ||
          description.toLowerCase().includes('sculptor') ||
          description.toLowerCase().includes('photographer')) {
        return qid;
      }
    }

    // If no clear artist found, return the first result
    return searchResults.length > 0 ? searchResults[0].id : null;

  } catch (error) {
    console.log(`  ⚠️ Error finding artist QID for ${artistName}: ${error}`);
    return null;
  }
}

/**
 * Search for paintings by a specific artist
 */
async function searchPaintingsByArtist(artistQID: string, titleQuery: string): Promise<WikiDataArtwork[]> {
  const query = `
    SELECT DISTINCT ?item ?itemLabel ?description ?inception ?genreLabel ?materialLabel ?locationLabel ?image WHERE {
      ?item wdt:P31 wd:Q3305213.  # instance of painting
      ?item wdt:P170 wd:${artistQID}.  # created by this artist

      # Title matching (if we have a title to match)
      ${titleQuery ? `?item wdt:P1476 ?title. FILTER(CONTAINS(LCASE(?title), LCASE("${titleQuery.replace(/"/g, '\\"')}")))` : ''}

      SERVICE wikibase:label {
        bd:serviceParam wikibase:language "[AUTO_LANGUAGE],en".
        ?genre rdfs:label ?genreLabel.
        ?material rdfs:label ?materialLabel.
        ?location rdfs:label ?locationLabel.
      }

      OPTIONAL { ?item schema:description ?description. FILTER(LANG(?description) = "en") }
      OPTIONAL { ?item wdt:P571 ?inception. }
      OPTIONAL { ?item wdt:P136 ?genre. }
      OPTIONAL { ?item wdt:P186 ?material. }
      OPTIONAL { ?item wdt:P276 ?location. }
      OPTIONAL { ?item wdt:P18 ?image. }
    }
    ORDER BY DESC(?inception)
    LIMIT 10
  `;

  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'WikiCommons-Art-Scraper/1.0 (https://github.com/plaintalkjon/wikicommons-art-scraper)',
        'Accept': 'application/json'
      }
    });

    if (!response.ok) return [];

    const data = await response.json();
    const bindings = data.results?.bindings || [];

    return bindings.map((binding: any) => ({
      qid: binding.item?.value?.split('/').pop() || '',
      title: binding.itemLabel?.value || '',
      artist: '', // Will be filled from artist QID
      description: binding.description?.value || undefined,
      inception: binding.inception?.value || undefined,
      genre: binding.genreLabel?.value ? [binding.genreLabel.value] : undefined,
      materials: binding.materialLabel?.value ? [binding.materialLabel.value] : undefined,
      location: binding.locationLabel?.value || undefined,
      image: binding.image?.value || undefined
    }));

  } catch (error) {
    console.log(`  ⚠️ Error searching paintings by artist ${artistQID}: ${error}`);
    return [];
  }
}

/**
 * Query WikiData for artwork information using artist-first approach
 */
export async function queryWikiDataArtwork(searchTerms: string[], googleUrl: string): Promise<WikiDataArtwork[]> {
  await rateLimiter.waitIfNeeded();

  try {
    const artworks: WikiDataArtwork[] = [];

    // Strategy 0: Check URL slug mapping first
    const urlSlugMatch = googleUrl.match(/\/asset\/([^\/]+)\//);
    if (urlSlugMatch) {
      const urlSlug = urlSlugMatch[1];
      if (KNOWN_ARTWORK_MAPPINGS[urlSlug]) {
        const artwork = await getWikiDataEntityDetails(KNOWN_ARTWORK_MAPPINGS[urlSlug]);
        if (artwork) {
          console.log(`  📚 Found mapped artwork: ${artwork.title}`);
          return [artwork];
        }
      }
    }

    // Extract artist and title from URL
    const { artist, title } = extractArtistAndTitle(googleUrl);
    console.log(`  🎨 Extracted - Artist: "${artist}", Title: "${title}"`);

    // Strategy 1: Artist-first approach (most reliable)
    if (artist) {
      const artistQID = await findArtistQID(artist);
      if (artistQID) {
        console.log(`  👨‍🎨 Found artist QID: ${artistQID} (${artist})`);

        // Get artist's name from WikiData
        const artistEntity = await getWikiDataEntityDetails(artistQID);
        const artistName = artistEntity?.title || artist;

        // Search for paintings by this artist
        const artistPaintings = await searchPaintingsByArtist(artistQID, title);
        if (artistPaintings.length > 0) {
          // Add artist name to results
          artistPaintings.forEach(painting => {
            painting.artist = artistName;
          });
          artworks.push(...artistPaintings);
          console.log(`  🎨 Found ${artistPaintings.length} paintings by ${artistName}`);
          return artworks;
        }
      }
    }

    // Strategy 2: Check known artworks by search terms
    const fullTitle = searchTerms[0].toLowerCase();
    if (KNOWN_ARTWORKS[fullTitle]) {
      const artwork = await getWikiDataEntityDetails(KNOWN_ARTWORKS[fullTitle]);
      if (artwork) {
        console.log(`  📚 Found known artwork: ${artwork.title}`);
        return [artwork];
      }
    }

    // Strategy 3: Fallback to general search
    const results = await searchWikiData(title || searchTerms[0]);
    artworks.push(...results);

    if (results.length > 0) {
      console.log(`  📚 Found ${results.length} WikiData matches for general search`);
      return artworks;
    }

    console.log(`  📚 Found ${artworks.length} WikiData matches total`);
    return artworks;

  } catch (error) {
    console.log(`  ❌ WikiData query error: ${error}`);
    return [];
  }
}

/**
 * Search WikiData using the search API
 */
async function searchWikiData(query: string, filter: string = ''): Promise<WikiDataArtwork[]> {
  const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(query)}&language=en&limit=5&format=json${filter ? `&${filter}` : ''}`;

  console.log(`  🔍 WikiData search: "${query}"`);

  const response = await fetch(searchUrl, {
    headers: {
      'User-Agent': 'WikiCommons-Art-Scraper/1.0 (https://github.com/plaintalkjon/wikicommons-art-scraper)'
    }
  });

  if (!response.ok) {
    console.log(`  ⚠️ WikiData search failed: ${response.status}`);
    return [];
  }

  const data = await response.json();
  const searchResults = data.search || [];

  console.log(`  📊 Raw search results: ${searchResults.length}`);
  searchResults.forEach((r: any, i: number) => {
    console.log(`    ${i + 1}. ${r.label} (${r.id}) - ${r.description || 'no desc'}`);
  });

  // Get detailed information for each result and filter for paintings
  const detailedArtworks: WikiDataArtwork[] = [];

  for (const result of searchResults) {
    const qid = result.id;
    const artwork = await getWikiDataEntityDetails(qid);
    if (artwork && isPainting(artwork)) {
      detailedArtworks.push(artwork);
    }
    // Small delay to be respectful
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  return detailedArtworks;
}

/**
 * Check if a WikiData item is a painting
 */
function isPainting(artwork: WikiDataArtwork): boolean {
  // Check if it has painting-related properties
  return !!(
    artwork.title &&
    artwork.artist &&
    (artwork.genre?.some(g => g.toLowerCase().includes('painting')) ||
     artwork.materials?.some(m => m.toLowerCase().includes('oil') || m.toLowerCase().includes('canvas')))
  );
}

/**
 * Get detailed information for a WikiData entity
 */
async function getWikiDataEntityDetails(qid: string): Promise<WikiDataArtwork | null> {
  const url = `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'WikiCommons-Art-Scraper/1.0 (https://github.com/plaintalkjon/wikicommons-art-scraper)'
      }
    });

    if (!response.ok) return null;

    const data = await response.json();
    const entity = data.entities[qid];
    if (!entity) return null;

    const claims = entity.claims;

    // Extract basic information
    const title = entity.labels?.en?.value || '';
    const description = entity.descriptions?.en?.value || '';

    // Extract artist
    const artistClaim = claims.P170?.[0];
    const artist = artistClaim?.mainsnak?.datavalue?.value?.['entity-type'] === 'item'
      ? await getEntityLabel(artistClaim.mainsnak.datavalue.value.id)
      : '';

    // Extract inception date
    const inceptionClaim = claims.P571?.[0];
    const inception = inceptionClaim?.mainsnak?.datavalue?.value?.time || '';

    // Extract genre
    const genreClaims = claims.P136 || [];
    const genres: string[] = [];
    for (const claim of genreClaims.slice(0, 2)) {
      if (claim.mainsnak?.datavalue?.value?.id) {
        const genreLabel = await getEntityLabel(claim.mainsnak.datavalue.value.id);
        if (genreLabel) genres.push(genreLabel);
      }
    }

    // Extract materials
    const materialClaims = claims.P186 || [];
    const materials: string[] = [];
    for (const claim of materialClaims.slice(0, 2)) {
      if (claim.mainsnak?.datavalue?.value?.id) {
        const materialLabel = await getEntityLabel(claim.mainsnak.datavalue.value.id);
        if (materialLabel) materials.push(materialLabel);
      }
    }

    // Extract location
    const locationClaim = claims.P276?.[0];
    const location = locationClaim?.mainsnak?.datavalue?.value?.id
      ? await getEntityLabel(locationClaim.mainsnak.datavalue.value.id)
      : '';

    // Extract image
    const imageClaim = claims.P18?.[0];
    const image = imageClaim?.mainsnak?.datavalue?.value || '';

    return {
      qid,
      title,
      artist,
      description: description || undefined,
      inception: inception || undefined,
      genre: genres.length > 0 ? genres : undefined,
      materials: materials.length > 0 ? materials : undefined,
      location: location || undefined,
      image: image || undefined
    };

  } catch (error) {
    console.log(`  ⚠️ Failed to get details for ${qid}: ${error}`);
    return null;
  }
}

/**
 * Get label for a WikiData entity
 */
async function getEntityLabel(qid: string): Promise<string> {
  try {
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=labels&languages=en&format=json`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'WikiCommons-Art-Scraper/1.0 (https://github.com/plaintalkjon/wikicommons-art-scraper)'
      }
    });

    if (!response.ok) return '';

    const data = await response.json();
    return data.entities?.[qid]?.labels?.en?.value || '';
  } catch {
    return '';
  }
}

/**
 * Match Google Arts entry with WikiData
 */
export async function matchGoogleArtsToWikiData(filename: string, googleUrl: string): Promise<GoogleArtsWikiDataMatch> {
  const searchTerms = extractSearchTerms(googleUrl);

  const wikiDataResults = await queryWikiDataArtwork(searchTerms, googleUrl);

  let confidence: 'high' | 'medium' | 'low' | 'none' = 'none';
  let bestMatch: WikiDataArtwork | undefined;

  if (wikiDataResults.length > 0) {
    // Score each result and pick the best
    const scored = wikiDataResults.map(artwork => ({
      artwork,
      score: calculateMatchScore(artwork, searchTerms, googleUrl)
    }));

    scored.sort((a, b) => b.score - a.score);
    bestMatch = scored[0].artwork;

    // Determine confidence based on score
    if (scored[0].score >= 80) confidence = 'high';
    else if (scored[0].score >= 50) confidence = 'medium';
    else if (scored[0].score >= 20) confidence = 'low';
    else confidence = 'none';

    console.log(`  🏆 Best match: "${bestMatch.title}" by ${bestMatch.artist} (score: ${scored[0].score}, confidence: ${confidence})`);
  }

  return {
    filename,
    googleUrl,
    wikiDataItem: bestMatch,
    confidence,
    searchTerms
  };
}

/**
 * Calculate match score between WikiData artwork and search terms
 */
function calculateMatchScore(artwork: WikiDataArtwork, searchTerms: string[], googleUrl: string): number {
  let score = 0;

  // Title matching (highest weight)
  const titleLower = artwork.title.toLowerCase();
  for (const term of searchTerms) {
    if (titleLower.includes(term.toLowerCase())) {
      score += 30; // Strong title match
      break; // Only count once per term type
    }
  }

  // Artist matching (high weight)
  const artistLower = artwork.artist.toLowerCase();
  for (const term of searchTerms) {
    if (artistLower.includes(term.toLowerCase())) {
      score += 25; // Strong artist match
      break;
    }
  }

  // URL slug matching (medium weight)
  const urlSlug = googleUrl.split('/asset/')[1]?.split('/')[0] || '';
  if (urlSlug) {
    const slugWords = urlSlug.split('-');
    for (const word of slugWords) {
      if (word.length > 2) {
        const wordLower = word.toLowerCase();
        if (titleLower.includes(wordLower) || artistLower.includes(wordLower)) {
          score += 15; // URL slug match
          break;
        }
      }
    }
  }

  // Date proximity (lower weight) - prefer older artworks for classic collections
  if (artwork.inception) {
    const yearMatch = artwork.inception.match(/(\d{4})/);
    if (yearMatch) {
      const year = parseInt(yearMatch[1]);
      // Prefer artworks from before 2000 (classic art collections)
      if (year < 1900) score += 10;
      else if (year < 2000) score += 5;
    }
  }

  // Has description (slight bonus)
  if (artwork.description) score += 5;

  // Has image (slight bonus)
  if (artwork.image) score += 5;

  return Math.min(score, 100); // Cap at 100
}

/**
 * Extract tags from WikiData artwork
 */
export function extractWikiDataTags(artwork: WikiDataArtwork): string[] {
  const tags: string[] = [];

  // Basic tags
  tags.push('painting');
  tags.push('wikidata');

  // Genre tags
  if (artwork.genre) {
    tags.push(...artwork.genre.map(g => g.toLowerCase()));
  }

  // Material tags
  if (artwork.materials) {
    tags.push(...artwork.materials.map(m => m.toLowerCase()));
  }

  // Location tags
  if (artwork.location) {
    tags.push(`location:${artwork.location.toLowerCase()}`);
  }

  // Date-based tags
  if (artwork.inception) {
    const yearMatch = artwork.inception.match(/(\d{4})/);
    if (yearMatch) {
      const year = parseInt(yearMatch[1]);
      tags.push(year.toString());

      // Century tags
      if (year >= 1400 && year < 1500) tags.push('15th century');
      else if (year >= 1500 && year < 1600) tags.push('16th century');
      else if (year >= 1600 && year < 1700) tags.push('17th century');
      else if (year >= 1700 && year < 1800) tags.push('18th century');
      else if (year >= 1800 && year < 1900) tags.push('19th century');
      else if (year >= 1900 && year < 2000) tags.push('20th century');
      else if (year >= 2000) tags.push('21st century');
    }
  }

  return [...new Set(tags)]; // Remove duplicates
}

/**
 * Test WikiData API directly
 */
export async function testWikiDataAPI(): Promise<void> {
  console.log('🧪 Testing WikiData API directly...');

  // Test direct search for known artworks
  const testSearches = [
    'the lovers',
    'symphony in white no. 1 the white girl',
    'mona lisa',
    'the starry night'
  ];

  for (const search of testSearches) {
    console.log(`\n🔍 Testing search: "${search}"`);
    const results = await searchWikiData(search);
    console.log(`  📊 Found ${results.length} results:`);

    for (const result of results.slice(0, 2)) {
      console.log(`    - "${result.title}" by ${result.artist} (${result.qid})`);
      if (result.inception) console.log(`      📅 ${result.inception}`);
    }
  }
}

/**
 * Test WikiData matching for a few examples
 */
export async function testWikiDataMatching(): Promise<void> {
  console.log('🧪 Testing WikiData matching...');

  const testCases = [
    {
      filename: '2936.jpg',
      googleUrl: 'https://artsandculture.google.com/asset/the-lovers-marc-chagall/jQEveVgIzd6-Og'
    },
    {
      filename: '1.jpg',
      googleUrl: 'https://artsandculture.google.com/asset/symphony-in-white-no-1-the-white-girl/egEsaSX979J8mw'
    }
  ];

  for (const testCase of testCases) {
    console.log(`\n🎨 Testing: ${testCase.filename}`);
    const match = await matchGoogleArtsToWikiData(testCase.filename, testCase.googleUrl);

    console.log(`  🔍 Search terms: ${match.searchTerms.join(', ')}`);
    console.log(`  🎯 Confidence: ${match.confidence}`);

    if (match.wikiDataItem) {
      const item = match.wikiDataItem;
      console.log(`  📚 WikiData: "${item.title}" by ${item.artist} (${item.qid})`);
      if (item.inception) console.log(`  📅 Date: ${item.inception}`);
      if (item.description) console.log(`  📝 Description: ${item.description.substring(0, 100)}...`);
    }
  }
}
