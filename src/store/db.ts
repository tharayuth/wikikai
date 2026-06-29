import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(here, "schema.sql");

export type Db = Database.Database;

export function openDb(dbPath: string): Db {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const schema = fs.readFileSync(schemaPath, "utf8");
  db.exec(schema);
  // ─── Lightweight in-place migrations ───
  // SQLite < 3.35 has no `ADD COLUMN IF NOT EXISTS`; use PRAGMA to check first.
  if (!hasColumn(db, "knowledge", "tokens_used")) {
    db.exec(`ALTER TABLE knowledge ADD COLUMN tokens_used INTEGER`);
  }
  if (!hasColumn(db, "activity_log", "user_id")) {
    db.exec(
      `ALTER TABLE activity_log ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`,
    );
  }
  if (!hasColumn(db, "users", "mcp_token")) {
    // Per-user MCP API token. Nullable for legacy rows; populated on
    // create + regenerate. UNIQUE so a stale token can't accidentally
    // shadow another user. NULL means "no token issued yet" — the
    // server falls back to the legacy WIKIKAI_TOKEN env var for those.
    db.exec(`ALTER TABLE users ADD COLUMN mcp_token TEXT`);
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_mcp_token ON users(mcp_token) WHERE mcp_token IS NOT NULL`,
    );
  }
  if (!hasColumn(db, "projects", "id")) {
    migrateProjectsAddId(db);
  }
  if (!hasColumn(db, "pages", "archived_at")) {
    // Soft-archive flag for pages. NULL = active; ISO timestamp = archived.
    // Archived pages are hidden from the sidebar + search by default but
    // never deleted.
    db.exec(`ALTER TABLE pages ADD COLUMN archived_at TEXT`);
  }
  if (!hasColumn(db, "knowledge", "share_token")) {
    // Public read-only share link. NULL = not shared; non-null = capability
    // token in the /share/<token> URL.
    db.exec(`ALTER TABLE knowledge ADD COLUMN share_token TEXT`);
  }
  // Unique index lives here (not in schema.sql) so it runs AFTER the column
  // exists on BOTH fresh DBs (column from CREATE TABLE) and legacy DBs (column
  // from the ALTER above). NULLs are distinct in SQLite, so un-shared rows
  // coexist; UNIQUE only guards against token collisions.
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_k_share ON knowledge(share_token)`,
  );
  return db;
}

/**
 * Give `projects` a stable auto-increment `id`.
 *
 * The legacy table had `name TEXT PRIMARY KEY` and no id. SQLite can't
 * `ALTER TABLE ADD COLUMN` an `INTEGER PRIMARY KEY AUTOINCREMENT`, so we
 * rebuild the table. `name` stays UNIQUE, so the `project_permissions`
 * FK (which references `projects(name)`) survives untouched — we still
 * disable FK enforcement during the swap and verify afterwards.
 *
 * Before rebuilding we backfill the registry from every distinct
 * `knowledge.project`, so projects that only existed implicitly (via a
 * knowledge row) also get an id and become filterable by `?projects=`.
 */
function migrateProjectsAddId(db: Database.Database): void {
  const fkWasOn = (db.pragma("foreign_keys", { simple: true }) as number) === 1;
  if (fkWasOn) db.pragma("foreign_keys = OFF");
  try {
    db.exec("BEGIN");
    // 1) Backfill: every project name referenced by knowledge gets a row.
    db.exec(`
      INSERT OR IGNORE INTO projects (name, created_at)
      SELECT DISTINCT project, COALESCE(MIN(created_at), datetime('now'))
      FROM knowledge
      WHERE project IS NOT NULL AND project <> ''
      GROUP BY project
    `);
    // 2) Rebuild with an auto-increment id, preserving creation order so
    //    ids read chronologically.
    db.exec(`
      CREATE TABLE projects_new (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL UNIQUE,
        created_at  TEXT NOT NULL
      )
    `);
    db.exec(`
      INSERT INTO projects_new (name, created_at)
      SELECT name, created_at FROM projects ORDER BY created_at, name
    `);
    db.exec("DROP TABLE projects");
    db.exec("ALTER TABLE projects_new RENAME TO projects");
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    if (fkWasOn) db.pragma("foreign_keys = ON");
    throw e;
  }
  if (fkWasOn) db.pragma("foreign_keys = ON");
  // FK integrity must still hold: every project_permissions.project_name
  // should match a surviving projects.name.
  const violations = db.pragma("foreign_key_check") as unknown[];
  if (violations.length > 0) {
    throw new Error(
      `projects id migration broke foreign keys: ${JSON.stringify(violations)}`,
    );
  }
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.some((r) => r.name === column);
}
