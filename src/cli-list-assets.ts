#!/usr/bin/env node
/**
 * Generate a local HTML gallery (or CSV) of stored assets (path-only).
 *
 * Usage examples:
 *   npm run list-assets -- --html ./gallery.html                 # single page (default limit=500)
 *   npm run list-assets -- --html ./gallery.html --limit 1000    # single page, custom size
 *   npm run list-assets -- --all --page-size 500 --html ./gallery.html
 *     -> generates paginated files: gallery-page-1.html, gallery-page-2.html, ...
 *   npm run list-assets -- --csv ./assets.csv                    # CSV output
 *
 * Notes:
 *   - Uses public_url from art_assets; if your bucket is private, adjust to signed URLs.
 *   - HTML gallery includes checkboxes and a "Copy Selected" helper to build a delete list.
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
    <input type="search" id="filter" placeholder="Filter by path" size="40" />
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
    const filterInput = document.getElementById('filter');
    const count = document.getElementById('count');
    const pageInfo = document.getElementById('pageInfo');

    function render(list) {
      grid.innerHTML = '';
      for (const row of list) {
        const card = document.createElement('div');
        card.className = 'card';
        card.dataset.text = row.storage_path.toLowerCase();
        card.innerHTML = \`
          <input type="checkbox" class="chk" data-path="\${row.storage_path}">
          <img class="thumb" src="\${row.public_url}" alt="\${row.storage_path}">
          <div class="meta">
            <div class="path">\${row.storage_path}</div>
            <div>Size: \${row.width || '?'} x \${row.height || '?'} | File: \${row.file_size ? (row.file_size/1024/1024).toFixed(2) + ' MB' : '?'}</div>
          </div>
        \`;
        grid.appendChild(card);
      }
      count.textContent = \`Showing \${list.length} item(s)\`;
      const pageText = meta.page != null && meta.pageCount != null
        ? \`Page \${meta.page + 1} / \${meta.pageCount}\`
        : '';
      const totalText = meta.total != null ? \`Total: \${meta.total}\` : '';
      pageInfo.textContent = [pageText, \`Offset: \${meta.offset}\`, \`Limit: \${meta.limit}\`, totalText].filter(Boolean).join(' | ');
    }

    function currentCards() {
      const q = filterInput.value.trim().toLowerCase();
      if (!q) return Array.from(grid.children);
      return Array.from(grid.children).filter(c => c.dataset.text.includes(q));
    }

    filterInput.addEventListener('input', () => {
      const q = filterInput.value.trim().toLowerCase();
      const cards = Array.from(grid.children);
      let shown = 0;
      for (const c of cards) {
        const match = c.dataset.text.includes(q);
        c.style.display = match ? '' : 'none';
        if (match) shown++;
      }
      count.textContent = \`Showing \${shown} item(s)\`;
    });

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

  const parseOrder = (value: string): { column: string; ascending: boolean } => {
    const parts = value.split('.');
    if (parts.length === 2) {
      return { column: parts[0], ascending: parts[1].toLowerCase() !== 'desc' };
    }
    return { column: value, ascending: true };
  };

  const { column: orderColumn, ascending } = parseOrder(orderArg);

  // Helper to fetch a page of assets
  const fetchPage = async (rangeStart: number, rangeEnd: number) => {
    try {
      const { data, error } = await supabase
        .from('art_assets')
        .select('art_id,storage_path,public_url,width,height,file_size')
        .order(orderColumn, { ascending })
        .range(rangeStart, rangeEnd);
      if (error) throw error;
      return data ?? [];
    } catch (err: any) {
      console.warn(`Warning: could not order by ${orderColumn} (${err?.message ?? err}). Falling back to unordered fetch.`);
      const { data, error } = await supabase
        .from('art_assets')
        .select('art_id,storage_path,public_url,width,height,file_size')
        .range(rangeStart, rangeEnd);
      if (error) throw new Error(`Failed to fetch assets: ${error.message}`);
      return data ?? [];
    }
  };

  // If generating all pages, compute total and iterate
  if (allPages) {
    // Count total rows
    const { count, error: countErr } = await supabase
      .from('art_assets')
      .select('art_id', { count: 'exact', head: true });
    if (countErr) throw new Error(`Failed to count assets: ${countErr.message}`);
    const total = count ?? 0;
    const pageCount = Math.ceil(total / limit) || 1;

    const { dir, name, ext } = path.parse(outHtml);
    const baseExt = ext || '.html';
    const pageFiles: string[] = [];

    for (let p = 0; p < pageCount; p++) {
      const pageOffset = p * limit;
      const pageAssets = await fetchPage(pageOffset, pageOffset + limit - 1);
      const rows: AssetRow[] = pageAssets.map((asset: any) => ({
        art_id: asset.art_id,
        storage_path: asset.storage_path,
        public_url: asset.public_url,
        width: asset.width,
        height: asset.height,
        file_size: asset.file_size,
      }));
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
  const assets = await fetchPage(offset, offset + limit - 1);

  if (!assets || assets.length === 0) {
    const emptyRows: AssetRow[] = [];
    if (outCsv) {
      const csv = toCsv(emptyRows);
      await writeFile(outCsv, csv, 'utf8');
      console.log(`CSV written to ${outCsv} (0 rows)`);
    } else {
      const html = renderHtml(emptyRows, { limit, offset, total: null });
      await writeFile(outHtml, html, 'utf8');
      console.log(`HTML gallery written to ${outHtml} (0 rows)`);
    }
    return;
  }

  const rows: AssetRow[] = [];
  for (const asset of assets ?? []) {
    rows.push({
      art_id: asset.art_id,
      storage_path: asset.storage_path,
      public_url: asset.public_url,
      width: asset.width,
      height: asset.height,
      file_size: asset.file_size,
    });
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


