import { config } from './config';

const OAUTH_ENDPOINT = 'https://meta.wikimedia.org/w/rest.php/oauth2/access_token';
const TOKEN_CACHE_TTL_MS = 3.5 * 60 * 60 * 1000; // 3.5 hours (tokens expire after 4 hours)

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

/**
 * Get a valid Wikimedia OAuth access token
 * Uses client credentials flow and caches the token until it expires
 */
export async function getWikimediaAccessToken(): Promise<string | null> {
  // Check if we have credentials
  if (!config.wikimediaClientId || !config.wikimediaClientSecret) {
    return null; // No OAuth credentials, use unauthenticated requests
  }

  // Check cache first
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }

  // Request new token
  try {
    const formData = new URLSearchParams();
    formData.append('grant_type', 'client_credentials');
    formData.append('client_id', config.wikimediaClientId);
    formData.append('client_secret', config.wikimediaClientSecret);

    const res = await fetch(OAUTH_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'wikicommons-art-scraper/1.0',
      },
      body: formData.toString(),
    });

    if (!res.ok) {
      const errorText = await res.text();
      let errorMessage = `Failed to get Wikimedia access token: ${res.status} ${errorText}`;
      
      // Provide helpful diagnostics for common errors
      if (res.status === 401) {
        try {
          const errorData = JSON.parse(errorText);
          if (errorData.error === 'invalid_client') {
            errorMessage += '\n  → This usually means:';
            errorMessage += '\n    1. The OAuth consumer is pending approval (can take up to 2 weeks)';
            errorMessage += '\n    2. The client ID or secret is incorrect';
            errorMessage += '\n    3. The redirect URI doesn\'t match the registered one';
            errorMessage += '\n  → Check status at: https://meta.wikimedia.org/wiki/Special:OAuthConsumerRegistration/list';
            errorMessage += '\n  → Falling back to unauthenticated requests (lower rate limits)';
          }
        } catch {
          // If we can't parse the error, just use the original message
        }
      }
      
      console.error(errorMessage);
      return null;
    }

    const data = (await res.json()) as { access_token: string; expires_in?: number };
    
    if (!data.access_token) {
      console.error('No access token in OAuth response');
      return null;
    }

    // Cache the token (expires in 4 hours, cache for 3.5 hours to be safe)
    const expiresIn = data.expires_in ?? 4 * 60 * 60; // Default to 4 hours
    tokenCache = {
      accessToken: data.access_token,
      expiresAt: Date.now() + Math.min(expiresIn * 1000, TOKEN_CACHE_TTL_MS),
    };

    console.log(`✓ Obtained Wikimedia OAuth access token (expires in ${Math.round(expiresIn / 60)} minutes)`);
    return tokenCache.accessToken;
  } catch (err) {
    console.error('Error getting Wikimedia access token:', err);
    return null;
  }
}




