#!/bin/bash
# Test script for post-art function with anon key pre-filled

ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4dGtwd3N4dXB6a3h1aGhtdnZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUxMTY2OTQsImV4cCI6MjA4MDY5MjY5NH0.TpaMU7-7-U7BSyjqPkfiGjpHFB6qVt1dMUxG5KFptR8"

ARTIST="${1:-Vincent%20van%20Gogh}"

echo "Testing post-art function for: $ARTIST"
echo ""

curl -X POST "https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/post-art?artist=$ARTIST" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" | python3 -m json.tool
