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
  return db;
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.some((r) => r.name === column);
}
