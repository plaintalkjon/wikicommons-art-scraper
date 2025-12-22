# Apply Row Level Security (RLS) Policies

## Quick Steps

1. **Open Supabase Dashboard**
   - Go to your Supabase project
   - Navigate to **SQL Editor** (left sidebar)

2. **Copy the SQL**
   - Open the file: `docs/setup-comprehensive-rls-corrected.sql`
   - Copy the entire contents (Ctrl+A, Ctrl+C)

3. **Paste and Run**
   - Paste into the SQL Editor
   - Click **Run** (or press Ctrl+Enter)

4. **Verify**
   - Run the verification queries at the bottom of the SQL file
   - Or run: `docs/verify-rls-status.sql`

## What This Does

✅ **Enables RLS** on all tables  
✅ **Allows public read** on non-sensitive tables (artists, arts, tags, etc.)  
✅ **Blocks public write** on all tables  
✅ **Fully protects** sensitive tables (mastodon_accounts, mastodon_account_tags)  

## Important Notes

- **Service role key automatically bypasses RLS** - your scripts will continue to work
- **Public can browse artworks** but cannot modify anything
- **Mastodon tokens are fully protected** - only accessible via service role

## File Location

The SQL file is located at:
```
docs/setup-comprehensive-rls-corrected.sql
```

## After Applying

Test that it works:

```bash
# Public can read (should work)
curl -H "apikey: YOUR_ANON_KEY" \
  "https://YOUR_PROJECT.supabase.co/rest/v1/artists?select=*&limit=5"

# Public cannot write (should fail)
curl -X POST \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "Test"}' \
  "https://YOUR_PROJECT.supabase.co/rest/v1/artists"

# Public cannot read tokens (should return empty)
curl -H "apikey: YOUR_ANON_KEY" \
  "https://YOUR_PROJECT.supabase.co/rest/v1/mastodon_accounts?select=*"
```
