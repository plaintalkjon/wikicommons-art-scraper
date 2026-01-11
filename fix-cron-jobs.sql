-- Fix Cron Jobs for MTG and Yu-Gi-Oh Bots
-- This script removes duplicate/conflicting cron jobs and sets up the correct configuration
-- Copy and paste this into Supabase SQL Editor

-- ============================================
-- STEP 1: Remove ALL existing MTG cron jobs
-- ============================================
-- Remove any duplicate or conflicting cron jobs
SELECT cron.unschedule('post-mtg-card');
SELECT cron.unschedule('post-mtg-commander');
SELECT cron.unschedule('post-mtg-secret-lair');
SELECT cron.unschedule('post-mtg-showcase');

-- ============================================
-- STEP 2: Create SINGLE MTG cron job
-- ============================================
-- This single cron job processes ALL MTG accounts automatically
-- It queries the database for all due accounts and processes them
SELECT cron.schedule(
  'post-mtg-card',
  '0 */6 * * *',  -- Every 6 hours (4 times per day)
  $$
  SELECT net.http_post(
    url := 'https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/post-mtg-card',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4dGtwd3N4dXB6a3h1aGhtdnZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUxMTY2OTQsImV4cCI6MjA4MDY5MjY5NH0.TpaMU7-7-U7BSyjqPkfiGjpHFB6qVt1dMUxG5KFptR8'
    )
  ) AS request_id;
  $$
);

-- ============================================
-- STEP 3: Remove any existing Yu-Gi-Oh cron job
-- ============================================
SELECT cron.unschedule('post-yugioh-card');

-- ============================================
-- STEP 4: Create Yu-Gi-Oh cron job
-- ============================================
-- This cron job processes ALL Yu-Gi-Oh accounts automatically
SELECT cron.schedule(
  'post-yugioh-card',
  '0 */6 * * *',  -- Every 6 hours (4 times per day)
  $$
  SELECT net.http_post(
    url := 'https://lxtkpwsxupzkxuhhmvvz.supabase.co/functions/v1/post-yugioh-card',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4dGtwd3N4dXB6a3h1aGhtdnZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUxMTY2OTQsImV4cCI6MjA4MDY5MjY5NH0.TpaMU7-7-U7BSyjqPkfiGjpHFB6qVt1dMUxG5KFptR8'
    )
  ) AS request_id;
  $$
);

-- ============================================
-- VERIFICATION: List all active cron jobs
-- ============================================
-- Run this query separately to verify cron jobs are set up correctly:
-- SELECT * FROM cron.job WHERE jobname IN ('post-mtg-card', 'post-yugioh-card');

