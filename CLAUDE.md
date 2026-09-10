# CLAUDE.md — WikiKai project context

This file is loaded by Claude Code when working in this repository. It is the orientation an experienced contributor would give a new collaborator before they touch any code.

## What this project is

WikiKai is a self-hosted **MCP server + web portal** for storing presentation-style knowledge documents. An MCP client (Claude Code, Claude Desktop, etc.) calls tools over HTTP to create knowledge documents made of multiple markdown pages with rich fences (Mermaid, Chart.js, stat cards, step cards). Humans browse the documents via the web portal at the same origin.

Read `README.md` for the user-facing overview. Read `DEPLOY.md` for production / multi-machine concerns.

## This repo is public — assume every commit is read by strangers

`github.com/tharayuth/wikikai` is an **open-source public repository**. Anything
committed is world-readable the moment it is pushed, and stays readable in the
history even after a later commit removes it. Treat that as a property of every
change, not as a step at the end.

**Before writing anything into a tracked file, ask whether it belongs in the
open.** These do not:

- Hostnames, IP addresses (including VPN ranges), ssh users and ssh targets
- Absolute paths on real machines — repo, data, and config paths on the dev box
  or the production VPS
- pm2 process names, nginx site-config paths, and anything else that describes
  the production layout
- Real tokens, passwords, keys, or anything hinting where they are kept
- Content pulled from the live corpus — internal or customer system names,
  document ids that only resolve against a private database

Machine-specific context goes in `CLAUDE.local.md`, which is gitignored. Ops
scripts that hardcode hosts (`sync-from-prod.sh`, `backup-prod.sh`) are
gitignored too — being merely *untracked* is not protection, because one
`git add -A` publishes them.

What **should** stay in this file: conventions, architecture, the URL contract,
and the constraints that shape a change (loopback-only bind, `DATA_DIR` outside
the repo, nginx needing its own block for streaming endpoints). A contributor
needs to know a rule exists; they do not need the coordinates it applies to.

Before a commit that touches docs, config, fixtures, or scripts:

```bash
git grep --cached -nIE '10\.[0-9]+\.[0-9]+\.[0-9]+|root@|/root/|/mnt/data|ssh |cupcode\.cc'
```

A hit is not automatically a leak — a tokenizer test may need a real string, and
`127.0.0.1` in a deployment example is fine — but every hit needs a reason.

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
  mcp/server.ts        registers 38 tools on McpServer
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

When editing the UI, **open the Vite port (`:5173`)** for HMR. The server port
(`:3939`) serves the most recent `client/dist/` build — stale unless you re-run
`npm run build:client`. On a remote dev box, reach both over the VPN rather than
exposing them.

## Where this runs — a dev box and a production VPS

There are exactly two live copies and they have different jobs: a **development**
host where all code is written, and a **production** VPS that serves
the public site under nginx. Concrete hostnames, addresses, paths and ssh
targets live in `CLAUDE.local.md`, which is untracked — this repo is public.

### The loop

**All code is written on the dev box.** Nothing is edited directly on
production — it only ever receives what came through `git`.

```bash
# 1. work on the dev box, then let the gates pass
npm run typecheck && npm test

# 2. see it: Vite HMR, or build and restart the dev pm2 process
npm run dev
#   …or…
npm run build && pm2 restart <dev-process>

# 3. commit + push (Conventional Commits — see "Commit style")
git add -A && git commit -m "feat: …" && git push

# 4. deploy: on the production host, pull + build + restart pm2
#    git pull && npm ci && npm run build && pm2 restart <prod-process>

# 5. verify production actually came back (expect 200)
curl -s -o /dev/null -w '%{http_code}\n' https://<site>/login
```

`npm ci` on step 4 is only needed when `package-lock.json` moved; a docs- or
source-only change can skip straight to `npm run build`. `better-sqlite3`
resolves a prebuilt binary for node v22 on both hosts, so no compiler runs.

A change is **not** deployed because it was pushed. GitHub is a waypoint, not
the server — production stays on the old build until the deploy step runs.

### Data flows one way: prod → dev

A sync script pulls production data down to dev. It takes a `sqlite3 .backup`
snapshot (consistent — production keeps serving throughout), then pulls
`items/`, `images/` and `files/`. It stops the dev process first, because
overwriting a SQLite file while a process holds it open corrupts it.

The ops scripts (`sync-from-prod.sh`, `backup-prod.sh`) are **gitignored**: they
hardcode one pair of hosts and have no meaning in a fresh clone. The constraints
they encode are the two bullets below, and those are the part worth keeping.

- **Nothing syncs back into production.** Knowledge authored on dev is *lost*
  on the next sync. Dev is a scratch copy to break; real content is written
  through production.
- **The integrity check must run through the app's SQLite**, never the system
  `sqlite3` CLI. An older CLI (3.45.1) cannot validate an FTS5 `trigram` index
  written by better-sqlite3's 3.49.2 and reports `malformed inverted index for
  FTS5 table main.pages_fts` on a perfectly healthy database. Checking with the
  wrong version teaches you to wave off the alarm — which is precisely how a
  real corruption would slip past.

### Production facts that constrain a change

- **The server binds loopback only** in production and nothing else. That host
  has a public IP; binding `0.0.0.0` would publish WikiKai straight to the
  internet, bypassing Cloudflare, TLS termination and nginx's real-IP handling.
  nginx runs on the same box, so loopback is all it needs.
- **`DATA_DIR` points outside the repo** on both hosts, so a code
  `rsync --delete` can never wipe the data.
- **nginx has three `proxy_pass` blocks** — `/api/events` (SSE), `/mcp` and
  `/`. A new endpoint that needs streaming or a long timeout needs its own
  block; the default one buffers.
- Full runbook, including emergency rollback, lives on the production host as
  `PRODUCTION.md` (path in `CLAUDE.local.md`).

## Native-module gotchas

- `better-sqlite3` and `@rollup/rollup-darwin-arm64` are compiled native modules. After switching Node versions (or moving the repo across machines / renaming the directory), you may see `NODE_MODULE_VERSION` mismatch or `code signature ... different Team IDs` errors.
- Fix with `npm rebuild better-sqlite3` (ABI) or `rm -rf node_modules && npm install` (signature).
- The bullets above are mostly a **macOS** concern and date from when a Mac was the dev
  box. On the current Linux hosts (system node v22) `better-sqlite3` resolves a prebuilt
  binary and none of this comes up.
- On macOS specifically: the hardened-runtime `node` bundled with some IDEs (e.g.
  `/Applications/Codex.app/Contents/Resources/node`) rejects adhoc-signed `.node` files.
  Prefer **nvm** or **Homebrew** Node there:
  `PATH=$HOME/.nvm/versions/node/v25.6.1/bin:$PATH npm run dev`.

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

Plus the global skill file `~/.claude/skills/wikikai/SKILL.md` — that
one lives outside this repo but should stay in sync with `docs/skill/SKILL.md`.
A pre-push hook (`scripts/git-hooks/pre-push`) blocks the push when the
two diverge. Enable it once per clone:

```bash
git config core.hooksPath scripts/git-hooks
```

When it fires, sync with `cp ~/.claude/skills/wikikai/SKILL.md docs/skill/SKILL.md`
and recommit. Bypass with `--no-verify` only if the global file is
intentionally ahead (e.g. you're prototyping skill content locally).

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

### Pull before you start, push when the topic closes

Production and the dev box both track `main`, and work can land from more than
one place. **Start every task by syncing**, so a change is written on top of
what is actually published:

```bash
git fetch origin && git status -sb     # behind? ahead? untracked strays?
git pull --ff-only                     # refuse a surprise merge; investigate instead
```

If `--ff-only` refuses, stop and look rather than forcing it — a divergence
means something landed that this tree does not know about.

Push as soon as a topic is committed, not in a batch at the end of the day. A
commit that sits only on the dev box is invisible to production, to the next
session, and to anyone else reading the repo. GitHub is a waypoint, not the
server: **pushing is not deploying** — production stays on its old build until
the deploy step in `CLAUDE.local.md` runs.

### Cut a release when the work warrants one

Tags are what the GitHub Releases page reads. A `main` full of unreleased
commits looks abandoned from the outside, however active it really is — the
repo once showed four months of silence while 51 commits sat untagged, because
the version was bumped and the tag was forgotten.

Release when a user-visible capability lands — a new MCP tool, a content fence,
a portal feature — or when a batch of fixes is worth naming. Not for a docs-only
or refactor-only commit.

```bash
npm run typecheck && npm test                    # gates first, always
npm version <x.y.z> --no-git-tag-version         # package.json AND the lockfile
git add package.json package-lock.json
git commit -m "chore(release): v<x.y.z>"
git tag -a v<x.y.z> -m "v<x.y.z> — <what changed, in a phrase>"
git push origin main && git push origin v<x.y.z>
```

Then create the GitHub Release for that tag — a tag alone does not make one.

Rules worth keeping:

- **Bump `package.json` and `package-lock.json` in the same commit.** Use
  `npm version --no-git-tag-version`; editing `package.json` by hand leaves the
  lockfile behind and costs a follow-up commit.
- **Tag the release commit itself**, and push the tag in the same breath as the
  branch. An untagged `chore(release)` commit is the failure described above.
- **Every commit should fall inside some tagged range.** To check:
  `git rev-list --count <latest-tag>..HEAD` — a large number means releases are
  overdue.
- **Never move or delete a pushed tag.** If a release was tagged in the wrong
  place, tag the correct commit retroactively and move on.
