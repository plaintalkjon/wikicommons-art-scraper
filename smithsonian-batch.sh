#!/bin/bash

# Smithsonian batch scraper - process multiple artists efficiently
# Usage: ./smithsonian-batch.sh "Artist1" "Artist2" "Artist3"
# Or: ./smithsonian-batch.sh --file artist-list.txt

MAX_CONCURRENT=2  # Very conservative for Smithsonian API
BATCH_SIZE=4      # Process in groups of 4 to monitor progress

if [ $# -eq 0 ]; then
    echo "Usage:"
    echo "  $0 \"Artist1\" \"Artist2\" \"Artist3\" ...  # Direct artist names"
    echo "  $0 --file artist-list.txt                # From file (one artist per line)"
    exit 1
fi

# Handle file input
if [ "$1" = "--file" ]; then
    if [ ! -f "$2" ]; then
        echo "Error: File $2 not found"
        exit 1
    fi
    # Read file line by line to preserve spaces in artist names
    ARTISTS=()
    while IFS= read -r line; do
        ARTISTS+=("$line")
    done < "$2"
else
    ARTISTS=("$@")
fi

TOTAL_ARTISTS=${#ARTISTS[@]}
echo "🎨 Smithsonian Batch Processing"
echo "================================"
echo "Total artists: $TOTAL_ARTISTS"
echo "Concurrent limit: $MAX_CONCURRENT"
echo "Batch size: $BATCH_SIZE"
echo "Artists: ${ARTISTS[*]}"
echo ""

# Process artists in batches
for ((i=0; i<TOTAL_ARTISTS; i+=BATCH_SIZE)); do
    BATCH_END=$((i + BATCH_SIZE - 1))
    if [ $BATCH_END -ge $TOTAL_ARTISTS ]; then
        BATCH_END=$((TOTAL_ARTISTS - 1))
    fi

    echo "📦 Processing batch $((i/BATCH_SIZE + 1)): artists $((i+1))-$((BATCH_END+1))"
    echo "    ${ARTISTS[@]:i:BATCH_SIZE}"
    echo ""

    # Start artists in this batch
    for ((j=i; j<=BATCH_END && j<TOTAL_ARTISTS; j++)); do
        artist="${ARTISTS[j]}"
        echo "▶️  Starting: $artist"

        # Start in background
        npm run fetch -- --artist "$artist" --source smithsonian --media painting,sculpture --exclude-drawings > "logs/smithsonian-$artist.log" 2>&1 &

        # Small delay between starting processes
        sleep 3

        # Limit concurrent processes
        while [ $(jobs -r | wc -l) -ge $MAX_CONCURRENT ]; do
            echo "⏳ Waiting for processes to complete... ($(jobs -r | wc -l) running)"
            sleep 15
        done
    done

    # Wait for this batch to complete before starting next
    echo "⏳ Waiting for batch to complete..."
    wait
    echo "✅ Batch completed!"
    echo ""
done

echo "🎉 All Smithsonian artists processed!"
echo "Check logs/smithsonian-*.log for individual results"
