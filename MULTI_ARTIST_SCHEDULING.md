# Multi-Artist Scheduling Guide

## Current Setup

Right now, you have:
- **1 edge function**: `vincent-van-gogh` (hardcoded to Vincent van Gogh)
- **4 cron jobs**: All calling the `vincent-van-gogh` function 4 times per day

## If You Add 2 More Artists

You have **two options**:

### Option 1: Separate Functions Per Artist (Current Approach)

**What you'd need:**
- 3 separate edge functions: `vincent-van-gogh`, `rembrandt`, `caravaggio`
- 12 total cron jobs (4 per artist × 3 artists)

**Pros:**
- Each artist has their own function
- Easy to manage individually
- Can customize per artist if needed

**Cons:**
- More functions to maintain
- More cron jobs to set up

### Option 2: Generic Function (Recommended)

**What you'd need:**
- 1 generic edge function: `post-art` (takes `?artist=Artist Name`)
- 12 total cron jobs (4 per artist × 3 artists), each calling with different artist parameter

**Pros:**
- Single function to maintain
- Easy to add new artists (just add cron jobs)
- More scalable

**Cons:**
- Slightly more complex cron setup

## Recommended: Generic Function Approach

I can create a generic `post-art` function that:
- Takes `?artist=Artist Name` as parameter
- Looks up credentials from database automatically
- Works for any artist

Then you'd schedule it like:
```sql
-- Vincent van Gogh - 4 times per day
SELECT cron.schedule('vincent-van-gogh-12am', '0 0 * * *', $$...?artist=Vincent van Gogh$$);
SELECT cron.schedule('vincent-van-gogh-6am', '0 6 * * *', $$...?artist=Vincent van Gogh$$);
-- etc.

-- Rembrandt - 4 times per day  
SELECT cron.schedule('rembrandt-12am', '0 0 * * *', $$...?artist=Rembrandt van Rijn$$);
-- etc.
```

## Answer to Your Question

**Currently:** Only Vincent van Gogh posts 4 times per day.

**If you add 2 more artists:**
- You'd need to either:
  1. Create separate functions for each + schedule them, OR
  2. Create a generic function + schedule it 12 times (4 per artist)

**Result:** Yes, each artist would post 4 times per day = 12 total posts per day (4 × 3 artists).

Would you like me to create a generic `post-art` function that works for any artist? That would be the cleanest solution.

