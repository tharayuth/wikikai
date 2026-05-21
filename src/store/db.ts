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
  return db;
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.some((r) => r.name === column);
}
