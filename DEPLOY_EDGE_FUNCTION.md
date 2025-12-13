# Deploying the Mastodon Post Edge Function

## Option 1: Using Supabase CLI (Recommended)

### Step 1: Install Supabase CLI

**Linux:**
```bash
# Using npm (if you have Node.js)
npm install -g supabase

# Or using the install script
curl -fsSL https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.tar.gz | tar -xz
sudo mv supabase /usr/local/bin/
```

**macOS:**
```bash
brew install supabase/tap/supabase
```

**Windows:**
```bash
# Using npm
npm install -g supabase

# Or using Scoop
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase
```

### Step 2: Login to Supabase
```bash
supabase login
```

### Step 3: Link to Your Project
```bash
cd /home/jonathanhdavis/wikicommons-art-scraper
supabase link --project-ref YOUR_PROJECT_REF
```

You can find your project ref in your Supabase dashboard URL: `https://supabase.com/dashboard/project/YOUR_PROJECT_REF`

### Step 4: Set Environment Variables

Create a `.env` file in the `supabase/functions/mastodon-post/` directory, or set them via the Supabase dashboard:

```bash
# In supabase/functions/mastodon-post/.env (optional, can also set in dashboard)
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
MASTODON_BASE_URL=https://mastodon.social
MASTODON_ACCESS_TOKEN=your_mastodon_token
BUCKET=Art
PREFIX=vincent-van-gogh
```

**Or set them in the Supabase Dashboard:**
1. Go to your Supabase project dashboard
2. Navigate to **Edge Functions** → **mastodon-post** → **Settings**
3. Add the environment variables there

### Step 5: Deploy the Function
```bash
supabase functions deploy mastodon-post
```

## Option 2: Using Supabase Dashboard (Web UI)

1. Go to your Supabase project dashboard
2. Navigate to **Edge Functions** in the sidebar
3. Click **Create a new function**
4. Name it `mastodon-post`
5. Copy the contents of `supabase/functions/mastodon-post/index.ts` into the editor
6. Set the environment variables in the function settings
7. Click **Deploy**

## Option 3: Using Supabase CLI with Direct Project Reference

If you don't want to link the project, you can deploy directly:

```bash
supabase functions deploy mastodon-post \
  --project-ref YOUR_PROJECT_REF \
  --no-verify-jwt
```

## Verify Deployment

After deployment, test the function:

```bash
# Test with storage listing (default)
curl "https://YOUR_PROJECT_REF.supabase.co/functions/v1/mastodon-post?PREFIX=vincent-van-gogh" \
  -H "Authorization: Bearer YOUR_ANON_KEY"

# Test with database query
curl "https://YOUR_PROJECT_REF.supabase.co/functions/v1/mastodon-post?use_db=true&artist=Vincent van Gogh" \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

## Environment Variables Required

- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Your service role key (from Supabase dashboard)
- `MASTODON_BASE_URL` - Your Mastodon instance URL (default: https://mastodon.social)
- `MASTODON_ACCESS_TOKEN` - Your Mastodon API access token

Optional:
- `BUCKET` - Storage bucket name (default: 'Art')
- `PREFIX` - Artist folder prefix (default: 'vincent-van-gogh')

## Troubleshooting

If you get "function not found" errors:
- Make sure the function is deployed: `supabase functions list`
- Check the function name matches exactly: `mastodon-post`

If you get storage errors:
- Verify the bucket name is correct (should be 'Art' capitalized)
- Check that the PREFIX matches the artist slug format (e.g., 'vincent-van-gogh')

If you get authentication errors:
- Verify your `SUPABASE_SERVICE_ROLE_KEY` is correct
- Make sure the key has the right permissions

