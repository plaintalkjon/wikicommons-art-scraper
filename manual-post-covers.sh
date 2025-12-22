#!/bin/bash
# Manual script to post for cover accounts (Weird Tales and The Argosy)
# Requires SUPABASE_ANON_KEY in .env or as environment variable

set -e

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Check for anon key
if [ -z "$SUPABASE_ANON_KEY" ]; then
    echo "Error: SUPABASE_ANON_KEY not found in environment"
    echo ""
    echo "To get your anon key:"
    echo "1. Go to Supabase Dashboard -> Settings -> API"
    echo "2. Copy the 'anon' or 'public' key"
    echo "3. Add it to .env as: SUPABASE_ANON_KEY=your_key_here"
    echo ""
    echo "Or run this script with:"
    echo "  SUPABASE_ANON_KEY=your_key ./manual-post-covers.sh"
    exit 1
fi

SUPABASE_URL="${SUPABASE_URL:-https://lxtkpwsxupzkxuhhmvvz.supabase.co}"

echo "=== Posting for Cover Accounts ==="
echo ""

# Post for Weird Tales
echo "1. Posting for Weird Tales..."
RESPONSE1=$(curl -s -X POST \
  "${SUPABASE_URL}/functions/v1/post-art?artist=Weird%20Tales" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json")

echo "$RESPONSE1" | jq '.' 2>/dev/null || echo "$RESPONSE1"
echo ""

# Post for The Argosy
echo "2. Posting for The Argosy..."
RESPONSE2=$(curl -s -X POST \
  "${SUPABASE_URL}/functions/v1/post-art?artist=The%20Argosy" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json")

echo "$RESPONSE2" | jq '.' 2>/dev/null || echo "$RESPONSE2"
echo ""

echo "=== Complete ==="
