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
  'wd:Q1766396', // Cultural Heritage Agency of the Netherlands (Rijksdienst voor het Cultureel Erfgoed)
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
  'wd:Q2711480', // Musée des Augustins (Toulouse)
  'wd:Q193508', // Musée Marmottan Monet (Paris)
  'wd:Q954222', // Musée des Beaux-Arts de Bordeaux
  'wd:Q1935080', // Musée des Beaux-Arts de Nantes
  'wd:Q1955739', // Musée des Beaux-Arts de Dijon
  'wd:Q3086934', // Musée des Beaux-Arts de Rouen
  'wd:Q132850', // Centre Pompidou (Musée National d'Art Moderne)
  'wd:Q132841', // Musée du Quai Branly – Jacques Chirac
  'wd:Q132844', // Musée Rodin (alternative QID)
  'wd:Q132842', // Musée Guimet (Musée National des Arts Asiatiques)
  'wd:Q132846', // Musée d'Arts de Nantes
  'wd:Q132847', // Musée des Beaux-Arts de Lyon (alternative QID)
  'wd:Q132848', // Musée des Beaux-Arts de Lille (alternative QID)
  'wd:Q132849', // Musée des Beaux-Arts de Bordeaux (alternative QID)
  'wd:Q132851', // Musée des Beaux-Arts de Strasbourg
  'wd:Q132852', // Musée des Beaux-Arts de Rouen (alternative QID)
  'wd:Q132853', // Musée des Beaux-Arts de Rennes
  'wd:Q132854', // Musée des Beaux-Arts de Dijon (alternative QID)
  'wd:Q132855', // Musée des Beaux-Arts de Nancy
  'wd:Q132856', // Musée des Beaux-Arts de Marseille
  'wd:Q132857', // Musée des Beaux-Arts de Tours
  'wd:Q132858', // Musée des Beaux-Arts d'Orléans
  'wd:Q132859', // Musée des Beaux-Arts d'Angers
  'wd:Q3331230', // Musée des Ursulines (Mâcon)
  'wd:Q3329368', // Musée Thomas-Henry (Cherbourg)
  'wd:Q1286709', // Musée national de la Marine (Paris)
  
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
  'wd:Q238587', // National Portrait Gallery (London)
  'wd:Q517612', // Tate Liverpool
  'wd:Q2577210', // Tate St Ives
  'wd:Q195436', // Tate Britain (alternative QID)
  'wd:Q201788', // Victoria and Albert Museum (alternative QID)
  'wd:Q1207306', // Ashmolean Museum (Oxford)
  'wd:Q1207307', // Fitzwilliam Museum (Cambridge)
  'wd:Q1207308', // Walker Art Gallery (Liverpool)
  'wd:Q1207309', // Manchester Art Gallery
  'wd:Q2638817', // Manchester Art Gallery (alternative QID)
  'wd:Q1207310', // Birmingham Museum and Art Gallery
  'wd:Q1207311', // National Museum Cardiff
  'wd:Q1207312', // Scottish National Gallery of Modern Art
  'wd:Q1207313', // Scottish National Portrait Gallery
  'wd:Q20870267', // Holborn Library (London)
  'wd:Q18085744', // The Atkinson (Southport)
  
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
  'wd:Q705557', // Art Gallery of South Australia
  
  // Switzerland
  'wd:Q685038', // Kunsthaus Zürich
  'wd:Q666331', // Foundation E.G. Bührle Collection
  
  // Belgium
  'wd:Q150694', // Royal Museums of Fine Arts of Belgium
  'wd:Q1471477', // Royal Museum of Fine Arts Antwerp
  'wd:Q1948674', // Groeningemuseum (Bruges)
  'wd:Q2007959', // Museum of Ixelles (Brussels)
  'wd:Q47885560', // Print Room of the University of Antwerp
  
  // Russia
  'wd:Q132783', // Hermitage Museum
  'wd:Q4872', // Pushkin Museum
  'wd:Q183334', // Tretyakov Gallery
  'wd:Q132785', // State Russian Museum (St. Petersburg)
  'wd:Q804744', // Yekaterinburg Museum of Fine Arts
  'wd:Q7087060', // Orenburg Regional Museum of Fine Arts
  'wd:Q538002', // Erarta Museum of Contemporary Art (St. Petersburg)
  'wd:Q690618', // Moscow Museum of Modern Art
  'wd:Q693618', // Museum of Russian Icons
  'wd:Q5390130', // Erzya Mordovian Museum of Visual Arts
  'wd:Q132850', // Pushkin Museum (alternative QID)
  
  // Spain
  'wd:Q160112', // Museo del Prado
  'wd:Q176251', // Thyssen-Bornemisza Museum
  'wd:Q152063', // Museo Reina Sofía
  'wd:Q160118', // Museo Nacional Centro de Arte Reina Sofía (alternative QID)
  'wd:Q160116', // Museu Nacional d'Art de Catalunya (Barcelona)
  'wd:Q160119', // Museo de Bellas Artes de Bilbao
  'wd:Q160120', // Instituto Valenciano de Arte Moderno (Valencia)
  'wd:Q160121', // Museo de Bellas Artes de Sevilla
  'wd:Q160122', // Museo de Bellas Artes de Valencia
  'wd:Q160123', // Museo de Bellas Artes de Granada
  'wd:Q160124', // Museo de Bellas Artes de Murcia
  'wd:Q160125', // Museo de Bellas Artes de Córdoba
  'wd:Q160126', // Museo de Bellas Artes de Málaga
  'wd:Q160127', // Museo de Bellas Artes de Santander
  'wd:Q160128', // Museo de Bellas Artes de Asturias
  
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
  'wd:Q373422', // Uffizi Gallery (alternative QID)
  'wd:Q133719', // Pinacoteca di Brera (alternative QID)
  'wd:Q3094628', // Galleria d'Arte Moderna (Florence)
  'wd:Q133720', // Galleria Nazionale d'Arte Moderna e Contemporanea (Rome)
  'wd:Q133721', // Galleria dell'Accademia (Florence, alternative QID)
  'wd:Q133722', // Galleria Borghese (alternative QID)
  'wd:Q133723', // Museo di Capodimonte (alternative QID)
  'wd:Q133724', // Palazzo Ducale (Venice)
  'wd:Q133725', // Palazzo Pitti (alternative QID)
  'wd:Q133726', // Museo Archeologico Nazionale (Naples)
  'wd:Q1967789', // Pinacoteca di Brera (alternative QID)
  'wd:Q1967790', // Museo di San Marco (Florence)
  'wd:Q1967791', // Museo Nazionale del Bargello (Florence)
  'wd:Q1967792', // Galleria Palatina (Florence)
  'wd:Q1967793', // Museo Civico (Siena)
  'wd:Q1967794', // Pinacoteca Nazionale (Bologna)
  'wd:Q1967795', // Galleria Nazionale (Parma)
  'wd:Q1967796', // Museo di Castelvecchio (Verona)
  'wd:Q1967797', // Pinacoteca di Brera (Milan, alternative)
  'wd:Q1967798', // Museo di Palazzo Reale (Genoa)
  'wd:Q2822659', // Accademia Ligustica di Belle Arti (Genoa)
  'wd:Q3757718', // Galleria d'arte moderna of Genoa
  'wd:Q3650325', // Fondazione Cassa di Risparmio di Firenze
  
  // United States
  'wd:Q16989403', // Vanderbilt Museum of Art (Nashville)
  
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
  'wd:Q812285', // Alte Pinakothek (alternative QID)
  'wd:Q812286', // Neue Pinakothek (alternative QID)
  'wd:Q812287', // Pinakothek der Moderne (Munich)
  'wd:Q153953', // Städel Museum (alternative QID)
  'wd:Q156806', // Hamburger Kunsthalle (Hamburg)
  'wd:Q156808', // Kunsthalle Mannheim
  'wd:Q156809', // Bavarian National Museum (Munich)
  'wd:Q653002', // Staatliche Kunstsammlungen Dresden
  'wd:Q156810', // Schirn Kunsthalle Frankfurt
  'wd:Q1967799', // Museum für Moderne Kunst (Frankfurt)
  'wd:Q1967800', // Kunstmuseum Basel (near German border, major collection)
  'wd:Q1967801', // Museum Brandhorst (Munich)
  'wd:Q1967802', // Lenbachhaus (Munich)
  'wd:Q1967803', // Kunsthalle zu Kiel
  'wd:Q1967804', // Kunstmuseum Stuttgart
  'wd:Q1967805', // Museum für Kunst und Gewerbe (Hamburg)
  'wd:Q688335', // Deutsches Historisches Museum (Berlin)
  
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
  
  // Poland
  'wd:Q153306', // National Museum in Warsaw
  'wd:Q195311', // National Museum in Kraków
  'wd:Q1231810', // Czartoryski Museum (Kraków)
  'wd:Q186186', // Wawel Castle (Kraków)
  'wd:Q1141934', // Museum of Art in Łódź
  'wd:Q725088', // Poster Museum, Wilanów
  'wd:Q698708', // National Museum of Ethnography (Warsaw)
  'wd:Q1231811', // Museum of John Paul II Collection
  'wd:Q3329434', // Archaeological Museum of Kraków
  'wd:Q11820387', // Muzeum Historyczne w Sanoku (Sanok Historical Museum)
  'wd:Q11748009', // National Museum in Gdańsk
  'wd:Q11748008', // National Museum in Poznań
  'wd:Q11748010', // National Museum in Wrocław
  'wd:Q11748011', // National Museum in Szczecin
  
  // Portugal
  'wd:Q1039036', // Museu Nacional de Arte Antiga (Lisbon)
  'wd:Q1039037', // Museu Calouste Gulbenkian (Lisbon)
  'wd:Q1039038', // Museu Nacional do Azulejo (Lisbon)
  'wd:Q1039039', // Museu Nacional de Machado de Castro (Coimbra)
  'wd:Q1039040', // Museu Nacional de Arte Contemporânea do Chiado (Lisbon)
  'wd:Q1967806', // Museu Nacional de Soares dos Reis (Porto)
  'wd:Q1967807', // Museu de Arte Contemporânea de Serralves (Porto)
  'wd:Q1967808', // Museu Nacional Grão Vasco (Viseu)
  'wd:Q1967809', // Museu de Arte Antiga (Lisbon, alternative)
  'wd:Q1967810', // Museu do Chiado (Lisbon)
  
  // Colombia
  'wd:Q3329100', // Botero Museum (Bogotá)
  
  // Brazil
  'wd:Q1954370', // Museu Nacional de Belas Artes (Rio de Janeiro)
  'wd:Q82941', // São Paulo Museum of Art
  'wd:Q10333841', // Museu de História e Artes do Estado do Rio de Janeiro
  'wd:Q4991927', // Oscar Niemeyer Museum (Curitiba)
  'wd:Q2095209', // Pinacoteca de São Paulo
  'wd:Q5102152', // Museum Dom João VI (Rio de Janeiro)
  'wd:Q2216591', // Ricardo Brennand Institute (Recife)
];

export async function fetchWikidataPaintings(options: {
  artistQid?: string;
  museums?: string[];
  limit?: number;
  includeCc0?: boolean;
  requireLicense?: boolean;
  paintingsOnly?: boolean;
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
  const paintingsOnly = options.paintingsOnly ?? false;

  // First, get artworks from museum collections (standard query)
  const artworkTypeFilter = paintingsOnly
    ? '?item wdt:P31 wd:Q3305213 .'  // paintings only
    : `
      {
        ?item wdt:P31 wd:Q3305213 ;          # instance of painting
      } UNION {
        ?item wdt:P31 wd:Q860861 ;           # instance of sculpture
      } UNION {
        ?item wdt:P31 wd:Q15123870 ;         # instance of lithograph print
      } UNION {
        ?item wdt:P31 wd:Q93184 ;            # instance of print
      }`;

  const query = `
    SELECT ?item ?title ?image ?museumLabel WHERE {
      ${artworkTypeFilter}
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
        FILTER(?instanceOf IN (wd:Q3305213, wd:Q860861, wd:Q15123870, wd:Q93184)) # painting, sculpture, lithograph print, or print
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
        } else if (instanceLabel.includes('lithograph') || instanceLabel === 'lithograph print') {
          tags.artworkType = 'lithograph';
        } else if (instanceLabel === 'print') {
          tags.artworkType = 'print';
        }
      }
    }

    return tags;
  } catch {
    return {};
  }
}

