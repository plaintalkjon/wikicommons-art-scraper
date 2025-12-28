# Duplicate Artist Name Constraint Error

## What Happened

During the Met-only scraping test, we encountered this error:
```
Failed to insert artist: duplicate key value violates unique constraint "artists_name_key"
```

This occurred when processing "Portrait of a Man" by an artist.

## Root Cause

The `artists` table has a **UNIQUE constraint** on the `name` column. This means no two artists can have the exact same name.

The error happens due to a **race condition** or **name normalization issue**:

### 1. Race Condition (Most Likely)

The `ensureArtist()` function in `src/db.ts` does this:
1. Check if artist exists: `SELECT ... WHERE name = 'Artist Name'`
2. If not found, insert: `INSERT INTO artists (name) VALUES ('Artist Name')`

**Problem**: When processing multiple objects in parallel (concurrency=2), two objects might:
- Both check for the same artist name at the same time
- Both find it doesn't exist
- Both try to insert it
- One succeeds, the other fails with duplicate key error

### 2. Name Normalization Issue

The Met-only pipeline uses `object.artistDisplayName` directly without normalization:

```typescript
const artistName = object.artistDisplayName || 'Unknown Artist';
artistId = await ensureArtist(artistName);
```

**Problem**: Met API might return variations like:
- "John Smith (American)"
- "John Smith"
- "John  Smith" (extra spaces)
- "john smith" (different case)

If the database has "John Smith" but Met returns "John Smith (American)", the check won't find it and will try to insert a duplicate.

### 3. Case Sensitivity

PostgreSQL (which Supabase uses) string comparisons are **case-sensitive** by default. So:
- "John Smith" ≠ "john smith"
- If one exists, the other will try to insert and fail

## Current Code Flow

```typescript
// src/pipeline-met-only.ts
const artistName = object.artistDisplayName || 'Unknown Artist';
if (artistMap.has(artistName)) {
  artistId = artistMap.get(artistName)!;
} else {
  artistId = await ensureArtist(artistName);  // ← Error happens here
  artistMap.set(artistName, artistId);
}
```

The `artistMap` helps within a single run, but:
- Doesn't help with database-level duplicates
- Doesn't normalize names
- Doesn't prevent race conditions between parallel processes

## Solution

### Option 1: Add Name Normalization (Recommended)

Normalize artist names before calling `ensureArtist()`:

```typescript
function normalizeArtistName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ' ')           // Multiple spaces to single
    .replace(/\([^)]*\)/g, '')     // Remove parenthetical notes
    .trim();
}

// In pipeline-met-only.ts
const artistName = normalizeArtistName(object.artistDisplayName || 'Unknown Artist');
```

### Option 2: Use Database UPSERT

Modify `ensureArtist()` to use `INSERT ... ON CONFLICT`:

```typescript
export async function ensureArtist(name: string): Promise<string> {
  const normalized = name.trim();
  
  // Try to get existing first
  const existing = await supabase
    .from('artists')
    .select('id')
    .eq('name', normalized)
    .maybeSingle();
  
  if (existing.data?.id) {
    return existing.data.id;
  }
  
  // Use upsert to handle race conditions
  const result = await supabase
    .from('artists')
    .upsert({ name: normalized }, { onConflict: 'name' })
    .select('id')
    .single();
  
  if (result.error || !result.data?.id) {
    // If still fails, try to get it (another process might have inserted it)
    const retry = await supabase
      .from('artists')
      .select('id')
      .eq('name', normalized)
      .single();
    
    if (retry.data?.id) {
      return retry.data.id;
    }
    
    throw new Error(`Failed to ensure artist: ${result.error?.message ?? 'unknown error'}`);
  }
  
  return result.data.id;
}
```

### Option 3: Add Error Handling

Catch the duplicate error and retry:

```typescript
try {
  artistId = await ensureArtist(artistName);
} catch (err) {
  if (err instanceof Error && err.message.includes('duplicate key')) {
    // Retry lookup
    const retry = await supabase
      .from('artists')
      .select('id')
      .eq('name', artistName)
      .single();
    
    if (retry.data?.id) {
      artistId = retry.data.id;
    } else {
      throw err;
    }
  } else {
    throw err;
  }
}
```

## Recommended Fix

Combine all three approaches:
1. **Normalize names** before database operations
2. **Use UPSERT** in `ensureArtist()` to handle race conditions
3. **Add error handling** as a fallback

This will make the system more robust and prevent this error from occurring.

## Impact

- **Severity**: Low - Only affects one artwork per run
- **Frequency**: Rare - Only happens with race conditions or name variations
- **Workaround**: The error is caught and logged, processing continues
- **Fix Priority**: Medium - Should be fixed to prevent future occurrences

















