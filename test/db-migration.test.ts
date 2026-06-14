import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../src/store/db.js";

/**
 * The projects table originally used `name TEXT PRIMARY KEY` with no id.
 * openDb() must migrate it in place to an auto-increment `id` without
 * losing rows or breaking the project_permissions foreign key.
 */
describe("projects id migration (legacy -> auto-increment)", () => {
  const tmpFiles: string[] = [];

  afterEach(() => {
    for (const f of tmpFiles.splice(0)) {
      for (const suffix of ["", "-wal", "-shm"]) {
        try {
          fs.rmSync(f + suffix);
        } catch {
          /* ignore */
        }
      }
    }
  });

  function makeLegacyDb(): string {
    const file = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "wikikai-mig-")),
      "legacy.db",
    );
    tmpFiles.push(file);
    const raw = new Database(file);
    raw.pragma("journal_mode = WAL");
    raw.pragma("foreign_keys = ON");
    raw.exec(`
      CREATE TABLE projects (name TEXT PRIMARY KEY, created_at TEXT NOT NULL);
      CREATE TABLE knowledge (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        project TEXT,
        session_id TEXT,
        user_prompt TEXT,
        tokens_used INTEGER,
        tags TEXT,
        author TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT);
      CREATE TABLE project_permissions (
        user_id      INTEGER NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
        project_name TEXT    NOT NULL REFERENCES projects(name) ON DELETE CASCADE
                                                                ON UPDATE CASCADE,
        level        TEXT    NOT NULL,
        granted_at   TEXT    NOT NULL,
        PRIMARY KEY (user_id, project_name)
      );
    `);
    raw.prepare("INSERT INTO projects (name, created_at) VALUES (?, ?)").run(
      "alpha",
      "2024-01-01T00:00:00.000Z",
    );
    raw.prepare("INSERT INTO projects (name, created_at) VALUES (?, ?)").run(
      "beta",
      "2024-01-02T00:00:00.000Z",
    );
    // "gamma" exists only via a knowledge row — must be backfilled + get an id.
    raw
      .prepare(
        "INSERT INTO knowledge (title, project, created_at, updated_at) VALUES (?, ?, ?, ?)",
      )
      .run("k1", "gamma", "2024-01-03T00:00:00.000Z", "2024-01-03T00:00:00.000Z");
    raw.prepare("INSERT INTO users (email) VALUES (?)").run("u@example.com");
    raw
      .prepare(
        "INSERT INTO project_permissions (user_id, project_name, level, granted_at) VALUES (?, ?, ?, ?)",
      )
      .run(1, "alpha", "view", "2024-01-04T00:00:00.000Z");
    raw.close();
    return file;
  }

  it("adds an auto-increment id while preserving rows and FKs", () => {
    const file = makeLegacyDb();
    const db = openDb(file);

    const cols = (db.prepare("PRAGMA table_info(projects)").all() as {
      name: string;
      pk: number;
    }[]);
    const idCol = cols.find((c) => c.name === "id");
    expect(idCol?.pk).toBe(1);

    const projects = db
      .prepare("SELECT id, name FROM projects ORDER BY id")
      .all() as { id: number; name: string }[];
    // alpha + beta (registered) + gamma (backfilled from knowledge)
    expect(projects.map((p) => p.name).sort()).toEqual(["alpha", "beta", "gamma"]);
    for (const p of projects) expect(p.id).toBeGreaterThan(0);

    // FK from project_permissions(project_name) must still resolve.
    expect(db.pragma("foreign_key_check")).toHaveLength(0);
    const perm = db
      .prepare("SELECT count(*) c FROM project_permissions")
      .get() as { c: number };
    expect(perm.c).toBe(1);

    db.close();
  });

  it("is idempotent — re-opening does not rebuild or change ids", () => {
    const file = makeLegacyDb();
    const first = openDb(file);
    const before = first.prepare("SELECT id, name FROM projects ORDER BY id").all();
    first.close();

    const second = openDb(file);
    const after = second.prepare("SELECT id, name FROM projects ORDER BY id").all();
    expect(after).toEqual(before);
    second.close();
  });
});
