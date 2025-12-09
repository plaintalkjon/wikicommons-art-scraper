const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';

export interface WikidataPainting {
  title: string; // commons file title, e.g., "File:Starry Night.jpg"
  museum?: string;
  itemId?: string; // QID
  imageUrl?: string;
}

const DEFAULT_MUSEUMS = [
  // Netherlands
  'wd:Q224124', // Van Gogh Museum
  'wd:Q1051928', // Kröller-Müller Museum
  'wd:Q190804', // Rijksmuseum
  'wd:Q12013217', // Noordbrabants Museum
  'wd:Q679527', // Museum Boijmans Van Beuningen
  
  // France
  'wd:Q23402', // Musée d'Orsay
  'wd:Q19675', // Louvre
  
  // United States - East Coast
  'wd:Q160236', // Metropolitan Museum of Art
  'wd:Q214867', // National Gallery of Art (US)
  'wd:Q49133', // Museum of Fine Arts Boston
  'wd:Q510324', // Philadelphia Museum of Art
  'wd:Q188740', // Museum of Modern Art (MoMA)
  'wd:Q201469', // Solomon R. Guggenheim Museum
  'wd:Q682827', // Frick Collection
  'wd:Q808462', // Barnes Foundation
  
  // United States - Midwest
  'wd:Q239303', // Art Institute of Chicago
  'wd:Q1760539', // Saint Louis Art Museum
  'wd:Q657415', // Cleveland Museum of Art
  'wd:Q1201549', // Detroit Institute of Arts
  'wd:Q1700481', // Minneapolis Institute of Art
  
  // United States - West Coast
  'wd:Q1752085', // Norton Simon Museum
  'wd:Q731126', // J. Paul Getty Museum
  'wd:Q1641836', // Los Angeles County Museum of Art (LACMA)
  'wd:Q913672', // San Francisco Museum of Modern Art
  'wd:Q1416890', // Fine Arts Museums of San Francisco
  
  // United Kingdom
  'wd:Q180788', // National Gallery (UK)
  'wd:Q430682', // Tate Britain
  'wd:Q193375', // Tate Modern
  'wd:Q12110695', // Courtauld Gallery
  
  // Switzerland
  'wd:Q685038', // Kunsthaus Zürich
  'wd:Q666331', // Foundation E.G. Bührle Collection
  
  // Russia
  'wd:Q132783', // Hermitage Museum
  'wd:Q4872', // Pushkin Museum
  'wd:Q183334', // Tretyakov Gallery
  
  // Spain
  'wd:Q160112', // Museo del Prado
  'wd:Q176251', // Thyssen-Bornemisza Museum
  
  // Italy
  'wd:Q51252', // Uffizi Gallery
  'wd:Q10855544', // Galleria dell'Accademia
  'wd:Q150066', // Pinacoteca di Brera
  'wd:Q841506', // Galleria Borghese
  
  // Germany
  'wd:Q154568', // Alte Pinakothek
  'wd:Q170152', // Neue Pinakothek
  'wd:Q162111', // Alte Nationalgalerie
  
  // Austria
  'wd:Q95569', // Kunsthistorisches Museum
  'wd:Q371908', // Albertina
  'wd:Q303139', // Belvedere
  
  // Japan
  'wd:Q1362629', // National Museum of Western Art
  'wd:Q653433', // Tokyo National Museum
  'wd:Q147286', // Kyoto National Museum
];

export async function fetchWikidataPaintings(options: {
  artistQid?: string;
  museums?: string[];
  limit?: number;
  includeCc0?: boolean;
  requireLicense?: boolean;
}): Promise<WikidataPainting[]> {
  const artistQid = options.artistQid ?? 'wd:Q5582'; // Vincent van Gogh
  const museums = options.museums ?? DEFAULT_MUSEUMS;
  const limit = options.limit ?? 100;
  const includeCc0 = options.includeCc0 ?? true;
  const requireLicense = options.requireLicense ?? false;

  const licenseFilter = requireLicense
    ? includeCc0
      ? `
      {
        ?item wdt:P6216 wd:Q19652 . # PD
      }
      UNION
      {
        ?item wdt:P6216 wd:Q6938433 . # CC0
      }
    `
      : `
      ?item wdt:P6216 wd:Q19652 . # PD
    `
    : '';

  const museumValues = museums.join(' ');

  const query = `
    SELECT ?item ?title ?image ?museumLabel WHERE {
      ?item wdt:P31 wd:Q3305213 ;          # instance of painting
            wdt:P170 ${artistQid} ;        # creator = artist
            wdt:P18 ?image ;               # has an image
            wdt:P195 ?museum .             # collection (museum)
      VALUES ?museum { ${museumValues} }
      ${licenseFilter}
      OPTIONAL { ?item rdfs:label ?title FILTER (LANG(?title) = "en") }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    LIMIT ${limit}
  `;

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
    throw new Error(`Wikidata SPARQL failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as {
    results: { bindings: Array<Record<string, { type: string; value: string }>> };
  };

  return (data.results?.bindings ?? []).map((b) => {
    const imageUrl = b.image?.value ?? '';
    const commonsTitle = urlToCommonsTitle(imageUrl);
    return {
      title: commonsTitle,
      museum: b.museumLabel?.value,
      itemId: b.item?.value ? b.item.value.replace('http://www.wikidata.org/entity/', '') : undefined,
      imageUrl,
    };
  });
}

function urlToCommonsTitle(url: string): string {
  // Commons file URLs look like .../commons/<hash>/<hash>/File_Name.ext
  // We want "File:File_Name.ext"
  try {
    const parts = url.split('/');
    const filename = parts[parts.length - 1];
    if (!filename) return '';
    return decodeURIComponent(`File:${filename}`);
  } catch {
    return '';
  }
}

export interface WikidataItemTags {
  genre?: string; // P136
  movement?: string; // P135
  inceptionDate?: string; // P571
}

/**
 * Fetch curated tags from Wikidata item properties:
 * - P136: genre (e.g., "landscape art")
 * - P135: movement (e.g., "Post-Impressionism")
 * - P571: inception/creation date (e.g., "1889")
 */
export async function fetchWikidataItemTags(itemId: string): Promise<WikidataItemTags> {
  if (!itemId || !itemId.startsWith('Q')) {
    return {};
  }

  const query = `
    SELECT ?genreLabel ?movementLabel ?inceptionDate WHERE {
      OPTIONAL { wd:${itemId} wdt:P136 ?genre . }
      OPTIONAL { wd:${itemId} wdt:P135 ?movement . }
      OPTIONAL { wd:${itemId} wdt:P571 ?inceptionDate . }
      SERVICE wikibase:label {
        bd:serviceParam wikibase:language "en" .
      }
    }
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
      return {};
    }

    const data = (await res.json()) as {
      results: { bindings: Array<Record<string, { type: string; value: string; 'xml:lang'?: string }>> };
    };

    const tags: WikidataItemTags = {};

    for (const binding of data.results?.bindings ?? []) {
      if (binding.genreLabel?.value && !tags.genre) {
        tags.genre = binding.genreLabel.value;
      }
      if (binding.movementLabel?.value && !tags.movement) {
        tags.movement = binding.movementLabel.value;
      }
      if (binding.inceptionDate?.value && !tags.inceptionDate) {
        // P571 returns dates in various formats, extract year if possible
        const dateValue = binding.inceptionDate.value;
        const yearMatch = dateValue.match(/\d{4}/);
        if (yearMatch) {
          tags.inceptionDate = yearMatch[0];
        } else {
          tags.inceptionDate = dateValue;
        }
      }
    }

    return tags;
  } catch {
    return {};
  }
}

