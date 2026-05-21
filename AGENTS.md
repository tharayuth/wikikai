# AGENTS.md — WikiKai project context

This file is loaded by Codex when working in this repository. It is the orientation an experienced contributor would give a new collaborator before they touch any code.

## What this project is

WikiKai is a self-hosted **MCP server + web portal** for storing presentation-style knowledge documents. An MCP client (Codex, Codex Desktop, etc.) calls tools over HTTP to create knowledge documents made of multiple markdown pages with rich fences (Mermaid, Chart.js, stat cards, step cards). Humans browse the documents via the web portal at the same origin.

Read `README.md` for the user-facing overview. Read `DEPLOY.md` for production / multi-machine concerns.

## Stack

- **Server**: Node (≥ 20.12), TypeScript, Express, `better-sqlite3` with SQLite FTS5, `@modelcontextprotocol/sdk` Streamable HTTP, Zod, markdown-it, Shiki
- **Client**: React 18 + Redux Toolkit, Vite, Mermaid 11, Chart.js 4
- **Tests**: Vitest + Supertest
- **Build**: `tsc` for server, `vite build` for client; concurrently for dev

## Repo layout (load-bearing files)

```
src/
  index.ts             entry — calls process.loadEnvFile then startServer
  server.ts            wires Config → Stores → MCP → Express app
  lib/config.ts        env → typed Config (incl. mcpToken)
  store/db.ts          better-sqlite3 connection + schema.sql apply
  store/knowledge.ts   knowledge metadata CRUD
  store/pages.ts       page CRUD + line-range ops + FTS sync
  store/schema.sql     SQLite schema (knowledge, pages, pages_fts)
  mcp/server.ts        registers 18 tools on McpServer
  mcp/handlers.ts      Zod schemas + tool impls — single source of truth for tool shapes
  mcp/examples.ts      get_example helper (outline + slice)
  mcp/examples/*.md    markdown reference content
  web/app.ts           Express routes — /api, /mcp (auth-gated), /mermaid, /chart, static
  web/mcpRoute.ts      MCP transport handler + session map
  web/mermaidViewer.ts standalone fullscreen Mermaid HTML (pan/zoom/export PNG)
  web/chartViewer.ts   standalone fullscreen Chart.js HTML (export PNG)
  render/markdown.ts   markdown-it + custom fences (mermaid/chart/chart-grid/stats/steps)

client/src/
  App.tsx              shell
  components/          Topbar, Sidebar, Viewer, TabStrip, PageContent, EditModal, HelpModal, InfoPopover, KnowledgeInfo, SearchResults, Toast
  hooks/useHash.ts     URL parser (& for kid, # for pid, :line)
  hooks/useMermaidCharts.ts  post-render hook — Mermaid + Chart.js + click-to-open-viewer
  store/api.ts         RTK Query client for /api
  store/uiSlice.ts     theme + help modal state (localStorage-backed)
  styles/theme.css     all styling (CSS variables, light/dark via [data-theme])

test/                  config / knowledge / pages / markdown / web / tools
```

## Conventions

- **Types/Schemas live in `mcp/handlers.ts`.** Zod schemas (`AddKnowledgeSchema`, etc.) are the source of truth; client types in `client/src/store/api.ts` mirror the response shapes.
- **URLs use `&` for knowledge id and `#` for page id.** Don't conflate them — `&3` is a document, `#12` is a tab inside it. URL example: `/&3/#12:42` (path `&3` → fragment `#12:42`).
- **Edits should prefer `edit_section` over `edit_lines`.** Heading-anchored edits survive other edits; line numbers shift.
- **`read_page` returns a `hash` of the read range.** Callers should pass it to `edit_lines` as `expected_hash` to detect stale state.
- **All metadata is in SQLite; raw markdown lives in `data/items/<kid>/<pid>.md`.** The two are kept consistent by `PageStore`.
- **FTS5 (`pages_fts`) is updated synchronously alongside `pages`.** When changing page CRUD, update both.
- **The `pages_fts` rowid is `pages.id`.** Don't rely on auto-rowid.
- **Strict TypeScript everywhere.** `npm run typecheck` must pass for both server and client. No `any` in new code; narrow `unknown` properly.
- **Markdown rendering happens server-side except for Mermaid + Chart.js**, which run in the browser. Adding a new fence type means: render to a `<div>` with a class in `render/markdown.ts`, then maybe wire JS in `client/src/hooks/useMermaidCharts.ts`.
- **CSS uses theme tokens.** Never hardcode colors in new code — use `var(--text)`, `var(--surface)`, `var(--accent)`, etc. Both `:root` and `[data-theme="dark"]` define the full token set.
- **MCP tool descriptions are English-only.** Every `description`, `title`, and `.describe(...)` on Zod schemas in `mcp/server.ts` + `mcp/handlers.ts` must be written in English so the MCP catalog stays consistent for any client/agent locale. Use English examples too (e.g. "update @47", not "อัพเดต @47"). User-facing UI strings in `client/src/components/` can stay Thai where the rest of the surface already is.

## Running locally

```bash
# First time
npm install

# Dev (server watch + Vite HMR client)
npm run dev
# → server on :3939, Vite on :5173 (proxies /api + /mcp to :3939)

# Production build
npm run build      # → dist/ (server JS) + client/dist/ (static SPA)
npm start          # tsx src/index.ts — no watch

# Quality gates
npm run typecheck  # tsc -p . && tsc -p client/tsconfig.json (no-emit)
npm test           # vitest
```

When editing the UI, **open `:5173`** for HMR. `:3939` serves the most recent `client/dist/` build — stale unless you re-run `npm run build:client`.

## Native-module gotchas

- `better-sqlite3` and `@rollup/rollup-darwin-arm64` are compiled native modules. After switching Node versions (or moving the repo across machines / renaming the directory), you may see `NODE_MODULE_VERSION` mismatch or `code signature ... different Team IDs` errors.
- Fix with `npm rebuild better-sqlite3` (ABI) or `rm -rf node_modules && npm install` (signature).
- The hardened-runtime `node` binary bundled with some IDEs (e.g. `/Applications/Codex.app/Contents/Resources/node`) rejects adhoc-signed `.node` files. Prefer **nvm** or **Homebrew** Node for dev: `PATH=$HOME/.nvm/versions/node/v25.6.1/bin:$PATH npm run dev`.

## Auth model

- `/mcp` is gated by `WIKIKAI_TOKEN` (Bearer header) when the env var is set.
- `/api/*`, `/`, `/mermaid/...`, `/chart/...` are **not** gated — they need to be reachable from a browser. Protect them at the network layer (reverse proxy / VPN) for public deployments.
- Local dev with no token: leave `WIKIKAI_TOKEN` unset; the server logs `[auth: OFF]`.

## Where to add things

| Adding… | Touch… |
|---|---|
| A new MCP tool | `mcp/handlers.ts` (Zod schema + impl) → `mcp/server.ts` (registerTool) → `test/tools.test.ts` |
| A new content fence | `render/markdown.ts` (fence handler) → `client/src/hooks/useMermaidCharts.ts` (if it needs JS) → `client/src/styles/theme.css` |
| A new REST endpoint | `web/app.ts` (before the SPA catch-all) → `client/src/store/api.ts` |
| A new UI feature | `client/src/components/...` + slice action in `store/uiSlice.ts` if it has state |
| A migration | append-only edits to `store/schema.sql` (CREATE TABLE IF NOT EXISTS); existing DBs apply diffs on open |

## Documenting a new feature

Whenever a user-visible capability is added (a new MCP tool, a new
content fence, a new UI affordance, a new block-type, …), **update all
three documentation surfaces in the same change set**:

1. **In-app dialog** — `client/src/components/HelpModal.tsx` (EN tab
   *and* TH tab — keep them in lockstep). This is what humans see by
   clicking `?` in the topbar.
2. **Bundled tutorial knowledge `&4`** — the `📘 คู่มือใช้งาน WikiKai
   — Tutorial` document. Use a one-shot script under `scripts/` to
   edit pages through `PageStore` so version bump + revision snapshot
   + FTS reindex all run. Touch:
   - `#19` (overview) — bump the stats card counts (tabs / fence types
     / tool count) and the steps list of tabs.
   - The dedicated tab for the feature (add a new tab via
     `pages.add({ position })` if there isn't one yet), or extend
     `#26` (MCP workflow doc) for tool-only additions.
3. **Example showcase knowledge `&3`** — the `🇹🇭 สถิติประเทศไทย`
   doc. Pick or add a section that uses the feature in a Thailand-
   themed context. Same scripted edit approach.

Plus the global skill file `~/.Codex/skills/wikikai/SKILL.md` — that
one lives outside this repo but should stay in sync with the same
information surface.

A change that *only* updates one of these (e.g. ships a new tool
without updating HelpModal) is incomplete; the agent / human reading
the dialog will assume the feature doesn't exist.

## What NOT to do

- Don't introduce new packages without a clear need — the dep list is intentionally short.
- Don't add ORM layers; `better-sqlite3` prepared statements are deliberate.
- Don't store extra metadata in markdown frontmatter — metadata belongs in the `pages` / `knowledge` tables.
- Don't render Mermaid or Chart.js server-side. They are client-only by design (server stays light).
- Don't break the URL contract (`/&N/#M:L`) — it's how external links from MCP `url` fields work.
- Don't ship secrets. `.env` is gitignored. If you need a new env var, document it in `README.md` + `.env.example`.

## Testing notes

- Tests use an in-memory or tmpdir-backed `KnowledgeStore` / `PageStore`. See `test/knowledge.test.ts` for patterns.
- `test/web.test.ts` boots the Express app with Supertest — no real network.
- After changing schemas in `mcp/handlers.ts`, update `test/tools.test.ts`.

## Web portal at a glance

- Sidebar (left): knowledges grouped by project, sorted by `updated_at`.
- Topbar: brand + `&N` badge + title (`KnowledgeInfo`). Clicking the **i** button opens `InfoPopover` with full metadata + active page summary.
- Viewer (right): `TabStrip` of pages on top, `PageContent` below. `page-id-header` shows `#N` badge + line count + Edit raw + Delete page buttons.
- Mermaid diagrams render in place; click to open `/mermaid/:pid/:idx` in a new tab with pan/zoom/export.
- Charts similarly open `/chart/:pid/:idx`.
- FTS search: type ≥ 2 chars in the topbar input → results dropdown.

## Commit style

Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `perf:`, `ci:`). Keep the subject under 70 chars; body explains *why*. One logical change per commit.

### Commit-first rule on topic change

The goal is simple: **one commit, one topic.** Commits must not mix
unrelated features.

When the user's next request is on a different topic than the work
currently in your working tree, **commit the current work first** as it
stands, then start the new topic with a clean tree. Don't try to "come
back" to the old topic after — the previous commit is the end of it.

Trigger checklist before starting a new edit:

- Is there uncommitted work in the tree?
- Is the new edit on the same topic as that work?
- If **no** to the second question → commit the current work first.

Exception: if the new edit is **required** for the current uncommitted
work to function (e.g. a bug in a helper being called, a missing type),
it belongs in the same commit — that isn't a topic change, it's part of
the same change.
