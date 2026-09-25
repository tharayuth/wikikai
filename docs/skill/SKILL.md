---
name: wikikai
description: Use WikiKai MCP server to persist presentation-style knowledge — markdown pages with Mermaid diagrams, Chart.js graphs, stats cards, and step lists. INVOKE when the user asks to "บันทึก", "เก็บไว้", "ทำ doc", "make a knowledge doc", "save this as a knowledge page", "ทำสรุปไว้ดู", "open my notes", or when producing an explanation that the user will want to revisit and share via URL. Also INVOKE when the user references existing knowledge (e.g. `&3`, `#12`, "เปิด knowledge เก่า", "search my docs"). Skip for transient answers, code edits, or pure conversation.
---

# WikiKai skill

WikiKai is an MCP server that stores **knowledge documents** with rich rendering (Mermaid, Chart.js, stat cards, step cards). Each document is a **knowledge** (`&N`) containing multiple **pages** (`#N`). Pages are markdown files indexed by SQLite FTS5. The server exposes a web portal for browsing. In the portal, select text before clicking **Edit raw** to focus, scroll to, and select its matching Markdown source. Formatting markers may be included when the selection crosses formatted text.

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
- `get_knowledge({ id, include_pages? })` — meta + page list (line counts, page `version`).
- `delete_knowledge({ id })` — permanent: pages, revisions and prompt log go too.
- `get_outline({ knowledge_id })` — page titles + heading hierarchy **without body** (cheapest scan).

### Pages
- `add_page({ knowledge_id, title, content, position?, summary?, keywords?, user_prompt? })`
- `edit_page({ page_id, title?, content?, summary?, keywords?, user_prompt? })` — full replace.
- `delete_page({ page_id })`
- `reorder_pages({ knowledge_id, order: [pid, pid, ...] })`
- `move_page({ page_id, before? | after? | position?, knowledge_id? })` — move one page: within its knowledge by one of `before` / `after` / `position`; into a DIFFERENT knowledge with `knowledge_id` (+ `position`, default last) — keeps id, history, images.

### Fine-grained edits
- `read_page({ page_id, line_start?, line_end?, mode? })` — content + `total_lines` + parent knowledge structure. Two modes:
  - **`mode: "summary"` (default for a whole page)** — every annotated rich block + table collapses to a one-line placeholder `[@N kind 25 lines: caption]` (or `[@N table 12r × 3c: caption]`); response also gains a `blocks` array with each id / kind / caption / source-line range. Typical 5–10× token saving on pages with diagrams or large tables. **`hash` is omitted** in this mode. AI's default workflow: read with `summary` → fetch full bodies via `get_block({ id })` for the few blocks you actually need.
  - **`mode: "full"` (default when you pass `line_start`/`line_end`)** — markdown with `hash` for `expected_hash` gating. Line numbers match source. **Use `full` before any `edit_lines` call** — the summary skeleton's line numbers DON'T match source.
  - Every read returns the page `version` — pass it as `expected_version` to `toggle_task` and the table tools.
  - **`include_styles: false` (default for both modes)** — every `style="..."` attribute inside `html-embed` fences is stripped from the returned content. Inline styles routinely eat 60-70% of an html-embed block's tokens with zero value for editing text/structure. Pass `include_styles: true` only when you're working on presentation (recolour, redesign). `get_block({ id })` has the same flag with the same default; only the `style=` attr is stripped — every other attribute (src/href/alt/title/data-*/class) stays. **`hash` is OMITTED when content is stripped** — writing the stripped HTML back via `edit_lines` would silently wipe the user's inline styles, so the server forces you to re-read with `include_styles: true` first to get a hash for editing.
- `edit_lines({ page_id, line_start, line_end, new_text, expected_hash?, user_prompt? })` — line range replace; `new_text: ""` deletes the range. Pass `expected_hash` — the `hash` of a read of exactly that range — to gate stale edits.
- `edit_section({ page_id, heading, new_content, user_prompt? })` — **PREFER THIS** over line edits — heading-anchored replace, stable across other edits.
- `replace_text({ knowledge_id, page_id?, find, replace, count?, user_prompt? })`

#### Mutation feedback (no re-read needed)
Every fine-grained edit (`edit_lines`, `edit_section`, `insert_lines`, `add_lines`) returns scoped feedback so you can keep editing without an immediate full re-read:
- **`changed_range.after`** — `{ line_start, line_end }` the new content now occupies (`before` = what it replaced; omitted for pure inserts/appends).
- **`changed_range_hash`** — hash of the `after` range. Pass it straight back as the next edit's `expected_hash` to chain edits on the same region with **no re-read**.
- **`page_hash`** — full-page hash, identical to `read_page({ mode: "full" })`'s `hash`. Trust it directly instead of re-reading just to get a hash.
- **`status`** — `"changed"` or `"noop"`. A `"noop"` (new content byte-identical to old) does **not** bump the version or snapshot a revision.
- **`affected`** — `{ headings, blocks }` that intersect the changed range, including any block/table **ids the server just stamped** (so you learn new `@N` ids without a re-read). Tables carry `row_count`. Scoped to the edit, never the whole page.

### Search + helper
- `search({ query, project?, projects?, knowledge_id?, limit?, include_archived? })` — ranked search across content/title/keywords. Terms are weighted by rarity, so a natural-language question outperforms a bag of keywords. Matching is literal (no Thai↔English translation); `&N` / `#N` / `@N` jumps straight to that document / page / block. Returns hits with `url`, `snippet`, `heading`, `matched_terms`, `match_ratio`, plus `total` relevant pages (raise `limit` to see more of them).
- `get_example({ kind?, outline_only?, line_start?, line_end? })` — markdown reference. **Use `outline_only: true` first** (10× cheaper). `kind` = `full` / `minimal` / `mermaid` / `chart` / `stats` / `steps` / `er` / `html` / `images` / `tasks`.
- `get_prompt_log({ knowledge_id, limit?, offset? })` — read the audit trail of `user_prompt` values per knowledge (only calls that passed one are logged; `total` counts all entries). Each entry: `{ page_id?, page_version?, tool_name, prompt, created_at }`. Use to answer "why did revision N happen?"
- `toggle_task({ page_id, index, expected_version? })` — flip the Nth interactive checkbox on a page (0-based, document order, skipping non-html-embed code fences). Counts three sources in source order: GFM `- [ ]`/`- [x]` task items (bulleted or numbered), `[ ]`/`[x]` **anywhere inside a markdown-table cell** (start, middle, multiple per cell), and `<input type="checkbox">` inside `html-embed`. Same path the web checkbox uses.
  - **Pass `expected_version` from your most recent `read_page` / `get_block`** when you call toggle from an AI workflow. Indices are recomputed top-down on every call, so if another tool added a checkbox earlier between your read and your toggle, index N now points at a different box. With `expected_version` the server rejects the call instead of flipping the wrong one. Web-UI clicks omit it (no race window).

### Interactive checkboxes (GFM, not a fence)
- Write plain GFM task items anywhere a normal markdown list works: `- [ ] task` / `- [x] done`. They render as clickable checkboxes; clicking flips the source (version bump + revision + FTS reindex).
- **Inside a plain markdown table**: drop `[ ]` or `[x]` anywhere in any cell (start, middle, multiple per cell) — each becomes a live checkbox sharing the same toggle-index counter as the GFM list above. The match requires the bracket pair to be followed by whitespace or the cell separator `|`, so `[abc]`, markdown links like `[link](url)`, and bracket-heavy code references like `arr[i]` aren't mis-detected. To keep a literal `[x]` as text (e.g. when documenting the syntax inside a cell), wrap it in backticks: `` `[x]` `` becomes inline code and is skipped.
- **Cell colours in a plain markdown table**: start a cell with `{bg=<colour>}` (background) and/or `{fg=<colour>}` (text; `color=` is an alias), e.g. `| {bg=green fg=green} Pass | {fg=red} **-1.8%** |`. Colours: `red` `green` `amber` `blue` `cyan` `purple` `gray` — theme colours, readable in light and dark mode. Works in header cells and alongside `[ ]`/`[x]`, bold and links. Only a marker at the very start of a cell with known keys and colours counts; anything else in braces (`{id}`, `{bg=pink}`) stays literal. Prefer this over converting a table to `html-embed` just to colour a few cells.
- **Line breaks inside a table cell**: a cell must stay on one source line, so write `<br>` where it should break, e.g. `| Suvarnabhumi (BKK)<br>Don Mueang (DMK) |`. `<br/>`, `<br />`, `</br>` and `&#10;` work too. Only inside table cells; in code spans and outside tables `<br>` stays literal, and other HTML tags in a table are still escaped.
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

**Ask the way you would ask a colleague.** Every term is weighted by how rare it
is across the corpus, so the words naming your subject decide the ranking and
filler words cost nothing. `"ทำไมเราเลือก better-sqlite3 แทน ORM"` works better
than `"sqlite ORM"`. Words shorter than three characters cannot be indexed and
are ignored. Thai needs no word segmentation, and asking in one language finds
pages written in the other.

Each hit returns `url`, `line`, `heading`, `snippet`, `page_title`,
`knowledge_title`, `matched_terms` and `match_ratio`.

**Read the hit before you read the page.** The snippet is quoted around the
rarest term you matched and the heading says where it sits — together they
usually answer the question, and every `read_page` you skip is a page of tokens
you did not spend. Call `read_page` when you need the surrounding lines, not to
find out whether the hit was relevant.

`match_ratio` below 1 means the page matched only part of your query; `total`
is the real number of matches, so `hits.length < total` means there is more
behind the `limit` you asked for.

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
| Use `tags` to classify across projects | Edit at **&N → จัดการ tags** (or **i → tags**); the sidebar tag button selects exact filters and shows the active selection as removable chips |
| Star important knowledge in the web portal | Browser-local preference; useful for filtering the sidebar without changing shared metadata |

## Content fences (use them — they render rich)

### Block-choice rule

**Reach for plain markdown + a prepared semantic block FIRST.** Only escalate to `html-embed` when the prepared blocks genuinely can't express what the reader needs to see, AND a custom HTML layout meaningfully improves understanding (gradient status cards, color-coded decision matrices, flex layouts with badges, `<details>` accordions, inline SVG diagrams, iframes).

Why this order:
- Prepared blocks are **cheaper to read** (no inline-style noise — `html-embed` style attrs are stripped by default for AI but the cost remains for human review/diff)
- Prepared blocks get **richer tooling** — `find_table_rows`, `get_table_rows`, chart re-themes, `@N` referencing all work out of the box
- Prepared blocks **render consistently** across light/dark themes; html-embed often needs theme-aware CSS to look right
- Inline `style="..."` in `html-embed` averages 60-70% of the block's bytes — picking the right semantic block avoids that cost entirely

Pick by intent:

| You want to show… | Use |
|---|---|
| Flow, sequence, ER, gantt, state, mindmap | ```mermaid |
| Numeric series / comparison / trend | ```chart (single) or ```chart-grid (multiple) |
| KPI numbers, dashboard headline figures | ```stats |
| Ordered procedure, how-to, deployment runbook | ```steps |
| Tabular data | **plain markdown table** (gets `@N`, `[ ]`/`[x]` in cells, `{bg=…}`/`{fg=…}` cell colours, `<br>` line breaks in cells, `find_table_rows` search, `get_table_rows` random access) |
| 4+ side-by-side screenshots as gallery | ```images |
| A password / token / key that belongs with the doc | ```secret via `seal_secret` — ciphertext in the page, never the value |
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
```file              — attachment card (name · size · type · description · View · Download). Get the fence from `add_file`
```secret            — encrypted credential (🔒 button; reader types the key, decrypts in the browser). Get the fence from `seal_secret`
```typescript / etc  — code blocks with Shiki highlight

## Secrets (encrypted credentials)

To keep a password, token or key file *with* the document without ever writing it in the clear:

1. Get the key. Pass the user's passphrase as `key`, or omit `key` to use the server's `WIKIKAI_SECRET_KEY` (the call errors when neither exists — **ask the user, never invent a key**).
2. `seal_secret({ text, label?, hint?, key? })` → `{ fence, label, key_source }`. `label` names what the secret is ("prod DB password"); `hint` reminds which key unlocks it. Both stay readable on the button, so never put the value in them.
3. Paste `fence` into the page like any block (add_page / add_lines / edit_section):

   ```markdown
   ```secret
   { "v": 1, "label": "prod DB password", "hint": "team vault", "iter": 600000, "salt": "…", "iv": "…", "ct": "…" }
   ```
   ```

   AES-256-GCM, key from PBKDF2-SHA256 (600k iterations, fresh salt + IV each call). The page holds ciphertext only — `read_page`, `search`, revisions and exports never see the value. The portal renders a small **🔒 label** button; a reader clicks it, types the key, and the text is decrypted in their browser (the key never reaches the server on that path). Wrong key → clear error, not garbage.
4. When the user asks for a stored credential, or a task needs one ("ssh to the box on this page"): `reveal_secret({ block_id })` using the `@N` on the block, or `reveal_secret({ page_id, label? | index? })`. Pass `key` (ask the user — the block's `hint` says which) or omit it to try the server key. Returns `{ text, label, hint, block_id, page_id, index, key_source, url }`; with several secrets and no selector the error lists the candidates. Project view permission applies and every reveal is written to the activity log (never the text).

Handle the revealed text like the credential it is: use it for the task, don't echo it back into the conversation or into another page unless the user asks.

## Files (attachments)

To attach a downloadable file (PDF, CSV, XLSX, ZIP, …) to a page:

1. Upload it — **never as base64** (the MCP tools no longer accept it):
   - **File on your machine (the usual case):** `get_upload_url({})`, then `curl -sS --data-binary @report-q3.pdf '<file_url>?name=report-q3.pdf&description=Final%2C%20signed'`. The bytes go from disk to the server without entering the conversation; curl prints the same JSON as `add_file`.
   - **File already on the server machine:** `add_file({ path })` (same `WIKIKAI_IMAGE_IMPORT_ROOTS` roots as images). Optional `mime_type`, `description`.
2. Paste the returned `fence` into the page as-is:

   ```markdown
   ```file
   { "src": "/file/<hash>.pdf", "name": "report-q3.pdf", "size_bytes": 1536000, "mime": "application/pdf", "description": "Final, signed" }
   ```
   ```

   Several files → a JSON array of those objects in one fence. Renders a card: name · size · type · description · **View** (in-app dialog: images / PDF / audio / video natively, any text file as plain text — sniffed by content, so `.http` / `.sql` / no extension work; binaries point to Download) · **Download**. The download is saved under `name` (the original filename); the server keeps the bytes under an opaque `/file/<sha256>.<ext>`.
3. Lifecycle is automatic and deferred: when no page references the `src` any more (after edit_page / edit_lines / edit_section / replace_text / delete_page / delete_knowledge, or a human Edit raw → Save), the file is marked as orphaned, and the bytes are deleted only after 7 days unreferenced with no page revision mentioning it. Images follow the same rule, so moving either between pages is safe. Don't try to "clean up" files yourself.

Max 50MB per file.

## Images

To attach an image to a knowledge page:

1. Upload it — **never as base64.** Writing a file out as base64 costs output tokens by the hundred thousand, so the MCP tools do not accept it. Two ways:
   - **File on your machine (the usual case):** call `get_upload_url({})` once per batch (the link takes any number of uploads for 15 minutes), then for each file:

     ```bash
     curl -sS --data-binary @login.png '<image_url>?alt=Login%20screen'
     ```

     The bytes go from disk to the server without entering the conversation. The type is detected from the bytes (PNG, JPEG, GIF, WebP, SVG; max 10MB).
   - **File already on the server machine:** `add_image({ path, alt? })` — `path` must be absolute and under a server-configured import root (`WIKIKAI_IMAGE_IMPORT_ROOTS`).

   Both return `{ src, markdown, hash, width, height, warnings, url, … }`. Content-addressed → identical bytes dedupe automatically, and re-uploading the same file brings back an image that went missing.
   - **Put `src` — or the ready `markdown` (`![alt](/img/<hash>.png)`) — into pages. Never `url`:** it carries this server's domain, and content must keep working if the domain changes. (Links to the server's own `/img/` and `/file/` are rewritten to paths on save anyway.)
   - **Read `warnings`.** For crisp figures, capture screenshots as **PNG at 2x** (e.g. Playwright `deviceScaleFactor: 2`): an image N px wide stays sharp on HiDPI screens only up to about N/2 px on screen, and JPEG smears text edges. A 1x capture of a 1440px window is fine up to `"720x"`.
2. Embed the returned `src` in markdown. **Default: plain markdown image** — covers virtually every case:

   ```markdown
   ![Pipeline overview](/img/abc.png "720x")
   ```

   - Title slot encodes max size: `"WxH"` / `"Wx"` / `"xH"` / `"tooltip w=300 h=200"` (leftover title text becomes the hover tooltip).
   - On a line of its own the image is centred and its **alt text is the visible caption** — write the alt as a short figure name.
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

**Token control — `get_image({ ..., mode })`:** pass `mode: "meta"` to get metadata only (mime, size, dimensions, alt) with **no inline bytes** — the cheapest way to decide *what* an image is before paying for base64. `mode: "full"` (or omitting `mode`) inlines the bytes (still capped by `max_bytes`, default ~6MB). The response carries a `mode` field reporting which applied. Reach for `meta` first when you only need to know an image exists / its size; use `full` when you actually need to see the picture.

**Reading size:** the inlined copy is scaled so its longest side is at most **1280px** (server default, as WebP) — screenshot text stays legible and image tokens drop (they grow with pixel count). The stored original is untouched. Pass `max_edge: N` for another size, or `original: true` when fine detail matters (tiny text, pixel-level checks). `served` in the result reports what was sent (`mime`, `width`, `height`, `resized`).

`read_page` automatically returns an `images_referenced` array covering **all** surfaces — every `{ src, url, alt?, caption?, block_id?, via }` where `via` is `"images"`, `"html-embed"`, or `"markdown"` (plain `![alt](/img/… "WxH/caption")`, title slot included). Use it to pick which image to `get_image` without re-parsing the page.

**Showing an image to a human / outside the portal — use `url`, not `src`.** `src` is a relative `/img/<hash>` path that only resolves inside the same-origin web portal; pasted into a chat or another app it renders broken. `images_referenced[].url` is the absolute, cross-machine URL (it works from any machine that can reach the server). To get the whole page body with every image reference already absolute, call `read_page({ ..., absolute_image_urls: true })` — note that rewrites `content`, so its `hash` is omitted (don't feed it back to `edit_lines`).

Tutorial doc lives at `/&4` — `get_outline({ knowledge_id: 4 })` + `read_page` to learn by example.

## Block ids (`@N`)

Every rendered rich fenced block gets a globally-unique id stamped into the source as ```` ```mermaid {@123} ```` and rendered as a tiny pill in the block's corner. The user can then refer to it by id: "อัพเดต @123" / "update @47".

When asked to **read** a block by `@N`:
- `get_block({ id: N })` — single call returns `{ kind, source, inner, line_start, line_end, page_id, version, page_title, knowledge_id, knowledge_title, project, url }`. The fence boundaries are already parsed for you; no need to FTS + read_page + locate ``` yourself.

When asked to **update** a block by `@N`:
1. `get_block({ id: N })` to see the current source + locate `line_start`/`line_end`.
2. `read_page({ page_id, line_start, line_end })` (full mode by default for a range) to get a fresh `hash`.
3. `edit_lines({ page_id, line_start, line_end, new_text, expected_hash })` — rewrites just that fence. Keep the existing `{@N}` annotation in `new_text` so the id is preserved.

(Direct FTS search `search({ query: "{@N}" })` still works — `get_block` is just the convenience wrapper.)

**Captions** — the annotation can carry a quoted caption: `{@123 "Architecture: API → DB"}` (renders like a `<figcaption>` under the block). Set / update / clear it with `set_block_caption({ id, caption })` — pass `null` or `""` to remove. Captions surface in `read_page` summary placeholders and `get_block({ summary: true })` probes, so a good caption makes future reads cheap.

**Caption a block as you create it** by writing `{@0 "caption"}` where the id goes — ```` ```mermaid {@0 "Login flow"} ```` or a `{@0 "…"}` line under a table. The server assigns the real id on save and keeps the caption. It also re-stamps an id another page already holds (e.g. a block copied from elsewhere), so never copy `{@N}` between pages expecting it to stay.

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
| "Give me row N" (you know the index) | `get_table_rows({ block_id: 123, start: N })` — `start` alone returns one row. 0-based; negative wraps from end (`-1` = last row). |
| "Give me rows N..M" / paginate a big table | `get_table_rows({ block_id, start, end?, offset?, limit? })` — contiguous range (`end` inclusive XOR `offset` count), 0-based, negative wraps from end. `limit` default 100 / max 500, `truncated: true` when capped. |
| "Find rows where col=value" / "rows mentioning X" / "first N rows" | `find_table_rows({ block_id, q?, where?, columns?, limit? })`. `q` = substring search (case-insensitive), `where` = exact column match (AND across keys), `columns` = restrict `q` to these column names, `limit` default 50 / max 500. Returns `{ matches: [{row_index, columns, source_line, url}], total_matched, truncated }`. |
| "Which rows have a checkbox? Toggle one of them" | `get_table_rows_with_checkbox({ block_id, checked? })`. Each match carries `checkboxes: [{ task_index, checked }]` — `task_index` is the **page-global** toggle index, pass it straight to `toggle_task({ page_id, index })`. It already accounts for any GFM tasks / html-embed checkboxes earlier on the page, so it is NOT the same as `row_index`. |
| "Show me the whole table" / "I'm about to edit it" | `get_block({ id: 123 })` (full source + inner). Use sparingly for tables > ~100 rows. |

**Editing table rows:** `update_table_rows` (replace a range; `new_rows: []` deletes it), `insert_table_rows` (insert before a 0-based `at`; `at = row_count` appends), `append_table_rows` (add at the end). All take a `new_rows: ["| a | b |", ...]` array, preserve the table's trailing `{@N}` id, and accept `expected_version`.

Token-cost rule of thumb: for a 100-row × 5-col table (cells averaging ~20 chars), `get_block` costs ~3 k tokens; `summary` ~0.1 k; `get_table_rows` for one row ~0.1 k; `find_table_rows` ~0.1 k per match. Probe with `summary` first when you don't know the size.

## URL conventions

- `/&3` — knowledge 3, first tab
- `/&3/#12` — knowledge 3, page 12
- `/&3/#12:42` — knowledge 3, page 12, scroll to line 42

`&` = knowledge marker, `#` = page marker. Both are clickable badges in the UI that copy to clipboard.

## What WikiKai is NOT

- Not a wiki for everyone — it's a personal/team knowledge store, not a public CMS.
- Not for transient context — use it when the user wants to come back to the content.
- Not a chat log — use `session_id` + `user_prompt` to link to the conversation, but the doc itself should be the *answer*, not the back-and-forth.
