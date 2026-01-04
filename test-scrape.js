const fetch = require('node-fetch');

async function testGoogleArtsScrape() {
  const url = 'https://artsandculture.google.com/asset/the-lovers-marc-chagall/jQEveVgIzd6-Og';

  try {
    console.log(`Testing scrape of: ${url}`);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    if (!response.ok) {
      console.log(`HTTP ${response.status}: ${response.statusText}`);
      return;
    }

    const html = await response.text();
    console.log(`HTML length: ${html.length} characters`);

    // Test title extraction
    const titlePatterns = [
      /<h1[^>]*>([^<]+)<\/h1>/i,
      /"name":\s*"([^"]+)"/i,
      /<title>([^<]+)<\/title>/i,
      /og:title" content="([^"]+)"/i,
    ];

    console.log('\n=== TITLE EXTRACTION ===');
    for (const pattern of titlePatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        console.log(`Pattern ${pattern.source}: "${match[1].trim()}"`);
      }
    }

    // Test artist extraction
    const artistPatterns = [
      /href="\/entity\/([^\/]+)\/[^"]*\?categoryId=artist"/i,
      /"author":\s*"([^"]+)"/i,
      /"author\\":\s*"([^"]+)"/i,
      /"creator":\s*"([^"]+)"/i,
    ];

    console.log('\n=== ARTIST EXTRACTION ===');
    for (const pattern of artistPatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        console.log(`Pattern ${pattern.source}: "${match[1].trim()}"`);
      }
    }

    // Look for JSON data
    const jsonMatch = html.match(/window\['[^']*'\]\s*=\s*({[^}]*})/);
    if (jsonMatch) {
      console.log('\n=== FOUND JSON DATA ===');
      console.log(jsonMatch[1].substring(0, 200) + '...');
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

testGoogleArtsScrape();

