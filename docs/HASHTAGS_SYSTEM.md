# Hashtags System for Quote Accounts

## Overview

The hashtags system allows you to assign **multiple hashtags** to each quote account. This enables more specific categorization and better discoverability on Mastodon. For example, Marcus Aurelius and Seneca the Younger can both have `#philosophy` and `#stoicism` hashtags.

## Architecture

### Database Tables

1. **`hashtags`** - Stores hashtag definitions
   - `id` - UUID primary key
   - `name` - Hashtag name (e.g., 'philosophy', 'stoicism') - stored without `#`, lowercase
   - `created_at`, `updated_at` - Timestamps

2. **`mastodon_account_hashtags`** - Junction table linking accounts to hashtags
   - `id` - UUID primary key
   - `mastodon_account_id` - Foreign key to `mastodon_accounts`
   - `hashtag_id` - Foreign key to `hashtags`
   - `created_at` - Timestamp
   - Unique constraint on `(mastodon_account_id, hashtag_id)` to prevent duplicates

### How It Works

1. **Quote Posting**: When a quote is posted, the system fetches all hashtags assigned to the account from the `mastodon_account_hashtags` junction table
2. **Fallback**: If no hashtags are assigned, the system falls back to the category-based hashtag (backward compatibility)
3. **Format**: Hashtags are appended to the quote text with double newlines: `"Quote text"\n\n#hashtag1 #hashtag2`

## Setup

### Step 1: Run Migration

Run the migration SQL to create the tables and migrate existing accounts:

```sql
-- Run migrate-hashtags-system.sql in Supabase SQL Editor
```

This will:
- Create `hashtags` table
- Create `mastodon_account_hashtags` junction table
- Insert common hashtags (philosophy, stoicism, literature, politics, science, art, wisdom, quotes)
- Migrate existing quote accounts to use hashtags based on their author's category

### Step 2: Assign Hashtags to Accounts

Use the CLI tool to manage hashtags:

```bash
# List hashtags for an account
npm run manage-hashtags -- --account username --list

# Add hashtags to an account
npm run manage-hashtags -- --account username --add philosophy stoicism

# Remove hashtags from an account
npm run manage-hashtags -- --account username --remove philosophy

# Create a new hashtag
npm run manage-hashtags -- --create stoicism

# List all available hashtags
npm run manage-hashtags -- --list-all
```

## Examples

### Example 1: Marcus Aurelius Account

```bash
# Add both philosophy and stoicism hashtags
npm run manage-hashtags -- --account MarcusAureliusBot --add philosophy stoicism
```

**Result**: Posts will include `#philosophy #stoicism`

### Example 2: Seneca the Younger Account

```bash
# Add philosophy, stoicism, and wisdom hashtags
npm run manage-hashtags -- --account SenecaBot --add philosophy stoicism wisdom
```

**Result**: Posts will include `#philosophy #stoicism #wisdom`

### Example 3: Mark Twain Account

```bash
# Add literature and quotes hashtags
npm run manage-hashtags -- --account MarkTwainBot --add literature quotes
```

**Result**: Posts will include `#literature #quotes`

## Code Changes

### Updated `formatQuote` Function

The `formatQuote` function in `supabase/functions/post-art/index.ts` now:
1. Accepts `accountId` and `supabase` client as parameters
2. Fetches hashtags from `mastodon_account_hashtags` junction table
3. Falls back to category-based hashtag if no hashtags are assigned
4. Returns formatted quote with multiple hashtags

```typescript
async function formatQuote(
  quote: { text: string; author: string; category?: string },
  accountId: string,
  supabase: any
): Promise<string> {
  // Fetch hashtags from junction table
  const { data: accountHashtags } = await supabase
    .from("mastodon_account_hashtags")
    .select(`hashtag_id, hashtags!inner(name)`)
    .eq("mastodon_account_id", accountId)
    .order("hashtags(name)", { ascending: true });

  // Use hashtags or fallback to category-based
  const hashtags = accountHashtags?.length > 0
    ? accountHashtags.map(ah => `#${ah.hashtags.name}`)
    : [getCategoryHashtag(quote.category)];

  return `"${quote.text}"\n\n${hashtags.join(' ')}`;
}
```

## Backward Compatibility

The system maintains backward compatibility:
- If no hashtags are assigned to an account, it uses the category-based hashtag (same as before)
- Existing accounts are automatically migrated during setup
- The migration assigns hashtags based on the author's category

## Common Hashtags

Pre-created hashtags include:
- `#philosophy` - General philosophy
- `#stoicism` - Stoic philosophy
- `#literature` - Literary quotes
- `#politics` - Political quotes
- `#science` - Scientific quotes
- `#art` - Art-related quotes
- `#wisdom` - General wisdom
- `#quotes` - General quotes

You can create additional hashtags as needed using the CLI tool.

## Best Practices

1. **Use Specific Hashtags**: Use specific hashtags like `#stoicism` rather than just `#philosophy` when appropriate
2. **Multiple Hashtags**: Assign 2-3 relevant hashtags per account for better discoverability
3. **Lowercase Only**: All hashtags are automatically converted to lowercase (e.g., `Stoicism` becomes `stoicism`)
4. **Consistent Naming**: Use single-word hashtags (e.g., `stoicism` not `stoic-philosophy`)
5. **Review Regularly**: Periodically review hashtags to ensure they're still relevant

## Troubleshooting

### Hashtags Not Appearing in Posts

1. Verify hashtags are assigned: `npm run manage-hashtags -- --account username --list`
2. Check account exists and is of type 'quote'
3. Verify migration was run successfully
4. Check function logs for errors

### Creating New Hashtags

```bash
# Create a new hashtag
npm run manage-hashtags -- --create existentialism

# Then assign it to accounts
npm run manage-hashtags -- --account username --add existentialism
```

### Removing All Hashtags

If you want to remove all hashtags and use the category-based fallback:

```bash
# List current hashtags first
npm run manage-hashtags -- --account username --list

# Remove each one
npm run manage-hashtags -- --account username --remove hashtag1 hashtag2 ...
```

