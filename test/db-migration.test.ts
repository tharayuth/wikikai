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

  it("gives an older database the task tables and activity columns", () => {
    const file = makeLegacyDb();
    const db = openDb(file);
    const cols = (db.prepare("PRAGMA table_info(activity_log)").all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).toEqual(expect.arrayContaining(["project_id", "task_id", "task_title"]));
    const { id } = db.prepare("SELECT id FROM projects WHERE name = 'alpha'").get() as { id: number };
    const now = "2026-01-01T00:00:00.000Z";
    db.prepare(
      "INSERT INTO tasks (project_id, title, position, created_at, updated_at) VALUES (?, 'T', 1, ?, ?)",
    ).run(id, now, now);
    expect(db.prepare("SELECT status, version FROM tasks").get()).toEqual({ status: "todo", version: 1 });
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM project_permissions").get()).toEqual({ n: 1 });
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

  describe("task modules", () => {
    /** A database as Project Tasks Core left it: tasks with no module or column. */
    function makeCoreDb(): string {
      const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wikikai-mig-")), "core.db");
      tmpFiles.push(file);
      const raw = new Database(file);
      raw.pragma("foreign_keys = ON");
      raw.exec(`
        CREATE TABLE projects (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL
        );
        CREATE TABLE tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'todo',
          position INTEGER NOT NULL,
          assignee_id INTEGER,
          start_date TEXT,
          due_date TEXT,
          labels TEXT,
          session_id TEXT,
          blocked_reason TEXT,
          created_by INTEGER,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1,
          archived_at TEXT
        );
      `);
      const now = "2026-01-01T00:00:00.000Z";
      raw.prepare("INSERT INTO projects (name, created_at) VALUES ('alpha', ?), ('empty', ?)").run(now, now);
      const insert = raw.prepare(
        "INSERT INTO tasks (project_id, title, status, position, created_at, updated_at) VALUES (1, ?, ?, ?, ?, ?)",
      );
      insert.run("second", "todo", 2, now, now);
      insert.run("first", "todo", 1, now, now);
      insert.run("doing", "doing", 1, now, now);
      raw.close();
      return file;
    }

    const tasksOf = (db: ReturnType<typeof openDb>) =>
      db.prepare("SELECT title, status, position, module_id, column_id FROM tasks ORDER BY id").all() as {
        title: string;
        status: string;
        position: number;
        module_id: number | null;
        column_id: number | null;
      }[];

    it("puts existing tasks in General with their order intact, and only projects with tasks", () => {
      const db = openDb(makeCoreDb());
      const modules = db.prepare("SELECT id, project_id, name, position FROM task_modules").all();
      expect(modules).toEqual([{ id: 1, project_id: 1, name: "General", position: 1 }]);
      expect(tasksOf(db)).toEqual([
        { title: "second", status: "todo", position: 2, module_id: 1, column_id: null },
        { title: "first", status: "todo", position: 1, module_id: 1, column_id: null },
        { title: "doing", status: "doing", position: 1, module_id: 1, column_id: null },
      ]);
      expect(db.pragma("foreign_key_check")).toEqual([]);
      db.close();
    });

    it("gives an older database the milestone column, empty", () => {
      const db = openDb(makeCoreDb());
      expect(db.prepare("SELECT DISTINCT milestone_id FROM tasks").all()).toEqual([{ milestone_id: null }]);
      expect(db.prepare("SELECT COUNT(*) AS n FROM milestones").get()).toEqual({ n: 0 });
      db.close();
    });

    it("changes nothing on a second open", () => {
      const file = makeCoreDb();
      const first = openDb(file);
      const before = [first.prepare("SELECT * FROM task_modules").all(), tasksOf(first)];
      first.close();
      const second = openDb(file);
      expect([second.prepare("SELECT * FROM task_modules").all(), tasksOf(second)]).toEqual(before);
      second.close();
    });

    it("repairs a task with no module, as a build from before modules would write", () => {
      const file = makeCoreDb();
      const first = openDb(file);
      const now = "2026-01-01T00:00:00.000Z";
      first
        .prepare("INSERT INTO tasks (project_id, title, position, created_at, updated_at) VALUES (1, 'old build', 9, ?, ?)")
        .run(now, now);
      first.close();
      const second = openDb(file);
      expect(tasksOf(second).find((t) => t.title === "old build")?.module_id).toBe(1);
      second.close();
    });

    it("clears a column that no longer matches its task's status", () => {
      const file = makeCoreDb();
      const first = openDb(file);
      first
        .prepare("INSERT INTO task_columns (module_id, name, status, position, created_at) VALUES (1, 'QA', 'review', 1, ?)")
        .run("2026-01-01T00:00:00.000Z");
      first.prepare("UPDATE tasks SET column_id = 1, status = 'review' WHERE title = 'first'").run();
      first.prepare("UPDATE tasks SET column_id = 1 WHERE title = 'second'").run();
      first.close();
      const second = openDb(file);
      const rows = tasksOf(second);
      expect(rows.find((t) => t.title === "first")?.column_id).toBe(1);
      expect(rows.find((t) => t.title === "second")?.column_id).toBeNull();
      second.close();
    });
  });
});
