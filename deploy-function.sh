#!/bin/bash
# Deployment script for Supabase Edge Function

set -e

echo "=== Supabase Edge Function Deployment ==="
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
echo "Step 1: Login to Supabase"
echo "You'll need to open a browser to complete login..."
$SUPABASE_CLI login

echo ""
echo "Step 2: Linking to project $PROJECT_REF"
$SUPABASE_CLI link --project-ref "$PROJECT_REF"

echo ""
echo "Step 3: Deploying mastodon-post function..."
$SUPABASE_CLI functions deploy mastodon-post

echo ""
echo "=== Deployment Complete! ==="
echo ""
echo "Next steps:"
echo "1. Set environment variables in Supabase Dashboard:"
echo "   - Go to Edge Functions → mastodon-post → Settings"
echo "   - Add: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MASTODON_BASE_URL, MASTODON_ACCESS_TOKEN"
echo ""
echo "2. Test the function:"
echo "   curl \"https://$PROJECT_REF.supabase.co/functions/v1/mastodon-post?PREFIX=vincent-van-gogh\" \\"
echo "     -H \"Authorization: Bearer YOUR_ANON_KEY\""
