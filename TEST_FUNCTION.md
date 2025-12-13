# Testing the post-art Function

## Quick Test

Replace `YOUR_ANON_KEY` with your actual anon key from Supabase Dashboard → Settings → API:

```bash
curl -X POST \
  "https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/post-art?artist=Vincent%20van%20Gogh" \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

Or use the test script:
```bash
./test-post-art.sh "Vincent van Gogh"
```

## Expected Response

If successful, you should see:
```json
{
  "ok": true,
  "media_id": "...",
  "status_id": "...",
  "storage_path": "vincent-van-gogh/...",
  "title": "Artwork Title",
  "artist": "Vincent van Gogh",
  "candidates_count": 486
}
```

## Troubleshooting

**If you get "No Mastodon account found":**
- Make sure you've run `docs/add-vincent-van-gogh-account.sql` to add the account to the database

**If you get "No images found":**
- Make sure Vincent van Gogh has artwork in the database
- Check that the artist name matches exactly: "Vincent van Gogh"

**If you get authentication errors:**
- Verify your anon key is correct
- Make sure the function is deployed

## Test Different Artists

```bash
# Vincent van Gogh
curl -X POST "https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/post-art?artist=Vincent%20van%20Gogh" \
  -H "Authorization: Bearer YOUR_ANON_KEY"

# Rembrandt (once you add their account)
curl -X POST "https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/post-art?artist=Rembrandt%20van%20Rijn" \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

