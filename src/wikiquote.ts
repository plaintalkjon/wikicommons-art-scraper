import axios from 'axios';
import * as cheerio from 'cheerio';

export interface Quote {
  text: string;
  reference: string;
  book: string;
  section: string;
  source: string;
  translation: string | null;
}

/**
 * Check if text is primarily English
 * Simple heuristic: checks if text contains mostly ASCII characters
 * and common English words/patterns
 */
export function isEnglish(text: string): boolean {
  if (!text || text.trim().length === 0) {
    return false;
  }

  // Remove common punctuation and whitespace for analysis
  const cleaned = text.replace(/[.,;:!?'"()\[\]{}—–-]/g, ' ').trim();
  
  if (cleaned.length === 0) {
    return false;
  }

  // Check for Greek characters (common in Marcus Aurelius quotes)
  const greekPattern = /[αβγδεζηθικλμνξοπρστυφχψωΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ]/;
  if (greekPattern.test(text)) {
    return false;
  }

  // Check for other non-Latin scripts (Cyrillic, Arabic, etc.)
  const nonLatinPattern = /[^\x00-\x7F\u00A0-\u024F\u1E00-\u1EFF]/;
  const nonLatinMatches = (text.match(nonLatinPattern) || []).length;
  const totalChars = text.length;
  
  // If more than 10% non-Latin characters, likely not English
  if (nonLatinMatches / totalChars > 0.1) {
    return false;
  }

  // Check for common English words/patterns
  const commonEnglishWords = /\b(the|and|or|but|in|on|at|to|for|of|with|by|from|as|is|are|was|were|be|been|have|has|had|do|does|did|will|would|should|could|may|might|can|must|this|that|these|those|a|an)\b/i;
  
  // If text has some English words, likely English
  if (commonEnglishWords.test(text)) {
    return true;
  }

  // If text is mostly ASCII and has reasonable length, assume English
  // (fallback for quotes that might not have common words)
  const asciiRatio = (text.match(/[\x00-\x7F]/g) || []).length / totalChars;
  return asciiRatio > 0.9 && cleaned.length > 10;
}

/**
 * Extract translation name from text and remove it
 * Looks for patterns like "(Hays translation)", "(translation by X)", etc.
 */
function extractTranslation(text: string): { cleanedText: string; translation: string | null } {
  // Pattern: (Hays translation), (translation by Hays), (Hays), etc.
  const translationPatterns = [
    /\(([^)]+?)\s+translation\)/i,
    /\(translation\s+by\s+([^)]+)\)/i,
    /\(([^)]+?)\s+trans\.\)/i,
    /\(([^)]+?)\s+trans\)/i, // Also catch "(Hays trans)"
  ];

  let cleanedText = text;
  let translation: string | null = null;

  for (const pattern of translationPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      translation = match[1].trim();
      // Remove the entire translation marker including parentheses
      cleanedText = text.replace(pattern, '').trim();
      // Clean up any extra whitespace or punctuation left behind
      cleanedText = cleanedText.replace(/\s+/g, ' ').trim();
      break;
    }
  }

  return { cleanedText, translation };
}

/**
 * Remove citations and references from text
 * Removes patterns like [1], [2], etc.
 */
function removeCitations(text: string): string {
  return text
    .replace(/\[\d+\]/g, '') // Remove [1], [2], etc.
    .replace(/\[citation needed\]/gi, '')
    .replace(/\[who\?\]/gi, '')
    .trim();
}

/**
 * Clean quote text: remove citations, normalize whitespace, remove translation markers, remove chapter references
 */
function cleanQuoteText(text: string): { cleanedText: string; translation: string | null } {
  // First extract translation info
  const { cleanedText: textWithoutTranslation, translation } = extractTranslation(text);
  
  // Remove citations
  let cleaned = removeCitations(textWithoutTranslation);
  
  // Remove chapter references (e.g., "Book VI, Chapter 3:", "Part I, Book I:", etc.)
  cleaned = cleaned
    .replace(/^(Book\s+[IVX]+,\s*Chapter\s+\d+:\s*)/i, '') // "Book VI, Chapter 3:"
    .replace(/^(Part\s+[IVX]+,\s*Book\s+[IVX]+:\s*[^:]+:\s*)/i, '') // "Part I, Book I: A Nice Little Family, Ch. 2:"
    .replace(/^(Part\s+[IVX]+,\s*Book\s+[IVX]+:\s*)/i, '') // "Part I, Book I:"
    .replace(/^(Book\s+[IVX]+:\s*)/i, '') // "Book VI:"
    .replace(/^(Chapter\s+\d+:\s*)/i, '') // "Chapter 3:"
    .replace(/^(Part\s+[IVX]+:\s*)/i, '') // "Part I:"
    .replace(/\s*(Book\s+[IVX]+,\s*Chapter\s+\d+:\s*)/gi, ' ') // Remove anywhere in text
    .replace(/\s*(Part\s+[IVX]+,\s*Book\s+[IVX]+:\s*)/gi, ' ') // Remove anywhere in text
    .replace(/\s*(Book\s+[IVX]+:\s*)/gi, ' ') // Remove anywhere in text
    .replace(/\s*(Chapter\s+\d+:\s*)/gi, ' ') // Remove anywhere in text
    .replace(/\s*(Part\s+[IVX]+:\s*)/gi, ' ') // Remove anywhere in text
    .replace(/\s*\(trans\.\s+Constance\s+Garnett\)/gi, ''); // Remove translation markers
  
  // Remove Epictetus-style citations (e.g., "Book I, ch. 2, § 1.")
  cleaned = cleaned
    .replace(/\s*Book\s+[IVX]+,\s*ch\.\s*\d+,\s*§\s*\d+\.?\s*/gi, ' ') // Remove "Book I, ch. 2, § 1." anywhere
    .replace(/^Book\s+[IVX]+,\s*ch\.\s*\d+,\s*§\s*\d+\.?\s*/i, '') // Remove at start
    .replace(/\s*Book\s+[IVX]+,\s*ch\.\s*\d+,\s*§\s*\d+\.?$/i, ''); // Remove at end
  
  // Remove "Variant translation:" markers
  cleaned = cleaned
    .replace(/^Variant translation:\s*/i, '') // Remove at start
    .replace(/\s*Variant translation:\s*/gi, ' '); // Remove anywhere
  
  // Remove translation markers in parentheses (e.g., "(trans. Constance Garnett)")
  cleaned = cleaned.replace(/\s*\(trans\.\s+[^)]+\)/gi, '');
  
  // Normalize whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  return { cleanedText: cleaned, translation };
}

/**
 * Parse reference notation (e.g., "I, 1" -> { book: "I", section: "1" })
 */
function parseReference(ref: string): { book: string; section: string } | null {
  const match = ref.match(/^([IVX]+)\s*,\s*(\d+)$/i);
  if (match) {
    return {
      book: match[1].toUpperCase(),
      section: match[2],
    };
  }
  return null;
}

/**
 * Extract quotes from Wikiquote HTML
 * Supports both philosopher pages (with "Quotes" section) and literary works (direct sections)
 */
export async function fetchQuotesFromWikiquote(url: string): Promise<Quote[]> {
  try {
    console.log(`📥 Fetching Wikiquote page: ${url}`);
    
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'wikicommons-art-scraper/1.0 (contact: developer@example.com)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 30000,
    });

    const $ = cheerio.load(response.data);
    const quotes: Quote[] = [];
    
    // Collect all headings to find boundaries
    const headings: Array<{ level: number; text: string; index: number; elem: any }> = [];
    $('h1, h2, h3, h4, h5').each((index, elem) => {
      const level = parseInt(elem.tagName.charAt(1));
      const text = $(elem).text().trim();
      headings.push({ level, text, index, elem });
    });

    // Try to find "Quotes" section (for philosopher pages like Marcus Aurelius)
    let quotesStartIndex = -1;
    let quotesEndIndex = -1;
    
    for (let i = 0; i < headings.length; i++) {
      const heading = headings[i];
      if (heading.text === 'Quotes' && quotesStartIndex === -1) {
        quotesStartIndex = i;
      } else if (quotesStartIndex !== -1 && (heading.text === 'Disputed' || heading.text === 'Misattributed' || heading.text.startsWith('Quotes about'))) {
        quotesEndIndex = i;
        break;
      }
    }

    // If we found a "Quotes" section, look for "Meditations" subsection
    if (quotesStartIndex !== -1) {
      console.log(`✓ Found Quotes section`);
      
      // Try to find Meditations subsection within Quotes (for Marcus Aurelius)
      let meditationsStartIndex = -1;
      let meditationsEndIndex = quotesEndIndex !== -1 ? quotesEndIndex : headings.length;
      
      for (let i = quotesStartIndex + 1; i < headings.length && i < meditationsEndIndex; i++) {
        const heading = headings[i];
        if (heading.text.includes('Meditations') || heading.text.includes('meditations')) {
          meditationsStartIndex = i;
          // Find end of Meditations (next h2 or h3, or end of Quotes section)
          for (let j = i + 1; j < headings.length; j++) {
            const nextHeading = headings[j];
            if (nextHeading.level <= 3 || nextHeading.text === 'Disputed' || nextHeading.text === 'Misattributed' || nextHeading.text.startsWith('Quotes about')) {
              meditationsEndIndex = j;
              break;
            }
          }
          break;
        }
      }

      if (meditationsStartIndex !== -1) {
        // Found Meditations subsection (Marcus Aurelius case)
        console.log(`✓ Found Meditations subsection`);
        return extractQuotesFromSection($, headings, meditationsStartIndex, meditationsEndIndex, 'Meditations');
      }

      // No Meditations subsection found - extract from all subsections within Quotes
      // (e.g., Nineteen Eighty-Four has "Part One", "Part Two", etc., with Chapters as h4)
      console.log(`⚠️  No Meditations subsection found, extracting from all subsections in Quotes`);
      
      const quotesEnd = quotesEndIndex !== -1 ? quotesEndIndex : headings.length;
      
      // Extract quotes from each subsection (h3 like "Part One", or h4 like "Chapter 1") within Quotes
      for (let i = quotesStartIndex + 1; i < quotesEnd; i++) {
        const heading = headings[i];
        
        // Skip "Quotes about" section
        if (heading.text.startsWith('Quotes about')) {
          break;
        }
        
        // Skip "Attributed" and "Disputed" subsections (these are not verified quotes)
        if (heading.text === 'Attributed' || heading.text === 'Disputed' || heading.text === 'Misattributed') {
          continue;
        }
        
        // Process h3 subsections (like "Part One", "Part Two") or h4 chapters
        if (heading.level === 3 || heading.level === 4) {
          // Find end of this subsection (next heading of same or higher level, or end of Quotes section)
          let subsectionEndIndex = quotesEnd;
          for (let j = i + 1; j < headings.length && j < quotesEnd; j++) {
            const nextHeading = headings[j];
            // Stop at same level or higher level heading, or at "Quotes about"
            if (nextHeading.level <= heading.level || nextHeading.text.startsWith('Quotes about')) {
              subsectionEndIndex = j;
              break;
            }
          }
          
          const subsectionQuotes = extractQuotesFromSection($, headings, i, subsectionEndIndex, heading.text);
          quotes.push(...subsectionQuotes);
          console.log(`  📖 Extracted ${subsectionQuotes.length} quotes from "${heading.text}"`);
        }
      }
      
      return quotes;
    }

    // If no "Quotes" section, treat as literary work (like "The Prophet")
    // Extract quotes from all h2 sections before "Misattributed", "Quotes about", or "External links"
    console.log(`⚠️  No "Quotes" section found, treating as literary work`);
    
    let contentEndIndex = headings.length;
    for (let i = 0; i < headings.length; i++) {
      const heading = headings[i];
      if (heading.text === 'Misattributed' || 
          heading.text.startsWith('Quotes about') || 
          heading.text === 'External links' || 
          heading.text === 'See also') {
        contentEndIndex = i;
        break;
      }
    }

    // Extract quotes from each h2 section
    for (let i = 0; i < contentEndIndex; i++) {
      const heading = headings[i];
      
      // Skip h1 (title) and non-h2 sections at the start
      if (heading.level === 1 || (heading.level !== 2 && i < 5)) {
        continue;
      }
      
      // Skip "Contents" section (table of contents)
      if (heading.text === 'Contents' || heading.text.includes('Contents')) {
        continue;
      }
      
      // Skip unwanted sections
      if (heading.text === 'Misattributed' || 
          heading.text.startsWith('Quotes about') ||
          heading.text === 'External links' ||
          heading.text === 'See also') {
        continue;
      }
      
      // Only process h2 sections (like "On Love", "On Marriage")
      if (heading.level === 2) {
        // Find end of this section (next h2 or end of content)
        let sectionEndIndex = contentEndIndex;
        for (let j = i + 1; j < headings.length && j < contentEndIndex; j++) {
          if (headings[j].level <= 2) {
            sectionEndIndex = j;
            break;
          }
        }
        
        const sectionQuotes = extractQuotesFromSection($, headings, i, sectionEndIndex, heading.text);
        quotes.push(...sectionQuotes);
        console.log(`  📖 Extracted ${sectionQuotes.length} quotes from "${heading.text}"`);
      }
    }

    console.log(`✓ Extracted ${quotes.length} total quotes`);
    
    return quotes;
  } catch (error: any) {
    console.error(`❌ Error fetching Wikiquote page: ${error.message}`);
    throw error;
  }
}

/**
 * Extract quotes from a specific section
 */
function extractQuotesFromSection(
  $: cheerio.CheerioAPI,
  headings: Array<{ level: number; text: string; index: number; elem: any }>,
  sectionStartIndex: number,
  sectionEndIndex: number,
  source: string
): Quote[] {
  const quotes: Quote[] = [];
  
  if (sectionStartIndex < 0 || sectionStartIndex >= headings.length) {
    return quotes;
  }

  const sectionHeading = headings[sectionStartIndex];
  const sectionHeadingElem = $(sectionHeading.elem);
  
  // Find the next major heading (end of section)
  let nextMajorHeadingElem: cheerio.Cheerio<any> | null = null;
  if (sectionEndIndex < headings.length) {
    nextMajorHeadingElem = $(headings[sectionEndIndex].elem);
  }
  
  // Get all list items on the page
  const allListItems = $('li');
  
  // Filter list items that are between section heading and next heading
  // Use a simpler approach: check if list item is a descendant of content between headings
  const filteredListItems = allListItems.filter((_, liElem) => {
    const $li = $(liElem);
    
    // Skip navigation/sidebar items
    if ($li.closest('nav, .nav, #navigation, .sidebar, #sidebar, .toc, #toc, .mw-toc').length > 0) {
      return false;
    }
    
    // Skip if it's in a TOC (table of contents)
    const parentText = $li.parent().text();
    if (parentText.includes('Toggle') || parentText.includes('Contents') || 
        $li.closest('.toc, #toc, .mw-toc').length > 0) {
      return false;
    }
    
    // Simple heuristic: if the list item contains text that matches our section's quotes,
    // include it. The deduplication will handle duplicates across sections.
    // For now, we'll be more permissive and let deduplication handle it.
    
    // Check if it looks like a quote (has reference pattern, page number, or substantial text)
    const text = $li.text().trim();
    
    // Skip junk text (footer, edit notices, etc.)
    if (text.includes('last edited') || text.includes('Creative Commons') || 
        text.includes('Terms of Use') || text.includes('Privacy Policy') ||
        text.includes('Wikimedia Foundation') || text.length < 30) {
      return false;
    }
    
    // Skip quotes from "Quotes about" sections (these are commentary, not actual quotes)
    if (text.includes('In truth,') && text.includes('work of such universal appeal')) {
      return false;
    }
    if (text.includes('Dr.') && text.includes('editor of')) {
      return false;
    }
    if (text.includes('as quoted in') || text.includes('as quoted by')) {
      return false;
    }
    // Skip external links and references
    if (text.includes('at Project Gutenberg') || text.includes('at online-literature.com') ||
        text.includes('at Orwell.ru') || text.includes('at george-orwell.org') ||
        text.includes('at Penn Library') || text.includes('digital library') ||
        text.includes('e-texts') || text.includes('Full texts') ||
        text.includes('Another site') || text.includes('Quotes analyzed') || 
        text.includes('study guide') || text.includes('External links') ||
        text.includes('Dostoevsky e-texts') || text.includes('Online Library Catalog') ||
        text.includes('St. Olaf College')) {
      return false;
    }
    // Skip chapter/section titles (these are headers, not quotes)
    // Pattern: Short text with semicolons or "of" that looks like a title
    if (text.length < 200 && (
        text.match(/^[A-Z][^.!?]*[;:]\s*[A-Z]/) || // "Title; Subtitle" or "Title: Subtitle"
        text.match(/^[A-Z][^.!?]*\sof\s[A-Z]/) || // "Title of Something"
        (text.match(/^[A-Z][^.!?]*$/) && !text.match(/[.!?]/) && text.length < 100) || // All caps or title case, no punctuation, short
        text.match(/^(The|A|An)\s+[A-Z][a-z]+\s+(Devil|Monk|Buffoon|Rebellion)/i) || // "The Devil", "The Russian Monk", etc.
        text.match(/Conversations and Exhortations/i) || // Specific chapter title pattern
        text.match(/^Book\s+[IVX]+,\s*Chapter\s+\d+:/i) || // "Book XI, Chapter 9:"
        text.match(/^Part\s+[IVX]+,\s*Book\s+[IVX]+:/i) // "Part I, Book I:"
    )) {
      return false;
    }
    // Skip citations about the author (not quotes by the author)
    if (text.match(/^(Colin Wilson|James Baldwin|H\.P\. Blavatsky|Tony Tanner|Maurice Friedberg|Alexander II|Jean-Paul Sartre|Dostoyevsky,? patron)/i)) {
      return false;
    }
    // Skip if it contains bibliographic info (ISBN, page numbers, etc.)
    if (text.match(/ISBN|p\.\s*\d+.*ISBN|Palgrave Macmillan|1948 p\.\s*\d+/i)) {
      return false;
    }
    // Skip quotes that are clearly ABOUT the author, not BY the author
    if (text.match(/patron saint of|testimony of Dostoevsky|Even Dostoyevski|I was soaked in the Russian|Who are some of the writers|Four facets may be distinguished/i)) {
      return false;
    }
    // Skip quotes ABOUT the author (not BY the author)
    // Pattern: "He is...", "He liked...", "There is no man...", "We are told of his...", etc.
    if (text.match(/^(I love|Emerson broke away|A cheery, child-like soul|Modern technics|Virtually at the same time|Nineteenth-century prose|He is|He liked|There is no man|We are told of his|He began where|Even when provocation|England laughed|We, as we read|Attributed to Emerson|That which struck me|It was a maxim|\[A\] great original|\[N\]o one has had|Simone Weil|Tony Benn|I cannot help myself|As there was a Socialism|Marx was not|Marx was an astronomer|Meghnad Desai|Martin Luther King|John Kenneth Galbraith|Che Guevara|Chris Hedges|Robert Heilbroner|John F\. Kennedy|Roger Kimball|Vladimir Lenin|Rosa Luxemburg|J\. Robert Oppenheimer|Paul Samuelson|Bernard Shaw|A\. J\. P\. Taylor|I find it|Just heard|Even though communist|If Marx had not|It had to be admitted|Marx had made|Marx so aptly observed|Marx was fortunate|I looked up to these Russians|Much if not all|The strength of Marx|The intellectual contribution|In the NKVD|Since Marx|All the destructive|You believe perhaps.*said Karl Marx|There is, in Marx|It was the world-renowned Karl Marx|Kierkegaard would call|At the opposite pole|J\. Bradford DeLong|Philosophers in the idealist|I met Marx|Engels was always|Neither Marx nor Engels|I enrage my friends|All the sophisticated|On the one hand, Karl Marx|Where no man lacks|when Karl Marx|I began to read Capital|There can be no doubt|In yet another aspect|Marx's father became|Lukes's answer|It is tempting to compare|From the viewpoint|Marx … was|Marx has certainly|Marxism is a religion|Karl Marx, in envisioning|Against anarchists Marx|L\.K\. Samuels|Fundamentalist religion becomes|You cannot conquer|Actually from State|Said to be a quote|A variant of the above|Surround yourself|Catch a man a fish)/i) ||
        text.match(/Emerson's prose|The Emerson Enigma|by George M Stack|Emerson was doing|Ralph Waldo Emerson wrote|as reported by|Quoted in [A-Z]|distinguishing him from|February \d+, \d{4}; cf\.|in Raymond Aron|The Opium of the Intellectuals|in an interview|Marx's Revenge|Fellowship Magazine|The Affluent Society|The Age Of Uncertainty|Notes for the Study|Truthdig|The Worldly Philosophers|The Future As History|in an address|Leszek Kolakowski|As quoted by Stephen|in Le Socialisme|Karl Marx, a visionary|Marx's economic teachings|Marx had not been|Marx had made mistakes|Marx's outlook|Controversial Kierkegaard|Understanding Karl Marx|Marx, Lenin, Trotsky|Marx money|Marx and Engles|Marx so aptly observed|Actually from State and Revolution|Said to be a quote from Das Kapital|A variant of the above misquote/i) ||
        (text.length < 200 && text.match(/^(Marx|Engels) (was|had|did|is|are)/i)) ||
        text.match(/as Marx so aptly observed|Marx was fortunate|Marx's father|Marx's outlook|Marx's economic|Marx had not|Marx had made/i)) {
      return false;
    }
    // Skip quotes that start with author's name followed by description (usually ABOUT, not BY)
    if (text.match(/^Emerson\s+(broke|was|is|had|gave|liked)/i)) {
      return false;
    }
    // Skip citations that mention "no known source" or "attributed" or "misattributed"
    if (text.match(/no known source|Widely attributed|actually comes from|misattributed|This sentence has no|Attributed to Emerson in/i)) {
      return false;
    }
    // Skip quotes that are clearly citations about the quote itself
    if (text.match(/^(Gow,|Quoted in [A-Z]|Said to a young|Variation:|Works and Days;|Composed in|Social Aims;|February \d+|Journal entry|Variant translation)/i)) {
      return false;
    }
    // Skip Epictetus-style citations (e.g., "Book I, ch. 2, § 1.")
    if (text.match(/^Book\s+[IVX]+,\s*ch\.\s*\d+,\s*§\s*\d+\.?$/i)) {
      return false;
    }
    // Skip items that are just "Variant translation:" followed by citation
    if (text.match(/^Variant translation:\s*(Book\s+[IVX]+,\s*ch\.\s*\d+,\s*§\s*\d+\.?|$)/i)) {
      return false;
    }
    // Skip citations with publication info (e.g., "Journals 1A", "Hong translation 1967 p. 14-15")
    if (text.match(/^(Soren|Søren) Kierkegaard's Journals|Hong translation \d{4}|p\.\s*\d+-\d+|Journals \d+[A-Z]/i)) {
      return false;
    }
    // Skip citations with Marx-Engels publication info
    if (text.match(/^(Marx-Engels|Marx Engels) Gesamt-Ausgabe|Erste Abteilung|Volume \d+|MESW|Marx Engels Selected Works/i)) {
      return false;
    }
    // Skip citations that are just publication references (e.g., "Theses on Feuerbach" (1845), Thesis 11, ...)
    if (text.match(/^"[^"]+"\s*\(\d{4}\),\s*(Thesis|Volume|p\.)/i)) {
      return false;
    }
    // Skip citations with newspaper/publication names (e.g., "The Victory...", Neue Rheinische Zeitung, 7 No...)
    if (text.match(/^"[^"]+",\s+(Neue Rheinische|Zeitung|p\.\s*\d+)/i) && text.length < 200) {
      return false;
    }
    // Skip misattributed quotes and citations (e.g., "We will hang the capitalists...", "'Where no man lacks': a post-capitalist order? -- An excerpt")
    if (text.match(/^(We will hang the capitalists|Where no man lacks|post-capitalist order|An excerpt, by|Share International magazine|Paradoxical aphorism)/i)) {
      return false;
    }
    // Skip citations that are just publication references (e.g., "Martin Heidegger at Eighty," in Heidegger and Modern Philosophy)
    if (text.match(/^"[^"]+",\s+in [A-Z][^,]+(,|:)/i) && text.length < 300) {
      return false;
    }
    // Skip citations with publication info (e.g., "Martin Heidegger at Eighty," in Heidegger and Modern Philosophy: Critical Essays (1978))
    if (text.match(/in Heidegger and Modern Philosophy|Critical Essays \(\d{4}\)/i)) {
      return false;
    }
    // Skip citations that are just chapter/page references (e.g., "Part 3, Ch. 11...", "As Arendt notes...")
    if (text.match(/^(Part \d+|Ch\. \d+|§ \d+|As Arendt notes|Thoughts on Politics)/i) ||
        (text.length < 200 && text.match(/^(Part|Chapter|Ch\.|§)\s+\d+/i))) {
      return false;
    }
    // Skip Bekker number citations (e.g., "A.1, 184a.16 sqq, source:, Book I, Part 1, Tr. R. P. Hardie")
    if (text.match(/^(A\.\d+|source:|Tr\.|Book [IVX]+,\s*Part \d+)/i) ||
        (text.length < 150 && text.match(/\d+[a-z]\.\d+\s+sqq|source:|Tr\.\s+[A-Z]/i))) {
      return false;
    }
    // Skip citations that start with ↑ (Wikiquote citation marker) or academic citations (e.g., "Shulman, L. S. (1986)")
    if (text.match(/^↑|^[A-Z][a-z]+,\s+[A-Z]\.\s+[A-Z]\.\s*\(\d{4}\)/i) ||
        (text.length < 200 && text.match(/^[A-Z][a-z]+,\s+[A-Z]\.\s+[A-Z]\.\s*\(\d{4}\)/i))) {
      return false;
    }
    // Skip citations that are just titles (e.g., "Thoughts on Politics and Revolution: A Commentary")
    if (text.match(/^\"[^\"]+\":\s*(A Commentary|A Report)/i) && text.length < 200) {
      return false;
    }
    // Skip citations that are just essay/article titles (e.g., "Thoughts on Politics and Revolution: A Commentary")
    if (text.match(/Thoughts on Politics.*A Commentary/i) || (text.length < 150 && text.match(/^\"[^\"]+\":\s*A Commentary/i))) {
      return false;
    }
    // Skip quotes that mention "said [Author] in [year]" format (these are usually citations, not the actual quote)
    if (text.match(/said (Karl )?Marx in \d{4}/i) && text.length < 300) {
      return false;
    }
    // Skip quotes that describe Marx's ideas rather than being BY Marx (e.g., "Labor-power is a commodity... Marx insisted")
    if (text.match(/Marx insisted|when Karl Marx, the most consistent/i)) {
      return false;
    }
    // Skip book titles that are just citations (e.g., "Upbuilding Discourses in Various Spirits, Hong")
    if (text.match(/^(Upbuilding|Discourses|Works of Love|Fear and Trembling|Either\/Or|The Concept of Anxiety|The Sickness unto Death|Concluding Unscientific Postscript|Stages on Life|The Point of View|Attack Upon Christianity|Uplifting Discourses),?\s+(Hong|translation|Swenson|Lowrie|Nichol|Hannay|Alexander|Dru)/i) ||
        text.match(/^(Pap\.|S\. Kierkegaard|Variations include|Søren Kierkegaard,|Of The Difference|As attributed|Attributed to|This phrase is thought|Mrs\.|Maurice|Carl Jung|Upbuilding Discourses series|Søren Kierkegaard Newsletter|Eighteen Upbuilding Discourses)/i) ||
        text.match(/^(The Point of View On My Work|Uplifting Discourses in Various Spirits in a section)/i) ||
        (text.length < 200 && text.match(/(Hong|Swenson|Translation|Nichol|Hannay|Lowrie|Alexander|Dru|Cosmopolitan|January \d{4}|letter from|coined by|edited by|series \(\d{4}-\d{2}\))/i))) {
      return false;
    }
    // Skip quotes that are clearly ABOUT the author (not BY the author)
    if (text.match(/^(The|A|An)\s+[A-Z][a-z]+\s+(is|was|are|were)/) && 
        (text.includes('novel') || text.includes('book') || text.includes('work'))) {
      return false;
    }
    // Skip items that look like bibliographic references
    if (text.match(/^[A-Z][a-z]+\s+[A-Z][a-z]+.*\(\d{4}\)/i) && text.length < 150) {
      return false;
    }
    // Skip citations/references (these are metadata, not actual quotes)
    // Pattern: "Book Title (year)" or "Letter to..." or "as published in" or "as translated by"
    if (text.match(/^(Letter|As quoted|As published|As translated|The .+ \(\d{4}\))/i)) {
      return false;
    }
    if (text.match(/as (published|translated|quoted) in/i) && text.length < 200) {
      return false;
    }
    // Skip citations that start with quoted title followed by "in" and publication info
    if (text.match(/^"[^"]+",\s+in\s+[^,]+(pp\.|p\.|Originally)/i)) {
      return false;
    }
    // Skip citations with "in [Publication]" followed by date and page numbers
    if (text.match(/,\s+in\s+[^,]+\([^)]+\d{4}\)\s+(pp\.|p\.)/i)) {
      return false;
    }
    // Skip if it contains "Originally" (usually indicates citation metadata)
    if (text.match(/Originally\s+(published|appeared)/i) && text.length < 300) {
      return false;
    }
    // Skip if it's just a book title with year and page reference (no actual quote text)
    if (text.match(/^[A-Z][^.]*\(\d{4}\)[^.]*$/)) {
      return false;
    }
    // Skip items that are just citations (contain "pp.", "ed.", "translated", "published" and are short)
    if (text.length < 150 && (
        text.match(/pp\.\s*\d+/i) || 
        text.match(/\bed\.\s+/i) ||
        text.match(/translated by/i) ||
        text.match(/published in/i) ||
        text.match(/\(tr\./i) ||
        (text.match(/\(\d{4}\)/i) && text.length < 100)
    )) {
      return false;
    }
    // Skip items that look like chapter references without quote text
    if (text.match(/^(Part|Chapter|Book)\s+\d+/i) && text.length < 100) {
      return false;
    }
    
    const hasRomanRef = /[IVX]+\s*,\s*\d+/.test(text); // Roman numeral reference like "I, 1"
    const hasPageRef = /\bp\.\s*\d+/.test(text); // Page reference like "p. 11"
    const isSubstantial = text.length > 50; // Real quotes are longer
    
    return hasRomanRef || hasPageRef || isSubstantial;
  });
  
  let currentBook: string | null = null;
  
  // First pass: identify Book headings between section heading and next heading
  if (nextMajorHeadingElem) {
    sectionHeadingElem.nextUntil(nextMajorHeadingElem).filter('h4, h5').each((_, headingElem) => {
      const headingText = $(headingElem).text().trim();
      const bookMatch = headingText.match(/Book\s+([IVX]+)/i);
      if (bookMatch) {
        currentBook = bookMatch[1].toUpperCase();
        console.log(`  📖 Found Book ${currentBook}`);
      }
    });
  } else {
    sectionHeadingElem.nextAll('h4, h5').each((_, headingElem) => {
      const headingText = $(headingElem).text().trim();
      const bookMatch = headingText.match(/Book\s+([IVX]+)/i);
      if (bookMatch) {
        currentBook = bookMatch[1].toUpperCase();
        console.log(`  📖 Found Book ${currentBook}`);
      }
    });
  }
  
  // Second pass: extract quotes from filtered list items
  filteredListItems.each((_, liElem) => {
    const $li = $(liElem);
    
    // Get quote text (everything before nested ul/ol)
    const quoteText = $li.clone().children('ul, ol').remove().end().text().trim();
    
    if (!quoteText || quoteText.length < 10) {
      return; // Skip empty or very short items
    }
    
    // Debug: log first few list items
    if (quotes.length < 3) {
      console.log(`  🔍 Sample list item text: ${quoteText.substring(0, 100)}...`);
    }

    // Get reference from nested ul > li or ol > li
    let reference: string | null = null;
    $li.find('ul > li, ol > li').each((_, refLi) => {
      const refText = $(refLi).text().trim();
      // Check if it looks like a reference (e.g., "I, 1", "II, 3")
      if (/^[IVX]+\s*,\s*\d+$/i.test(refText)) {
        reference = refText;
        return false; // break
      }
      // Check for page reference (e.g., "p. 11")
      if (/^p\.\s*\d+$/i.test(refText)) {
        reference = refText;
        return false; // break
      }
    });

    // Also check for reference in format "* I, 1" or "* p. 11" at end of quote text
    if (!reference) {
      const romanRefMatch = quoteText.match(/\*\s*([IVX]+\s*,\s*\d+)$/i);
      if (romanRefMatch) {
        reference = romanRefMatch[1].trim();
      } else {
        const pageRefMatch = quoteText.match(/\*\s*(p\.\s*\d+)$/i);
        if (pageRefMatch) {
          reference = pageRefMatch[1].trim();
        }
      }
    }

    // For literary works, references are optional (page numbers)
    // If no reference found, use a placeholder or skip
    if (!reference) {
      // Try to extract page number from text itself
      const pageMatch = quoteText.match(/\bp\.\s*(\d+)/i);
      if (pageMatch) {
        reference = `p. ${pageMatch[1]}`;
      } else {
        // For literary works without references, we can still extract the quote
        // Use index as reference to ensure uniqueness
        reference = `quote-${quotes.length + 1}`;
      }
    }

    // Parse reference (handle both Roman numeral and page number formats)
    let parsedRef: { book: string; section: string } | null = null;
    if (reference.match(/^[IVX]+\s*,\s*\d+$/i)) {
      parsedRef = parseReference(reference);
    } else {
      // For page references or other formats, use the reference as section
      parsedRef = { book: '', section: reference };
    }

    if (!parsedRef) {
      return; // Skip invalid references
    }

    // Use current book if available, otherwise extract from reference
    const book = currentBook || parsedRef.book;

    // Clean quote text (remove ALL reference patterns from the text)
    let textToClean = quoteText
      .replace(/\*\s*\[?[IVX]+\s*,\s*\d+\]?\s*$/i, '') // Remove "* VIII, 25" or "* [VIII, 25]" at end
      .replace(/\[[IVX]+\s*,\s*\d+\]\s*$/i, '') // Remove "[VIII, 25]" at end  
      .replace(/\s*\[[IVX]+\s*,\s*\d+\]\s*/gi, ' ') // Remove "[VIII, 25]" anywhere in text
      .replace(/\s+[IVX]+\s*,\s*\d+\s*$/i, '') // Remove "VIII, 25" at end (no brackets)
      .replace(/\*\s*p\.\s*\d+\s*$/i, '') // Remove "* p. 11" at end
      .replace(/\bp\.\s*\d+\s*$/i, '') // Remove "p. 11" at end
      // Remove Epictetus-style citations
      .replace(/\s*Book\s+[IVX]+,\s*ch\.\s*\d+,\s*§\s*\d+\.?\s*/gi, ' ') // Remove "Book I, ch. 2, § 1." anywhere
      .replace(/^Book\s+[IVX]+,\s*ch\.\s*\d+,\s*§\s*\d+\.?\s*/i, '') // Remove at start
      .replace(/\s*Book\s+[IVX]+,\s*ch\.\s*\d+,\s*§\s*\d+\.?$/i, '') // Remove at end
      // Remove "Variant translation:" markers
      .replace(/^Variant translation:\s*/i, '') // Remove at start
      .replace(/\s*Variant translation:\s*/gi, ' ') // Remove anywhere
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
    
    const { cleanedText, translation } = cleanQuoteText(textToClean);

    // Skip if empty after cleaning
    if (!cleanedText || cleanedText.length < 10) {
      return;
    }

    // Check if English
    if (!isEnglish(cleanedText)) {
      console.log(`  ⏭️  Skipping non-English quote: ${cleanedText.substring(0, 50)}...`);
      return;
    }

    // Avoid duplicates (by text + source, since references may vary)
    // Also check for near-duplicates (same first 100 chars)
    const exists = quotes.some(q => {
      if (q.text === cleanedText && q.source === source) {
        return true;
      }
      // Check for near-duplicates (same start)
      if (q.source === source && cleanedText.length > 50 && q.text.length > 50) {
        const qStart = q.text.substring(0, 100).trim();
        const cleanedStart = cleanedText.substring(0, 100).trim();
        if (qStart === cleanedStart) {
          return true;
        }
      }
      return false;
    });
    if (exists) {
      return;
    }

    // Create quote object
    const quote: Quote = {
      text: cleanedText,
      reference: reference,
      book: book,
      section: parsedRef.section,
      source: source,
      translation: translation,
    };

    quotes.push(quote);
  });

  return quotes;
}

/**
 * Deduplicate quotes by reference, keeping the first English translation
 */
export function deduplicateQuotes(quotes: Quote[]): Quote[] {
  const seen = new Map<string, Quote>();
  
  for (const quote of quotes) {
    const key = quote.reference;
    
    // If we haven't seen this reference, add it
    if (!seen.has(key)) {
      // Only add if it's English
      if (isEnglish(quote.text)) {
        seen.set(key, quote);
      }
    }
    // If we've seen it but current is English and previous wasn't, replace
    else {
      const existing = seen.get(key)!;
      if (!isEnglish(existing.text) && isEnglish(quote.text)) {
        seen.set(key, quote);
      }
    }
  }
  
  return Array.from(seen.values());
}

