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
- `edit_knowledge({ id, ...metadata })` — update metadata only (no content).
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

### Fine-grained edits
- `read_page({ page_id, line_start?, line_end? })` — content + `total_lines` + `hash` + parent knowledge structure.
- `edit_lines({ page_id, line_start, line_end, new_text, expected_hash?, user_prompt? })` — line range replace. Pass `expected_hash` from a recent `read_page` to gate stale edits.
- `edit_section({ page_id, heading, new_content, user_prompt? })` — **PREFER THIS** over line edits — heading-anchored replace, stable across other edits.
- `replace_text({ knowledge_id, page_id?, find, replace, count?, user_prompt? })`

### Search + helper
- `search({ query, project?, knowledge_id?, limit? })` — SQLite FTS5 across content/title/keywords. Returns hits with `url`.
- `get_example({ kind?, outline_only?, line_start?, line_end? })` — markdown reference. **Use `outline_only: true` first** (10× cheaper). `kind` = `full` / `minimal` / `mermaid` / `chart` / `stats` / `steps` / `er` / `html`.
- `get_prompt_log({ knowledge_id, limit?, offset? })` — read the rolling audit trail of `user_prompt` values per knowledge. Each entry: `{ page_id?, page_version?, tool_name, prompt, created_at }`. Use to answer "why did revision N happen?"
- `toggle_task({ page_id, index })` — flip the Nth GFM `- [ ]` / `- [x]` task or `<input type="checkbox">` inside `html-embed` on a page (0-based, document order, skipping code fences). Same path the web checkbox uses.

### Interactive checkboxes (GFM, not a fence)
- Write plain GFM task items anywhere a normal markdown list works: `- [ ] task` / `- [x] done`. They render as clickable checkboxes; clicking flips the source (version bump + revision + FTS reindex).
- For checkboxes **inside a table** or any custom layout, drop raw `<input type="checkbox">` (with or without `checked`) into an `html-embed` block — the renderer rewrites them so they're live and share the same toggle index.
- AI can drive the same toggle without the UI via `toggle_task({ page_id, index })`.
- **Do not** use a `checklist` fence — that block was retired; if you see one in an old page, replace it with GFM tasks on save.

### Prompt log (opt-in)
Every mutation tool accepts an optional `user_prompt` field. When supplied, the server truncates it to 500 chars and appends a row to `prompt_log` linked to the resulting page + version. **Opt-in by design** — send only when the user's message carries intent (a request, a correction). Skip for trivial retries or follow-ups. The info popover in the web UI shows the log as a timeline; `get_prompt_log` is the read-side.

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
     title, project, session_id, user_prompt, tokens_used,
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

## Content fences (use them — they render rich)

```mermaid           — flowchart/sequence/ER/gantt/state
```chart             — single Chart.js (JSON config)
```chart-grid        — array of charts side-by-side
```stats             — array of { num, label, color? } (purple/blue/green/amber/red/cyan)
```steps             — array of { title, body? } — auto-numbered cards, body is markdown
```html-embed        — raw HTML for flexible content (richer tables with row colors / col-span / sticky headers, custom card/grid layouts, inline SVG, iframes, <details>). <script> tags are inert by design
```images            — single image or gallery — array of { src, alt?, caption? }. UI renders as a thumbnail grid; click opens a lightbox
```typescript / etc  — code blocks with Shiki highlight

## Images

To attach an image to a knowledge page:

1. `add_image({ data_base64, mime_type, alt? })` — uploads bytes. Returns `{ src: "/img/<hash>.<ext>", hash, size_bytes, … }`. Content-addressed → identical bytes dedupe automatically.
2. Embed the returned `src` in markdown in one of two ways:

   **A. Plain gallery — `images` fence** (recommended when the image stands on its own):
   ```images
   [
     { "src": "/img/abc.png", "alt": "Pipeline overview", "caption": "Phase 1" },
     { "src": "/img/def.jpg", "alt": "Result chart" }
   ]
   ```
   One image is fine — the fence accepts a single object or a 1-element array. UI renders a thumbnail grid; click → lightbox.

   **B. Image inside custom HTML — `html-embed` + `<img>`** (when you need the image as part of a flex/grid layout, beside text, in a `<details>`, with bespoke width/border):
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

`read_page` automatically returns an `images_referenced` array covering **both** sources — every `{ src, alt?, caption?, block_id?, via }` where `via` is `"images"` or `"html-embed"`. Use it to pick which image to `get_image` without re-parsing the page yourself.

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

**Markdown tables do not get an `@N` id** — they're plain text, not fenced. If the user wants to refer to a table by `@N`, the table must be authored as a `<table>` inside an `html-embed` fence (which is a rich block and does get an id).

## URL conventions

- `/&3` — knowledge 3, first tab
- `/&3/#12` — knowledge 3, page 12
- `/&3/#12:42` — knowledge 3, page 12, scroll to line 42

`&` = knowledge marker, `#` = page marker. Both are clickable badges in the UI that copy to clipboard.

## What WikiKai is NOT

- Not a wiki for everyone — it's a personal/team knowledge store, not a public CMS.
- Not for transient context — use it when the user wants to come back to the content.
- Not a chat log — use `session_id` + `user_prompt` to link to the conversation, but the doc itself should be the *answer*, not the back-and-forth.
