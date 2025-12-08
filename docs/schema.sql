-- Proposed tables to support assets and provenance.
-- Run in Supabase SQL editor (adjust schema names if needed).

create table if not exists public.art_assets (
  id uuid primary key default gen_random_uuid(),
  art_id uuid references public.arts(id) on delete cascade,
  storage_path text not null,
  public_url text not null,
  width int,
  height int,
  file_size int,
  mime_type text,
  sha256 text,
  created_at timestamptz default now(),
  unique (art_id, storage_path)
);

create table if not exists public.art_sources (
  id uuid primary key default gen_random_uuid(),
  art_id uuid references public.arts(id) on delete cascade,
  source text not null,
  source_pageid bigint,
  source_title text,
  source_url text,
  fetched_at timestamptz default now(),
  unique (source, source_pageid)
);

-- Optional: lightweight run log for ingestion jobs.
create table if not exists public.ingest_runs (
  id uuid primary key default gen_random_uuid(),
  artist text,
  limit_requested int,
  paintings_only boolean,
  started_at timestamptz default now(),
  ended_at timestamptz,
  attempted int,
  uploaded int,
  skipped int,
  errors jsonb
);

