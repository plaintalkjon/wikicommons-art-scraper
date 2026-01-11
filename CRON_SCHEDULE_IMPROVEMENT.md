# Cron Schedule Improvement - Frequent Runs with Interval Control

## Current Setup

- **Cron Schedule**: Every 6 hours (`0 */6 * * *`)
- **Posting Interval**: 6 hours (controlled by `last_posted_at`)
- **Problem**: If a post fails, retry happens 6 hours later

## Proposed Setup

- **Cron Schedule**: Every 15 minutes (`*/15 * * * *`)
- **Posting Interval**: Still 6 hours (controlled by `last_posted_at` in function)
- **Benefit**: If a post fails, retry happens in 15 minutes

## How It Works

The function already has built-in interval control:

1. **Cron runs frequently** (every 15 minutes)
2. **Function checks `last_posted_at`** for each account
3. **Only posts accounts** where `last_posted_at` is NULL or older than 6 hours
4. **Updates `last_posted_at`** only after successful post

### Example Timeline

```
00:00 - Cron runs, Account A posted successfully (last_posted_at = 00:00)
00:15 - Cron runs, Account A skipped (only 15 min since last post)
00:30 - Cron runs, Account A skipped
...
06:00 - Cron runs, Account A due (6 hours passed), posts successfully
06:15 - Cron runs, Account A skipped
```

### Failure Recovery

```
00:00 - Cron runs, Account A tries to post but fails (network error)
00:15 - Cron runs, Account A tries again (retry in 15 min, not 6 hours!)
00:30 - Cron runs, Account A posts successfully (last_posted_at = 00:30)
00:45 - Cron runs, Account A skipped
...
06:30 - Cron runs, Account A due again (6 hours since 00:30)
```

## Benefits

✅ **Faster Recovery**: Failed posts retry in 15 minutes instead of 6 hours  
✅ **Same Posting Frequency**: Accounts still post every 6 hours  
✅ **More Resilient**: Transient failures (network, API issues) recover quickly  
✅ **Better Monitoring**: More frequent checks = better visibility  
✅ **No Code Changes**: Function already supports this pattern  

## Schedule Options

- **Every 10 minutes** (`*/10 * * * *`) - Fastest retry, more function invocations
- **Every 15 minutes** (`*/15 * * * *`) - Balanced (recommended)
- **Every 20 minutes** (`*/20 * * * *`) - Still good retry, fewer invocations

## Cost Considerations

- **Function Invocations**: ~96/day (15 min) vs ~4/day (6 hours)
- **Cost**: Supabase Edge Functions are very cheap, ~$0.0000002 per invocation
- **Trade-off**: ~$0.02/month extra for much better reliability

## Implementation

Run the SQL in `update-mtg-cron-frequent.sql` to update the cron schedule.

The function already has the `interval_hours=6` parameter, so no code changes needed!

