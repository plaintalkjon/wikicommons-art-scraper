# Deploy MTG Card Bot Edge Function

## Option 1: Deploy via Supabase Dashboard (Easiest)

1. Go to your Supabase Dashboard: https://supabase.com/dashboard
2. Select your project
3. Navigate to **Edge Functions** in the left sidebar
4. Click **"Create a new function"** or **"Deploy function"**
5. Function name: `post-mtg-card`
6. Copy the contents of `supabase/functions/post-mtg-card/index.ts`
7. Paste into the editor
8. Click **"Deploy"**

## Option 2: Deploy via Supabase CLI

### Install Supabase CLI (if not installed):

```bash
# macOS
brew install supabase/tap/supabase

# Linux (using npm)
npm install -g supabase

# Or download from: https://github.com/supabase/cli/releases
```

### Login and Deploy:

```bash
# Login to Supabase
supabase login

# Link to your project (if not already linked)
supabase link --project-ref lxtkpwsxupzkxuhhmvvz

# Deploy the function
supabase functions deploy post-mtg-card
```

## Verify Deployment

After deploying, test the function:

```bash
curl -X POST \
  'https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/post-mtg-card?account=CuratedMTGShowcase' \
  -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4dGtwd3N4dXB6a3h1aGhtdnZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUxMTY2OTQsImV4cCI6MjA4MDY5MjY5NH0.TpaMU7-7-U7BSyjqPkfiGjpHFB6qVt1dMUxG5KFptR8'
```

You should see a response indicating the function ran successfully.

## Next Steps

After deploying the function:
1. Run the SQL from `setup-mtg-bot-final.sql` in Supabase SQL Editor
2. The bot will start posting automatically every 6 hours!

