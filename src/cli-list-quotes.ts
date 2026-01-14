#!/usr/bin/env node
/**
 * Generate a local HTML gallery of quotes with special characters (beyond commas and periods).
 * Useful for identifying quotes that need cleanup.
 *
 * Usage examples:
 *   npm run list-quotes -- --html ./quotes-gallery.html                 # single page (default limit=500)
 *   npm run list-quotes -- --html ./quotes-gallery.html --limit 1000    # single page, custom size
 *   npm run list-quotes -- --all --page-size 500 --html ./quotes-gallery.html
 *     -> generates paginated files: quotes-gallery-page-1.html, quotes-gallery-page-2.html, ...
 *   npm run list-quotes -- --csv ./quotes.csv                          # CSV output
 *   npm run list-quotes -- --author "Marcus Aurelius" --html ./marcus.html  # filter by author
 *
 * Options:
 *   --author <name>       Filter quotes by author name (server-side filtering)
 *   --html <file>         Output HTML gallery to file
 *   --csv <file>          Output CSV data to file
 *   --limit <number>      Limit number of quotes (default: 500)
 *   --all                 Generate paginated gallery for all quotes
 *   --page-size <num>     Page size for --all mode
 *   --order <column>      Order by column (default: created_at.desc)
 *
 * Notes:
 *   - Only shows quotes with special characters beyond commas and periods
 *   - HTML gallery includes checkboxes and a "Copy Selected IDs" helper to build a delete list
 *   - Special characters detection flags: em dashes, special quotes, unicode characters, etc.
 */

import { writeFile } from 'fs/promises';
import path from 'path';
import { supabase } from './config';
import { parseArgs } from './utils';

type QuoteRow = {
  id: string;
  text: string;
  author_id: string;
  author_name?: string;
  author_category?: string;
  source?: string | null;
  character_count?: number | null;
  created_at?: string;
  posted_at?: string | null;
  special_chars?: string[];
};

/**
 * Detects special characters beyond commas and periods
 * Allows: letters, numbers, spaces, commas, periods, apostrophes, hyphens, basic punctuation
 * Flags: em dashes, en dashes, special quotes, unicode symbols, etc.
 */
function hasSpecialChars(text: string): { hasSpecial: boolean; chars: string[] } {
  // Allowed characters: letters, numbers, spaces, basic punctuation
  // Allowed: a-z, A-Z, 0-9, space, comma, period, apostrophe, hyphen, colon, semicolon, question, exclamation, parentheses, brackets, quotes
  const allowedPattern = /^[a-zA-Z0-9\s,.'\-:;?!()\[\]"']$/;
  
  // Find all characters that are NOT in the allowed set
  const allChars = Array.from(text);
  const specialChars: string[] = [];
  const seen = new Set<string>();
  
  for (const char of allChars) {
    if (!allowedPattern.test(char) && !seen.has(char)) {
      specialChars.push(char);
      seen.add(char);
    }
  }
  
  return {
    hasSpecial: specialChars.length > 0,
    chars: specialChars.sort()
  };
}

function escapeCsv(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toCsv(rows: QuoteRow[]): string {
  const headers = [
    'id',
    'text',
    'author_name',
    'author_category',
    'source',
    'character_count',
    'created_at',
    'posted_at',
    'special_chars',
  ];
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.text,
        r.author_name ?? '',
        r.author_category ?? '',
        r.source ?? '',
        r.character_count ?? '',
        r.created_at ?? '',
        r.posted_at ?? '',
        (r.special_chars || []).join('; '),
      ]
        .map((v) => escapeCsv(String(v)))
        .join(','),
    );
  }
  return lines.join('\n');
}

function renderHtml(
  rows: QuoteRow[],
  meta: { limit: number; offset: number; total?: number | null; page?: number | null; pageCount?: number | null },
): string {
  const data = JSON.stringify(rows);
  const info = JSON.stringify(meta);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Quotes with Special Characters Gallery</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 16px; background: #f7f7f7; }
    .controls { margin-bottom: 12px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(400px, 1fr)); gap: 12px; }
    .card { background: #fff; padding: 12px; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.12); display: flex; flex-direction: column; gap: 8px; cursor: pointer; transition: all 0.2s ease; }
    .card:hover { box-shadow: 0 2px 6px rgba(0,0,0,0.15); transform: translateY(-1px); }
    .card.selected { background: #e3f2fd; border: 2px solid #1976d2; }
    .card.selected:hover { background: #bbdefb; }
    .quote-text { font-size: 14px; color: #222; line-height: 1.6; margin: 8px 0; padding: 8px; background: #f9f9f9; border-left: 3px solid #1976d2; }
    .meta { font-size: 12px; color: #444; line-height: 1.4; }
    .author { font-weight: bold; color: #222; }
    .source { font-style: italic; color: #666; }
    .special-chars { margin-top: 8px; padding: 6px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 4px; }
    .special-chars-label { font-weight: bold; color: #856404; font-size: 11px; margin-bottom: 4px; }
    .special-char { display: inline-block; padding: 2px 6px; margin: 2px; background: #ffc107; color: #856404; border-radius: 3px; font-family: monospace; font-size: 12px; }
    label { cursor: pointer; }
    input[type="search"] { padding: 6px; }
    button { padding: 6px 10px; cursor: pointer; margin: 2px; }
    .count { font-size: 12px; color: #666; }
    .id { font-size: 11px; word-break: break-all; color: #666; font-family: monospace; }
    .checkbox-container { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .quote-text-editable { font-size: 14px; color: #222; line-height: 1.6; margin: 8px 0; padding: 8px; background: #fff; border: 2px solid #1976d2; border-radius: 4px; width: 100%; min-height: 60px; font-family: inherit; resize: vertical; }
    .quote-actions { display: flex; gap: 8px; margin-top: 8px; }
    .edit-btn { background: #1976d2; color: white; border: none; }
    .save-btn { background: #28a745; color: white; border: none; }
    .cancel-btn { background: #6c757d; color: white; border: none; }
    .card.edited { border: 2px solid #28a745; }
    .card.editing { border: 2px solid #ffc107; }
  </style>
</head>
<body>
  <div class="controls">
    <label><input type="checkbox" id="selectAll" /> Select all</label>
    <button id="copy">Copy selected IDs</button>
    <button id="copyEdited">Copy edited quotes (JSON)</button>
    <input type="search" id="textFilter" placeholder="Filter by quote text" size="40" />
    <input type="search" id="authorFilter" placeholder="Filter by author" size="25" />
    <input type="search" id="sourceFilter" placeholder="Filter by source" size="25" />
    <button id="clearFilters">Clear filters</button>
    <span class="count" id="count"></span>
    <span class="count" id="pageInfo"></span>
    <span class="count" id="editedCount" style="color: #28a745; font-weight: bold;"></span>
  </div>
  <div class="grid" id="grid"></div>
  <script>
    const data = ${data};
    const meta = ${info};
    const grid = document.getElementById('grid');
    const selectAll = document.getElementById('selectAll');
    const copyBtn = document.getElementById('copy');
    const copyEditedBtn = document.getElementById('copyEdited');
    const textFilter = document.getElementById('textFilter');
    const authorFilter = document.getElementById('authorFilter');
    const sourceFilter = document.getElementById('sourceFilter');
    const clearFiltersBtn = document.getElementById('clearFilters');
    const count = document.getElementById('count');
    const pageInfo = document.getElementById('pageInfo');
    const editedCount = document.getElementById('editedCount');
    
    // Track edited quotes: { quoteId: { originalText: string, editedText: string } }
    const editedQuotes = new Map();

    function render(list) {
      grid.innerHTML = '';
      for (const row of list) {
        const card = document.createElement('div');
        card.className = 'card';
        card.dataset.text = (row.text || '').toLowerCase();
        card.dataset.author = (row.author_name || '').toLowerCase();
        card.dataset.source = (row.source || '').toLowerCase();
        const isEdited = editedQuotes.has(row.id);
        const displayText = isEdited ? editedQuotes.get(row.id).editedText : row.text;
        const cardClasses = ['card'];
        if (isEdited) cardClasses.push('edited');
        card.className = cardClasses.join(' ');
        card.dataset.quoteId = row.id;
        card.innerHTML = \`
          <div class="checkbox-container">
            <input type="checkbox" class="chk" data-id="\${row.id}" onclick="event.stopPropagation()">
            <span class="id">ID: \${row.id}</span>
          </div>
          <div class="quote-text-display" data-quote-id="\${row.id}">\${escapeHtml(displayText)}</div>
          <div class="quote-text-edit" data-quote-id="\${row.id}" style="display: none;">
            <textarea class="quote-text-editable" data-quote-id="\${row.id}">\${escapeHtml(row.text)}</textarea>
            <div class="quote-actions">
              <button class="save-btn" data-quote-id="\${row.id}">Save</button>
              <button class="cancel-btn" data-quote-id="\${row.id}">Cancel</button>
            </div>
          </div>
          <div class="meta">
            \${row.author_name ? \`<div class="author">\${escapeHtml(row.author_name)}\${row.author_category ? ' (' + escapeHtml(row.author_category) + ')' : ''}</div>\` : ''}
            \${row.source ? \`<div class="source">Source: \${escapeHtml(row.source)}</div>\` : ''}
            <div>Characters: \${row.character_count || '?'} | Created: \${row.created_at ? new Date(row.created_at).toLocaleDateString() : '?'}\${row.posted_at ? ' | Posted: ' + new Date(row.posted_at).toLocaleDateString() : ''}</div>
            \${row.special_chars && row.special_chars.length > 0 ? \`
              <div class="special-chars">
                <div class="special-chars-label">Special Characters Found:</div>
                \${row.special_chars.map(c => {
                  const code = c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0');
                  const escaped = escapeHtml(c);
                  return '<span class="special-char" title="U+' + code + '">' + escaped + '</span>';
                }).join('')}
              </div>
            \` : ''}
            <div class="quote-actions" style="margin-top: 8px;">
              <button class="edit-btn" data-quote-id="\${row.id}" onclick="event.stopPropagation()">Edit</button>
            </div>
          </div>
        \`;
        grid.appendChild(card);
        
        // Make card clickable for selection
        card.addEventListener('click', function(e) {
          // Don't toggle if clicking on interactive elements
          if (e.target.tagName === 'BUTTON' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') {
            return;
          }
          const checkbox = card.querySelector('.chk');
          if (checkbox) {
            checkbox.checked = !checkbox.checked;
            updateCardSelection(card, checkbox.checked);
          }
        });
        
        // Update card visual state when checkbox changes
        const checkbox = card.querySelector('.chk');
        if (checkbox) {
          checkbox.addEventListener('change', function() {
            updateCardSelection(card, this.checked);
          });
          // Set initial state
          updateCardSelection(card, checkbox.checked);
        }
        
        // Attach edit button handler
        const editBtn = card.querySelector('.edit-btn');
        if (editBtn) {
          editBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            const quoteId = this.getAttribute('data-quote-id');
            const card = this.closest('.card');
            const displayDiv = card.querySelector('.quote-text-display');
            const editDiv = card.querySelector('.quote-text-edit');
            const textarea = editDiv.querySelector('textarea');
            
            displayDiv.style.display = 'none';
            editDiv.style.display = 'block';
            card.classList.add('editing');
            textarea.focus();
          });
        }
        
        // Attach save button handler
        const saveBtn = card.querySelector('.save-btn');
        if (saveBtn) {
          saveBtn.addEventListener('click', function() {
            const quoteId = this.getAttribute('data-quote-id');
            const card = this.closest('.card');
            const displayDiv = card.querySelector('.quote-text-display');
            const editDiv = card.querySelector('.quote-text-edit');
            const textarea = editDiv.querySelector('textarea');
            const originalText = data.find(q => q.id === quoteId).text;
            const editedText = textarea.value.trim();
            
            if (editedText === originalText) {
              // No changes, just cancel
              displayDiv.style.display = 'block';
              editDiv.style.display = 'none';
              card.classList.remove('editing');
              return;
            }
            
            // Save the edit
            editedQuotes.set(quoteId, {
              originalText: originalText,
              editedText: editedText
            });
            
            // Update display
            displayDiv.textContent = editedText;
            displayDiv.style.display = 'block';
            editDiv.style.display = 'none';
            card.classList.remove('editing');
            card.classList.add('edited');
            
            // Update card dataset for filtering
            card.dataset.text = editedText.toLowerCase();
            
            updateEditedCount();
          });
        }
        
        // Attach cancel button handler
        const cancelBtn = card.querySelector('.cancel-btn');
        if (cancelBtn) {
          cancelBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            const quoteId = this.getAttribute('data-quote-id');
            const card = this.closest('.card');
            const displayDiv = card.querySelector('.quote-text-display');
            const editDiv = card.querySelector('.quote-text-edit');
            const textarea = editDiv.querySelector('textarea');
            const originalText = data.find(q => q.id === quoteId).text;
            
            // Reset textarea to original
            textarea.value = originalText;
            
            displayDiv.style.display = 'block';
            editDiv.style.display = 'none';
            card.classList.remove('editing');
          });
        }
      }
      applyFilters();
      const pageText = meta.page != null && meta.pageCount != null
        ? \`Page \${meta.page + 1} / \${meta.pageCount}\`
        : '';
      const totalText = meta.total != null ? \`Total: \${meta.total}\` : '';
      pageInfo.textContent = [pageText, \`Offset: \${meta.offset}\`, \`Limit: \${meta.limit}\`, totalText].filter(Boolean).join(' | ');
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function applyFilters() {
      const textQuery = textFilter.value.trim().toLowerCase();
      const authorQuery = authorFilter.value.trim().toLowerCase();
      const sourceQuery = sourceFilter.value.trim().toLowerCase();

      const cards = Array.from(grid.children);
      let shown = 0;
      for (const c of cards) {
        const textMatch = !textQuery || c.dataset.text.includes(textQuery);
        const authorMatch = !authorQuery || c.dataset.author.includes(authorQuery);
        const sourceMatch = !sourceQuery || c.dataset.source.includes(sourceQuery);
        const match = textMatch && authorMatch && sourceMatch;
        c.style.display = match ? '' : 'none';
        if (match) shown++;
      }
      count.textContent = \`Showing \${shown} item(s)\`;
    }

    function currentCards() {
      return Array.from(grid.children).filter(c => c.style.display !== 'none');
    }

    function clearFilters() {
      textFilter.value = '';
      authorFilter.value = '';
      sourceFilter.value = '';
      applyFilters();
    }

    textFilter.addEventListener('input', applyFilters);
    authorFilter.addEventListener('input', applyFilters);
    sourceFilter.addEventListener('input', applyFilters);
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
      const ids = cards
        .map(c => c.querySelector('.chk'))
        .filter(chk => chk && chk.checked)
        .map(chk => chk.getAttribute('data-id'));
      if (!ids.length) {
        alert('No items selected.');
        return;
      }
      await navigator.clipboard.writeText(ids.join('\\n'));
      alert(\`Copied \${ids.length} ID(s) to clipboard\`);
    });
    
    copyEditedBtn.addEventListener('click', async () => {
      if (editedQuotes.size === 0) {
        alert('No quotes have been edited.');
        return;
      }
      
      const edits = Array.from(editedQuotes.entries()).map(([id, edit]) => ({
        id: id,
        originalText: edit.originalText,
        editedText: edit.editedText
      }));
      
      const json = JSON.stringify(edits, null, 2);
      await navigator.clipboard.writeText(json);
      alert(\`Copied \${edits.length} edited quote(s) to clipboard as JSON\`);
    });
    
    function updateEditedCount() {
      editedCount.textContent = editedQuotes.size > 0 ? \`(\${editedQuotes.size} edited)\` : '';
    }
    
    function updateCardSelection(card, isSelected) {
      if (isSelected) {
        card.classList.add('selected');
      } else {
        card.classList.remove('selected');
      }
    }

    render(data);
    updateEditedCount();
  </script>
</body>
</html>`;
}

async function main() {
  const args = parseArgs();
  const outHtml = (args.html as string) || './quotes-gallery.html';
  const outCsv = args.csv as string | undefined;
  const allPages = Boolean(args.all);
  // No default limit - fetch all quotes by default (unless explicitly specified)
  const limitArg = args.limit ? parseInt(args.limit as string, 10) : undefined;
  const pageSize = args['page-size'] ? parseInt(args['page-size'] as string, 10) : (limitArg || 100000);
  const limit = allPages ? pageSize : (limitArg || 100000);
  const page = args.page ? parseInt(args.page as string, 10) : 0;
  const offset = args.offset ? parseInt(args.offset as string, 10) : page * limit;
  const orderArg = (args.order as string | undefined) || 'created_at.desc';
  const filterAuthor = args['author'] as string | undefined;

  const parseOrder = (value: string): { column: string; ascending: boolean } => {
    const parts = value.split('.');
    if (parts.length === 2) {
      return { column: parts[0], ascending: parts[1].toLowerCase() !== 'desc' };
    }
    return { column: value, ascending: true };
  };

  const { column: orderColumn, ascending } = parseOrder(orderArg);

  // Helper to fetch a page of quotes with metadata
  const fetchPage = async (rangeStart: number, rangeEnd: number): Promise<QuoteRow[]> => {
    try {
      let query = supabase
        .from('quotes')
        .select(`
          id,
          text,
          author_id,
          source,
          character_count,
          created_at,
          quote_authors!inner(id, name, category)
        `);

      // Apply author filter if specified
      if (filterAuthor) {
        // First find the author
        const { data: authorData, error: authorError } = await supabase
          .from('quote_authors')
          .select('id')
          .eq('name', filterAuthor)
          .single();

        if (authorError || !authorData) {
          console.log(`No author found with name: ${filterAuthor}`);
          return [];
        }

        query = query.eq('author_id', authorData.id);
      }

      const { data: quotes, error } = await query
        .order(orderColumn, { ascending })
        .range(rangeStart, rangeEnd);

      if (error) throw error;
      if (!quotes || quotes.length === 0) return [];

      // Process quotes to detect special characters and format data
      const processedQuotes: QuoteRow[] = quotes
        .map((q: any): QuoteRow | null => {
          const author = Array.isArray(q.quote_authors) ? q.quote_authors[0] : q.quote_authors;
          const { hasSpecial, chars } = hasSpecialChars(q.text);
          
          // Only include quotes with special characters
          if (!hasSpecial) return null;

          return {
            id: q.id,
            text: q.text,
            author_id: q.author_id,
            author_name: author?.name,
            author_category: author?.category,
            source: q.source,
            character_count: q.character_count,
            created_at: q.created_at,
            posted_at: q.posted_at || null,
            special_chars: chars,
          };
        })
        .filter((q): q is QuoteRow => q !== null);

      return processedQuotes;
    } catch (err: any) {
      console.warn(`Warning: could not fetch quotes: ${err?.message ?? err}`);
      return [];
    }
  };

  // First, we need to fetch ALL quotes to filter for special characters
  // This is because we can't filter by special characters in the database
  console.log('Fetching all quotes to detect special characters...');
  
  let allQuotes: QuoteRow[] = [];
  let currentOffset = 0;
  const batchSize = 1000;
  
  while (true) {
    try {
      let query = supabase
        .from('quotes')
        .select(`
          id,
          text,
          author_id,
          source,
          character_count,
          created_at,
          quote_authors!inner(id, name, category)
        `);

      if (filterAuthor) {
        const { data: authorData } = await supabase
          .from('quote_authors')
          .select('id')
          .eq('name', filterAuthor)
          .single();
        
        if (authorData) {
          query = query.eq('author_id', authorData.id);
        }
      }

      let batchQuery = query.order(orderColumn, { ascending });
      // Only use range if we have a limit, otherwise fetch all
      if (limitArg !== undefined) {
        batchQuery = batchQuery.range(currentOffset, currentOffset + batchSize - 1);
      } else {
        // For unlimited, still paginate in batches but don't restrict range
        batchQuery = batchQuery.range(currentOffset, currentOffset + batchSize - 1);
      }
      const { data: batch, error } = await batchQuery;

      if (error) throw error;
      if (!batch || batch.length === 0) break;

      // Process batch
      const processed = batch
        .map((q: any): QuoteRow | null => {
          const author = Array.isArray(q.quote_authors) ? q.quote_authors[0] : q.quote_authors;
          const { hasSpecial, chars } = hasSpecialChars(q.text);
          
          if (!hasSpecial) return null;

          return {
            id: q.id,
            text: q.text,
            author_id: q.author_id,
            author_name: author?.name,
            author_category: author?.category,
            source: q.source,
            character_count: q.character_count,
            created_at: q.created_at,
            posted_at: q.posted_at || null,
            special_chars: chars,
          };
        })
        .filter((q): q is QuoteRow => q !== null);

      allQuotes.push(...processed);
      console.log(`  Processed ${currentOffset + batch.length} quotes, found ${allQuotes.length} with special characters...`);

      if (batch.length < batchSize) break;
      currentOffset += batchSize;
    } catch (err: any) {
      console.error(`Error fetching batch at offset ${currentOffset}: ${err?.message ?? err}`);
      break;
    }
  }

  console.log(`Found ${allQuotes.length} quotes with special characters`);

  // If generating all pages, paginate the filtered results
  if (allPages) {
    const total = allQuotes.length;
    const pageCount = Math.ceil(total / limit) || 1;

    const { dir, name, ext } = path.parse(outHtml);
    const baseExt = ext || '.html';
    const pageFiles: string[] = [];

    for (let p = 0; p < pageCount; p++) {
      const pageOffset = p * limit;
      const pageQuotes = allQuotes.slice(pageOffset, pageOffset + limit);
      const html = renderHtml(pageQuotes, { limit, offset: pageOffset, total, page: p, pageCount });
      const filename = path.join(dir || '.', `${name || 'quotes-gallery'}-page-${p + 1}${baseExt}`);
      await writeFile(filename, html, 'utf8');
      pageFiles.push(filename);
      console.log(`HTML page written: ${filename} (${pageQuotes.length} rows)`);
    }

    // Write a simple index file linking to all pages
    const indexHtml = `<!doctype html>
<html><head><meta charset="UTF-8"><title>Quotes Gallery Index</title></head>
<body><h1>Quotes with Special Characters - Gallery Pages</h1><ul>
${pageFiles.map((f) => `<li><a href="${path.basename(f)}">${path.basename(f)}</a></li>`).join('\n')}
</ul></body></html>`;
    const indexFile = path.join(dir || '.', `${name || 'quotes-gallery'}-index${baseExt}`);
    await writeFile(indexFile, indexHtml, 'utf8');
    console.log(`Index written: ${indexFile} (${pageFiles.length} pages, total quotes: ${total})`);
    return;
  }

  // Single page mode - use the filtered results
  const pageQuotes = allQuotes.slice(offset, offset + limit);

  if (!pageQuotes || pageQuotes.length === 0) {
    if (outCsv) {
      const csv = toCsv([]);
      await writeFile(outCsv, csv, 'utf8');
      console.log(`CSV written to ${outCsv} (0 rows)`);
    } else {
      const html = renderHtml([], { limit, offset, total: allQuotes.length });
      await writeFile(outHtml, html, 'utf8');
      console.log(`HTML gallery written to ${outHtml} (0 rows)`);
    }
    return;
  }

  if (outCsv) {
    const csv = toCsv(pageQuotes);
    await writeFile(outCsv, csv, 'utf8');
    console.log(`CSV written to ${outCsv} (${pageQuotes.length} rows)`);
  } else {
    const html = renderHtml(pageQuotes, { limit, offset, total: allQuotes.length });
    await writeFile(outHtml, html, 'utf8');
    console.log(`HTML gallery written to ${outHtml} (${pageQuotes.length} rows)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

