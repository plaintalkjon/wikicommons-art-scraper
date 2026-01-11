# Met Full Scrape Monitoring

## Check Progress

### View Live Log Output
```bash
tail -f .met-full-scrape.log
```

### View Last 50 Lines
```bash
tail -50 .met-full-scrape.log
```

### Check if Process is Running
```bash
ps aux | grep "cli-scrape-met-full" | grep -v grep
```

### View Summary Statistics
```bash
tail -100 .met-full-scrape.log | grep -E "Final Summary|Artists processed|Total uploaded|Total skipped|403 ERROR"
```

### Check Recent Activity
```bash
tail -20 .met-full-scrape.log
```

## Stop the Process

If you need to stop the scraping:

```bash
pkill -f "cli-scrape-met-full"
```

Or find the PID and kill it:
```bash
ps aux | grep "cli-scrape-met-full" | grep -v grep | awk '{print $2}' | xargs kill
```

## Check Database Progress

To see how many Met artworks have been uploaded:

```bash
npm run check-met-uploads
```

## Expected Output Format

The log will show:
- Artist being processed
- Number of Met object IDs found
- Upload progress for each artwork
- Final summary with totals
- 403 error detection (if encountered)



















