#!/bin/bash
# Deployment script for generic post-art Edge Function

set -e

echo "=== Deploying Generic post-art Edge Function ==="
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
echo "Deploying post-art function..."
$SUPABASE_CLI functions deploy post-art

echo ""
echo "=== Deployment Complete! ==="
echo ""
echo "The function is now available at:"
echo "  https://$PROJECT_REF.supabase.co/functions/v1/post-art?artist=Artist Name"
echo ""
echo "Usage examples:"
echo "  ?artist=Vincent van Gogh"
echo "  ?artist=Rembrandt van Rijn"
echo "  ?artist=Caravaggio"
echo ""
echo "Next steps:"
echo "1. Set up scheduling using setup-multi-artist-schedule.sql"
echo "2. Add artist accounts to mastodon_accounts table"
echo "3. Test manually:"
echo "   curl \"https://$PROJECT_REF.supabase.co/functions/v1/post-art?artist=Vincent van Gogh\" \\"
echo "     -H \"Authorization: Bearer YOUR_ANON_KEY\""

