-- ───── Projects: registry of project names ─────
-- Projects mainly exist as the loose `project` column on `knowledge`,
-- but we also accept registering an empty project (no knowledge yet)
-- so it shows up in the filter / move-to-project pickers immediately.
-- The list of "all known projects" is the UNION of this table + the
-- distinct non-null `project` values on `knowledge`.
CREATE TABLE IF NOT EXISTS projects (
  name        TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL
);

-- ───── Knowledge: container/document ─────
CREATE TABLE IF NOT EXISTS knowledge (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT    NOT NULL,
  project      TEXT,
  session_id   TEXT,                       -- Claude Code chat session UUID (claude --resume <id>)
  user_prompt  TEXT,                       -- user message/question that triggered this doc
  tokens_used  INTEGER,                    -- optional, tokens AI consumed producing this knowledge
  tags         TEXT,                       -- comma-separated
  author       TEXT,
  created_at   TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL,
  version      INTEGER NOT NULL DEFAULT 1  -- bumps when metadata changes
);

CREATE INDEX IF NOT EXISTS idx_k_project ON knowledge(project);
CREATE INDEX IF NOT EXISTS idx_k_session ON knowledge(session_id);
CREATE INDEX IF NOT EXISTS idx_k_updated ON knowledge(updated_at);

-- ───── Pages: chapters within a knowledge ─────
CREATE TABLE IF NOT EXISTS pages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  knowledge_id  INTEGER NOT NULL REFERENCES knowledge(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,          -- 1-based order within knowledge
  title         TEXT    NOT NULL,
  summary       TEXT,                       -- one-line tooltip
  keywords      TEXT,                       -- comma-separated, per-page search hints
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_pages_kid_pos ON pages(knowledge_id, position);

-- ───── Images: content-addressed binary store ─────
-- Files live on disk at data/images/<2-char-prefix>/<sha256>.<ext>.
-- Hash is the primary key so duplicate uploads dedupe naturally and
-- URLs are immutable (safe to cache forever).
CREATE TABLE IF NOT EXISTS images (
  hash         TEXT    PRIMARY KEY,
  ext          TEXT    NOT NULL,            -- "png" / "jpg" / "webp" / "gif" / "svg"
  mime         TEXT    NOT NULL,
  size_bytes   INTEGER NOT NULL,
  width        INTEGER,                     -- optional (not extracted in MVP)
  height       INTEGER,
  alt          TEXT,                        -- default alt text
  created_at   TEXT    NOT NULL
);

-- ───── Block ID sequence: global auto-increment for rich blocks ─────
-- Every fenced rich block (mermaid/chart/chart-grid/stats/steps/html-embed)
-- gets a globally-unique id annotated into the markdown source as
-- ```mermaid {@123}. IDs are never reused — adding/removing blocks does
-- not renumber existing ones. Used so the user can refer to a block by
-- id alone ("update @123") regardless of which page it lives in.
CREATE TABLE IF NOT EXISTS block_seq (
  id      INTEGER PRIMARY KEY CHECK (id = 0),
  next_id INTEGER NOT NULL
);
INSERT OR IGNORE INTO block_seq (id, next_id) VALUES (0, 1);

-- ───── Page revisions: snapshot per version bump ─────
-- Every time a page's `version` bumps (via update/append/edit_lines/
-- edit_section/replace_text), the post-change state is captured here.
-- v1 is recorded on initial add_page.
CREATE TABLE IF NOT EXISTS page_revisions (
  page_id      INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  version      INTEGER NOT NULL,
  title        TEXT    NOT NULL,
  content      TEXT    NOT NULL,
  summary      TEXT,
  keywords     TEXT,
  created_at   TEXT    NOT NULL,
  PRIMARY KEY (page_id, version)
);
CREATE INDEX IF NOT EXISTS idx_page_revisions_pid ON page_revisions(page_id, version DESC);

-- ───── Prompt log: rolling log of user messages that shaped a doc ─────
-- The `knowledge.user_prompt` column only stores the FIRST prompt (when
-- the doc was created). To keep an audit trail of every user message
-- that triggered an edit, MCP mutation tools (edit_page / add_page /
-- edit_lines / edit_section / replace_text / edit_knowledge / append_page)
-- accept an optional `user_prompt` parameter. When present, the server
-- truncates it to 500 chars and appends a row here so the InfoPopover
-- can show "why each revision happened".
-- page_id is nullable so knowledge-level prompts (metadata edits) can be
-- logged without a page anchor.
CREATE TABLE IF NOT EXISTS prompt_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  knowledge_id  INTEGER NOT NULL REFERENCES knowledge(id) ON DELETE CASCADE,
  page_id       INTEGER REFERENCES pages(id) ON DELETE SET NULL,
  page_version  INTEGER,                  -- page version *after* the change, when applicable
  tool_name     TEXT,                     -- which MCP tool wrote this row
  prompt        TEXT NOT NULL,            -- truncated to 500 chars on insert
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prompt_log_kid ON prompt_log(knowledge_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prompt_log_pid ON prompt_log(page_id, created_at DESC);

-- ───── Activity log ─────
-- Coarse audit trail of every mutating action (add / edit / delete /
-- toggle / caption / reorder / upload) across knowledge / page / block /
-- image / task targets. Snapshots the human-readable title / caption at
-- the time of the action so the log stays meaningful even after the
-- target is renamed or deleted. Source = 'mcp' (with tool_name set) or
-- 'web' (UI click). Content bodies are NEVER captured — just enough to
-- answer "what changed, where, when, by whom (tool)".
CREATE TABLE IF NOT EXISTS activity_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at      TEXT NOT NULL,
  source          TEXT NOT NULL CHECK (source IN ('mcp', 'web')),
  tool_name       TEXT,                          -- MCP tool name; null for plain web mutations
  action          TEXT NOT NULL,                 -- 'add' | 'edit' | 'delete' | 'reorder' | 'toggle' | 'caption' | 'upload' | 'resize'
  target          TEXT NOT NULL,                 -- 'knowledge' | 'page' | 'block' | 'image' | 'task'
  knowledge_id    INTEGER,                       -- nullable for image uploads
  knowledge_title TEXT,
  page_id         INTEGER,
  page_title      TEXT,
  block_id        INTEGER,
  block_caption   TEXT
);
CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_kid ON activity_log(knowledge_id, created_at DESC);

-- ───── Users + sessions (Tier 1 login) ─────
-- Single-tenant: every logged-in user sees the same content. The auth
-- layer just blocks anonymous access and tags every mutation with the
-- acting user. MCP-source rows get `user_id` from a configured default
-- (`WIKIKAI_MCP_DEFAULT_USER`) since MCP clients authenticate by token,
-- not by user session.
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,           -- scrypt$<salt>$<hash>
  display_name  TEXT NOT NULL,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,          -- opaque base64url(32 bytes)
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);

-- NOTE: `activity_log.user_id` is added by the in-place migration in
-- `src/store/db.ts` (SQLite < 3.35 has no ADD COLUMN IF NOT EXISTS,
-- and adding it here would crash on every restart after the first).

-- ───── FTS5: search across page content + title + keywords ─────
-- Uses the `trigram` tokenizer (SQLite ≥ 3.34) so substring search works
-- for Thai, Chinese, Japanese, and any script without whitespace word
-- boundaries — `unicode61` would index whole sentences as single tokens.
-- Minimum match length is 3 codepoints (a trigram).
CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
  content,
  title,
  keywords,
  tokenize='trigram'
);

-- ───── Project permissions: per-(user, project) view/edit grants ─────
-- Missing row = no access (deny by default). Admins bypass this table
-- entirely via the `users.is_admin` flag — they don't need rows.
CREATE TABLE IF NOT EXISTS project_permissions (
  user_id      INTEGER NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
  project_name TEXT    NOT NULL REFERENCES projects(name) ON DELETE CASCADE
                                                           ON UPDATE CASCADE,
  level        TEXT    NOT NULL CHECK (level IN ('view','edit')),
  granted_at   TEXT    NOT NULL,
  granted_by   INTEGER          REFERENCES users(id)      ON DELETE SET NULL,
  PRIMARY KEY (user_id, project_name)
);
CREATE INDEX IF NOT EXISTS idx_pp_user ON project_permissions(user_id);
