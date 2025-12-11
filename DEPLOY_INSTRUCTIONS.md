# Quick Deployment Instructions

## Option 1: Run the Deployment Script (Interactive)

```bash
cd /home/jonathanhdavis/wikicommons-art-scraper
./deploy-function.sh
```

This will:
1. Download Supabase CLI (if needed)
2. Prompt you to login (opens browser)
3. Link to your project
4. Deploy the function

## Option 2: Manual Steps

### 1. Login to Supabase
```bash
/tmp/supabase login
```
(This will open a browser for authentication)

### 2. Link Your Project
```bash
cd /home/jonathanhdavis/wikicommons-art-scraper
/tmp/supabase link --project-ref lxtkpwsxupzkxuhhmvvz
```

### 3. Deploy the Function
```bash
/tmp/supabase functions deploy mastodon-post
```

### 4. Set Environment Variables

Go to your Supabase Dashboard:
1. Navigate to **Edge Functions** → **mastodon-post** → **Settings**
2. Add these environment variables:
   - `SUPABASE_URL` = `https://lxtkpwsxupzkxuhhmvvz.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` = (from your .env file)
   - `MASTODON_BASE_URL` = `https://mastodon.social` (or your instance)
   - `MASTODON_ACCESS_TOKEN` = (your Mastodon token)
   - `BUCKET` = `Art` (optional, defaults to 'Art')
   - `PREFIX` = `vincent-van-gogh` (optional)

### 5. Test the Function

```bash
curl "https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/mastodon-post?PREFIX=vincent-van-gogh" \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

## Your Project Details

- **Project Ref**: `lxtkpwsxupzkxuhhmvvz`
- **Project URL**: `https://lxtkpwsxupzkxuhhmvvz.supabase.co`
- **Function Path**: `supabase/functions/mastodon-post/index.ts`
