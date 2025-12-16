-- Add last_posted_at column to art_assets table for tracking posted artworks
-- This allows the system to avoid repeats and reset when all artworks have been posted
-- Run this in Supabase SQL Editor

ALTER TABLE art_assets 
ADD COLUMN IF NOT EXISTS last_posted_at TIMESTAMPTZ;

-- Create index for efficient queries (ordering by last_posted_at)
CREATE INDEX IF NOT EXISTS idx_art_assets_last_posted 
ON art_assets(last_posted_at) 
WHERE last_posted_at IS NOT NULL;

-- Create index for finding unposted assets (NULL last_posted_at)
CREATE INDEX IF NOT EXISTS idx_art_assets_unposted 
ON art_assets(art_id) 
WHERE last_posted_at IS NULL;


