#!/bin/bash
# Deployment script for Vincent Van Gogh Edge Function

set -e

echo "=== Deploying Vincent Van Gogh Edge Function ==="
echo ""

# Check if Supabase CLI is available
if [ ! -f "/tmp/supabase" ]; then
    echo "Downloading Supabase CLI..."
    curl -fsSL https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.tar.gz -o /tmp/supabase.tar.gz
    tar -xzf /tmp/supabase.tar.gz -C /tmp
    chmod +x /tmp/supabase
fi

SUPABASE_CLI="/tmp/supabase"

# Extract project ref from .env
if [ -f .env ]; then
    SUPABASE_URL=$(grep "^SUPABASE_URL=" .env | cut -d '=' -f2 | tr -d '"' | tr -d "'")
    PROJECT_REF=$(echo "$SUPABASE_URL" | sed -E 's|https://([^.]+)\..*|\1|')
    echo "Detected project ref: $PROJECT_REF"
else
    echo "Error: .env file not found"
    exit 1
fi

echo ""
echo "Deploying vincent-van-gogh function..."
$SUPABASE_CLI functions deploy vincent-van-gogh

echo ""
echo "=== Deployment Complete! ==="
echo ""
echo "The function is now available at:"
echo "  https://$PROJECT_REF.supabase.co/functions/v1/vincent-van-gogh"
echo ""
echo "Next steps:"
echo "1. Copy environment variables from mastodon-post function:"
echo "   - Go to Edge Functions → mastodon-post → Settings"
echo "   - Copy all env vars to vincent-van-gogh → Settings"
echo ""
echo "2. Set up scheduling (4 times per day):"
echo "   Option A: Use Supabase Dashboard → Database → Extensions → Enable pg_cron"
echo "   Option B: Run setup-schedule.sql in SQL Editor (replace YOUR_ANON_KEY)"
echo "   Option C: Use external cron service (see SCHEDULE_OPTIONS.md)"
echo ""
echo "3. Test the function:"
echo "   curl \"https://$PROJECT_REF.supabase.co/functions/v1/vincent-van-gogh?PREFIX=vincent-van-gogh\" \\"
echo "     -H \"Authorization: Bearer YOUR_ANON_KEY\""
