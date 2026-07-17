---
name: wikikai
description: Use WikiKai MCP server to persist presentation-style knowledge — markdown pages with Mermaid diagrams, Chart.js graphs, stats cards, and step lists. INVOKE when the user asks to "บันทึก", "เก็บไว้", "ทำ doc", "make a knowledge doc", "save this as a knowledge page", "ทำสรุปไว้ดู", "open my notes", or when producing an explanation that the user will want to revisit and share via URL. Also INVOKE when the user references existing knowledge (e.g. `&3`, `#12`, "เปิด knowledge เก่า", "search my docs"). Skip for transient answers, code edits, or pure conversation.
---

# WikiKai skill

WikiKai is an MCP server that stores **knowledge documents** with rich rendering (Mermaid, Chart.js, stat cards, step cards). Each document is a **knowledge** (`&N`) containing multiple **pages** (`#N`). Pages are markdown files indexed by SQLite FTS5. The server exposes a web portal for browsing.

## When to use

Use WikiKai when the user wants persistent, browsable, shareable knowledge. Strong triggers:

- "บันทึก / เก็บไว้ / ทำสรุป / ทำ doc / make a knowledge doc / save this"
- The answer is structured (multiple sections, would benefit from tabs) and the user will revisit
- The user references an existing knowledge by id: `&N`, `#N`, or asks "เปิด knowledge เก่า"
- The user asks to "search my docs" / "ค้นใน knowledge ที่ทำไว้"

Skip WikiKai for: one-shot questions, code-only edits, chit-chat.

## The tools (grouped)

### Knowledge (whole documents)
- `add_knowledge({ title, project?, session_id?, user_prompt?, tokens_used?, tags?, first_page? })` — create. Returns `{ id, url }`.
- `edit_knowledge({ id, ...metadata })` — update metadata only (no content), including replacing the knowledge's `tags` array.
- `list_knowledge({ project?, tag?, session_id?, search? })` — metadata-only listing.
- `get_knowledge({ id, include_pages? })` — meta + page list with line counts.
- `delete_knowledge({ id })` — cascades to pages.
- `get_outline({ knowledge_id })` — page titles + heading hierarchy **without body** (cheapest scan).

### Pages
- `add_page({ knowledge_id, title, content, position?, summary?, keywords?, user_prompt? })`
- `edit_page({ page_id, title?, content?, summary?, keywords?, user_prompt? })` — full replace.
- `append_page({ page_id, text, user_prompt? })` — race-safe, no re-read needed.
- `delete_page({ page_id })`
- `list_pages({ knowledge_id })`
- `reorder_pages({ knowledge_id, order: [pid, pid, ...] })`
- `move_page_to_knowledge({ page_id, knowledge_id, position? })` — move a page into a DIFFERENT knowledge (keeps id, history, images; appends when `position` omitted). Use `move_page` / `move_page_to` to reorder within one knowledge.

### Fine-grained edits
- `read_page({ page_id, line_start?, line_end?, mode? })` — content + `total_lines` + parent knowledge structure. Two modes:
  - **`mode: "summary"` (DEFAULT)** — every annotated rich block + table collapses to a one-line placeholder `[@N kind 25 lines: caption]` (or `[@N table 12r × 3c: caption]`); response also gains a `blocks` array with each id / kind / caption / source-line range. Typical 5–10× token saving on pages with diagrams or large tables. **`hash` is omitted** in this mode. AI's default workflow: read with `summary` → fetch full bodies via `get_block({ id })` for the few blocks you actually need.
  - **`mode: "full"`** — verbatim markdown with `hash` for `expected_hash` gating. Line numbers match source. **Switch to `full` immediately before any `edit_lines` call** — the summary skeleton's line numbers DON'T match source, so a line-based edit on summary content would target the wrong spot.
  - **`include_styles: false` (default for both modes)** — every `style="..."` attribute inside `html-embed` fences is stripped from the returned content. Inline styles routinely eat 60-70% of an html-embed block's tokens with zero value for editing text/structure. Pass `include_styles: true` only when you're working on presentation (recolour, redesign). `get_block({ id })` has the same flag with the same default; only the `style=` attr is stripped — every other attribute (src/href/alt/title/data-*/class) stays. **`hash` is OMITTED when content is stripped** — writing the stripped HTML back via `edit_lines` would silently wipe the user's inline styles, so the server forces you to re-read with `include_styles: true` first to get a hash for editing.
- `edit_lines({ page_id, line_start, line_end, new_text, expected_hash?, user_prompt? })` — line range replace. Pass `expected_hash` from a recent `read_page` to gate stale edits.
- `edit_section({ page_id, heading, new_content, user_prompt? })` — **PREFER THIS** over line edits — heading-anchored replace, stable across other edits.
- `replace_text({ knowledge_id, page_id?, find, replace, count?, user_prompt? })`

#### Mutation feedback (no re-read needed)
Every fine-grained edit (`edit_lines`, `edit_section`, `insert_lines`, `add_lines`, `append_page`) returns scoped feedback so you can keep editing without an immediate full re-read:
- **`changed_range.after`** — `{ line_start, line_end }` the new content now occupies (`before` = what it replaced; omitted for pure inserts/appends).
- **`changed_range_hash`** — hash of the `after` range. Pass it straight back as the next edit's `expected_hash` to chain edits on the same region with **no re-read**.
- **`page_hash`** — full-page hash, identical to `read_page({ mode: "full" })`'s `hash`. Trust it directly instead of re-reading just to get a hash.
- **`status`** — `"changed"` or `"noop"`. A `"noop"` (new content byte-identical to old) does **not** bump the version or snapshot a revision.
- **`affected`** — `{ headings, blocks }` that intersect the changed range, including any block/table **ids the server just stamped** (so you learn new `@N` ids without a re-read). Tables carry `row_count`. Scoped to the edit, never the whole page.

### Search + helper
- `search({ query, project?, knowledge_id?, limit? })` — SQLite FTS5 across content/title/keywords. Returns hits with `url`.
- `get_example({ kind?, outline_only?, line_start?, line_end? })` — markdown reference. **Use `outline_only: true` first** (10× cheaper). `kind` = `full` / `minimal` / `mermaid` / `chart` / `stats` / `steps` / `er` / `html`.
- `get_prompt_log({ knowledge_id, limit?, offset? })` — read the rolling audit trail of `user_prompt` values per knowledge. Each entry: `{ page_id?, page_version?, tool_name, prompt, created_at }`. Use to answer "why did revision N happen?"
- `toggle_task({ page_id, index, expected_version? })` — flip the Nth interactive checkbox on a page (0-based, document order, skipping non-html-embed code fences). Counts three sources in source order: GFM `- [ ]`/`- [x]` task items, `[ ]`/`[x]` **anywhere inside a markdown-table cell** (start, middle, multiple per cell), and `<input type="checkbox">` inside `html-embed`. Same path the web checkbox uses.
  - **Pass `expected_version` from your most recent `read_page` / `get_block`** when you call toggle from an AI workflow. Indices are recomputed top-down on every call, so if another tool added a checkbox earlier between your read and your toggle, index N now points at a different box. With `expected_version` the server rejects the call instead of flipping the wrong one. Web-UI clicks omit it (no race window).

### Interactive checkboxes (GFM, not a fence)
- Write plain GFM task items anywhere a normal markdown list works: `- [ ] task` / `- [x] done`. They render as clickable checkboxes; clicking flips the source (version bump + revision + FTS reindex).
- **Inside a plain markdown table**: drop `[ ]` or `[x]` anywhere in any cell (start, middle, multiple per cell) — each becomes a live checkbox sharing the same toggle-index counter as the GFM list above. The match requires the bracket pair to be bounded by whitespace or the cell separator `|`, so `[abc]`, markdown links like `[link](url)`, and bracket-heavy code references like `arr[i]` aren't mis-detected. To keep a literal `[x]` as text (e.g. when documenting the syntax inside a cell), wrap it in backticks: `` `[x]` `` becomes inline code and is skipped.
- For checkboxes inside a custom HTML layout (gradient cards, sticky-header tables, badges, …), drop raw `<input type="checkbox">` (with or without `checked`) into an `html-embed` block — same toggle index. Prefer the plain-markdown form for ordinary tables; use `html-embed` only when you need full HTML/CSS control.
- AI can drive the same toggle without the UI via `toggle_task({ page_id, index })`.
- **Do not** use a `checklist` fence — that block was retired; if you see one in an old page, replace it with GFM tasks on save.

### Prompt log (opt-in)
Every mutation tool accepts an optional `user_prompt` field. When supplied, the server truncates it to 500 chars and appends a row to `prompt_log` linked to the resulting page + version. **Opt-in by design** — send only when the user's message carries intent (a request, a correction). Skip for trivial retries or follow-ups. The info popover in the web UI shows the log as a timeline; `get_prompt_log` is the read-side.

### Per-project permissions

Non-admin users authenticated by their personal MCP token (`mcp_token`) only see knowledge in projects an admin has granted them. `view` allows read tools (`list_knowledge`, `get_*`, `read_page`, `search`); `edit` allows mutations (`add_*`, `edit_*`, `delete_*`). Admin-token callers bypass all checks. Forbidden calls throw with messages like "no access to project 'X'" or "edit not allowed on project 'Y'".

## Recommended workflows

### Creating a new knowledge

1. **Scan an example cheaply first** (only if you forgot fence syntax):
   ```
   get_example({ kind: "full", outline_only: true })   // heading list + total_lines
   get_example({ kind: "full", line_start: N, line_end: N+20 })  // slice the section you need
   ```
2. **Create with first_page** to save a round-trip:
   ```
   add_knowledge({
     title, project, tags, session_id, user_prompt, tokens_used,
     first_page: { title, content }
   })
   ```
3. **Add more pages** — one major heading per page works well:
   ```
   add_page({ knowledge_id, title, content })
   ```
4. **Reply to the user with the URL** (`/&{id}`) so they can open it immediately.

### Editing existing knowledge

1. `get_outline({ knowledge_id })` — see structure cheaply.
2. `read_page({ page_id, line_start, line_end })` — read only the section you need.
3. `edit_section({ page_id, heading, new_content })` — stable edits anchored to headings.
4. Fallback to `edit_lines` only if the section has no heading; always pass `expected_hash`.

### Recall / search

```
search({ query, project? })
```
Returns hits with `url`, `line`, `snippet`, `page_title`, `knowledge_title`. Open the URL or `read_page` to dig in.

## Best practices

| Do | Why |
|---|---|
| Pass `session_id` (Claude Code chat UUID) | Users can `claude --resume <id>` from the doc later |
| Pass `user_prompt` verbatim | Shown in info popover — explains why the doc exists |
| Pass `tokens_used` (input + output) | Cost tracking surfaces in UI |
| Use `edit_section` over `edit_lines` | Line numbers shift after every edit |
| `outline_only:true` before `read_page` | 10× cheaper |
| One major H1/H2 per page | Tab navigation works naturally |
| Use `project` to group | Sidebar groups by project |
| Use `tags` to classify across projects | The portal edits them at **&N → จัดการ tags** (or **i → tags**) and its sidebar filter matches tag text |
| Star important knowledge in the web portal | Browser-local preference; useful for filtering the sidebar without changing shared metadata |

## Content fences (use them — they render rich)

### Block-choice rule

**Reach for plain markdown + a prepared semantic block FIRST.** Only escalate to `html-embed` when the prepared blocks genuinely can't express what the reader needs to see, AND a custom HTML layout meaningfully improves understanding (gradient status cards, color-coded decision matrices, flex layouts with badges, `<details>` accordions, inline SVG diagrams, iframes).

Why this order:
- Prepared blocks are **cheaper to read** (no inline-style noise — `html-embed` style attrs are stripped by default for AI but the cost remains for human review/diff)
- Prepared blocks get **richer tooling** — `find_table_rows`, `get_table_row`, chart re-themes, `@N` referencing all work out of the box
- Prepared blocks **render consistently** across light/dark themes; html-embed often needs theme-aware CSS to look right
- Inline `style="..."` in `html-embed` averages 60-70% of the block's bytes — picking the right semantic block avoids that cost entirely

Pick by intent:

| You want to show… | Use |
|---|---|
| Flow, sequence, ER, gantt, state, mindmap | ```mermaid |
| Numeric series / comparison / trend | ```chart (single) or ```chart-grid (multiple) |
| KPI numbers, dashboard headline figures | ```stats |
| Ordered procedure, how-to, deployment runbook | ```steps |
| Tabular data | **plain markdown table** (gets `@N`, `[ ]`/`[x]` in cells, `find_table_rows` search, `get_table_row` random access) |
| 4+ side-by-side screenshots as gallery | ```images |
| Single image inline / in prose / in a table cell | plain markdown `![alt](src "WxH")` (has drag-resize + click-lightbox) |
| Decision matrix with row/col colors, gradient cards, badges, custom `<details>`, inline SVG, iframe | ```html-embed (last resort) |

### Fence catalog

```mermaid           — flowchart/sequence/ER/gantt/state
```chart             — single Chart.js (JSON config)
```chart-grid        — array of charts side-by-side
```stats             — array of { num, label, color? } (purple/blue/green/amber/red/cyan)
```steps             — array of { title, body? } — auto-numbered cards, body is markdown
```html-embed        — raw HTML for flexible content (richer tables with row colors / col-span / sticky headers, custom card/grid layouts, inline SVG, iframes, <details>). <script> tags are inert by design. **Last resort** — see block-choice rule above
```images            — multi-image GALLERY only (4+ side-by-side thumbnails as a uniform grid). For a single image, use plain markdown `![alt](src "WxH")` instead — it now has drag-to-resize + click-to-lightbox, so it covers the same use case with less syntax
```typescript / etc  — code blocks with Shiki highlight

## Images

To attach an image to a knowledge page:

1. `add_image(...)` — registers the image, returns `{ src: "/img/<hash>.<ext>", hash, size_bytes, … }`. Content-addressed → identical bytes dedupe automatically. Two ways to supply the bytes:
   - **`{ path, alt? }`** — *prefer this when the file is on the same machine as the server.* The server reads the file off its own disk, so **no base64 enters your context** (a same-machine import that would cost tens-of-thousands of tokens as base64 becomes ~free). `path` must be absolute and under a server-configured import root (`WIKIKAI_IMAGE_IMPORT_ROOTS`); mime is inferred. If it's not on the server, download it there first, then import by path.
   - **`{ data_base64, mime_type, alt? }`** — fallback for files NOT on the server machine. Sends the bytes inline (token-expensive for large images).
2. Embed the returned `src` in markdown. **Default: plain markdown image** — covers virtually every case:

   ```markdown
   ![Pipeline overview](/img/abc.png "720x")
   ```

   - Title slot encodes max size: `"WxH"` / `"Wx"` / `"xH"` / `"caption w=300 h=200"` (caption form when you want both text and sizing).
   - Works in paragraphs, list items, AND markdown table cells.
   - Web UI adds drag-to-resize handles on hover (right/bottom/corner) → drop and the new size is persisted to the title slot via `POST /api/pages/:pid/image-size`.
   - Click the image → fullscreen lightbox with the original resolution.
   - Article column is ~860 px on a typical screen; `"720x"` is a safe full-bleed cap.

   Two specialised surfaces, reach for only when the default doesn't fit:

   **A. Multi-image gallery — `images` fence** (4+ side-by-side thumbnails as a uniform grid):
   ```images
   [
     { "src": "/img/abc.png", "alt": "Pipeline overview", "caption": "Phase 1" },
     { "src": "/img/def.jpg", "alt": "Result chart" },
     { "src": "/img/ghi.jpg", "alt": "Final dashboard" },
     { "src": "/img/jkl.jpg", "alt": "Audit log" }
   ]
   ```
   For ≤ 3 images, plain markdown is simpler and equivalent (it has its own lightbox + resize handles).

   **B. Image inside custom HTML — `html-embed` + `<img>`** (when the image is part of a flex/grid layout, badge, `<details>`, with bespoke border/styling):
   ```html-embed
   <div style="display:flex;gap:14px;align-items:flex-start;">
     <img src="/img/abc.png" alt="Pipeline" style="width:240px;border-radius:8px;" />
     <div>
       <h4>Phase 1 ingestion</h4>
       <p>รับข้อมูลจาก iSingleForm API, ทำ data quality scoring …</p>
     </div>
   </div>
   ```

To **view** an image later, use `get_image({ hash })` or `get_image({ src })` — the response includes an MCP `image` content block so the assistant sees the picture inline, plus a JSON sidecar with metadata.

**Token control — `get_image({ ..., mode })`:** pass `mode: "meta"` to get metadata only (mime, size, dimensions, alt) with **no inline bytes** — the cheapest way to decide *what* an image is before paying for base64. `mode: "full"` (or omitting `mode`) inlines the bytes as today (still capped by `max_bytes`, default ~6MB). The response carries a `mode` field reporting which applied. Reach for `meta` first when you only need to know an image exists / its size; use `full` when you actually need to see the picture.

`read_page` automatically returns an `images_referenced` array covering **all** surfaces — every `{ src, url, alt?, caption?, block_id?, via }` where `via` is `"images"`, `"html-embed"`, or `"markdown"` (plain `![alt](/img/… "WxH/caption")`, title slot included). Use it to pick which image to `get_image` without re-parsing the page.

**Showing an image to a human / outside the portal — use `url`, not `src`.** `src` is a relative `/img/<hash>` path that only resolves inside the same-origin web portal; pasted into a chat or another app it renders broken. `images_referenced[].url` is the absolute, cross-machine URL (it works from any machine that can reach the server). To get the whole page body with every image reference already absolute, call `read_page({ ..., absolute_image_urls: true })` — note that rewrites `content`, so its `hash` is omitted (don't feed it back to `edit_lines`).

Tutorial doc lives at `/&4` — `get_outline({ knowledge_id: 4 })` + `read_page` to learn by example.

## Block ids (`@N`)

Every rendered rich fenced block gets a globally-unique id stamped into the source as ```` ```mermaid {@123} ```` and rendered as a tiny pill in the block's corner. The user can then refer to it by id: "อัพเดต @123" / "update @47".

When asked to **read** a block by `@N`:
- `get_block({ id: N })` — single call returns `{ kind, source, inner, line_start, line_end, page_id, page_title, knowledge_id, knowledge_title, project, url }`. The fence boundaries are already parsed for you; no need to FTS + read_page + locate ``` yourself.

When asked to **update** a block by `@N`:
1. `get_block({ id: N })` to see the current source + locate `line_start`/`line_end`.
2. `read_page({ page_id, line_start, line_end })` to get a fresh `hash` for the line range.
3. `edit_lines({ page_id, line_start, line_end, new_text, expected_hash })` — rewrites just that fence. Keep the existing `{@N}` annotation in `new_text` so the id is preserved.

(Direct FTS search `search({ query: "{@N}" })` still works — `get_block` is just the convenience wrapper.)

### Converting a block to a different type — keep the `@N`

When the user asks "convert @123 from a markdown table to an html-embed" (or stats card → mermaid, etc.), **carry the `{@123}` annotation into the new source** so the id stays stable and every `@123` reference the user already has keeps working:

- Fence block: include the annotation in the fence info — `` ```html-embed {@123} `` / `` ```mermaid {@123} ``
- Markdown table: leave a blank line under the last row, then `{@123}` on its own line

If you forget, the server now auto-preserves: `edit_lines` and `edit_section` extract `{@N}` ids from the region being replaced and inject any missing ones into the first eligible slot in the new content (fence info or table-trailing-line), in source order. So a single-block conversion keeps its id even when you submit the new source without the annotation. Multi-block regions get 1:1 mapping by order; N:1 merges keep the first id and lose the rest (no other reasonable choice). Still — write the annotation explicitly when you can; the auto-preserve is a safety net, not a contract.

**Markdown tables also get an `@N` id** via a trailing `{@N}` line under the table (with one blank line in between):

```markdown
| col a | col b |
|-------|-------|
| 1     | 2     |

{@123}
```

The renderer attaches it as `data-block-id` on the `<table>`. `injectBlockIds` auto-inserts the annotation on save when missing — you don't need to allocate one yourself, just write the table and let the server stamp it.

**Reading a table efficiently** — `get_block` returns the whole body, which can be expensive for large tables. Pick the cheapest tool for the question:

| Question | Use |
|---|---|
| "What columns does @123 have? How many rows?" | `get_block({ id: 123, summary: true })` → `{ kind:"table", columns:[...], row_count, line_start, line_end, ... }` — no body, cheap. |
| "Give me row N" (you know the index) | `get_table_row({ block_id: 123, index: N })`. `index` is 0-based; negative wraps from end (`-1` = last row). |
| "Find rows where col=value" / "rows mentioning X" / "first N rows" | `find_table_rows({ block_id, q?, where?, columns?, limit? })`. `q` = substring search (case-insensitive), `where` = exact column match (AND across keys), `columns` = restrict `q` to these column names, `limit` default 50 / max 500. Returns `{ matches: [{row_index, columns, source_line, url}], total_matched, truncated }`. |
| "Which rows have a checkbox? Toggle one of them" | `get_table_rows_with_checkbox({ block_id, checked? })`. Each match carries `checkboxes: [{ task_index, checked }]` — `task_index` is the **page-global** toggle index, pass it straight to `toggle_task({ page_id, index })`. It already accounts for any GFM tasks / html-embed checkboxes earlier on the page, so it is NOT the same as `row_index`. |
| "Show me the whole table" / "I'm about to edit it" | `get_block({ id: 123 })` (full source + inner). Use sparingly for tables > ~100 rows. |

**Editing table rows:** `update_table_rows` (replace a range), `insert_table_rows` (insert before a 0-based `at`; `at = row_count` appends), `append_table_rows` (add at the end). The plural names are canonical; the singular `insert_table_row` / `append_table_row` remain as compatibility aliases. All take a `new_rows: ["| a | b |", ...]` array and preserve the table's trailing `{@N}` id.

Token-cost rule of thumb: for a 100-row × 5-col table (cells averaging ~20 chars), `get_block` costs ~3 k tokens; `summary` ~0.1 k; `get_table_row` ~0.1 k; `find_table_rows` ~0.1 k per match. Probe with `summary` first when you don't know the size.

## URL conventions

- `/&3` — knowledge 3, first tab
- `/&3/#12` — knowledge 3, page 12
- `/&3/#12:42` — knowledge 3, page 12, scroll to line 42

`&` = knowledge marker, `#` = page marker. Both are clickable badges in the UI that copy to clipboard.

## What WikiKai is NOT

- Not a wiki for everyone — it's a personal/team knowledge store, not a public CMS.
- Not for transient context — use it when the user wants to come back to the content.
- Not a chat log — use `session_id` + `user_prompt` to link to the conversation, but the doc itself should be the *answer*, not the back-and-forth.
