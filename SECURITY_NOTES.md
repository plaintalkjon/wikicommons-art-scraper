# Security Notes for mastodon_accounts Table

## Protection Strategy

The `mastodon_accounts` table is protected using **Row Level Security (RLS)**:

### What RLS Does

1. **Blocks Public Access** - No one can read tokens via the public Supabase API
2. **Blocks Authenticated Users** - Even logged-in users cannot access
3. **Allows Service Role** - Edge functions can still access (they use service role key)

### How It Works

- **RLS Policy**: `"Deny all public access"` blocks all public/anonymous access
- **Service Role Bypass**: Edge functions use `SUPABASE_SERVICE_ROLE_KEY` which automatically bypasses RLS
- **Result**: Only your edge functions can read tokens, no one else

### Testing Security

Try accessing via public API (should fail):
```bash
# This should return empty or error
curl "https://YOUR_PROJECT.supabase.co/rest/v1/mastodon_accounts" \
  -H "apikey: YOUR_ANON_KEY"
```

Edge function access (should work):
- Edge functions use service role key
- They automatically bypass RLS
- No changes needed to your code

### Additional Security Measures

1. **Never expose service role key** - Keep it in environment variables only
2. **Rotate tokens regularly** - Update tokens in database periodically
3. **Monitor access** - Check Supabase logs for any unauthorized access attempts
4. **Use Supabase Vault** (optional) - For even more security, consider storing tokens in Supabase Vault instead of plain database

### Supabase Vault Alternative

For maximum security, you could use Supabase Vault:

```sql
-- Store token in vault
SELECT vault.create_secret('your_token_here', 'mastodon_token_vincent_van_gogh');

-- Retrieve in edge function
SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'mastodon_token_vincent_van_gogh';
```

However, database storage with RLS is secure enough for most use cases since:
- Only service role can access
- Tokens are not exposed via public API
- Easy to manage and update

