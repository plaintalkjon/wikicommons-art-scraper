# Testing RLS Policies

After running `setup-comprehensive-rls-corrected.sql`, you can test the policies to ensure they work correctly.

## Test 1: Public Read Access (Should Work)

Using the **anon key** (public API key), try to read data:

```bash
# Test reading artists
curl -H "apikey: YOUR_ANON_KEY" \
  "https://YOUR_PROJECT.supabase.co/rest/v1/artists?select=*&limit=5"

# Test reading arts
curl -H "apikey: YOUR_ANON_KEY" \
  "https://YOUR_PROJECT.supabase.co/rest/v1/arts?select=*&limit=5"

# Test reading tags
curl -H "apikey: YOUR_ANON_KEY" \
  "https://YOUR_PROJECT.supabase.co/rest/v1/tags?select=*&limit=5"
```

**Expected**: Should return data ✅

## Test 2: Public Write Access (Should Fail)

Try to insert data using the **anon key**:

```bash
# Try to insert an artist (should fail)
curl -X POST \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -d '{"name": "Test Artist"}' \
  "https://YOUR_PROJECT.supabase.co/rest/v1/artists"
```

**Expected**: Should return 403 Forbidden or similar error ❌

## Test 3: Public Read Sensitive Tables (Should Fail)

Try to read sensitive tables using the **anon key**:

```bash
# Try to read mastodon_accounts (should fail)
curl -H "apikey: YOUR_ANON_KEY" \
  "https://YOUR_PROJECT.supabase.co/rest/v1/mastodon_accounts?select=*"
```

**Expected**: Should return empty array or 403 Forbidden ❌

## Test 4: Service Role Access (Should Work)

Using the **service role key** (in your scripts), everything should work:

```typescript
// This should work - service role bypasses RLS
const { data } = await supabase
  .from('artists')
  .select('*')
  
// This should also work
const { data } = await supabase
  .from('mastodon_accounts')
  .select('*')
```

**Expected**: Should return data ✅

## Verification in Supabase Dashboard

1. Go to **Authentication** > **Policies**
2. Check each table to see the policies
3. Verify:
   - Non-sensitive tables have "Public can read" policies
   - All tables have "Public cannot modify" policies
   - Sensitive tables have "Deny all" policies

## Common Issues

**Issue**: "RLS is enabled but I can't read data"
- Check that policies are created correctly
- Verify the policy `USING (true)` clause is correct
- Check that RLS is actually enabled: `SELECT tablename, rowsecurity FROM pg_tables WHERE tablename = 'artists';`

**Issue**: "Service role can't write"
- Service role should bypass RLS automatically
- If it doesn't, check your Supabase client is using the service role key
- Verify the key starts with `eyJ...` and is the service_role key, not anon key


