const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';

export interface WikidataPainting {
  title: string; // commons file title, e.g., "File:Starry Night.jpg"
  museum?: string;
  itemId?: string; // QID
  imageUrl?: string;
}

/**
 * Look up Wikidata QID for an artist by name
 */
export async function findArtistQID(artistName: string): Promise<string | null> {
  // Simplified query - search by label first, then filter by occupation
  const query = `
    SELECT ?item ?itemLabel WHERE {
      ?item rdfs:label "${artistName.replace(/"/g, '\\"')}"@en .
      OPTIONAL { ?item wdt:P106 ?occupation . }
      FILTER(?item = ?item && (EXISTS { ?item wdt:P106/wdt:P279* wd:Q1028181 } || EXISTS { ?item wdt:P106/wdt:P279* wd:Q42973 }))
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
          ?item rdfs:label "${artistName.replace(/"/g, '\\"')}"@en .
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
      
      // Try fuzzy search with CONTAINS as last resort
      const fuzzyQuery = `
        SELECT ?item ?itemLabel WHERE {
          ?item rdfs:label ?itemLabel .
          FILTER(CONTAINS(LCASE(?itemLabel), LCASE("${artistName.replace(/"/g, '\\"')}")))
          FILTER(LANG(?itemLabel) = "en")
          OPTIONAL { ?item wdt:P106 ?occupation . }
          FILTER(EXISTS { ?item wdt:P106/wdt:P279* wd:Q1028181 } || EXISTS { ?item wdt:P106/wdt:P279* wd:Q42973 })
          SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
        }
        LIMIT 1
      `;
      
      try {
        const fuzzyRes = await fetch(SPARQL_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/sparql-query',
            Accept: 'application/sparql-results+json',
            'User-Agent': 'wikicommons-art-scraper/1.0 (contact: developer@example.com)',
          },
          body: fuzzyQuery,
        });
        
        if (fuzzyRes.ok) {
          const fuzzyData = (await fuzzyRes.json()) as {
            results: { bindings: Array<Record<string, { type: string; value: string }>> };
          };
          const fuzzyBinding = fuzzyData.results?.bindings?.[0];
          if (fuzzyBinding?.item?.value) {
            return fuzzyBinding.item.value.replace('http://www.wikidata.org/entity/', '');
          }
        }
      } catch {
        // Ignore fuzzy search errors
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

const DEFAULT_MUSEUMS = [
  // Netherlands
  'wd:Q224124', // Van Gogh Museum
  'wd:Q1051928', // Kröller-Müller Museum
  'wd:Q190804', // Rijksmuseum
  'wd:Q12013217', // Noordbrabants Museum
  'wd:Q679527', // Museum Boijmans Van Beuningen
  'wd:Q221092', // Mauritshuis
  'wd:Q924335', // Stedelijk Museum Amsterdam
  'wd:Q1499958', // Kunstmuseum Den Haag (formerly Gemeentemuseum)
  
  // France
  'wd:Q23402', // Musée d'Orsay
  'wd:Q19675', // Louvre
  'wd:Q193507', // Musée Rodin
  'wd:Q1664416', // Petit Palais
  'wd:Q207694', // Grand Palais
  'wd:Q193511', // Musée des Beaux-Arts de Lyon
  'wd:Q3330218', // Musée des Beaux-Arts Jules Chéret (Nice)
  'wd:Q333', // Musée Fabre (Montpellier)
  'wd:Q333064', // Musée Granet (Aix-en-Provence)
  'wd:Q193509', // Palais des Beaux-Arts de Lille
  
  // United States - East Coast
  'wd:Q160236', // Metropolitan Museum of Art
  'wd:Q214867', // National Gallery of Art (US)
  'wd:Q49133', // Museum of Fine Arts Boston
  'wd:Q1343589', // Philadelphia Museum of Art
  'wd:Q188740', // Museum of Modern Art (MoMA)
  'wd:Q201469', // Solomon R. Guggenheim Museum
  'wd:Q682827', // Frick Collection
  'wd:Q808462', // Barnes Foundation
  'wd:Q1059456', // New-York Historical Society
  'wd:Q799531', // Wadsworth Atheneum Museum of Art
  'wd:Q1568434', // Yale University Art Gallery
  'wd:Q210081', // Walters Art Museum
  'wd:Q1192305', // Smithsonian American Art Museum
  'wd:Q59468', // Neue Galerie New York
  
  // United States - Midwest
  'wd:Q239303', // Art Institute of Chicago
  'wd:Q1760539', // Saint Louis Art Museum
  'wd:Q657415', // Cleveland Museum of Art
  'wd:Q1201549', // Detroit Institute of Arts
  'wd:Q1700481', // Minneapolis Institute of Art
  'wd:Q1743116', // Toledo Museum of Art
  'wd:Q5914', // Indianapolis Museum of Art
  'wd:Q1976985', // Nelson-Atkins Museum of Art
  'wd:Q2970522', // Cincinnati Art Museum
  'wd:Q688731', // Milwaukee Art Museum
  
  // United States - South
  'wd:Q1565911', // Museum of Fine Arts, Houston
  'wd:Q745866', // Dallas Museum of Art
  'wd:Q574848', // High Museum of Art (Atlanta)
  'wd:Q705517', // North Carolina Museum of Art
  
  // United States - West Coast
  'wd:Q1752085', // Norton Simon Museum
  'wd:Q731126', // J. Paul Getty Museum
  'wd:Q1641836', // Los Angeles County Museum of Art (LACMA)
  'wd:Q913672', // San Francisco Museum of Modern Art
  'wd:Q1416890', // Fine Arts Museums of San Francisco
  'wd:Q1189960', // Denver Art Museum
  'wd:Q1816301', // Seattle Art Museum
  'wd:Q724334', // Portland Art Museum
  'wd:Q977015', // Phoenix Art Museum
  
  // United Kingdom
  'wd:Q180788', // National Gallery (UK)
  'wd:Q430682', // Tate Britain
  'wd:Q193375', // Tate Modern
  'wd:Q12110695', // Courtauld Gallery
  'wd:Q2051997', // National Galleries Scotland
  'wd:Q1327919', // Wallace Collection
  'wd:Q6373', // British Museum
  'wd:Q213322', // Victoria and Albert Museum
  'wd:Q1459037', // Royal Collection (UK)
  
  // Canada
  'wd:Q1068063', // National Gallery of Canada
  'wd:Q693611', // Art Gallery of Ontario
  'wd:Q860812', // Montreal Museum of Fine Arts
  'wd:Q371960', // Vancouver Art Gallery
  
  // Australia
  'wd:Q1464509', // National Gallery of Victoria
  'wd:Q705551', // Art Gallery of New South Wales
  'wd:Q7270900', // Queensland Art Gallery
  'wd:Q688701', // National Gallery of Australia
  
  // Switzerland
  'wd:Q685038', // Kunsthaus Zürich
  'wd:Q666331', // Foundation E.G. Bührle Collection
  
  // Belgium
  'wd:Q150694', // Royal Museums of Fine Arts of Belgium
  'wd:Q1471477', // Royal Museum of Fine Arts Antwerp
  'wd:Q1948674', // Groeningemuseum (Bruges)
  
  // Russia
  'wd:Q132783', // Hermitage Museum
  'wd:Q4872', // Pushkin Museum
  'wd:Q183334', // Tretyakov Gallery
  
  // Spain
  'wd:Q160112', // Museo del Prado
  'wd:Q176251', // Thyssen-Bornemisza Museum
  'wd:Q152063', // Museo Reina Sofía
  
  // Italy
  'wd:Q51252', // Uffizi Gallery
  'wd:Q10855544', // Galleria dell'Accademia (Florence)
  'wd:Q150066', // Pinacoteca di Brera
  'wd:Q841506', // Galleria Borghese
  'wd:Q774940', // Pinacoteca Vaticana
  'wd:Q9135595', // Galleria Nazionale d'Arte Moderna (Rome)
  'wd:Q38348', // Palazzo Pitti
  'wd:Q716618', // Museo di Capodimonte
  'wd:Q163916', // Museo Correr (Venice)
  'wd:Q1056170', // Ca' Rezzonico (Venice)
  'wd:Q151015', // Gallerie dell'Accademia (Venice)
  'wd:Q1049033', // Peggy Guggenheim Collection
  'wd:Q132137', // Vatican Museums
  'wd:Q133799', // Capitoline Museums (Rome)
  
  // Germany
  'wd:Q154568', // Alte Pinakothek
  'wd:Q170152', // Neue Pinakothek
  'wd:Q162111', // Alte Nationalgalerie
  'wd:Q156687', // Städel Museum
  'wd:Q1539784', // Gemäldegalerie Alte Meister (Dresden)
  'wd:Q1510464', // Gemäldegalerie Neue Meister (Dresden)
  'wd:Q703640', // Museum Ludwig (Cologne)
  'wd:Q693591', // Kunsthalle Bremen
  'wd:Q1136465', // Museum Folkwang (Essen)
  'wd:Q165631', // Gemäldegalerie (Berlin)
  'wd:Q151803', // Germanisches Nationalmuseum (Nuremberg)
  'wd:Q151828', // Pergamon Museum (Berlin)
  
  // Austria
  'wd:Q95569', // Kunsthistorisches Museum
  'wd:Q371908', // Albertina
  'wd:Q303139', // Belvedere
  
  // Scandinavia
  'wd:Q842858', // Nationalmuseum (Stockholm)
  'wd:Q671384', // Statens Museum for Kunst (Copenhagen)
  'wd:Q3330707', // Nasjonalgalleriet (Oslo)
  
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

  // First, get artworks from museum collections (standard query)
  const query = `
    SELECT ?item ?title ?image ?museumLabel WHERE {
      {
        ?item wdt:P31 wd:Q3305213 ;          # instance of painting
      } UNION {
        ?item wdt:P31 wd:Q860861 ;           # instance of sculpture
      }
      ?item wdt:P170 ${artistQid} ;          # creator = artist
            wdt:P18 ?image ;                  # has an image
            wdt:P195 ?museum .                # collection (museum)
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
  artworkType?: string; // P31 (instance of) - e.g., "painting", "sculpture"
}

/**
 * Fetch curated tags from Wikidata item properties:
 * - P136: genre (e.g., "landscape art")
 * - P135: movement (e.g., "Post-Impressionism")
 * - P571: inception/creation date (e.g., "1889")
 * - P31: instance of (e.g., "painting", "sculpture")
 */
/**
 * Fetch the English title/label for a Wikidata item
 */
export async function fetchWikidataItemTitle(itemId: string): Promise<string | null> {
  if (!itemId || !itemId.startsWith('Q')) {
    return null;
  }

  const query = `
    SELECT ?titleLabel WHERE {
      wd:${itemId} rdfs:label ?titleLabel .
      FILTER(LANG(?titleLabel) = "en")
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
      return null;
    }

    const data = (await res.json()) as {
      results: { bindings: Array<Record<string, { type: string; value: string }>> };
    };

    const title = data.results?.bindings?.[0]?.titleLabel?.value;
    return title || null;
  } catch {
    return null;
  }
}

export async function fetchWikidataItemTags(itemId: string): Promise<WikidataItemTags> {
  if (!itemId || !itemId.startsWith('Q')) {
    return {};
  }

  const query = `
    SELECT ?genreLabel ?movementLabel ?inceptionDate ?instanceOfLabel WHERE {
      OPTIONAL { wd:${itemId} wdt:P136 ?genre . }
      OPTIONAL { wd:${itemId} wdt:P135 ?movement . }
      OPTIONAL { wd:${itemId} wdt:P571 ?inceptionDate . }
      OPTIONAL { 
        wd:${itemId} wdt:P31 ?instanceOf .
        FILTER(?instanceOf IN (wd:Q3305213, wd:Q860861)) # painting or sculpture
      }
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
      if (binding.instanceOfLabel?.value && !tags.artworkType) {
        // Map Wikidata labels to our tag names
        const instanceLabel = binding.instanceOfLabel.value.toLowerCase();
        if (instanceLabel === 'painting') {
          tags.artworkType = 'painting';
        } else if (instanceLabel === 'sculpture') {
          tags.artworkType = 'sculpture';
        }
      }
    }

    return tags;
  } catch {
    return {};
  }
}

