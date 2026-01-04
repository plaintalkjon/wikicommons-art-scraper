#!/usr/bin/env node
/**
 * Generate a local HTML gallery (or CSV) of stored assets.
 *
 * Usage examples:
 *   npm run list-assets -- --html ./gallery.html                 # single page (default limit=500)
 *   npm run list-assets -- --html ./gallery.html --limit 1000    # single page, custom size
 *   npm run list-assets -- --all --page-size 500 --html ./gallery.html
 *     -> generates paginated files: gallery-page-1.html, gallery-page-2.html, ...
 *   npm run list-assets -- --csv ./assets.csv                    # CSV output
 *   npm run list-assets -- --tag "painting" --html ./paintings.html  # filter by tag
 *   npm run list-assets -- --artist "Vincent van Gogh" --html ./vangogh.html  # filter by artist
 *
 * Options:
 *   --tag <tag_name>      Filter assets by tag (server-side filtering)
 *   --artist <name>       Filter assets by artist name (server-side filtering)
 *   --max-dim <number>    Filter assets where both width and height are < number (server-side filtering)
 *   --html <file>         Output HTML gallery to file
 *   --csv <file>          Output CSV data to file
 *   --limit <number>      Limit number of assets (default: 500)
 *   --all                 Generate paginated gallery for all assets
 *   --page-size <num>     Page size for --all mode
 *   --order <column>      Order by column (default: created_at.desc)
 *
 * Notes:
 *   - Uses public_url from art_assets; if your bucket is private, adjust to signed URLs.
 *   - HTML gallery includes checkboxes and a "Copy Selected" helper to build a delete list.
 *   - Server-side tag filtering (--tag) is more efficient than client-side filtering.
 */

import { writeFile } from 'fs/promises';
import path from 'path';
import { supabase } from './config';
import { parseArgs } from './utils';

type AssetRow = {
  art_id: string;
  storage_path: string;
  public_url: string;
  width?: number | null;
  height?: number | null;
  file_size?: number | null;
  artist_name?: string;
  art_title?: string;
  tags?: string[];
};

function escapeCsv(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toCsv(rows: AssetRow[]): string {
  const headers = [
    'storage_path',
    'public_url',
    'art_id',
    'width',
    'height',
    'file_size',
    'artist_name',
    'art_title',
    'tags',
  ];
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.storage_path,
        r.public_url,
        r.art_id,
        r.width ?? '',
        r.height ?? '',
        r.file_size ?? '',
        r.artist_name ?? '',
        r.art_title ?? '',
        (r.tags || []).join('; '),
      ]
        .map((v) => escapeCsv(String(v)))
        .join(','),
    );
  }
  return lines.join('\n');
}

function renderHtml(
  rows: AssetRow[],
  meta: { limit: number; offset: number; total?: number | null; page?: number | null; pageCount?: number | null },
): string {
  const data = JSON.stringify(rows);
  const info = JSON.stringify(meta);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Art Assets Gallery</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 16px; background: #f7f7f7; }
    .controls { margin-bottom: 12px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
    .card { background: #fff; padding: 10px; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.12); display: flex; flex-direction: column; gap: 8px; }
    .thumb { width: 100%; height: 180px; object-fit: cover; background: #eee; }
    .meta { font-size: 12px; color: #444; line-height: 1.4; }
    .artist { font-weight: bold; color: #222; }
    .title { font-style: italic; color: #666; }
    .tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
    .tag { background: #e3f2fd; color: #1976d2; padding: 2px 6px; border-radius: 10px; font-size: 11px; }
    label { cursor: pointer; }
    input[type="search"] { padding: 6px; }
    button { padding: 6px 10px; cursor: pointer; }
    .count { font-size: 12px; color: #666; }
    .path { font-size: 12px; word-break: break-all; color: #222; }
  </style>
</head>
<body>
  <div class="controls">
    <label><input type="checkbox" id="selectAll" /> Select all</label>
    <button id="copy">Copy selected paths</button>
    <input type="search" id="pathFilter" placeholder="Filter by path" size="30" />
    <input type="search" id="artistFilter" placeholder="Filter by artist" size="25" />
    <input type="search" id="tagFilter" placeholder="Filter by tag" size="25" />
    <button id="clearFilters">Clear filters</button>
    <span class="count" id="count"></span>
    <span class="count" id="pageInfo"></span>
  </div>
  <div class="grid" id="grid"></div>
  <script>
    const data = ${data};
    const meta = ${info};
    const grid = document.getElementById('grid');
    const selectAll = document.getElementById('selectAll');
    const copyBtn = document.getElementById('copy');
    const pathFilter = document.getElementById('pathFilter');
    const artistFilter = document.getElementById('artistFilter');
    const tagFilter = document.getElementById('tagFilter');
    const clearFiltersBtn = document.getElementById('clearFilters');
    const count = document.getElementById('count');
    const pageInfo = document.getElementById('pageInfo');

    function render(list) {
      grid.innerHTML = '';
      for (const row of list) {
        const card = document.createElement('div');
        card.className = 'card';
        card.dataset.path = row.storage_path.toLowerCase();
        card.dataset.artist = (row.artist_name || '').toLowerCase();
        card.dataset.tags = (row.tags || []).join(' ').toLowerCase();
        card.innerHTML = \`
          <input type="checkbox" class="chk" data-path="\${row.storage_path}">
          <img class="thumb" src="\${row.public_url}" alt="\${row.storage_path}">
          <div class="meta">
            <div class="path">\${row.storage_path}</div>
            \${row.artist_name ? \`<div class="artist">\${row.artist_name}</div>\` : ''}
            \${row.art_title ? \`<div class="title">\${row.art_title}</div>\` : ''}
            \${row.tags && row.tags.length ? \`<div class="tags">\${row.tags.map(t => \`<span class="tag">\${t}</span>\`).join('')}</div>\` : ''}
            <div>Size: \${row.width || '?'} x \${row.height || '?'} | File: \${row.file_size ? (row.file_size/1024/1024).toFixed(2) + ' MB' : '?'}</div>
          </div>
        \`;
        grid.appendChild(card);
      }
      applyFilters();
      const pageText = meta.page != null && meta.pageCount != null
        ? \`Page \${meta.page + 1} / \${meta.pageCount}\`
        : '';
      const totalText = meta.total != null ? \`Total: \${meta.total}\` : '';
      pageInfo.textContent = [pageText, \`Offset: \${meta.offset}\`, \`Limit: \${meta.limit}\`, totalText].filter(Boolean).join(' | ');
    }

    function applyFilters() {
      const pathQuery = pathFilter.value.trim().toLowerCase();
      const artistQuery = artistFilter.value.trim().toLowerCase();
      const tagQuery = tagFilter.value.trim().toLowerCase();

      const cards = Array.from(grid.children);
      let shown = 0;
      for (const c of cards) {
        const pathMatch = !pathQuery || c.dataset.path.includes(pathQuery);
        const artistMatch = !artistQuery || c.dataset.artist.includes(artistQuery);
        const tagMatch = !tagQuery || c.dataset.tags.includes(tagQuery);
        const match = pathMatch && artistMatch && tagMatch;
        c.style.display = match ? '' : 'none';
        if (match) shown++;
      }
      count.textContent = \`Showing \${shown} item(s)\`;
    }

    function currentCards() {
      return Array.from(grid.children).filter(c => c.style.display !== 'none');
    }

    function clearFilters() {
      pathFilter.value = '';
      artistFilter.value = '';
      tagFilter.value = '';
      applyFilters();
    }

    pathFilter.addEventListener('input', applyFilters);
    artistFilter.addEventListener('input', applyFilters);
    tagFilter.addEventListener('input', applyFilters);
    clearFiltersBtn.addEventListener('click', clearFilters);

    selectAll.addEventListener('change', () => {
      const cards = currentCards();
      cards.forEach(c => {
        const chk = c.querySelector('.chk');
        if (chk) chk.checked = selectAll.checked;
      });
    });

    copyBtn.addEventListener('click', async () => {
      const cards = currentCards();
      const paths = cards
        .map(c => c.querySelector('.chk'))
        .filter(chk => chk && chk.checked)
        .map(chk => chk.getAttribute('data-path'));
      if (!paths.length) {
        alert('No items selected.');
        return;
      }
      await navigator.clipboard.writeText(paths.join('\\n'));
      alert(\`Copied \${paths.length} path(s) to clipboard\`);
    });

    render(data);
  </script>
</body>
</html>`;
}

async function main() {
  const args = parseArgs();
  const outHtml = (args.html as string) || './gallery.html';
  const outCsv = args.csv as string | undefined;
  const allPages = Boolean(args.all);
  const limitArg = args.limit ? parseInt(args.limit as string, 10) : 500;
  const pageSize = args['page-size'] ? parseInt(args['page-size'] as string, 10) : limitArg;
  const limit = allPages ? pageSize : limitArg;
  const page = args.page ? parseInt(args.page as string, 10) : 0;
  const offset = args.offset ? parseInt(args.offset as string, 10) : page * limit;
  const orderArg = (args.order as string | undefined) || 'created_at.desc';
  const filterTag = args['tag'] as string | undefined;
  const filterArtist = args['artist'] as string | undefined;
  const maxDim = args['max-dim'] ? parseInt(args['max-dim'] as string, 10) : undefined;

  const parseOrder = (value: string): { column: string; ascending: boolean } => {
    const parts = value.split('.');
    if (parts.length === 2) {
      return { column: parts[0], ascending: parts[1].toLowerCase() !== 'desc' };
    }
    return { column: value, ascending: true };
  };

  const { column: orderColumn, ascending } = parseOrder(orderArg);

  // Helper to fetch a page of assets with metadata
  const fetchPage = async (rangeStart: number, rangeEnd: number): Promise<AssetRow[]> => {
    // Handle tag or artist filtering separately since they can't be combined with ordering
    if (filterTag || filterArtist) {
      try {

        let artIds: string[];

        if (filterTag) {
          // First, find art_ids that have the specified tag
          const { data: tagData, error: tagError } = await supabase
            .from('tags')
            .select('id')
            .eq('name', filterTag);

          if (tagError) {
            console.error(`Tag lookup error: ${tagError.message}`);
            return [];
          }

          if (!tagData || tagData.length === 0) {
            console.log(`No tag found with name: ${filterTag}`);
            return [];
          }

          const tagId = tagData[0].id;

          const { data: artTagData, error: artTagError } = await supabase
            .from('art_tags')
            .select('art_id')
            .eq('tag_id', tagId);

          if (artTagError) {
            console.error(`Art tags lookup error: ${artTagError.message}`);
            return [];
          }

          if (!artTagData || artTagData.length === 0) {
            console.log(`No artworks found with tag: ${filterTag}`);
            return [];
          }

          artIds = artTagData.map(at => at.art_id);
        } else {
          // Artist filtering
          const { data: artistData, error: artistError } = await supabase
            .from('artists')
            .select('id')
            .eq('name', filterArtist);

          if (artistError) {
            console.error(`Artist lookup error: ${artistError.message}`);
            return [];
          }

          if (!artistData || artistData.length === 0) {
            console.log(`No artist found with name: ${filterArtist}`);
            return [];
          }

          const artistId = artistData[0].id;

          const { data: artsData, error: artsError } = await supabase
            .from('arts')
            .select('id')
            .eq('artist_id', artistId);

          if (artsError) {
            console.error(`Arts lookup error: ${artsError.message}`);
            return [];
          }

          if (!artsData || artsData.length === 0) {
            console.log(`No artworks found for artist: ${filterArtist}`);
            return [];
          }

          artIds = artsData.map(art => art.id);
        }

        // Fetch assets in batches to avoid large in() clauses that can cause timeouts
        const batchSize = 50;
        const allAssets: any[] = [];

        for (let i = 0; i < artIds.length; i += batchSize) {
          const batch = artIds.slice(i, i + batchSize);
          let query = supabase
            .from('art_assets')
            .select('art_id,storage_path,public_url,width,height,file_size')
            .in('art_id', batch);

          // Apply dimension filter if specified
          if (maxDim) {
            query = query.lt('width', maxDim).lt('height', maxDim);
          }

          const { data: batchAssets, error: batchError } = await query;

          if (batchError) {
            console.error(`Batch fetch error for batch ${Math.floor(i/batchSize) + 1}: ${batchError.message}`);
            continue;
          }

          if (batchAssets) {
            allAssets.push(...batchAssets);
          }
        }

        if (allAssets.length === 0) {
          console.log('No assets found for artworks with this tag');
          return [];
        }

        if (!allAssets || allAssets.length === 0) {
          console.log('No assets found for artworks');
          return [];
        }

        // Apply pagination in memory
        const assets = allAssets.slice(rangeStart, rangeEnd + 1);

        // Get unique art_ids from paginated results
        const pageArtIds = Array.from(new Set(assets.map(a => a.art_id)));

        // Fetch arts with artist info
        const { data: arts, error: artsError } = await supabase
          .from('arts')
          .select('id, title, artist_id')
          .in('id', pageArtIds);
        if (artsError) {
          console.warn(`Warning: could not fetch arts: ${artsError.message}`);
          // Return basic data
          return assets.map(asset => ({
            art_id: asset.art_id,
            storage_path: asset.storage_path,
            public_url: asset.public_url,
            width: asset.width,
            height: asset.height,
            file_size: asset.file_size,
          }));
        }

        // Get unique artist_ids
        const artistIds = Array.from(new Set((arts || []).map(a => a.artist_id).filter(Boolean)));

        // Fetch artists
        const { data: artists, error: artistsError } = await supabase
          .from('artists')
          .select('id, name')
          .in('id', artistIds);
        if (artistsError) console.warn(`Warning: could not fetch artists: ${artistsError.message}`);

        // Fetch art_tags
        const { data: artTags, error: tagsError } = await supabase
          .from('art_tags')
          .select('art_id, tag_id')
          .in('art_id', pageArtIds);
        if (tagsError) console.warn(`Warning: could not fetch art_tags: ${tagsError.message}`);

        // Get unique tag_ids
        const tagIds = Array.from(new Set((artTags || []).map(at => at.tag_id).filter(Boolean)));

        // Fetch tag names
        const { data: tags, error: tagNamesError } = await supabase
          .from('tags')
          .select('id, name')
          .in('id', tagIds);
        if (tagNamesError) console.warn(`Warning: could not fetch tag names: ${tagNamesError.message}`);

        // Create lookup maps
        const artsMap = new Map((arts || []).map(a => [a.id, a]));
        const artistsMap = new Map((artists || []).map(a => [a.id, a]));
        const tagNamesMap = new Map((tags || []).map(t => [t.id, t.name]));
        const tagsMap = new Map<string, string[]>();
        (artTags || []).forEach(at => {
          const tagName = tagNamesMap.get(at.tag_id);
          if (tagName) {
            if (!tagsMap.has(at.art_id)) tagsMap.set(at.art_id, []);
            tagsMap.get(at.art_id)!.push(tagName);
          }
        });

        // Combine data
        return assets.map(asset => {
          const art = artsMap.get(asset.art_id);
          const artist = art?.artist_id ? artistsMap.get(art.artist_id) : null;
          const tags = tagsMap.get(asset.art_id) || [];

          return {
            art_id: asset.art_id,
            storage_path: asset.storage_path,
            public_url: asset.public_url,
            width: asset.width,
            height: asset.height,
            file_size: asset.file_size,
            artist_name: artist?.name || undefined,
            art_title: art?.title || undefined,
            tags: tags,
          };
        });
      } catch (err: any) {
        console.warn(`Error in tag filtering: ${err?.message ?? err}`);
        return [];
      }
    }

    // Non-tag filtering case
    try {
      let query = supabase
        .from('art_assets')
        .select('art_id,storage_path,public_url,width,height,file_size');

      // Apply dimension filter if specified
      if (maxDim) {
        query = query.lt('width', maxDim).lt('height', maxDim);
      }

      const { data: assets, error } = await query
        .order(orderColumn, { ascending })
        .range(rangeStart, rangeEnd);
      if (error) throw error;
      if (!assets || assets.length === 0) return [];

      // Get unique art_ids
      const artIds = Array.from(new Set(assets.map(a => a.art_id)));

      if (!assets || assets.length === 0) return [];

      // Fetch arts with artist info
      const { data: arts, error: artsError } = await supabase
        .from('arts')
        .select('id, title, artist_id')
        .in('id', artIds);
      if (artsError) {
        console.warn(`Warning: could not fetch arts: ${artsError.message}`);
        throw artsError;
      }

      // Get unique artist_ids
      const artistIds = Array.from(new Set((arts || []).map(a => a.artist_id).filter(Boolean)));

      // Fetch artists
      const { data: artists, error: artistsError } = await supabase
        .from('artists')
        .select('id, name')
        .in('id', artistIds);
      if (artistsError) {
        console.warn(`Warning: could not fetch artists: ${artistsError.message}`);
        throw artistsError;
      }

      // Fetch art_tags with tag names
      const { data: artTags, error: tagsError } = await supabase
        .from('art_tags')
        .select('art_id, tag_id')
        .in('art_id', artIds);
      if (tagsError) console.warn(`Warning: could not fetch art_tags: ${tagsError.message}`);

      // Get unique tag_ids
      const tagIds = Array.from(new Set((artTags || []).map(at => at.tag_id).filter(Boolean)));

      // Fetch tag names
      const { data: tags, error: tagNamesError } = await supabase
        .from('tags')
        .select('id, name')
        .in('id', tagIds);
      if (tagNamesError) console.warn(`Warning: could not fetch tag names: ${tagNamesError.message}`);

      // Create lookup maps
      const artsMap = new Map((arts || []).map(a => [a.id, a]));
      const artistsMap = new Map((artists || []).map(a => [a.id, a]));
      const tagNamesMap = new Map((tags || []).map(t => [t.id, t.name]));
      const tagsMap = new Map<string, string[]>();
      (artTags || []).forEach(at => {
        const tagName = tagNamesMap.get(at.tag_id);
        if (tagName) {
          if (!tagsMap.has(at.art_id)) tagsMap.set(at.art_id, []);
          tagsMap.get(at.art_id)!.push(tagName);
        }
      });

      // Combine data
      return assets.map(asset => {
        const art = artsMap.get(asset.art_id);
        const artist = art?.artist_id ? artistsMap.get(art.artist_id) : null;
        const tags = tagsMap.get(asset.art_id) || [];

        return {
          art_id: asset.art_id,
          storage_path: asset.storage_path,
          public_url: asset.public_url,
          width: asset.width,
          height: asset.height,
          file_size: asset.file_size,
          artist_name: artist?.name || undefined,
          art_title: art?.title || undefined,
          tags: tags,
        };
      });
    } catch (err: any) {
      console.warn(`Warning: could not order by ${orderColumn} (${err?.message ?? err}). Falling back to unordered fetch.`);
      // Fallback: fetch without ordering/filtering
      let assets: any[];
      if (filterTag) {
        // For fallback with tag filter, we need to do a more complex query
        const { data: tagData } = await supabase
          .from('tags')
          .select('id')
          .eq('name', filterTag)
          .single();

        if (tagData) {
          const { data: artTagData } = await supabase
            .from('art_tags')
            .select('art_id')
            .eq('tag_id', tagData.id);

          if (artTagData && artTagData.length > 0) {
            const artIds = artTagData.map(at => at.art_id);
            let query = supabase
              .from('art_assets')
              .select('art_id,storage_path,public_url,width,height,file_size')
              .in('art_id', artIds);

            // Apply dimension filter if specified
            if (maxDim) {
              query = query.lt('width', maxDim).lt('height', maxDim);
            }

            const { data: assetsData } = await query;
            assets = assetsData?.slice(rangeStart, rangeEnd + 1) || [];
          } else {
            assets = [];
          }
        } else {
          assets = [];
        }
      } else {
        let query = supabase
          .from('art_assets')
          .select('art_id,storage_path,public_url,width,height,file_size');

        // Apply dimension filter if specified
        if (maxDim) {
          query = query.lt('width', maxDim).lt('height', maxDim);
        }

        const { data: assetsData } = await query.range(rangeStart, rangeEnd);
        assets = assetsData || [];
      }

      if (!assets || assets.length === 0) return [];

      // Return basic data without metadata on error
      return assets.map(asset => ({
        art_id: asset.art_id,
        storage_path: asset.storage_path,
        public_url: asset.public_url,
        width: asset.width,
        height: asset.height,
        file_size: asset.file_size,
      }));
    }
  };

  // If generating all pages, compute total and iterate
  if (allPages) {
    // Count total rows (respecting tag or artist filter if specified)
    let total: number;
    if (filterTag) {
      const { data: tagData, error: tagError } = await supabase
        .from('tags')
        .select('id')
        .eq('name', filterTag);
      if (tagError) throw new Error(`Failed to find tag: ${tagError.message}`);
      if (!tagData || tagData.length === 0) {
        console.log(`No artworks found with tag: ${filterTag}`);
        total = 0;
      } else {
        const { count, error: countErr } = await supabase
          .from('art_tags')
          .select('art_id', { count: 'exact', head: true })
          .eq('tag_id', tagData[0].id);
        if (countErr) throw new Error(`Failed to count assets with tag: ${countErr.message}`);
        total = count ?? 0;
      }
    } else if (filterArtist) {
      const { data: artistData, error: artistError } = await supabase
        .from('artists')
        .select('id')
        .eq('name', filterArtist);
      if (artistError) throw new Error(`Failed to find artist: ${artistError.message}`);
      if (!artistData || artistData.length === 0) {
        console.log(`No artworks found for artist: ${filterArtist}`);
        total = 0;
      } else {
        const { count, error: countErr } = await supabase
          .from('arts')
          .select('id', { count: 'exact', head: true })
          .eq('artist_id', artistData[0].id);
        if (countErr) throw new Error(`Failed to count artworks for artist: ${countErr.message}`);
        total = count ?? 0;
      }
    } else {
      let countQuery = supabase
        .from('art_assets')
        .select('art_id', { count: 'exact', head: true });

      // Apply dimension filter if specified
      if (maxDim) {
        countQuery = countQuery.lt('width', maxDim).lt('height', maxDim);
      }

      const { count, error: countErr } = await countQuery;
      if (countErr) throw new Error(`Failed to count assets: ${countErr.message}`);
      total = count ?? 0;
    }
    const pageCount = Math.ceil(total / limit) || 1;

    const { dir, name, ext } = path.parse(outHtml);
    const baseExt = ext || '.html';
    const pageFiles: string[] = [];

    for (let p = 0; p < pageCount; p++) {
      const pageOffset = p * limit;
      const rows = await fetchPage(pageOffset, pageOffset + limit - 1);
      const html = renderHtml(rows, { limit, offset: pageOffset, total, page: p, pageCount });
      const filename = path.join(dir || '.', `${name || 'gallery'}-page-${p + 1}${baseExt}`);
      await writeFile(filename, html, 'utf8');
      pageFiles.push(filename);
      console.log(`HTML page written: ${filename} (${rows.length} rows)`);
    }

    // Write a simple index file linking to all pages
    const indexHtml = `<!doctype html>
<html><head><meta charset="UTF-8"><title>Gallery Index</title></head>
<body><h1>Gallery Pages</h1><ul>
${pageFiles.map((f) => `<li><a href="${path.basename(f)}">${path.basename(f)}</a></li>`).join('\n')}
</ul></body></html>`;
    const indexFile = path.join(dir || '.', `${name || 'gallery'}-index${baseExt}`);
    await writeFile(indexFile, indexHtml, 'utf8');
    console.log(`Index written: ${indexFile} (${pageFiles.length} pages, total assets: ${total})`);
    return;
  }

  // Single page mode
  const rows = await fetchPage(offset, offset + limit - 1);

  if (!rows || rows.length === 0) {
    if (outCsv) {
      const csv = toCsv([]);
      await writeFile(outCsv, csv, 'utf8');
      console.log(`CSV written to ${outCsv} (0 rows)`);
    } else {
      const html = renderHtml([], { limit, offset, total: null });
      await writeFile(outHtml, html, 'utf8');
      console.log(`HTML gallery written to ${outHtml} (0 rows)`);
    }
    return;
  }

  const filtered = rows;

  if (outCsv) {
    const csv = toCsv(filtered);
    await writeFile(outCsv, csv, 'utf8');
    console.log(`CSV written to ${outCsv} (${filtered.length} rows)`);
  } else {
    const html = renderHtml(filtered, { limit, offset, total: null });
    await writeFile(outHtml, html, 'utf8');
    console.log(`HTML gallery written to ${outHtml} (${filtered.length} rows)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


