/**
 * Wikiquotes API client for fetching philosopher quotes
 */

const WIKIQUOTE_API = 'https://en.wikiquote.org/w/api.php';
const MAX_QUOTE_LENGTH = 500; // Mastodon character limit

export interface Quote {
  text: string;
  source?: string;
  section?: string;
  characterCount: number;
}

interface Section {
  index: number;
  level: number;
  line: string;
}

/**
 * Extract quotes from HTML content
 */
function extractQuotesFromHTML(html: string): Quote[] {
  const quotes: Quote[] = [];

  // Method 1: Extract from <li> tags (most common format)
  const liMatches = html.match(/<li[^>]*>([\s\S]*?)<\/li>/g);
  if (liMatches) {
    liMatches.forEach(li => {
      // Remove HTML tags but preserve text
      const text = li
        .replace(/<li[^>]*>/, '')
        .replace(/<\/li>/, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      // Filter out very short items (likely headers) and very long ones
      if (text.length >= 30 && text.length <= MAX_QUOTE_LENGTH) {
        // Check if it looks like a quote (has quotes or is a statement)
        if (text.includes('"') || text.length > 30) {
          // Filter out metadata patterns
          if (!text.match(/^(Notebooks|Letter|Popular usage|See also|External links)/i) &&
              !text.match(/^[A-Z]$/) && // Single letters
              !text.match(/^\d+$/) && // Just numbers
              !text.match(/^Chapter \d+/i)) { // Chapter headers
            quotes.push({
              text,
              characterCount: text.length,
            });
          }
        }
      }
    });
  }

  // Method 2: Extract from blockquotes
  const blockquoteMatches = html.match(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/g);
  if (blockquoteMatches) {
    blockquoteMatches.forEach(bq => {
      const text = bq
        .replace(/<blockquote[^>]*>/, '')
        .replace(/<\/blockquote>/, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (text.length >= 30 && text.length <= MAX_QUOTE_LENGTH) {
        quotes.push({
          text,
          characterCount: text.length,
        });
      }
    });
  }

  return quotes;
}

/**
 * Extract quotes from a specific section of a Wikiquotes page
 */
async function extractQuotesFromSection(
  pageTitle: string,
  sectionIndex: number,
  sectionName?: string,
): Promise<Quote[]> {
  const params = new URLSearchParams({
    action: 'parse',
    format: 'json',
    page: pageTitle,
    prop: 'text',
    section: sectionIndex.toString(),
  });

  const response = await fetch(`${WIKIQUOTE_API}?${params.toString()}`);
  const data = (await response.json()) as {
    parse?: { text?: { '*': string } };
    error?: { code: string; info: string };
  };

  if (data.error) {
    console.warn(`Error fetching section ${sectionIndex}: ${data.error.info}`);
    return [];
  }

  if (!data.parse?.text) {
    return [];
  }

  const html = data.parse.text['*'];
  const quotes = extractQuotesFromHTML(html);

  // Add section name to quotes
  return quotes.map(quote => ({
    ...quote,
    section: sectionName,
  }));
}

/**
 * Get all sections from a Wikiquotes page
 */
async function getPageSections(pageTitle: string): Promise<Section[]> {
  const params = new URLSearchParams({
    action: 'parse',
    format: 'json',
    page: pageTitle,
    prop: 'sections',
  });

  const response = await fetch(`${WIKIQUOTE_API}?${params.toString()}`);
  const data = (await response.json()) as {
    parse?: { sections?: Section[] };
    error?: { code: string; info: string };
  };

  if (data.error || !data.parse?.sections) {
    return [];
  }

  return data.parse.sections;
}

/**
 * Fetch quotes from a philosopher's Wikiquotes page
 * @param philosopherName - Name of the philosopher
 * @param sectionFilter - Optional: only fetch quotes from sections matching this name (case-insensitive partial match)
 */
export async function fetchPhilosopherQuotes(philosopherName: string, sectionFilter?: string): Promise<Quote[]> {
  console.log(`Fetching quotes for: ${philosopherName}...`);

  // Get page sections
  const sections = await getPageSections(philosopherName);

  if (sections.length === 0) {
    console.warn(`No sections found for ${philosopherName}`);
    return [];
  }

  console.log(`Found ${sections.length} sections`);

  let allQuotes: Quote[] = [];

  if (sectionFilter) {
    // Filter to only the specified section
    const filterLower = sectionFilter.toLowerCase();
    const matchingSections = sections.filter(s => 
      s.line.toLowerCase().includes(filterLower) && s.level >= 2
    );

    if (matchingSections.length === 0) {
      console.warn(`No sections found matching "${sectionFilter}"`);
      return [];
    }

    console.log(`Found ${matchingSections.length} section(s) matching "${sectionFilter}"`);

    for (const section of matchingSections) {
      console.log(`Extracting from section: "${section.line}" (index ${section.index})`);
      const sectionQuotes = await extractQuotesFromSection(philosopherName, section.index, section.line);
      allQuotes = [...allQuotes, ...sectionQuotes];
      console.log(`Extracted ${sectionQuotes.length} quotes from "${section.line}"`);
      
      // Add delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } else {
    // Original behavior: find main quotes section and work sections
    // Find the main "Quotes" section (usually first level 2 section)
    const quotesSection = sections.find(s => s.line.toLowerCase().includes('quote') && s.level === 2) || sections[0];

    if (!quotesSection) {
      console.warn(`No quotes section found for ${philosopherName}`);
      return [];
    }

    console.log(`Extracting from section: "${quotesSection.line}" (index ${quotesSection.index})`);

    // Extract quotes from main section
    const mainQuotes = await extractQuotesFromSection(philosopherName, quotesSection.index, quotesSection.line);

    console.log(`Extracted ${mainQuotes.length} quotes from main section`);

    // Also try a few work-specific sections (they often have better quotes)
    const workSections = sections
      .filter(s => s.level === 3 && s.index > 0 && !s.line.toLowerCase().includes('see also'))
      .slice(0, 5); // Try first 5 works

    allQuotes = [...mainQuotes];

    for (const workSection of workSections) {
      const workQuotes = await extractQuotesFromSection(philosopherName, workSection.index, workSection.line);
      allQuotes = [...allQuotes, ...workQuotes];
      
      // Add delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  // Remove duplicates and filter
  const uniqueQuotes = Array.from(
    new Map(allQuotes.map(q => [q.text, q])).values()
  ).filter(q => {
    // Final validation
    return (
      q.text.length >= 30 &&
      q.text.length <= MAX_QUOTE_LENGTH &&
      !q.text.match(/^(Notebooks|Letter|Popular usage|See also|External links)/i) &&
      !q.text.match(/^[A-Z]$/) &&
      !q.text.match(/^\d+$/) &&
      !q.text.match(/^Chapter \d+/i)
    );
  });

  console.log(`Total unique quotes: ${uniqueQuotes.length}`);

  return uniqueQuotes;
}

/**
 * Find philosopher QID in Wikidata
 */
export async function findPhilosopherQID(philosopherName: string): Promise<string | null> {
  const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';

  // Query for philosopher (occupation: philosopher = Q4964182)
  const query = `
    SELECT ?item ?itemLabel WHERE {
      ?item rdfs:label "${philosopherName.replace(/"/g, '\\"')}"@en .
      OPTIONAL { ?item wdt:P106 ?occupation . }
      FILTER(EXISTS { ?item wdt:P106/wdt:P279* wd:Q4964182 })
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    LIMIT 1
  `;

  try {
    const res = await fetch(SPARQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sparql-query',
        Accept: 'application/sparql-results+json',
        'User-Agent': 'wikicommons-art-scraper/1.0 (contact: developer@example.com)',
      },
      body: query,
    });

    if (!res.ok) {
      // Try without occupation filter as fallback
      const fallbackQuery = `
        SELECT ?item ?itemLabel WHERE {
          ?item rdfs:label "${philosopherName.replace(/"/g, '\\"')}"@en .
          SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
        }
        LIMIT 1
      `;

      const fallbackRes = await fetch(SPARQL_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/sparql-query',
          Accept: 'application/sparql-results+json',
          'User-Agent': 'wikicommons-art-scraper/1.0 (contact: developer@example.com)',
        },
        body: fallbackQuery,
      });

      if (fallbackRes.ok) {
        const data = (await fallbackRes.json()) as {
          results: { bindings: Array<Record<string, { type: string; value: string }>> };
        };
        const binding = data.results?.bindings?.[0];
        if (binding?.item?.value) {
          return binding.item.value.replace('http://www.wikidata.org/entity/', '');
        }
      }

      return null;
    }

    const data = (await res.json()) as {
      results: { bindings: Array<Record<string, { type: string; value: string }>> };
    };
    const binding = data.results?.bindings?.[0];
    if (binding?.item?.value) {
      return binding.item.value.replace('http://www.wikidata.org/entity/', '');
    }

    return null;
  } catch {
    return null;
  }
}
