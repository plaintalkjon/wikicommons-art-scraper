#!/bin/bash
# Cleanup script to remove obsolete files
# Run with: bash cleanup-obsolete.sh

set -e

echo "=== Cleaning Up Obsolete Files ==="
echo ""

# Obsolete SQL Scripts (Replaced by Hourly Rotation)
echo "Removing obsolete scheduling SQL scripts..."
rm -f docs/schedule-auto-rotation.sql
rm -f docs/schedule-staggered-posts.sql
rm -f docs/schedule-split-accounts.sql
rm -f docs/verify-auto-rotation-schedule.sql
rm -f docs/verify-staggered-schedule.sql
rm -f docs/fix-timeout-issue.sql
rm -f docs/update-to-4-posts-per-day.sql

# Obsolete SQL Scripts (One-Time Setups - Already Applied)
echo "Removing one-time setup SQL scripts..."
rm -f docs/add-vincent-van-gogh-account.sql
rm -f docs/add-thomas-cole-schedule.sql
rm -f docs/add-courbet-schedule.sql
rm -f setup-schedule.sql
rm -f setup-multi-artist-schedule.sql
rm -f verify-schedule.sql

# Obsolete SQL Scripts (Replaced by v2)
echo "Removing obsolete tag account support (replaced by v2)..."
rm -f docs/add-tag-account-support.sql

# Obsolete Edge Functions
echo "Removing obsolete edge functions..."
rm -rf supabase/functions/vincent-van-gogh
rm -rf supabase/functions/mastodon-post

# Obsolete Deploy Scripts
echo "Removing obsolete deploy scripts..."
rm -f deploy-vincent-van-gogh.sh
rm -f deploy-function.sh

# Obsolete Migrations
echo "Removing obsolete migrations..."
rm -f supabase/migrations/20241211000000_schedule_vincent_van_gogh.sql

# Obsolete CLI Scripts
echo "Removing obsolete CLI scripts..."
rm -f src/cli-update-titles.ts

# Remove from package.json
echo "Removing 'update-titles' script from package.json..."
# This will be done manually or with a sed command

echo ""
echo "=== Cleanup Complete ==="
echo ""
echo "Note: You should also:"
echo "1. Remove 'update-titles' script from package.json"
echo "2. Review and update documentation files that reference deleted scripts"
echo "3. Check if add-last-posted-column.sql and add-art-assets-last-posted.sql are already applied"


