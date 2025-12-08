# Wikimedia Commons → Supabase pipeline

Goal: fetch artworks (starting with Vincent van Gogh) from Wikimedia Commons, download images near 1280px width, preserve original format, store files in Supabase Storage under artist-specific paths, and persist metadata + tags in Supabase tables. Mastodon posting happens in a separate project.

## Config
- Env vars (local `.env`, not committed):
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_BUCKET` (e.g., `Art`)
- Bucket layout: `Art/{artist-slug}/{slugified-title}.{ext}` (e.g., `Art/van-gogh/starry-night.jpg`).

## Data model (proposed)
- `artworks`: `id` (Wikimedia pageid or filename), `title`, `artist`, `wikimedia_page`, `source_image_url`, `license`, `date_created`, `description`, `fetched_at`.
- `artwork_assets`: `artwork_id`, `storage_path`, `width`, `height`, `file_size`, `mime_type`, `sha256`.
- `artwork_tags`: `artwork_id`, `tag` (Commons categories).

## Pipeline (per artist)
1) Discover works via Wikimedia Commons API (categorymembers/search for artist).
2) For each work, pick best image variant closest to 1280px width (no upscale; keep format).
3) Collect metadata: title, page URL, license, dimensions, description, categories/tags.
4) Download image; compute hash; prep storage path.
5) Upload to Supabase Storage bucket (`SUPABASE_BUCKET`); make path deterministic/idempotent.
6) Upsert metadata into tables; upsert tags.
7) Idempotency key: use `pageid` or canonical filename to avoid duplicates.

## CLI (planned)
- `npm run fetch -- --artist "Vincent van Gogh" --limit 50 --dry-run`
  - Options: `--artist`, `--limit`, `--dry-run` (skip upload), `--since` (future), `--verbose`.

## Next implementation steps
- Add env loader and Supabase client.
- Implement Wikimedia fetcher (artist → works → image selection).
- Implement downloader + storage uploader + metadata/tag persistence.
- Add CLI entrypoint wiring the pipeline for van Gogh first run.

