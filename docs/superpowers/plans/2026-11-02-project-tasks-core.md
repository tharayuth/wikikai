# Project Tasks Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each project a task board, a task list, task dates on its calendar, and MCP tools that let an agent claim the next task.

**Architecture:** A new `TaskStore` over two SQLite tables holds every rule, so MCP tools and REST routes are thin callers that cannot drift apart. The web client adds Board and List tabs beside the existing calendar, all fed by one cached query and refreshed by a `task-changed` SSE event. Tasks reference `projects.id`, so a project rename leaves them untouched.

**Tech Stack:** Node, TypeScript, Express, better-sqlite3, Zod, `@modelcontextprotocol/sdk`, React 18, Redux Toolkit Query, `@dnd-kit`, Vitest, Supertest.

**Spec:** `docs/superpowers/specs/2026-11-02-project-tasks-core-design.md`

## Global Constraints

- No new packages. `@dnd-kit/core`, `@dnd-kit/sortable` and `@dnd-kit/utilities` are already dependencies.
- This repository is public. Nothing committed may contain hostnames, IP addresses, real paths, process names or live document ids. Those live in the untracked `CLAUDE.local.md`.
- Strict TypeScript with no `any` in new code. `npm run typecheck` covers server and client.
- Statuses are exactly `todo`, `doing`, `review`, `done`.
- Limits: title 1 to 300 characters, description up to 20,000, labels up to 20 of up to 50 characters with no commas, `session_id` up to 200, `blocked_reason` up to 1,000, link URL up to 2,000, link label up to 200, up to 50 links per task.
- MCP descriptions are English only, and the catalog stays under 40,000 characters (`test/mcp-catalog.test.ts`). Trim text rather than raise the budget.
- New CSS uses theme tokens only, never hardcoded colours. New view labels are English, matching `CalendarView`.
- URL form: `/?calendar=<project_id>&month=YYYY-MM&view=board|list&task=<id>`. The `/&N/#M` contract is unchanged.
- `/api/share/*` and `PublicView` must not change.
- Conventional Commits, one logical change per commit, with the attribution lines your harness specifies. Stage named files, never `git add -A`.
- Do not push until Task 11. Name the pm2 process in every pm2 command, and never export `DATA_DIR`, `PORT` or `HOST`.

## Review Focus

- An agent changes a task while a person has unsaved edits in the modal: the typed text must stay on screen, and saving must not overwrite the agent's change. Pinned in Task 8.
- An assignee loses project access or is deleted: their tasks stay editable, and saving an unrelated field must not fail. Pinned in Task 2.
- Editing only one date so that it crosses the other, such as an earlier `due_date` with an existing `start_date`: the edit is refused, because the check uses the merged values. Pinned in Task 2.
- A project is renamed while it has tasks: tasks stay, their `project` shows the new name, and access follows the rename. Pinned in Task 3.
- Link URLs that look harmless to a prefix check but not to a browser, such as `/<tab>/evil.test`, `/\evil.test` and `JAVASCRIPT:alert(1)`: all are refused. Pinned in Task 2.

---

### Task 1: Task tables and task rows in the activity log

**Files:**
- Modify: `src/store/schema.sql` (append)
- Modify: `src/store/db.ts` (migration block, after the `activity_log.user_id` check)
- Modify: `src/store/activityLog.ts`
- Create: `test/activity-log-tasks.test.ts`
- Modify: `test/db-migration.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: tables `tasks` and `task_links`. `ActivityTarget` gains `"board_task"`. `RecordInput` and `ActivityEntry` gain `project_id`, `task_id`, `task_title`.

- [ ] **Step 1: Write the failing tests**

Create `test/activity-log-tasks.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { openDb } from "../src/store/db.js";
import { ActivityLogStore } from "../src/store/activityLog.js";
import { KnowledgeStore } from "../src/store/knowledge.js";

function setup() {
  const db = openDb(":memory:");
  const knowledge = new KnowledgeStore(db);
  knowledge.registerProject("alpha");
  knowledge.registerProject("beta");
  const log = new ActivityLogStore(db);
  const idOf = (name: string): number =>
    (db.prepare("SELECT id FROM projects WHERE name = ?").get(name) as { id: number }).id;
  return { knowledge, log, alpha: idOf("alpha"), beta: idOf("beta") };
}

describe("activity log: board_task rows", () => {
  it("stores the project, task id and title", () => {
    const { log, alpha } = setup();
    log.record({
      action: "add",
      target: "board_task",
      project_id: alpha,
      task_id: 12,
      task_title: "Ship it",
    });
    expect(log.list().entries[0]).toMatchObject({
      action: "add",
      target: "board_task",
      knowledge_id: null,
      project_id: alpha,
      task_id: 12,
      task_title: "Ship it",
    });
  });

  it("shows a member the task rows of their projects only", () => {
    const { log, alpha, beta } = setup();
    log.record({ action: "add", target: "board_task", project_id: alpha, task_id: 1, task_title: "A" });
    log.record({ action: "add", target: "board_task", project_id: beta, task_id: 2, task_title: "B" });
    const { entries, total } = log.list({ visibleProjects: ["alpha"] });
    expect(entries.map((e) => e.task_id)).toEqual([1]);
    expect(total).toBe(1);
  });

  it("keeps showing a member the document rows of their projects", () => {
    const { knowledge, log } = setup();
    const k = knowledge.add({ title: "Doc", project: "alpha" });
    log.record({ action: "add", target: "knowledge", knowledge_id: k.id, knowledge_title: "Doc" });
    expect(log.list({ visibleProjects: ["alpha"] }).entries).toHaveLength(1);
    expect(log.list({ visibleProjects: ["beta"] }).entries).toHaveLength(0);
  });

  it("still hides rows with neither a document nor a project from members", () => {
    const { log } = setup();
    log.record({ action: "upload", target: "image" });
    expect(log.list({ visibleProjects: ["alpha"] }).entries).toEqual([]);
    expect(log.list({ visibleProjects: null }).entries).toHaveLength(1);
  });

  it("leaves task rows off the page calendar", () => {
    const { log, alpha } = setup();
    log.record({ action: "add", target: "board_task", project_id: alpha, task_id: 1, task_title: "A" });
    const today = new Date().toISOString().slice(0, 10);
    expect(log.calendar({ project: "alpha", from: today, to: today, tz: "UTC" })).toEqual([]);
  });
});
```

Add to the `describe` in `test/db-migration.test.ts`, after the first `it`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/activity-log-tasks.test.ts test/db-migration.test.ts`
Expected: FAIL. Inserting `board_task` values leaves `project_id` undefined, and `no such table: tasks` from the migration test.

- [ ] **Step 3: Add the tables**

Append to `src/store/schema.sql`:

```sql

-- ───── Tasks: tracked work on a project's board ─────
-- Separate from page checkboxes (`- [ ]`, the `toggle_task` tool), which are
-- content inside a document. `project_id` references the stable id, so a
-- project rename leaves tasks alone. RESTRICT because unregistering a project
-- keeps its documents; it must not silently take its tasks. `position` orders
-- tasks within one project + status, and the board order is the work queue.
-- See store/tasks.ts for the rules.
CREATE TABLE IF NOT EXISTS tasks (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  title          TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',  -- markdown
  status         TEXT NOT NULL DEFAULT 'todo'
                 CHECK (status IN ('todo','doing','review','done')),
  position       INTEGER NOT NULL,
  assignee_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  start_date     TEXT,                      -- YYYY-MM-DD
  due_date       TEXT,                      -- YYYY-MM-DD
  labels         TEXT,                      -- comma-separated, like knowledge.tags
  session_id     TEXT,                      -- claude --resume <id>
  blocked_reason TEXT,                      -- NULL = not blocked
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  version        INTEGER NOT NULL DEFAULT 1,
  archived_at    TEXT                       -- NULL = active
);
CREATE INDEX IF NOT EXISTS idx_tasks_board ON tasks(project_id, status, position);

CREATE TABLE IF NOT EXISTS task_links (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,                 -- http(s):// or a relative /path only
  label      TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_links_task ON task_links(task_id);
-- NOTE: `activity_log.project_id`, `task_id` and `task_title` are added by the
-- in-place migration in db.ts, for the same reason as `activity_log.user_id`.
```

- [ ] **Step 4: Add the activity log columns**

In `src/store/db.ts`, directly after the `if (!hasColumn(db, "activity_log", "user_id")) { ... }` block:

```ts
  for (const [column, type] of [
    ["project_id", "INTEGER"],
    ["task_id", "INTEGER"],
    ["task_title", "TEXT"],
  ] as const) {
    if (!hasColumn(db, "activity_log", column)) {
      // Board-task rows have no document or page to hang off. Not foreign
      // keys: a log row outlives its target.
      db.exec(`ALTER TABLE activity_log ADD COLUMN ${column} ${type}`);
    }
  }
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_activity_log_project ON activity_log(project_id, created_at DESC)`,
  );
```

- [ ] **Step 5: Teach the store about them**

In `src/store/activityLog.ts`:

Add `| "board_task"` to `ActivityTarget`, directly after `| "task"`.

Add to `RecordInput`, after `block_caption`:

```ts
  project_id?: number | null;
  task_id?: number | null;
  task_title?: string | null;
```

Add to `ActivityEntry`, after `block_caption`:

```ts
  project_id: number | null;
  task_id: number | null;
  task_title: string | null;
```

Replace the `INSERT` in `record`, and its `run` argument:

```ts
    this.db
      .prepare(
        `INSERT INTO activity_log
         (created_at, source, tool_name, action, target,
          knowledge_id, knowledge_title, page_id, page_title,
          block_id, block_caption, project_id, task_id, task_title, user_id)
         VALUES
         (@created_at, @source, @tool_name, @action, @target,
          @knowledge_id, @knowledge_title, @page_id, @page_title,
          @block_id, @block_caption, @project_id, @task_id, @task_title, @user_id)`,
      )
      .run({
        created_at: new Date().toISOString(),
        source: ctx.source,
        tool_name: ctx.tool_name ?? null,
        action: entry.action,
        target: entry.target,
        knowledge_id: entry.knowledge_id ?? null,
        knowledge_title: entry.knowledge_title ?? null,
        page_id: entry.page_id ?? null,
        page_title: entry.page_title ?? null,
        block_id: entry.block_id ?? null,
        block_caption: entry.block_caption ?? null,
        project_id: entry.project_id ?? null,
        task_id: entry.task_id ?? null,
        task_title: entry.task_title ?? null,
        user_id: ctx.user_id ?? null,
      });
```

Replace the docblock sentence about `visibleProjects` and the visibility condition in `list`:

```ts
  /** List entries newest-first. Optional `knowledge_id` narrows to a
   *  single knowledge; `limit` defaults to 100 (max 500). When
   *  `visibleProjects` is an array, only rows whose document or task belongs
   *  to one of those projects are returned — rows with neither (e.g. image
   *  uploads) are excluded too. Passing `null` or `undefined` disables the
   *  visibility filter (admin view). */
```

```ts
      const placeholders = visFilter.map(() => "?").join(",");
      conditions.push(
        `((a.knowledge_id IS NOT NULL AND a.knowledge_id IN (SELECT id FROM knowledge WHERE project IN (${placeholders})))
          OR a.project_id IN (SELECT id FROM projects WHERE name IN (${placeholders})))`,
      );
      params.push(...visFilter, ...visFilter);
```

Add the new columns to the `SELECT` in `list`:

```ts
        `SELECT a.id, a.created_at, a.source, a.tool_name, a.action, a.target,
                a.knowledge_id, a.knowledge_title, a.page_id, a.page_title,
                a.block_id, a.block_caption, a.project_id, a.task_id, a.task_title,
                a.user_id, u.display_name AS user_name
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run test/activity-log-tasks.test.ts test/db-migration.test.ts test/calendar.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/store/schema.sql src/store/db.ts src/store/activityLog.ts test/activity-log-tasks.test.ts test/db-migration.test.ts
git commit -m "feat: add task tables and task rows in the activity log"
```

---

### Task 2: TaskStore

**Files:**
- Create: `src/store/tasks.ts`
- Modify: `src/store/calendar.ts` (export `parseDate`)
- Modify: `src/lib/events.ts`
- Create: `test/tasks.test.ts`

**Interfaces:**
- Consumes: `ActivityLogStore.record` with `board_task` rows from Task 1.
- Produces, all from `src/store/tasks.ts`:
  - `TASK_STATUSES`, `TaskStatus`, `TaskPlacement`
  - Types `TaskProject`, `TaskMember`, `TaskLink`, `TaskLinkInput`, `TaskRow`, `Task`, `AddTaskInput`, `EditTaskInput`, `MoveTaskInput`, `ListTasksOptions`
  - Errors `TaskNotFoundError`, `TaskConflictError`, `TaskStaleError` (with `currentVersion`)
  - `new TaskStore(db, activityLog, { aclEnabled? })` with methods:
    - `getProject(id): TaskProject | null`
    - `ensureProject(name): TaskProject`
    - `listMembers(project: string): TaskMember[]`
    - `resolveAssignee(project: string, ref: string, callerId: number | null): number`
    - `add(projectId, input): Task`
    - `get(id): Task | null`
    - `list(projectId, opts?): TaskRow[]`
    - `next(projectId, callerId): TaskRow | null`
    - `edit(id, input): Task`
    - `move(id, input): Task`
    - `remove(id): void`
- Produces, from `src/lib/events.ts`: the event `{ type: "task-changed"; project_id: number; task_id: number }`.

- [ ] **Step 1: Write the failing tests**

Create `test/tasks.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { openDb } from "../src/store/db.js";
import { ActivityLogStore } from "../src/store/activityLog.js";
import { KnowledgeStore } from "../src/store/knowledge.js";
import { PermissionStore } from "../src/store/permissions.js";
import { UserStore } from "../src/store/users.js";
import { withCallContext } from "../src/lib/callContext.js";
import { onEvent, type WikikaiEvent } from "../src/lib/events.js";
import {
  TaskConflictError,
  TaskNotFoundError,
  TaskStaleError,
  TaskStore,
} from "../src/store/tasks.js";

function setup(opts: { aclEnabled?: boolean } = {}) {
  const db = openDb(":memory:");
  const users = new UserStore(db);
  const admin = users.create({ email: "admin@x.test", password: "x", display_name: "Admin", is_admin: true });
  const alice = users.create({ email: "alice@x.test", password: "x", display_name: "Alice" });
  const bob = users.create({ email: "bob@x.test", password: "x", display_name: "Bob" });
  const carol = users.create({ email: "carol@x.test", password: "x", display_name: "Carol" });
  const knowledge = new KnowledgeStore(db);
  knowledge.registerProject("alpha");
  const permissions = new PermissionStore(db);
  permissions.replaceForUser(alice.id, [{ project: "alpha", level: "edit" }], admin.id);
  permissions.replaceForUser(bob.id, [{ project: "alpha", level: "edit" }], admin.id);
  permissions.replaceForUser(carol.id, [{ project: "alpha", level: "view" }], admin.id);
  const log = new ActivityLogStore(db);
  const tasks = new TaskStore(db, log, opts);
  const alpha = tasks.ensureProject("alpha");
  return { db, users, admin, alice, bob, carol, knowledge, permissions, log, tasks, alpha };
}

const order = (tasks: TaskStore, projectId: number): string[] =>
  tasks.list(projectId).map((t) => `${t.status}:${t.title}`);

describe("TaskStore", () => {
  describe("add", () => {
    it("creates a todo at the bottom of its status", () => {
      const { tasks, alpha } = setup();
      const first = tasks.add(alpha.id, { title: "  First  " });
      const second = tasks.add(alpha.id, { title: "Second" });
      expect(first).toMatchObject({
        title: "First",
        project: "alpha",
        project_id: alpha.id,
        status: "todo",
        position: 1,
        version: 1,
        description: "",
        labels: [],
        links: [],
        assignee: null,
        archived: false,
        blocked_reason: null,
        session_id: null,
      });
      expect(second.position).toBe(2);
    });

    it("stores the optional fields and who created the task", () => {
      const { tasks, alpha, alice } = setup();
      const t = withCallContext({ source: "web", user_id: alice.id }, () =>
        tasks.add(alpha.id, {
          title: "T",
          description: "Body",
          status: "review",
          assignee_id: alice.id,
          start_date: "2026-11-01",
          due_date: "2026-11-02",
          labels: ["งานด่วน", " API ", "api"],
          links: [{ url: "/&3/#12", label: "spec" }],
          session_id: "abc",
        }),
      );
      expect(t).toMatchObject({
        description: "Body",
        status: "review",
        assignee: { id: alice.id, display_name: "Alice" },
        start_date: "2026-11-01",
        due_date: "2026-11-02",
        labels: ["งานด่วน", "API"],
        session_id: "abc",
        created_by: alice.id,
      });
      expect(t.links).toEqual([{ id: expect.any(Number), url: "/&3/#12", label: "spec" }]);
    });

    it("places a task at the top when asked", () => {
      const { tasks, alpha } = setup();
      tasks.add(alpha.id, { title: "A" });
      tasks.add(alpha.id, { title: "B", position: "top" });
      expect(order(tasks, alpha.id)).toEqual(["todo:B", "todo:A"]);
    });

    it("rejects a project that does not exist", () => {
      const { tasks } = setup();
      expect(() => tasks.add(9999, { title: "T" })).toThrow(/project 9999 not found/);
    });
  });

  describe("validation", () => {
    it("checks text limits", () => {
      const { tasks, alpha } = setup();
      expect(() => tasks.add(alpha.id, { title: "   " })).toThrow(/title is required/);
      expect(() => tasks.add(alpha.id, { title: "x".repeat(301) })).toThrow(/title/);
      expect(() => tasks.add(alpha.id, { title: "T", description: "x".repeat(20_001) })).toThrow(/description/);
      expect(() => tasks.add(alpha.id, { title: "T", session_id: "x".repeat(201) })).toThrow(/session_id/);
      expect(() => tasks.add(alpha.id, { title: "T", blocked_reason: "x".repeat(1_001) })).toThrow(/blocked_reason/);
    });

    it("checks labels", () => {
      const { tasks, alpha } = setup();
      expect(() => tasks.add(alpha.id, { title: "T", labels: ["a,b"] })).toThrow(/comma/);
      expect(() => tasks.add(alpha.id, { title: "T", labels: ["x".repeat(51)] })).toThrow(/label/);
      const many = Array.from({ length: 21 }, (_, i) => `l${i}`);
      expect(() => tasks.add(alpha.id, { title: "T", labels: many })).toThrow(/20 labels/);
    });

    it("checks dates", () => {
      const { tasks, alpha } = setup();
      expect(() => tasks.add(alpha.id, { title: "T", due_date: "2026-13-01" })).toThrow(/due_date/);
      expect(() => tasks.add(alpha.id, { title: "T", start_date: "tomorrow" })).toThrow(/start_date/);
      expect(() =>
        tasks.add(alpha.id, { title: "T", start_date: "2026-11-02", due_date: "2026-11-01" }),
      ).toThrow(/after due_date/);
    });

    it("refuses an edit that moves one date across the other", () => {
      const { tasks, alpha } = setup();
      const t = tasks.add(alpha.id, { title: "T", start_date: "2026-11-10", due_date: "2026-11-20" });
      expect(() => tasks.edit(t.id, { expected_version: 1, due_date: "2026-11-01" })).toThrow(/after due_date/);
      expect(() => tasks.edit(t.id, { expected_version: 1, start_date: "2026-11-30" })).toThrow(/after due_date/);
      expect(tasks.edit(t.id, { expected_version: 1, start_date: null, due_date: "2026-11-01" }).start_date).toBeNull();
    });

    it("accepts web and in-app links", () => {
      const { tasks, alpha } = setup();
      const urls = ["https://github.com/org/repo/commit/abc", "HTTP://x.test", "/&3/#12", "/?calendar=1"];
      const t = tasks.add(alpha.id, { title: "T", links: urls.map((url) => ({ url })) });
      expect(t.links.map((l) => l.url)).toEqual(urls);
    });

    it.each([
      "javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "data:text/html,x",
      "ftp://x.test",
      "x.test",
      "//evil.test",
      "/\\evil.test",
      "/\t/evil.test",
      "/\n/evil.test",
      "https://x.test/a b",
      "",
    ])("refuses the link %j", (url) => {
      const { tasks, alpha } = setup();
      expect(() => tasks.add(alpha.id, { title: "T", links: [{ url }] })).toThrow(/link/);
    });

    it("limits links per task", () => {
      const { tasks, alpha } = setup();
      const links = Array.from({ length: 51 }, (_, i) => ({ url: `/p${i}` }));
      expect(() => tasks.add(alpha.id, { title: "T", links })).toThrow(/50 links/);
    });
  });

  describe("edit", () => {
    it("bumps the version once, however many fields changed", () => {
      const { tasks, alpha } = setup();
      const t = tasks.add(alpha.id, { title: "T" });
      const next = tasks.edit(t.id, { expected_version: 1, title: "New", description: "B", labels: ["x"] });
      expect(next).toMatchObject({ title: "New", description: "B", labels: ["x"], version: 2 });
    });

    it("lets exactly one of two callers claim a task", () => {
      const { tasks, alpha } = setup();
      const t = tasks.add(alpha.id, { title: "T" });
      const claim = () => tasks.edit(t.id, { expected_version: t.version, status: "doing" });
      expect(claim().version).toBe(2);
      expect(claim).toThrow(TaskStaleError);
      expect(claim).toThrow(/STALE: task T\d+ version mismatch: expected v1, current v2/);
    });

    it("refuses an edit with nothing to change", () => {
      const { tasks, alpha } = setup();
      const t = tasks.add(alpha.id, { title: "T" });
      expect(() => tasks.edit(t.id, { expected_version: 1 })).toThrow(/nothing to change/);
    });

    it("clears nullable fields and treats blank text as cleared", () => {
      const { tasks, alpha, alice } = setup();
      const t = tasks.add(alpha.id, {
        title: "T",
        assignee_id: alice.id,
        session_id: "s",
        blocked_reason: "stuck",
        due_date: "2026-11-01",
      });
      const next = tasks.edit(t.id, {
        expected_version: 1,
        assignee_id: null,
        session_id: null,
        blocked_reason: "   ",
        due_date: null,
      });
      expect(next).toMatchObject({ assignee: null, session_id: null, blocked_reason: null, due_date: null });
    });

    it("adds and removes links, bumping the version", () => {
      const { tasks, alpha } = setup();
      const t = tasks.add(alpha.id, { title: "T", links: [{ url: "/a" }] });
      const added = tasks.edit(t.id, { expected_version: 1, add_links: [{ url: "/b", label: "B" }] });
      expect(added.version).toBe(2);
      expect(added.links.map((l) => l.url)).toEqual(["/a", "/b"]);
      const removed = tasks.edit(t.id, { expected_version: 2, remove_link_ids: [added.links[0].id] });
      expect(removed.version).toBe(3);
      expect(removed.links.map((l) => l.url)).toEqual(["/b"]);
    });

    it("cannot remove another task's link", () => {
      const { tasks, alpha } = setup();
      const a = tasks.add(alpha.id, { title: "A", links: [{ url: "/a" }] });
      const b = tasks.add(alpha.id, { title: "B" });
      tasks.edit(b.id, { expected_version: 1, remove_link_ids: [a.links[0].id] });
      expect(tasks.get(a.id)?.links).toHaveLength(1);
    });

    it("fails for an unknown task", () => {
      const { tasks } = setup();
      expect(() => tasks.edit(9999, { expected_version: 1, title: "X" })).toThrow(TaskNotFoundError);
    });
  });

  describe("position", () => {
    it("moves a task to the bottom of a new status, except done, which goes on top", () => {
      const { tasks, alpha } = setup();
      const a = tasks.add(alpha.id, { title: "A" });
      const b = tasks.add(alpha.id, { title: "B" });
      const c = tasks.add(alpha.id, { title: "C", status: "doing" });
      tasks.edit(a.id, { expected_version: 1, status: "doing" });
      expect(order(tasks, alpha.id)).toEqual(["todo:B", "doing:C", "doing:A"]);
      tasks.edit(b.id, { expected_version: 1, status: "done" });
      tasks.edit(c.id, { expected_version: 1, status: "done" });
      expect(order(tasks, alpha.id)).toEqual(["doing:A", "done:C", "done:B"]);
    });

    it("lets position override the default", () => {
      const { tasks, alpha } = setup();
      tasks.add(alpha.id, { title: "A", status: "done" });
      const b = tasks.add(alpha.id, { title: "B" });
      tasks.edit(b.id, { expected_version: 1, status: "done", position: "bottom" });
      expect(order(tasks, alpha.id)).toEqual(["done:A", "done:B"]);
    });

    it("does not bump anything on a position-only edit", () => {
      const { tasks, alpha } = setup();
      const a = tasks.add(alpha.id, { title: "A" });
      const b = tasks.add(alpha.id, { title: "B" });
      const moved = tasks.edit(b.id, { expected_version: 1, position: "top" });
      expect(moved.version).toBe(1);
      expect(moved.updated_at).toBe(b.updated_at);
      expect(tasks.get(a.id)?.version).toBe(1);
      expect(order(tasks, alpha.id)).toEqual(["todo:B", "todo:A"]);
    });

    it("ignores archived tasks, and an unarchived task returns at the bottom", () => {
      const { tasks, alpha } = setup();
      const a = tasks.add(alpha.id, { title: "A" });
      tasks.add(alpha.id, { title: "B" });
      const archived = tasks.edit(a.id, { expected_version: 1, archived: true });
      expect(archived.archived).toBe(true);
      expect(order(tasks, alpha.id)).toEqual(["todo:B"]);
      tasks.add(alpha.id, { title: "C" });
      tasks.edit(a.id, { expected_version: 2, archived: false });
      expect(order(tasks, alpha.id)).toEqual(["todo:B", "todo:C", "todo:A"]);
    });
  });

  describe("move", () => {
    it("reorders within a status without checking or bumping the version", () => {
      const { tasks, alpha } = setup();
      const a = tasks.add(alpha.id, { title: "A" });
      tasks.add(alpha.id, { title: "B" });
      const c = tasks.add(alpha.id, { title: "C" });
      const moved = tasks.move(c.id, { status: "todo", before_id: a.id, expected_version: 999 });
      expect(moved.version).toBe(1);
      expect(order(tasks, alpha.id)).toEqual(["todo:C", "todo:A", "todo:B"]);
      expect(tasks.list(alpha.id).map((t) => t.position)).toEqual([1, 2, 3]);
    });

    it("checks and bumps the version when the status changes", () => {
      const { tasks, alpha } = setup();
      const a = tasks.add(alpha.id, { title: "A" });
      expect(tasks.move(a.id, { status: "doing", before_id: null, expected_version: 1 }).version).toBe(2);
      expect(() => tasks.move(a.id, { status: "review", before_id: null, expected_version: 1 })).toThrow(TaskStaleError);
    });

    it("leaves other tasks' versions alone", () => {
      const { tasks, alpha } = setup();
      const a = tasks.add(alpha.id, { title: "A" });
      const b = tasks.add(alpha.id, { title: "B", status: "doing" });
      tasks.move(a.id, { status: "doing", before_id: b.id, expected_version: 1 });
      expect(tasks.get(b.id)?.version).toBe(1);
      expect(order(tasks, alpha.id)).toEqual(["doing:A", "doing:B"]);
    });

    it("falls back to the bottom when before_id is no longer in the target status", () => {
      const { tasks, alpha } = setup();
      const a = tasks.add(alpha.id, { title: "A" });
      const b = tasks.add(alpha.id, { title: "B", status: "doing" });
      tasks.add(alpha.id, { title: "C", status: "doing" });
      tasks.move(a.id, { status: "review", before_id: b.id, expected_version: 1 });
      expect(tasks.get(a.id)).toMatchObject({ status: "review", position: 1 });
    });

    it("refuses to move an archived task", () => {
      const { tasks, alpha } = setup();
      const a = tasks.add(alpha.id, { title: "A" });
      tasks.edit(a.id, { expected_version: 1, archived: true });
      expect(() => tasks.move(a.id, { status: "doing", before_id: null, expected_version: 2 })).toThrow(TaskConflictError);
    });
  });

  describe("next", () => {
    it("returns the first unblocked, unarchived todo that is free or the caller's", () => {
      const { tasks, alpha, alice, bob } = setup();
      const forBob = tasks.add(alpha.id, { title: "For Bob", assignee_id: bob.id });
      tasks.add(alpha.id, { title: "Blocked", blocked_reason: "waiting" });
      const archived = tasks.add(alpha.id, { title: "Archived" });
      tasks.edit(archived.id, { expected_version: 1, archived: true });
      tasks.add(alpha.id, { title: "Doing", status: "doing" });
      const free = tasks.add(alpha.id, { title: "Free" });
      expect(tasks.next(alpha.id, alice.id)?.id).toBe(free.id);
      expect(tasks.next(alpha.id, bob.id)?.id).toBe(forBob.id);
    });

    it("follows the board order", () => {
      const { tasks, alpha, alice } = setup();
      tasks.add(alpha.id, { title: "A" });
      const b = tasks.add(alpha.id, { title: "B" });
      tasks.edit(b.id, { expected_version: 1, position: "top" });
      expect(tasks.next(alpha.id, alice.id)?.id).toBe(b.id);
    });

    it("offers only unassigned tasks when there is no caller, and null when none remain", () => {
      const { tasks, alpha, alice } = setup();
      tasks.add(alpha.id, { title: "Assigned", assignee_id: alice.id });
      expect(tasks.next(alpha.id, null)).toBeNull();
      const free = tasks.add(alpha.id, { title: "Free" });
      expect(tasks.next(alpha.id, null)?.id).toBe(free.id);
    });
  });

  describe("list", () => {
    it("orders by status, then position, and leaves out archived tasks", () => {
      const { tasks, alpha } = setup();
      tasks.add(alpha.id, { title: "D", status: "done" });
      tasks.add(alpha.id, { title: "R", status: "review" });
      tasks.add(alpha.id, { title: "T" });
      const gone = tasks.add(alpha.id, { title: "Gone" });
      tasks.edit(gone.id, { expected_version: 1, archived: true });
      expect(order(tasks, alpha.id)).toEqual(["todo:T", "review:R", "done:D"]);
      expect(tasks.list(alpha.id, { includeArchived: true })).toHaveLength(4);
    });

    it("filters by status, assignee and label, and applies a limit", () => {
      const { tasks, alpha, alice } = setup();
      tasks.add(alpha.id, { title: "A", assignee_id: alice.id, labels: ["งานด่วน"] });
      tasks.add(alpha.id, { title: "B", status: "doing", labels: ["API"] });
      tasks.add(alpha.id, { title: "C", status: "done" });
      expect(tasks.list(alpha.id, { statuses: ["doing", "done"] }).map((t) => t.title)).toEqual(["B", "C"]);
      expect(tasks.list(alpha.id, { assigneeId: alice.id }).map((t) => t.title)).toEqual(["A"]);
      expect(tasks.list(alpha.id, { label: "api" }).map((t) => t.title)).toEqual(["B"]);
      expect(tasks.list(alpha.id, { label: "งานด่วน" }).map((t) => t.title)).toEqual(["A"]);
      expect(tasks.list(alpha.id, { limit: 2 })).toHaveLength(2);
    });

    it("keeps rows compact", () => {
      const { tasks, alpha } = setup();
      tasks.add(alpha.id, { title: "T", description: "Body" });
      expect(tasks.list(alpha.id)[0]).not.toHaveProperty("description");
    });
  });

  describe("members and assignees", () => {
    it("lists users with edit access plus admins, with no emails", () => {
      const { tasks } = setup();
      expect(tasks.listMembers("alpha").map((m) => m.display_name)).toEqual(["Admin", "Alice", "Bob"]);
      expect(tasks.listMembers("alpha")[0]).not.toHaveProperty("email");
    });

    it("lists every user when the ACL is off", () => {
      const { tasks } = setup({ aclEnabled: false });
      expect(tasks.listMembers("alpha").map((m) => m.display_name)).toContain("Carol");
    });

    it("refuses to assign someone without edit access", () => {
      const { tasks, alpha, carol } = setup();
      expect(() => tasks.add(alpha.id, { title: "T", assignee_id: carol.id })).toThrow(/cannot be assigned/);
    });

    it("keeps a task usable after its assignee loses access", () => {
      const { tasks, alpha, alice, admin, permissions } = setup();
      const t = tasks.add(alpha.id, { title: "T", assignee_id: alice.id });
      permissions.replaceForUser(alice.id, [], admin.id);
      const next = tasks.edit(t.id, { expected_version: 1, title: "Renamed" });
      expect(next.assignee?.id).toBe(alice.id);
      const same = tasks.edit(t.id, { expected_version: 2, assignee_id: alice.id });
      expect(same.assignee?.id).toBe(alice.id);
    });

    it("clears the assignee when the user is deleted", () => {
      const { tasks, alpha, bob, users } = setup();
      const t = tasks.add(alpha.id, { title: "T", assignee_id: bob.id });
      users.delete(bob.id);
      expect(tasks.get(t.id)?.assignee).toBeNull();
      expect(tasks.edit(t.id, { expected_version: 1, title: "Still works" }).title).toBe("Still works");
    });

    it("resolves me, a display name or an email", () => {
      const { tasks, alice, bob } = setup();
      expect(tasks.resolveAssignee("alpha", "me", alice.id)).toBe(alice.id);
      expect(tasks.resolveAssignee("alpha", "alice", null)).toBe(alice.id);
      expect(tasks.resolveAssignee("alpha", "BOB@x.test", null)).toBe(bob.id);
    });

    it("explains a failed lookup using display names only", () => {
      const { tasks } = setup();
      expect(() => tasks.resolveAssignee("alpha", "me", null)).toThrow(/caller/);
      let message = "";
      try {
        tasks.resolveAssignee("alpha", "nobody", null);
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toContain("Alice");
      expect(message).not.toContain("@x.test");
    });

    it("refuses an ambiguous name", () => {
      const { tasks, users, permissions, admin } = setup();
      const twin = users.create({ email: "twin@x.test", password: "x", display_name: "Alice" });
      permissions.replaceForUser(twin.id, [{ project: "alpha", level: "edit" }], admin.id);
      expect(() => tasks.resolveAssignee("alpha", "Alice", null)).toThrow(/ambiguous/);
    });
  });

  describe("ensureProject", () => {
    it("returns a registered project", () => {
      const { tasks, alpha } = setup();
      expect(tasks.ensureProject(" alpha ")).toEqual(alpha);
    });

    it("registers a project known only through a document", () => {
      const { tasks, db } = setup();
      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO knowledge (title, project, created_at, updated_at) VALUES ('K', 'derived', ?, ?)",
      ).run(now, now);
      expect(tasks.ensureProject("derived").name).toBe("derived");
    });

    it("refuses an unknown name, so a typo cannot create a project", () => {
      const { tasks, db } = setup();
      expect(() => tasks.ensureProject("typo")).toThrow(/project 'typo' not found/);
      expect(db.prepare("SELECT 1 FROM projects WHERE name = 'typo'").get()).toBeUndefined();
    });
  });

  describe("remove", () => {
    it("deletes only archived tasks", () => {
      const { tasks, alpha } = setup();
      const t = tasks.add(alpha.id, { title: "T", links: [{ url: "/a" }] });
      expect(() => tasks.remove(t.id)).toThrow(TaskConflictError);
      tasks.edit(t.id, { expected_version: 1, archived: true });
      tasks.remove(t.id);
      expect(tasks.get(t.id)).toBeNull();
      expect(() => tasks.remove(t.id)).toThrow(TaskNotFoundError);
    });
  });

  describe("side effects", () => {
    it("emits ids only", () => {
      const { tasks, alpha } = setup();
      const seen: WikikaiEvent[] = [];
      const off = onEvent((e) => seen.push(e));
      const t = tasks.add(alpha.id, { title: "Private title", description: "Private body" });
      off();
      expect(seen.filter((e) => e.type === "task-changed")).toEqual([
        { type: "task-changed", project_id: alpha.id, task_id: t.id },
      ]);
      expect(JSON.stringify(seen)).not.toContain("Private");
    });

    it("logs each kind of change, and never the body", () => {
      const { tasks, alpha, log, db } = setup();
      const a = tasks.add(alpha.id, { title: "A", description: "Private body" });
      tasks.add(alpha.id, { title: "B" });
      tasks.edit(a.id, { expected_version: 1, title: "A2" });
      tasks.edit(a.id, { expected_version: 2, position: "bottom" });
      tasks.edit(a.id, { expected_version: 2, archived: true });
      tasks.remove(a.id);
      const actions = log.list().entries.reverse().map((e) => e.action);
      expect(actions).toEqual(["add", "add", "edit", "reorder", "edit", "delete"]);
      expect(log.list().entries[0]).toMatchObject({
        target: "board_task",
        project_id: alpha.id,
        task_id: a.id,
        task_title: "A2",
      });
      expect(JSON.stringify(db.prepare("SELECT * FROM activity_log").all())).not.toContain("Private body");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/tasks.test.ts`
Expected: FAIL with `Failed to load url ../src/store/tasks.js`.

- [ ] **Step 3: Export `parseDate` and add the event**

In `src/store/calendar.ts`, change `function parseDate(` to `export function parseDate(`.

In `src/lib/events.ts`, add to the doc comment's list of kinds, after `activity-logged`:

```ts
 *   task-changed     — a task on a project's board changed. Ids only: this
 *                       stream reaches every connected browser regardless of
 *                       project access.
```

and add to the `WikikaiEvent` union:

```ts
  | { type: "task-changed"; project_id: number; task_id: number }
```

- [ ] **Step 4: Write the store**

Create `src/store/tasks.ts`:

```ts
import type { Db } from "./db.js";
import type { ActivityAction, ActivityLogStore } from "./activityLog.js";
import { parseDate } from "./calendar.js";
import { getCallContext } from "../lib/callContext.js";
import { emitEvent } from "../lib/events.js";

/**
 * Tasks on a project's board. Every rule lives here, so the MCP tools and the
 * REST routes are thin callers that cannot disagree. See the design in
 * docs/superpowers/specs/2026-11-02-project-tasks-core-design.md.
 *
 * - `version` guards field changes: two callers holding one version cannot
 *   both win, which is what makes claiming a task safe.
 * - `position` orders tasks within one project + status. It is not versioned,
 *   so dragging one card never fails someone else's claim of another.
 */

export const TASK_STATUSES = ["todo", "doing", "review", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPlacement = "top" | "bottom";

const TITLE_MAX = 300;
const DESCRIPTION_MAX = 20_000;
const LABEL_MAX = 50;
const LABELS_MAX = 20;
const SESSION_MAX = 200;
const BLOCKED_MAX = 1_000;
const LINK_URL_MAX = 2_000;
const LINK_LABEL_MAX = 200;
const LINKS_MAX = 50;

export interface TaskProject {
  id: number;
  name: string;
}

export interface TaskMember {
  id: number;
  display_name: string;
}

export interface TaskLink {
  id: number;
  url: string;
  label: string | null;
}

export interface TaskLinkInput {
  url: string;
  label?: string;
}

/** What a board or a list needs: no description or links. */
export interface TaskRow {
  id: number;
  project_id: number;
  title: string;
  status: TaskStatus;
  position: number;
  assignee: TaskMember | null;
  start_date: string | null;
  due_date: string | null;
  labels: string[];
  blocked_reason: string | null;
  version: number;
  updated_at: string;
  archived: boolean;
}

export interface Task extends TaskRow {
  project: string;
  description: string;
  session_id: string | null;
  links: TaskLink[];
  created_by: number | null;
  created_at: string;
}

interface TaskFieldsInput {
  description?: string;
  status?: TaskStatus;
  assignee_id?: number | null;
  start_date?: string | null;
  due_date?: string | null;
  labels?: string[];
  session_id?: string | null;
  blocked_reason?: string | null;
  position?: TaskPlacement;
}

export interface AddTaskInput extends TaskFieldsInput {
  title: string;
  links?: TaskLinkInput[];
}

export interface EditTaskInput extends TaskFieldsInput {
  expected_version: number;
  title?: string;
  add_links?: TaskLinkInput[];
  remove_link_ids?: number[];
  archived?: boolean;
}

export interface MoveTaskInput {
  status: TaskStatus;
  before_id: number | null;
  expected_version: number;
}

export interface ListTasksOptions {
  statuses?: TaskStatus[];
  assigneeId?: number;
  label?: string;
  includeArchived?: boolean;
  limit?: number;
}

export class TaskNotFoundError extends Error {
  constructor(id: number) {
    super(`task T${id} not found`);
    this.name = "TaskNotFoundError";
  }
}

export class TaskConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskConflictError";
  }
}

export class TaskStaleError extends TaskConflictError {
  constructor(
    id: number,
    expected: number,
    public readonly currentVersion: number,
  ) {
    super(`STALE: task T${id} version mismatch: expected v${expected}, current v${currentVersion}`);
    this.name = "TaskStaleError";
  }
}

interface TaskDbRow {
  id: number;
  project_id: number;
  project_name: string;
  title: string;
  description: string;
  status: TaskStatus;
  position: number;
  assignee_id: number | null;
  assignee_name: string | null;
  start_date: string | null;
  due_date: string | null;
  labels: string | null;
  session_id: string | null;
  blocked_reason: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  version: number;
  archived_at: string | null;
}

const SELECT_TASK = `
  SELECT t.*, p.name AS project_name, u.display_name AS assignee_name
  FROM tasks t
  JOIN projects p ON p.id = t.project_id
  LEFT JOIN users u ON u.id = t.assignee_id`;

const STATUS_ORDER = `CASE t.status WHEN 'todo' THEN 1 WHEN 'doing' THEN 2 WHEN 'review' THEN 3 ELSE 4 END`;

function cleanTitle(value: string): string {
  const title = value.trim();
  if (!title) throw new Error("title is required");
  if (title.length > TITLE_MAX) throw new Error(`title must be ≤ ${TITLE_MAX} chars`);
  return title;
}

function cleanDescription(value: string): string {
  if (value.length > DESCRIPTION_MAX) throw new Error(`description must be ≤ ${DESCRIPTION_MAX} chars`);
  return value;
}

/** Blank counts as cleared, so an emptied form field needs no special case. */
function cleanOptionalText(value: string | null | undefined, name: string, max: number): string | null {
  if (value == null) return null;
  const text = value.trim();
  if (!text) return null;
  if (text.length > max) throw new Error(`${name} must be ≤ ${max} chars`);
  return text;
}

function cleanDate(value: string | null | undefined, name: string): string | null {
  if (value == null) return null;
  parseDate(value, name);
  return value;
}

function assertDateOrder(start: string | null, due: string | null): void {
  if (start && due && start > due) throw new Error("start_date must not be after due_date");
}

function cleanLabels(values: string[]): string | null {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const label = raw.trim();
    if (!label) continue;
    if (label.includes(",")) throw new Error(`label '${label}' must not contain a comma`);
    if (label.length > LABEL_MAX) throw new Error(`label must be ≤ ${LABEL_MAX} chars`);
    const key = label.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  if (out.length > LABELS_MAX) throw new Error(`a task can have at most ${LABELS_MAX} labels`);
  return out.length ? out.join(",") : null;
}

function parseLabels(stored: string | null): string[] {
  return stored ? stored.split(",") : [];
}

/**
 * Links land in `<a href>`, so only http(s) and same-origin paths pass.
 * Whitespace and control characters are refused because browsers strip them
 * while parsing a URL: `/<tab>/evil.test` would otherwise become
 * protocol-relative after it passed the check.
 */
function isAllowedLinkUrl(url: string): boolean {
  if (/[\s\u0000-\u001f\u007f]/.test(url)) return false;
  if (/^https?:\/\//i.test(url)) return true;
  return url.startsWith("/") && url[1] !== "/" && url[1] !== "\\";
}

function cleanLink(input: TaskLinkInput): { url: string; label: string | null } {
  const url = input.url.trim();
  if (url.length > LINK_URL_MAX) throw new Error(`link url must be ≤ ${LINK_URL_MAX} chars`);
  if (!isAllowedLinkUrl(url)) throw new Error(`link url must be http(s):// or a relative /path: '${url}'`);
  return { url, label: cleanOptionalText(input.label, "link label", LINK_LABEL_MAX) };
}

function toRow(r: TaskDbRow): TaskRow {
  return {
    id: r.id,
    project_id: r.project_id,
    title: r.title,
    status: r.status,
    position: r.position,
    assignee:
      r.assignee_id != null && r.assignee_name != null
        ? { id: r.assignee_id, display_name: r.assignee_name }
        : null,
    start_date: r.start_date,
    due_date: r.due_date,
    labels: parseLabels(r.labels),
    blocked_reason: r.blocked_reason,
    version: r.version,
    updated_at: r.updated_at,
    archived: r.archived_at !== null,
  };
}

export class TaskStore {
  private readonly aclEnabled: boolean;

  constructor(
    private readonly db: Db,
    private readonly activityLog: ActivityLogStore,
    opts: { aclEnabled?: boolean } = {},
  ) {
    this.aclEnabled = opts.aclEnabled ?? true;
  }

  // ─── Projects ───

  getProject(id: number): TaskProject | null {
    const row = this.db.prepare(`SELECT id, name FROM projects WHERE id = ?`).get(id) as
      | TaskProject
      | undefined;
    return row ?? null;
  }

  /** The named project's registry row, registering one that only documents
   *  mention so far. An unknown name is an error, so a typo cannot create a
   *  project. */
  ensureProject(name: string): TaskProject {
    const trimmed = name.trim();
    const referenced = this.db.prepare(`SELECT 1 FROM knowledge WHERE project = ? LIMIT 1`).get(trimmed);
    if (referenced) {
      this.db
        .prepare(`INSERT OR IGNORE INTO projects (name, created_at) VALUES (?, ?)`)
        .run(trimmed, new Date().toISOString());
    }
    const row = this.db.prepare(`SELECT id, name FROM projects WHERE name = ?`).get(trimmed) as
      | TaskProject
      | undefined;
    if (!row) throw new Error(`project '${trimmed}' not found`);
    return row;
  }

  // ─── Members ───

  /** Who a task can be assigned to: users with edit access, plus admins. */
  listMembers(project: string): TaskMember[] {
    return this.memberRows(project).map(({ id, display_name }) => ({ id, display_name }));
  }

  private memberRows(project: string): (TaskMember & { email: string })[] {
    const rows = this.aclEnabled
      ? this.db
          .prepare(
            `SELECT id, display_name, email FROM users
             WHERE is_admin = 1
                OR id IN (SELECT user_id FROM project_permissions
                          WHERE project_name = ? AND level = 'edit')
             ORDER BY display_name, id`,
          )
          .all(project)
      : this.db.prepare(`SELECT id, display_name, email FROM users ORDER BY display_name, id`).all();
    return rows as (TaskMember & { email: string })[];
  }

  /** Turn `"me"`, a display name or an email into a user id. Errors name
   *  valid members by display name only: emails are accepted, never returned. */
  resolveAssignee(project: string, ref: string, callerId: number | null): number {
    const wanted = ref.trim().toLocaleLowerCase();
    if (wanted === "me") {
      if (callerId == null) throw new Error(`assignee "me" needs a caller, and this call has no user`);
      return callerId;
    }
    const members = this.memberRows(project);
    const matches = members.filter(
      (m) => m.display_name.toLocaleLowerCase() === wanted || m.email.toLocaleLowerCase() === wanted,
    );
    if (matches.length === 1) return matches[0].id;
    const names = members.map((m) => m.display_name).join(", ");
    throw new Error(
      matches.length > 1
        ? `assignee '${ref}' is ambiguous. Valid members: ${names}`
        : `assignee '${ref}' is not a member of this project. Valid members: ${names}`,
    );
  }

  private assertAssignable(project: string, userId: number): void {
    if (!this.memberRows(project).some((m) => m.id === userId)) {
      throw new Error(`user ${userId} cannot be assigned: no edit access to this project`);
    }
  }

  // ─── Reads ───

  get(id: number): Task | null {
    const row = this.dbRow(id);
    return row ? this.toTask(row) : null;
  }

  list(projectId: number, opts: ListTasksOptions = {}): TaskRow[] {
    const conditions = [`t.project_id = ?`];
    const params: unknown[] = [projectId];
    if (!opts.includeArchived) conditions.push(`t.archived_at IS NULL`);
    if (opts.statuses?.length) {
      conditions.push(`t.status IN (${opts.statuses.map(() => "?").join(",")})`);
      params.push(...opts.statuses);
    }
    if (opts.assigneeId != null) {
      conditions.push(`t.assignee_id = ?`);
      params.push(opts.assigneeId);
    }
    const rows = this.db
      .prepare(`${SELECT_TASK} WHERE ${conditions.join(" AND ")} ORDER BY ${STATUS_ORDER}, t.position, t.id`)
      .all(...params) as TaskDbRow[];
    let out = rows.map(toRow);
    if (opts.label) {
      const wanted = opts.label.trim().toLocaleLowerCase();
      out = out.filter((t) => t.labels.some((l) => l.toLocaleLowerCase() === wanted));
    }
    return opts.limit != null ? out.slice(0, opts.limit) : out;
  }

  /** The task an agent should claim next: the board order is the queue. */
  next(projectId: number, callerId: number | null): TaskRow | null {
    const row = this.db
      .prepare(
        `${SELECT_TASK}
         WHERE t.project_id = ?
           AND t.status = 'todo'
           AND t.archived_at IS NULL
           AND t.blocked_reason IS NULL
           AND (t.assignee_id IS NULL OR t.assignee_id = ?)
         ORDER BY t.position, t.id
         LIMIT 1`,
      )
      .get(projectId, callerId) as TaskDbRow | undefined;
    return row ? toRow(row) : null;
  }

  // ─── Writes ───

  add(projectId: number, input: AddTaskInput): Task {
    const project = this.getProject(projectId);
    if (!project) throw new Error(`project ${projectId} not found`);
    const title = cleanTitle(input.title);
    const description = cleanDescription(input.description ?? "");
    const status = input.status ?? "todo";
    const start = cleanDate(input.start_date, "start_date");
    const due = cleanDate(input.due_date, "due_date");
    assertDateOrder(start, due);
    const labels = cleanLabels(input.labels ?? []);
    const session = cleanOptionalText(input.session_id, "session_id", SESSION_MAX);
    const blocked = cleanOptionalText(input.blocked_reason, "blocked_reason", BLOCKED_MAX);
    const links = (input.links ?? []).map(cleanLink);
    if (input.assignee_id != null) this.assertAssignable(project.name, input.assignee_id);
    const now = new Date().toISOString();

    const id = this.db.transaction(() => {
      const info = this.db
        .prepare(
          `INSERT INTO tasks
             (project_id, title, description, status, position, assignee_id, start_date, due_date,
              labels, session_id, blocked_reason, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          projectId,
          title,
          description,
          status,
          input.assignee_id ?? null,
          start,
          due,
          labels,
          session,
          blocked,
          getCallContext().user_id ?? null,
          now,
          now,
        );
      const taskId = Number(info.lastInsertRowid);
      this.insertLinks(taskId, links, now);
      this.place(taskId, projectId, status, input.position ?? "bottom");
      return taskId;
    })();

    this.afterChange("add", projectId, id, title);
    return this.require(id);
  }

  edit(id: number, input: EditTaskInput): Task {
    const outcome = this.db.transaction(() => {
      const cur = this.requireRow(id);
      if (cur.version !== input.expected_version) {
        throw new TaskStaleError(id, input.expected_version, cur.version);
      }
      const now = new Date().toISOString();
      const sets: string[] = [];
      const params: Record<string, unknown> = {};
      const set = (column: string, value: unknown): void => {
        sets.push(`${column} = @${column}`);
        params[column] = value;
      };

      const title = input.title !== undefined ? cleanTitle(input.title) : cur.title;
      if (input.title !== undefined) set("title", title);
      if (input.description !== undefined) set("description", cleanDescription(input.description));
      if (input.status !== undefined) set("status", input.status);
      if (input.assignee_id !== undefined) {
        if (input.assignee_id !== null && input.assignee_id !== cur.assignee_id) {
          this.assertAssignable(cur.project_name, input.assignee_id);
        }
        set("assignee_id", input.assignee_id);
      }
      // The order check uses the merged dates, so moving one date across the
      // other is refused even though that date alone is valid.
      const start = input.start_date !== undefined ? cleanDate(input.start_date, "start_date") : cur.start_date;
      const due = input.due_date !== undefined ? cleanDate(input.due_date, "due_date") : cur.due_date;
      assertDateOrder(start, due);
      if (input.start_date !== undefined) set("start_date", start);
      if (input.due_date !== undefined) set("due_date", due);
      if (input.labels !== undefined) set("labels", cleanLabels(input.labels));
      if (input.session_id !== undefined) {
        set("session_id", cleanOptionalText(input.session_id, "session_id", SESSION_MAX));
      }
      if (input.blocked_reason !== undefined) {
        set("blocked_reason", cleanOptionalText(input.blocked_reason, "blocked_reason", BLOCKED_MAX));
      }
      if (input.archived !== undefined) set("archived_at", input.archived ? (cur.archived_at ?? now) : null);

      const addLinks = (input.add_links ?? []).map(cleanLink);
      const removeLinks = input.remove_link_ids ?? [];
      const fieldsChanged = sets.length > 0 || addLinks.length > 0 || removeLinks.length > 0;
      if (!fieldsChanged && input.position === undefined) throw new Error("nothing to change");

      if (fieldsChanged) {
        const info = this.db
          .prepare(
            `UPDATE tasks SET ${[...sets, "version = version + 1", "updated_at = @updated_at"].join(", ")}
             WHERE id = @id AND version = @expected_version`,
          )
          .run({ ...params, updated_at: now, id, expected_version: input.expected_version });
        if (info.changes !== 1) throw new TaskStaleError(id, input.expected_version, cur.version + 1);
        const removeLink = this.db.prepare(`DELETE FROM task_links WHERE task_id = ? AND id = ?`);
        for (const linkId of removeLinks) removeLink.run(id, linkId);
        this.insertLinks(id, addLinks, now);
      }

      const status = input.status ?? cur.status;
      const archived = input.archived ?? cur.archived_at !== null;
      if (!archived) {
        if (input.position) this.place(id, cur.project_id, status, input.position);
        else if (status !== cur.status) this.place(id, cur.project_id, status, status === "done" ? "top" : "bottom");
        else if (cur.archived_at !== null) this.place(id, cur.project_id, status, "bottom");
      }
      return { projectId: cur.project_id, title, fieldsChanged };
    })();

    this.afterChange(outcome.fieldsChanged ? "edit" : "reorder", outcome.projectId, id, outcome.title);
    return this.require(id);
  }

  /** Drag on the board. A reorder cannot lose anyone's work, so only a status
   *  change checks and bumps the version. A `before_id` no longer in the
   *  target status means the bottom, so a slightly stale board cannot fail. */
  move(id: number, input: MoveTaskInput): Task {
    const outcome = this.db.transaction(() => {
      const cur = this.requireRow(id);
      if (cur.archived_at !== null) throw new TaskConflictError(`task T${id} is archived; unarchive it first`);
      const statusChanged = input.status !== cur.status;
      if (statusChanged) {
        if (cur.version !== input.expected_version) {
          throw new TaskStaleError(id, input.expected_version, cur.version);
        }
        this.db
          .prepare(`UPDATE tasks SET status = ?, version = version + 1, updated_at = ? WHERE id = ?`)
          .run(input.status, new Date().toISOString(), id);
      }
      this.place(id, cur.project_id, input.status, { beforeId: input.before_id });
      return { projectId: cur.project_id, title: cur.title, statusChanged };
    })();

    this.afterChange(outcome.statusChanged ? "edit" : "reorder", outcome.projectId, id, outcome.title);
    return this.require(id);
  }

  /** Permanent. Only an archived task can go, so a delete is always two steps. */
  remove(id: number): void {
    const cur = this.requireRow(id);
    if (cur.archived_at === null) throw new TaskConflictError(`task T${id} must be archived before it is deleted`);
    this.db.prepare(`DELETE FROM tasks WHERE id = ?`).run(id);
    this.afterChange("delete", cur.project_id, id, cur.title);
  }

  // ─── Internals ───

  private dbRow(id: number): TaskDbRow | null {
    const row = this.db.prepare(`${SELECT_TASK} WHERE t.id = ?`).get(id) as TaskDbRow | undefined;
    return row ?? null;
  }

  private requireRow(id: number): TaskDbRow {
    const row = this.dbRow(id);
    if (!row) throw new TaskNotFoundError(id);
    return row;
  }

  private require(id: number): Task {
    return this.toTask(this.requireRow(id));
  }

  private toTask(r: TaskDbRow): Task {
    const links = this.db
      .prepare(`SELECT id, url, label FROM task_links WHERE task_id = ? ORDER BY id`)
      .all(r.id) as TaskLink[];
    return {
      ...toRow(r),
      project: r.project_name,
      description: r.description,
      session_id: r.session_id,
      links,
      created_by: r.created_by,
      created_at: r.created_at,
    };
  }

  private insertLinks(taskId: number, links: { url: string; label: string | null }[], now: string): void {
    const insert = this.db.prepare(`INSERT INTO task_links (task_id, url, label, created_at) VALUES (?, ?, ?, ?)`);
    for (const link of links) insert.run(taskId, link.url, link.label, now);
    const { n } = this.db.prepare(`SELECT COUNT(*) AS n FROM task_links WHERE task_id = ?`).get(taskId) as {
      n: number;
    };
    if (n > LINKS_MAX) throw new Error(`a task can have at most ${LINKS_MAX} links`);
  }

  /** Put one task into its status's order and renumber that status from 1.
   *  Other tasks keep their version and updated_at. */
  private place(
    id: number,
    projectId: number,
    status: TaskStatus,
    where: TaskPlacement | { beforeId: number | null },
  ): void {
    const ids = (
      this.db
        .prepare(
          `SELECT id FROM tasks
           WHERE project_id = ? AND status = ? AND archived_at IS NULL AND id <> ?
           ORDER BY position, id`,
        )
        .all(projectId, status, id) as { id: number }[]
    ).map((r) => r.id);
    let index = ids.length;
    if (where === "top") {
      index = 0;
    } else if (where !== "bottom" && where.beforeId != null) {
      const at = ids.indexOf(where.beforeId);
      if (at >= 0) index = at;
    }
    ids.splice(index, 0, id);
    const update = this.db.prepare(`UPDATE tasks SET position = ? WHERE id = ?`);
    ids.forEach((taskId, i) => update.run(i + 1, taskId));
  }

  private afterChange(action: ActivityAction, projectId: number, taskId: number, title: string): void {
    try {
      this.activityLog.record({
        action,
        target: "board_task",
        project_id: projectId,
        task_id: taskId,
        task_title: title,
      });
    } catch {
      // Never let audit logging take down a mutation.
    }
    emitEvent({ type: "task-changed", project_id: projectId, task_id: taskId });
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/tasks.test.ts test/calendar.test.ts && npx tsc -p . --noEmit`
Expected: PASS, and no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/store/tasks.ts src/store/calendar.ts src/lib/events.ts test/tasks.test.ts
git commit -m "feat: add TaskStore with claims, board order and validation"
```

---

### Task 3: Keep assets and projects safe when tasks exist

**Files:**
- Modify: `src/store/orphanGc.ts`
- Modify: `src/store/knowledge.ts`
- Modify: `test/tools.test.ts` (inside the existing orphan GC `describe`)
- Create: `test/tasks-lifecycle.test.ts`

**Interfaces:**
- Consumes: `TaskStore` from Task 2.
- Produces: `ProjectHasTasksError` exported from `src/store/knowledge.ts`, with `count: number`. `sweepOrphanedAssets` keeps its signature and now also counts task descriptions.

- [ ] **Step 1: Write the failing tests**

Create `test/tasks-lifecycle.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../src/store/db.js";
import { ActivityLogStore } from "../src/store/activityLog.js";
import { FileStore } from "../src/store/files.js";
import { ImageStore } from "../src/store/images.js";
import { KnowledgeStore, ProjectHasTasksError } from "../src/store/knowledge.js";
import { sweepOrphanedAssets } from "../src/store/orphanGc.js";
import { PageStore } from "../src/store/pages.js";
import { PermissionStore } from "../src/store/permissions.js";
import { TaskStore } from "../src/store/tasks.js";
import { UserStore } from "../src/store/users.js";

describe("tasks and the things around them", () => {
  let dir: string;
  let db: ReturnType<typeof openDb>;
  let knowledge: KnowledgeStore;
  let tasks: TaskStore;
  let projectId: number;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "wikikai-tasks-"));
    db = openDb(":memory:");
    knowledge = new KnowledgeStore(db);
    knowledge.registerProject("alpha");
    tasks = new TaskStore(db, new ActivityLogStore(db));
    projectId = tasks.ensureProject("alpha").id;
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  describe("attachments", () => {
    it("keeps a file used only by a task, archived or not, until the task is deleted", () => {
      const pages = new PageStore(db, path.join(dir, "items"));
      const images = new ImageStore(db, path.join(dir, "images"));
      const files = new FileStore(db, path.join(dir, "files"));
      const meta = files.add(Buffer.from("report"), "report.txt", "text/plain");
      const sweep = () => sweepOrphanedAssets({ db, pages, images, files, graceMs: 0 });

      const t = tasks.add(projectId, {
        title: "T",
        description: `[report](/file/${meta.hash}.${meta.ext})`,
      });
      expect(sweep().removed_files).toBe(0);
      expect(files.get(meta.hash)).not.toBeNull();

      tasks.edit(t.id, { expected_version: 1, archived: true });
      expect(sweep().removed_files).toBe(0);
      expect(files.get(meta.hash)).not.toBeNull();

      tasks.remove(t.id);
      expect(sweep().removed_files).toBe(1);
      expect(files.get(meta.hash)).toBeNull();
    });
  });

  describe("unregistering a project", () => {
    it("refuses while tasks exist, counting archived ones, and keeps everything", () => {
      const t = tasks.add(projectId, { title: "T" });
      tasks.add(projectId, { title: "U" });
      tasks.edit(t.id, { expected_version: 1, archived: true });
      expect(() => knowledge.unregisterProject("alpha")).toThrow(ProjectHasTasksError);
      expect(() => knowledge.unregisterProject("alpha")).toThrow(/2 task/);
      expect(tasks.getProject(projectId)?.name).toBe("alpha");
      expect(tasks.list(projectId, { includeArchived: true })).toHaveLength(2);
    });

    it("has the foreign key as a backstop", () => {
      tasks.add(projectId, { title: "T" });
      expect(() => db.prepare("DELETE FROM projects WHERE id = ?").run(projectId)).toThrow(/FOREIGN KEY/);
    });

    it("still works once the tasks are gone, or for a project with none", () => {
      const t = tasks.add(projectId, { title: "T" });
      tasks.edit(t.id, { expected_version: 1, archived: true });
      tasks.remove(t.id);
      expect(knowledge.unregisterProject("alpha")).toEqual({ name: "alpha", removed: true });
    });
  });

  describe("renaming a project", () => {
    it("keeps its tasks, and access follows the new name", () => {
      const users = new UserStore(db);
      const admin = users.create({ email: "a@x.test", password: "x", display_name: "Admin", is_admin: true });
      const alice = users.create({ email: "b@x.test", password: "x", display_name: "Alice" });
      new PermissionStore(db).replaceForUser(alice.id, [{ project: "alpha", level: "edit" }], admin.id);
      const t = tasks.add(projectId, { title: "T", assignee_id: alice.id });

      knowledge.renameProject("alpha", "gamma");

      expect(tasks.get(t.id)).toMatchObject({ project: "gamma", project_id: projectId });
      expect(tasks.listMembers("gamma").map((m) => m.display_name)).toContain("Alice");
      expect(tasks.edit(t.id, { expected_version: 1, assignee_id: alice.id }).assignee?.id).toBe(alice.id);
    });
  });
});
```

Add to `test/tools.test.ts`:

At the top, with the other imports:

```ts
import { TaskStore } from "../src/store/tasks.js";
```

Inside the orphan GC `describe`, directly after the test named `an edit that drops the only reference stamps the image but keeps the bytes`:

```ts
    it("an image used only by a task description survives the sweep until the task is deleted", async () => {
      knowledge.registerProject("p");
      const tasks = new TaskStore(db, new ActivityLogStore(db));
      const img = await addPng("task-only");
      const t = tasks.add(tasks.ensureProject("p").id, {
        title: "T",
        description: `![shot](${img.src})`,
      });

      ageOrphan(img.hash, 30);
      sweep();
      expect(images.get(img.hash)).not.toBeNull();
      expect(onDisk(img)).toBe(true);
      expect(orphanedAt(img.hash)).toBeNull();

      tasks.edit(t.id, { expected_version: 1, archived: true });
      ageOrphan(img.hash, 30);
      sweep();
      expect(images.get(img.hash)).not.toBeNull();

      tasks.remove(t.id);
      sweep();
      ageOrphan(img.hash, 30);
      sweep();
      expect(images.get(img.hash)).toBeNull();
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/tasks-lifecycle.test.ts test/tools.test.ts -t "task"`
Expected: FAIL. `ProjectHasTasksError` is undefined, and the image is deleted while a task still references it.

- [ ] **Step 3: Count task descriptions as live references**

In `src/store/orphanGc.ts`, replace the two type imports:

```ts
import { extractImageHashesSet, type ImageStore } from "./images.js";
import { extractFileHashesSet, type FileStore } from "./files.js";
```

Add, directly above `sweepOrphanedAssets`:

```ts
/**
 * Asset hashes mentioned in task descriptions. Read through the sweep's own
 * `db`, so no caller can forget to count tasks. Archived tasks count: one
 * unarchive brings the description back.
 */
function taskDescriptionRefs(db: Db, extract: (content: string) => Set<string>): Set<string> {
  const out = new Set<string>();
  const rows = db
    .prepare(`SELECT description FROM tasks WHERE description <> ''`)
    .iterate() as IterableIterator<{ description: string }>;
  for (const row of rows) {
    for (const hash of extract(row.description)) out.add(hash);
  }
  return out;
}
```

In `sweepOrphanedAssets`, change the two `liveRefs` lines:

```ts
    liveRefs: new Set([
      ...pages.allReferencedImageHashes(),
      ...taskDescriptionRefs(db, extractImageHashesSet),
    ]),
```

```ts
        liveRefs: new Set([
          ...pages.allReferencedFileHashes(),
          ...taskDescriptionRefs(db, extractFileHashesSet),
        ]),
```

Extend the doc comment on `SweepOptions.liveRefs`:

```ts
  /** Hashes referenced by live page content and task descriptions (lowercased). */
```

- [ ] **Step 4: Refuse to unregister a project with tasks**

In `src/store/knowledge.ts`, add above `export class KnowledgeStore`:

```ts
/** Unregistering keeps a project's documents, so it must not silently take its
 *  tasks. Checked up front because a raw constraint error says nothing useful. */
export class ProjectHasTasksError extends Error {
  constructor(
    name: string,
    public readonly count: number,
  ) {
    super(`project "${name}" has ${count} task(s), archived ones included. Delete them first.`);
    this.name = "ProjectHasTasksError";
  }
}
```

Replace `unregisterProject`:

```ts
  /** Drop a project from the registry. Does NOT delete any knowledge —
   *  the project name simply stops appearing on its own once no knowledge
   *  references it. Refused while the project has tasks. */
  unregisterProject(name: string): { name: string; removed: boolean } {
    const trimmed = name.trim();
    const { n } = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM tasks t JOIN projects p ON p.id = t.project_id WHERE p.name = ?`,
      )
      .get(trimmed) as { n: number };
    if (n > 0) throw new ProjectHasTasksError(trimmed, n);
    const r = this.db.prepare(`DELETE FROM projects WHERE name = ?`).run(trimmed);
    return { name: trimmed, removed: r.changes > 0 };
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/tasks-lifecycle.test.ts test/tools.test.ts test/files.test.ts test/knowledge.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/store/orphanGc.ts src/store/knowledge.ts test/tasks-lifecycle.test.ts test/tools.test.ts
git commit -m "fix: keep task assets through GC and block removing projects with tasks"
```

---

### Task 4: MCP tools

**Files:**
- Modify: `src/mcp/handlers.ts`
- Modify: `src/mcp/server.ts`
- Create: `test/tasks-tools.test.ts`
- Modify: `test/mcp-catalog.test.ts`

**Interfaces:**
- Consumes: `TaskStore` and its types from Task 2.
- Produces: tools `add_task`, `list_tasks`, `get_task`, `edit_task`. Schemas `AddTaskSchema`, `ListTasksSchema`, `GetTaskSchema`, `EditTaskSchema`. Types `TaskResult` and `TaskListEntry`. Task URLs have the form `<base>/?calendar=<project_id>&view=board&task=<id>`.

- [ ] **Step 1: Write the failing tests**

Create `test/tasks-tools.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../src/store/db.js";
import { ActivityLogStore } from "../src/store/activityLog.js";
import { ImageStore } from "../src/store/images.js";
import { KnowledgeStore } from "../src/store/knowledge.js";
import { PageStore } from "../src/store/pages.js";
import { PermissionStore } from "../src/store/permissions.js";
import { PromptLogStore } from "../src/store/promptLog.js";
import { UserStore, type User } from "../src/store/users.js";
import { buildToolHandlers, type ToolHandlers } from "../src/mcp/handlers.js";
import { withCallContext } from "../src/lib/callContext.js";

describe("task tools", () => {
  let dir: string;
  let h: ToolHandlers;
  let alice: User;
  let bob: User;
  let carol: User;
  let dave: User;

  const as = <T>(user: User, fn: () => T): T =>
    withCallContext({ source: "mcp", user_id: user.id }, fn);

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "wikikai-task-tools-"));
    const db = openDb(":memory:");
    const knowledge = new KnowledgeStore(db);
    const users = new UserStore(db);
    const permissions = new PermissionStore(db);
    const admin = users.create({ email: "admin@x.test", password: "x", display_name: "Admin", is_admin: true });
    alice = users.create({ email: "alice@x.test", password: "x", display_name: "Alice" });
    bob = users.create({ email: "bob@x.test", password: "x", display_name: "Bob" });
    carol = users.create({ email: "carol@x.test", password: "x", display_name: "Carol" });
    dave = users.create({ email: "dave@x.test", password: "x", display_name: "Dave" });
    knowledge.registerProject("alpha");
    permissions.replaceForUser(alice.id, [{ project: "alpha", level: "edit" }], admin.id);
    permissions.replaceForUser(bob.id, [{ project: "alpha", level: "edit" }], admin.id);
    permissions.replaceForUser(carol.id, [{ project: "alpha", level: "view" }], admin.id);
    h = buildToolHandlers(
      knowledge,
      new PageStore(db, path.join(dir, "items")),
      new ImageStore(db, path.join(dir, "images")),
      new PromptLogStore(db),
      new ActivityLogStore(db),
      { publicBaseUrl: "http://test/" },
      permissions,
      users,
      db,
    );
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("creates a task and returns it in full with a board url", async () => {
    const t = await as(alice, () => h.add_task({ project: "alpha", title: "T", description: "Body", assignee: "me" }));
    expect(t).toMatchObject({
      title: "T",
      description: "Body",
      status: "todo",
      version: 1,
      assignee: { id: alice.id, display_name: "Alice" },
      links: [],
    });
    expect(t.url).toBe(`http://test/?calendar=${t.project_id}&view=board&task=${t.id}`);
  });

  it("runs the whole agent flow", async () => {
    await as(alice, () => h.add_task({ project: "alpha", title: "First", description: "Do this" }));
    await as(alice, () => h.add_task({ project: "alpha", title: "Second" }));

    const { tasks: found } = await as(alice, () => h.list_tasks({ project: "alpha", next: true }));
    expect(found.map((t) => t.title)).toEqual(["First"]);

    const claimed = await as(alice, () =>
      h.edit_task({
        task_id: found[0].id,
        expected_version: found[0].version,
        status: "doing",
        assignee: "me",
        session_id: "session-1",
      }),
    );
    expect(claimed).toMatchObject({ status: "doing", description: "Do this", session_id: "session-1", version: 2 });

    const done = await as(alice, () =>
      h.edit_task({
        task_id: claimed.id,
        expected_version: claimed.version,
        status: "review",
        add_links: [{ url: "https://github.com/org/repo/commit/abc", label: "commit" }],
      }),
    );
    expect(done.status).toBe("review");
    expect(done.links[0]).toMatchObject({ label: "commit" });

    const { tasks: rest } = await as(alice, () => h.list_tasks({ project: "alpha", next: true }));
    expect(rest.map((t) => t.title)).toEqual(["Second"]);
  });

  it("lets only one of two sessions claim a task", async () => {
    const t = await as(alice, () => h.add_task({ project: "alpha", title: "T" }));
    const claim = (user: User) =>
      as(user, () => h.edit_task({ task_id: t.id, expected_version: t.version, status: "doing", assignee: "me" }));
    const results = await Promise.allSettled([claim(alice), claim(bob)]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(rejected.reason)).toContain("STALE");
  });

  it("requires expected_version on edit", async () => {
    const t = await as(alice, () => h.add_task({ project: "alpha", title: "T" }));
    await expect(
      as(alice, () => h.edit_task({ task_id: t.id, title: "X" } as Parameters<ToolHandlers["edit_task"]>[0])),
    ).rejects.toThrow(/expected_version/);
  });

  it("lists compact rows, leaving out done tasks by default", async () => {
    await as(alice, () => h.add_task({ project: "alpha", title: "Open", description: "Body" }));
    await as(alice, () => h.add_task({ project: "alpha", title: "Closed", status: "done" }));
    const { tasks } = await as(alice, () => h.list_tasks({ project: "alpha" }));
    expect(tasks.map((t) => t.title)).toEqual(["Open"]);
    expect(Object.keys(tasks[0]).sort()).toEqual(
      ["assignee", "blocked_reason", "due_date", "id", "labels", "status", "title", "url", "version"].sort(),
    );
    const { tasks: closed } = await as(alice, () => h.list_tasks({ project: "alpha", status: ["done"] }));
    expect(closed.map((t) => t.title)).toEqual(["Closed"]);
  });

  it("filters by assignee and label, and limits", async () => {
    await as(alice, () => h.add_task({ project: "alpha", title: "A", assignee: "bob@x.test", labels: ["api"] }));
    await as(alice, () => h.add_task({ project: "alpha", title: "B" }));
    const byBob = await as(alice, () => h.list_tasks({ project: "alpha", assignee: "Bob" }));
    expect(byBob.tasks.map((t) => t.title)).toEqual(["A"]);
    const byLabel = await as(alice, () => h.list_tasks({ project: "alpha", label: "API" }));
    expect(byLabel.tasks.map((t) => t.title)).toEqual(["A"]);
    const limited = await as(alice, () => h.list_tasks({ project: "alpha", limit: 1 }));
    expect(limited.tasks).toHaveLength(1);
  });

  it("refuses next combined with filters", async () => {
    await expect(as(alice, () => h.list_tasks({ project: "alpha", next: true, limit: 1 }))).rejects.toThrow(/next/);
  });

  it("reads one task in full, and archives through edit_task", async () => {
    const t = await as(alice, () => h.add_task({ project: "alpha", title: "T", description: "Body" }));
    expect((await as(carol, () => h.get_task({ task_id: t.id }))).description).toBe("Body");
    const archived = await as(alice, () => h.edit_task({ task_id: t.id, expected_version: 1, archived: true }));
    expect(archived.archived).toBe(true);
    expect((await as(alice, () => h.list_tasks({ project: "alpha" }))).tasks).toEqual([]);
    const all = await as(alice, () => h.list_tasks({ project: "alpha", include_archived: true }));
    expect(all.tasks).toHaveLength(1);
  });

  it("offers no way to delete a task", () => {
    expect((h as unknown as Record<string, unknown>).delete_task).toBeUndefined();
  });

  it("lets view access read but not write", async () => {
    const t = await as(alice, () => h.add_task({ project: "alpha", title: "T" }));
    expect((await as(carol, () => h.list_tasks({ project: "alpha" }))).tasks).toHaveLength(1);
    await expect(as(carol, () => h.add_task({ project: "alpha", title: "X" }))).rejects.toThrow(/edit not allowed/);
    await expect(
      as(carol, () => h.edit_task({ task_id: t.id, expected_version: 1, title: "X" })),
    ).rejects.toThrow(/edit not allowed/);
  });

  it("refuses non-members, including by task id", async () => {
    const t = await as(alice, () => h.add_task({ project: "alpha", title: "T" }));
    await expect(as(dave, () => h.list_tasks({ project: "alpha" }))).rejects.toThrow(/no access/);
    await expect(as(dave, () => h.get_task({ task_id: t.id }))).rejects.toThrow(/no access/);
    await expect(
      as(dave, () => h.edit_task({ task_id: t.id, expected_version: 1, title: "X" })),
    ).rejects.toThrow(/no access/);
  });

  it("explains an unknown project and an unknown task", async () => {
    const admin = { id: 1 } as User;
    await expect(as(admin, () => h.add_task({ project: "typo", title: "T" }))).rejects.toThrow(/project 'typo' not found/);
    await expect(as(admin, () => h.get_task({ task_id: 9999 }))).rejects.toThrow(/not found/);
    await expect(
      as(admin, () => h.edit_task({ task_id: 9999, expected_version: 1, title: "X" })),
    ).rejects.toThrow(/not found/);
  });

  it("never returns an email", async () => {
    const t = await as(alice, () => h.add_task({ project: "alpha", title: "T", assignee: "bob@x.test" }));
    const listed = await as(alice, () => h.list_tasks({ project: "alpha" }));
    const read = await as(alice, () => h.get_task({ task_id: t.id }));
    expect(JSON.stringify([t, listed, read])).not.toContain("@x.test");
    await expect(as(alice, () => h.add_task({ project: "alpha", title: "T", assignee: "nobody" }))).rejects.toSatisfy(
      (e: Error) => e.message.includes("Bob") && !e.message.includes("@x.test"),
    );
  });

  it("clears the assignee with null", async () => {
    const t = await as(alice, () => h.add_task({ project: "alpha", title: "T", assignee: "me" }));
    const cleared = await as(alice, () => h.edit_task({ task_id: t.id, expected_version: 1, assignee: null }));
    expect(cleared.assignee).toBeNull();
  });
});
```

Add to `test/mcp-catalog.test.ts`, inside the `describe`:

```ts
  it("exposes the task tools, with no way to delete", async () => {
    const names = (await listTools()).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["add_task", "list_tasks", "get_task", "edit_task"]));
    expect(names).not.toContain("delete_task");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/tasks-tools.test.ts test/mcp-catalog.test.ts`
Expected: FAIL with `h.add_task is not a function`, and missing tool names.

- [ ] **Step 3: Add schemas and types to `handlers.ts`**

Add to the imports in `src/mcp/handlers.ts`:

```ts
import {
  TASK_STATUSES,
  TaskStore,
  type Task,
  type TaskMember,
  type TaskRow,
  type TaskStatus,
} from "../store/tasks.js";
```

Add directly above `export type ToolInputs = {`:

```ts
// ─── Project tasks ───

const TASK_ASSIGNEE_NOTE = '"me", or a project member\'s display name or email.';
const TASK_DATE_NOTE = "YYYY-MM-DD.";

const TaskLinkSchema = z.object({
  url: z.string().max(2000).describe("http(s):// or a relative path such as /&3/#12."),
  label: z.string().max(200).optional(),
});

const TaskPlacementSchema = z
  .enum(["top", "bottom"])
  .optional()
  .describe("Place within its status. The board order is the work queue.");

export const AddTaskSchema = z.object({
  project: z.string().min(1).max(100),
  title: z.string().min(1).max(300),
  description: z.string().max(20000).optional().describe("Markdown. Keep long material on a wiki page and link it."),
  status: z.enum(TASK_STATUSES).optional().describe("Default todo."),
  assignee: z.string().max(200).optional().describe(TASK_ASSIGNEE_NOTE),
  start_date: z.string().optional().describe(TASK_DATE_NOTE),
  due_date: z.string().optional().describe(TASK_DATE_NOTE),
  labels: z.array(z.string().max(50)).max(20).optional(),
  links: z.array(TaskLinkSchema).max(50).optional(),
  session_id: z.string().max(200).optional().describe(SESSION_NOTE),
  position: TaskPlacementSchema,
});

export const ListTasksSchema = z
  .object({
    project: z.string().min(1).max(100),
    status: z.array(z.enum(TASK_STATUSES)).optional().describe("Default todo, doing, review."),
    assignee: z.string().max(200).optional().describe(TASK_ASSIGNEE_NOTE),
    label: z.string().max(50).optional(),
    include_archived: z.boolean().optional(),
    limit: z.number().int().min(1).max(500).optional().describe("Default 100."),
    next: z.boolean().optional().describe("Return only the next task to claim. Takes no other filter."),
  })
  .refine(
    (v) =>
      !v.next ||
      (v.status === undefined &&
        v.assignee === undefined &&
        v.label === undefined &&
        v.include_archived === undefined &&
        v.limit === undefined),
    { message: "next cannot be combined with other filters" },
  );

export const GetTaskSchema = z.object({
  task_id: z.number().int().positive(),
});

export const EditTaskSchema = z.object({
  task_id: z.number().int().positive(),
  expected_version: z
    .number()
    .int()
    .positive()
    .describe("Task `version` from a previous task call. The call fails (STALE) if the task changed since."),
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(20000).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  assignee: z.string().max(200).nullable().optional().describe(`${TASK_ASSIGNEE_NOTE} null clears.`),
  start_date: z.string().nullable().optional().describe(`${TASK_DATE_NOTE} null clears.`),
  due_date: z.string().nullable().optional().describe(`${TASK_DATE_NOTE} null clears.`),
  labels: z.array(z.string().max(50)).max(20).optional().describe("Replaces the whole list."),
  session_id: z.string().max(200).nullable().optional().describe(SESSION_NOTE),
  blocked_reason: z
    .string()
    .max(1000)
    .nullable()
    .optional()
    .describe("Why work stopped. The next task skips blocked tasks. null clears."),
  add_links: z.array(TaskLinkSchema).max(50).optional(),
  remove_link_ids: z.array(z.number().int().positive()).max(50).optional(),
  archived: z.boolean().optional(),
  position: TaskPlacementSchema,
});

export type TaskResult = Task & { url: string };

export interface TaskListEntry {
  id: number;
  title: string;
  status: TaskStatus;
  assignee: TaskMember | null;
  due_date: string | null;
  labels: string[];
  blocked_reason: string | null;
  version: number;
  url: string;
}

function taskUrl(ctx: HandlerContext, projectId: number, taskId: number): string {
  const base = ctx.publicBaseUrl.replace(/\/$/, "");
  return `${base}/?calendar=${projectId}&view=board&task=${taskId}`;
}

const DEFAULT_LIST_STATUSES: TaskStatus[] = ["todo", "doing", "review"];
const DEFAULT_LIST_LIMIT = 100;

```

In `ToolInputs`, after `toggle_task`:

```ts
  add_task: z.infer<typeof AddTaskSchema>;
  list_tasks: z.infer<typeof ListTasksSchema>;
  get_task: z.infer<typeof GetTaskSchema>;
  edit_task: z.infer<typeof EditTaskSchema>;
```

At the end of `ToolHandlers`, after the `toggle_task` entry:

```ts
  add_task(input: ToolInputs["add_task"]): Promise<TaskResult>;
  list_tasks(input: ToolInputs["list_tasks"]): Promise<{ tasks: TaskListEntry[] }>;
  get_task(input: ToolInputs["get_task"]): Promise<TaskResult>;
  edit_task(input: ToolInputs["edit_task"]): Promise<TaskResult>;
```

- [ ] **Step 4: Add the handlers**

In `buildToolHandlers`, directly after `const aclEnabled = ctx.projectAclEnabled ?? true;`:

```ts
  const tasks = new TaskStore(db, activityLog, { aclEnabled });
  const callerId = (): number | null => getCallContext().user_id ?? null;
  const withTaskUrl = (task: Task): TaskResult => ({
    ...task,
    url: taskUrl(ctx, task.project_id, task.id),
  });
  const compactTask = (row: TaskRow): TaskListEntry => ({
    id: row.id,
    title: row.title,
    status: row.status,
    assignee: row.assignee,
    due_date: row.due_date,
    labels: row.labels,
    blocked_reason: row.blocked_reason,
    version: row.version,
    url: taskUrl(ctx, row.project_id, row.id),
  });
```

Add after the `toggle_task` method, inside the returned object:

```ts
    async add_task(input) {
      const parsed = AddTaskSchema.parse(input);
      gateEditByProject(parsed.project);
      const project = tasks.ensureProject(parsed.project);
      const { project: _project, assignee, ...fields } = parsed;
      return withTaskUrl(
        tasks.add(project.id, {
          ...fields,
          assignee_id: assignee === undefined ? undefined : tasks.resolveAssignee(project.name, assignee, callerId()),
        }),
      );
    },

    async list_tasks(input) {
      const parsed = ListTasksSchema.parse(input);
      gateReadByProject(parsed.project);
      const project = tasks.ensureProject(parsed.project);
      if (parsed.next) {
        const next = tasks.next(project.id, callerId());
        return { tasks: next ? [compactTask(next)] : [] };
      }
      const rows = tasks.list(project.id, {
        statuses: parsed.status ?? DEFAULT_LIST_STATUSES,
        assigneeId:
          parsed.assignee === undefined ? undefined : tasks.resolveAssignee(project.name, parsed.assignee, callerId()),
        label: parsed.label,
        includeArchived: parsed.include_archived,
        limit: parsed.limit ?? DEFAULT_LIST_LIMIT,
      });
      return { tasks: rows.map(compactTask) };
    },

    async get_task(input) {
      const parsed = GetTaskSchema.parse(input);
      const task = tasks.get(parsed.task_id);
      if (!task) throw new Error(`task T${parsed.task_id} not found`);
      gateReadByProject(task.project);
      return withTaskUrl(task);
    },

    async edit_task(input) {
      const parsed = EditTaskSchema.parse(input);
      const current = tasks.get(parsed.task_id);
      if (!current) throw new Error(`task T${parsed.task_id} not found`);
      gateEditByProject(current.project);
      const { task_id, assignee, ...fields } = parsed;
      return withTaskUrl(
        tasks.edit(task_id, {
          ...fields,
          ...(assignee === undefined
            ? {}
            : { assignee_id: assignee === null ? null : tasks.resolveAssignee(current.project, assignee, callerId()) }),
        }),
      );
    },
```

- [ ] **Step 5: Register the tools**

In `src/mcp/server.ts`, add to the import from `./handlers.js`, keeping alphabetical order: `AddTaskSchema`, `EditTaskSchema`, `GetTaskSchema`, `ListTasksSchema`.

Append this sentence to the end of the `toggle_task` description string, inside its closing quote:

```text
 For tracked work on a project's board, use the task tools.
```

Add directly above `// ─── Images and files ───`:

```ts
  // ─── Project tasks ───
  server.registerTool(
    "add_task",
    {
      title: "Create task",
      description:
        "Create a task on a project's board: tracked work with a status and an assignee. For a checkbox inside a page, use toggle_task. Returns the full task, with `version` and `url`.",
      inputSchema: shapeOf(AddTaskSchema),
    },
    async (input) => jsonContent(await handlers.add_task(input)),
  );

  server.registerTool(
    "list_tasks",
    {
      title: "List tasks",
      description:
        "A project's board tasks in board order, as compact rows without description or links. To pick up work, pass `next: true`, then claim the result with edit_task: its `version`, status `doing`, assignee `me` and your `session_id`. STALE means another session took it, so list again.",
      inputSchema: shapeOf(ListTasksSchema),
    },
    async (input) => jsonContent(await handlers.list_tasks(input)),
  );

  server.registerTool(
    "get_task",
    {
      title: "Read task",
      description: "One board task in full, with its description and links.",
      inputSchema: shapeOf(GetTaskSchema),
    },
    async (input) => jsonContent(await handlers.get_task(input)),
  );

  server.registerTool(
    "edit_task",
    {
      title: "Edit task",
      description:
        "Change a board task: any field, its status, links, or `archived`. Tasks cannot be deleted here. When work is finished, set status `review` and link the commit or document; set `done` only when the user says so. If stuck, set `blocked_reason` and stop. Returns the full task with its new `version`.",
      inputSchema: shapeOf(EditTaskSchema),
    },
    async (input) => jsonContent(await handlers.edit_task(input)),
  );

```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run test/tasks-tools.test.ts test/mcp-catalog.test.ts test/tools.test.ts && npx tsc -p . --noEmit`
Expected: PASS. If the size budget fails, shorten the new descriptions and `.describe()` strings. Do not raise the budget.

- [ ] **Step 7: Commit**

```bash
git add src/mcp/handlers.ts src/mcp/server.ts test/tasks-tools.test.ts test/mcp-catalog.test.ts
git commit -m "feat: add MCP tools for project tasks"
```

---

### Task 5: REST routes

**Files:**
- Create: `src/web/taskRoutes.ts`
- Modify: `src/web/app.ts`
- Modify: `src/server.ts`
- Create: `test/tasks-web.test.ts`

**Interfaces:**
- Consumes: `TaskStore` and errors from Task 2, `ProjectHasTasksError` from Task 3.
- Produces: `attachTaskRoutes(app, { tasks, permissions, aclEnabled })`, `BuildAppOptions.tasks?: TaskStore`, and these endpoints:
  - `GET /api/projects/:id/tasks?include_archived=1` returns `{ project, can_edit, tasks }`
  - `POST /api/projects/:id/tasks` returns 201 with a full task
  - `GET /api/projects/:id/members` returns `{ members }`
  - `GET /api/tasks/:id`, `PATCH /api/tasks/:id`, `POST /api/tasks/:id/move` return a full task
  - `DELETE /api/tasks/:id` returns `{ deleted: true }`
  - `GET /api/tasks/:id/rendered` returns HTML

- [ ] **Step 1: Write the failing tests**

Create `test/tasks-web.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import request from "supertest";
import { openDb } from "../src/store/db.js";
import { ActivityLogStore } from "../src/store/activityLog.js";
import { ImageStore } from "../src/store/images.js";
import { KnowledgeStore } from "../src/store/knowledge.js";
import { PageStore } from "../src/store/pages.js";
import { PermissionStore } from "../src/store/permissions.js";
import { PromptLogStore } from "../src/store/promptLog.js";
import { ShareUserStore } from "../src/store/shareUsers.js";
import { TaskStore } from "../src/store/tasks.js";
import { SessionStore, UserStore } from "../src/store/users.js";
import { buildToolHandlers } from "../src/mcp/handlers.js";
import { buildApp } from "../src/web/app.js";

describe("task routes", () => {
  let dir: string;
  let server: Server;
  let tasks: TaskStore;
  let projectId: number;
  let adminCookie: string;
  let aliceCookie: string;
  let carolCookie: string;
  let daveCookie: string;

  const api = () => request(server);

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "wikikai-task-web-"));
    const db = openDb(":memory:");
    const knowledge = new KnowledgeStore(db);
    const pages = new PageStore(db, path.join(dir, "items"));
    const images = new ImageStore(db, path.join(dir, "images"));
    const promptLog = new PromptLogStore(db);
    const activityLog = new ActivityLogStore(db);
    const users = new UserStore(db);
    const sessions = new SessionStore(db, users);
    const permissions = new PermissionStore(db);
    const handlers = buildToolHandlers(
      knowledge,
      pages,
      images,
      promptLog,
      activityLog,
      { publicBaseUrl: "http://test" },
      permissions,
      users,
      db,
    );
    tasks = new TaskStore(db, activityLog);
    const app = buildApp({
      knowledge,
      pages,
      images,
      promptLog,
      activityLog,
      users,
      sessions,
      permissions,
      shareUsers: new ShareUserStore(db),
      handlers,
      publicBaseUrl: "http://test",
      webAuth: true,
      tasks,
    });
    server = app.listen(0);

    const admin = users.create({ email: "admin@x.test", password: "pw", display_name: "Admin", is_admin: true });
    const alice = users.create({ email: "alice@x.test", password: "pw", display_name: "Alice" });
    const carol = users.create({ email: "carol@x.test", password: "pw", display_name: "Carol" });
    users.create({ email: "dave@x.test", password: "pw", display_name: "Dave" });
    knowledge.registerProject("alpha");
    permissions.replaceForUser(alice.id, [{ project: "alpha", level: "edit" }], admin.id);
    permissions.replaceForUser(carol.id, [{ project: "alpha", level: "view" }], admin.id);
    projectId = tasks.ensureProject("alpha").id;

    const login = async (email: string): Promise<string> => {
      const res = await api().post("/api/auth/login").send({ email, password: "pw" });
      return res.headers["set-cookie"][0];
    };
    adminCookie = await login("admin@x.test");
    aliceCookie = await login("alice@x.test");
    carolCookie = await login("carol@x.test");
    daveCookie = await login("dave@x.test");
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("refuses anonymous callers", async () => {
    expect((await api().get(`/api/projects/${projectId}/tasks`)).status).toBe(401);
    expect((await api().post(`/api/projects/${projectId}/tasks`).send({ title: "T" })).status).toBe(401);
  });

  it("lists rows for the views, with can_edit for the caller", async () => {
    tasks.add(projectId, { title: "T", description: "Body", start_date: "2026-11-01" });
    const edit = await api().get(`/api/projects/${projectId}/tasks`).set("Cookie", aliceCookie);
    expect(edit.status).toBe(200);
    expect(edit.body.project).toEqual({ id: projectId, name: "alpha" });
    expect(edit.body.can_edit).toBe(true);
    expect(edit.body.tasks[0]).toMatchObject({ title: "T", start_date: "2026-11-01", position: 1 });
    expect(edit.body.tasks[0].updated_at).toEqual(expect.any(String));
    expect(edit.body.tasks[0]).not.toHaveProperty("description");
    const view = await api().get(`/api/projects/${projectId}/tasks`).set("Cookie", carolCookie);
    expect(view.body.can_edit).toBe(false);
    const admin = await api().get(`/api/projects/${projectId}/tasks`).set("Cookie", adminCookie);
    expect(admin.body.can_edit).toBe(true);
  });

  it("includes done tasks, and archived ones only on request", async () => {
    tasks.add(projectId, { title: "Done", status: "done" });
    const gone = tasks.add(projectId, { title: "Gone" });
    tasks.edit(gone.id, { expected_version: 1, archived: true });
    const plain = await api().get(`/api/projects/${projectId}/tasks`).set("Cookie", aliceCookie);
    expect(plain.body.tasks.map((t: { title: string }) => t.title)).toEqual(["Done"]);
    const all = await api()
      .get(`/api/projects/${projectId}/tasks`)
      .query({ include_archived: 1 })
      .set("Cookie", aliceCookie);
    expect(all.body.tasks).toHaveLength(2);
  });

  it("answers 404 for an unknown project or task", async () => {
    expect((await api().get("/api/projects/9999/tasks").set("Cookie", adminCookie)).status).toBe(404);
    expect((await api().get("/api/projects/9999/members").set("Cookie", adminCookie)).status).toBe(404);
    expect((await api().post("/api/projects/9999/tasks").set("Cookie", adminCookie).send({ title: "T" })).status).toBe(404);
    expect((await api().get("/api/tasks/9999").set("Cookie", adminCookie)).status).toBe(404);
    expect((await api().get("/api/tasks/9999/rendered").set("Cookie", adminCookie)).status).toBe(404);
    expect(
      (await api().patch("/api/tasks/9999").set("Cookie", adminCookie).send({ expected_version: 1, title: "X" })).status,
    ).toBe(404);
  });

  it("creates a task with edit access only", async () => {
    const made = await api().post(`/api/projects/${projectId}/tasks`).set("Cookie", aliceCookie).send({ title: "T" });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ title: "T", status: "todo", version: 1 });
    expect((await api().post(`/api/projects/${projectId}/tasks`).set("Cookie", carolCookie).send({ title: "X" })).status).toBe(403);
    expect((await api().post(`/api/projects/${projectId}/tasks`).set("Cookie", daveCookie).send({ title: "X" })).status).toBe(403);
  });

  it("refuses non-members by task id", async () => {
    const t = tasks.add(projectId, { title: "T" });
    expect((await api().get(`/api/tasks/${t.id}`).set("Cookie", daveCookie)).status).toBe(403);
    expect((await api().get(`/api/tasks/${t.id}/rendered`).set("Cookie", daveCookie)).status).toBe(403);
    expect(
      (await api().patch(`/api/tasks/${t.id}`).set("Cookie", daveCookie).send({ expected_version: 1, title: "X" })).status,
    ).toBe(403);
    expect(
      (await api().post(`/api/tasks/${t.id}/move`).set("Cookie", carolCookie).send({ status: "doing", before_id: null, expected_version: 1 })).status,
    ).toBe(403);
  });

  it("answers 409 with the current version for a stale edit", async () => {
    const t = tasks.add(projectId, { title: "T" });
    tasks.edit(t.id, { expected_version: 1, title: "Changed" });
    const res = await api().patch(`/api/tasks/${t.id}`).set("Cookie", aliceCookie).send({ expected_version: 1, title: "Mine" });
    expect(res.status).toBe(409);
    expect(res.body.current_version).toBe(2);
    expect(res.body.error).toContain("STALE");
  });

  it("requires expected_version on PATCH", async () => {
    const t = tasks.add(projectId, { title: "T" });
    expect((await api().patch(`/api/tasks/${t.id}`).set("Cookie", aliceCookie).send({ title: "X" })).status).toBe(400);
  });

  it("moves a task, answering 409 only when the status change is stale", async () => {
    const a = tasks.add(projectId, { title: "A" });
    const b = tasks.add(projectId, { title: "B" });
    const reorder = await api()
      .post(`/api/tasks/${b.id}/move`)
      .set("Cookie", aliceCookie)
      .send({ status: "todo", before_id: a.id, expected_version: 999 });
    expect(reorder.status).toBe(200);
    expect(reorder.body.position).toBe(1);
    const stale = await api()
      .post(`/api/tasks/${a.id}/move`)
      .set("Cookie", aliceCookie)
      .send({ status: "doing", before_id: null, expected_version: 999 });
    expect(stale.status).toBe(409);
  });

  it.each(["javascript:alert(1)", "//evil.test"])("refuses the link %j", async (url) => {
    const res = await api()
      .post(`/api/projects/${projectId}/tasks`)
      .set("Cookie", aliceCookie)
      .send({ title: "T", links: [{ url }] });
    expect(res.status).toBe(400);
  });

  it("lists assignable members by id and display name only", async () => {
    const res = await api().get(`/api/projects/${projectId}/members`).set("Cookie", carolCookie);
    expect(res.status).toBe(200);
    expect(res.body.members.map((m: { display_name: string }) => m.display_name)).toEqual(["Admin", "Alice"]);
    expect(Object.keys(res.body.members[0]).sort()).toEqual(["display_name", "id"]);
    expect(JSON.stringify(res.body)).not.toContain("@x.test");
    expect((await api().get(`/api/projects/${projectId}/members`).set("Cookie", daveCookie)).status).toBe(403);
  });

  it("renders the description with the no-transform header", async () => {
    const t = tasks.add(projectId, { title: "T", description: "**bold**" });
    const res = await api().get(`/api/tasks/${t.id}/rendered`).set("Cookie", carolCookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain("<strong>bold</strong>");
    expect(res.headers["cache-control"]).toContain("no-transform");
  });

  it("lets only an admin delete, and only an archived task", async () => {
    const t = tasks.add(projectId, { title: "T" });
    expect((await api().delete(`/api/tasks/${t.id}`).set("Cookie", aliceCookie)).status).toBe(403);
    expect((await api().delete(`/api/tasks/${t.id}`).set("Cookie", adminCookie)).status).toBe(409);
    tasks.edit(t.id, { expected_version: 1, archived: true });
    expect((await api().delete(`/api/tasks/${t.id}`).set("Cookie", adminCookie)).status).toBe(200);
    expect(tasks.get(t.id)).toBeNull();
  });

  it("answers 409 when unregistering a project that has tasks", async () => {
    tasks.add(projectId, { title: "T" });
    const res = await api().delete("/api/projects/alpha").set("Cookie", adminCookie);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/1 task/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/tasks-web.test.ts`
Expected: FAIL with 404s from the missing routes.

- [ ] **Step 3: Write the routes**

Create `src/web/taskRoutes.ts`:

```ts
import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import { ForbiddenError, assertProjectAccess, type AccessLevel } from "../lib/permissions.js";
import { renderMarkdown } from "../render/markdown.js";
import type { PermissionStore } from "../store/permissions.js";
import {
  TASK_STATUSES,
  TaskConflictError,
  TaskNotFoundError,
  TaskStaleError,
  type TaskProject,
  type TaskStore,
} from "../store/tasks.js";

export interface TaskRouteOptions {
  tasks: TaskStore;
  permissions: PermissionStore;
  aclEnabled: boolean;
}

// Shapes only. Limits and meaning are enforced by TaskStore, the one place
// that holds the rules for both REST and MCP.
const LinkBody = z.object({ url: z.string(), label: z.string().optional() });

const AddBody = z.object({
  title: z.string(),
  description: z.string().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  assignee_id: z.number().int().positive().nullable().optional(),
  start_date: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  labels: z.array(z.string()).optional(),
  links: z.array(LinkBody).optional(),
  session_id: z.string().nullable().optional(),
  blocked_reason: z.string().nullable().optional(),
  position: z.enum(["top", "bottom"]).optional(),
});

const PatchBody = AddBody.omit({ links: true })
  .partial({ title: true })
  .extend({
    expected_version: z.number().int().positive(),
    add_links: z.array(LinkBody).optional(),
    remove_link_ids: z.array(z.number().int().positive()).optional(),
    archived: z.boolean().optional(),
  });

const MoveBody = z.object({
  status: z.enum(TASK_STATUSES),
  before_id: z.number().int().positive().nullable(),
  expected_version: z.number().int().positive(),
});

function parseId(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error("invalid id");
  return n;
}

export function attachTaskRoutes(app: Express, opts: TaskRouteOptions): void {
  const { tasks, permissions, aclEnabled } = opts;

  const gate = (req: Request, project: string, need: AccessLevel): void => {
    if (!req.user || !aclEnabled || req.user.is_admin) return;
    assertProjectAccess(req.user, project, need, permissions, { enabled: aclEnabled });
  };

  const canEdit = (req: Request, project: string): boolean => {
    if (!req.user || !aclEnabled || req.user.is_admin) return true;
    return permissions.get(req.user.id, project)?.level === "edit";
  };

  /** The project in `:id`, or null after answering 404. */
  const loadProject = (req: Request, res: Response): TaskProject | null => {
    const id = parseId(req.params.id);
    const project = tasks.getProject(id);
    if (!project) res.status(404).json({ error: `project ${id} not found` });
    return project;
  };

  /** The task's project name, for the access check. Throws when it is gone. */
  const projectOfTask = (id: number): string => {
    const task = tasks.get(id);
    if (!task) throw new TaskNotFoundError(id);
    return task.project;
  };

  const fail = (e: unknown, res: Response, next: NextFunction): void => {
    if (e instanceof TaskStaleError) {
      res.status(409).json({ error: e.message, current_version: e.currentVersion });
    } else if (e instanceof TaskConflictError) {
      res.status(409).json({ error: e.message });
    } else if (e instanceof TaskNotFoundError) {
      res.status(404).json({ error: e.message });
    } else {
      next(e);
    }
  };

  app.get("/api/projects/:id/tasks", (req, res, next) => {
    try {
      const project = loadProject(req, res);
      if (!project) return;
      gate(req, project.name, "view");
      res.json({
        project,
        can_edit: canEdit(req, project.name),
        tasks: tasks.list(project.id, { includeArchived: req.query.include_archived === "1" }),
      });
    } catch (e) {
      fail(e, res, next);
    }
  });

  app.post("/api/projects/:id/tasks", (req, res, next) => {
    try {
      const project = loadProject(req, res);
      if (!project) return;
      gate(req, project.name, "edit");
      res.status(201).json(tasks.add(project.id, AddBody.parse(req.body)));
    } catch (e) {
      fail(e, res, next);
    }
  });

  app.get("/api/projects/:id/members", (req, res, next) => {
    try {
      const project = loadProject(req, res);
      if (!project) return;
      gate(req, project.name, "view");
      res.json({ members: tasks.listMembers(project.name) });
    } catch (e) {
      fail(e, res, next);
    }
  });

  app.get("/api/tasks/:id", (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      gate(req, projectOfTask(id), "view");
      res.json(tasks.get(id));
    } catch (e) {
      fail(e, res, next);
    }
  });

  app.get("/api/tasks/:id/rendered", async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      gate(req, projectOfTask(id), "view");
      const html = await renderMarkdown(tasks.get(id)?.description ?? "");
      // Same header as sendPageHtml in app.ts: a proxy must not rewrite the body.
      res.set("Cache-Control", "no-transform").type("text/html").send(html);
    } catch (e) {
      fail(e, res, next);
    }
  });

  app.patch("/api/tasks/:id", (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      gate(req, projectOfTask(id), "edit");
      res.json(tasks.edit(id, PatchBody.parse(req.body)));
    } catch (e) {
      fail(e, res, next);
    }
  });

  app.post("/api/tasks/:id/move", (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      gate(req, projectOfTask(id), "edit");
      res.json(tasks.move(id, MoveBody.parse(req.body)));
    } catch (e) {
      fail(e, res, next);
    }
  });

  app.delete("/api/tasks/:id", (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (aclEnabled && req.user && !req.user.is_admin) throw new ForbiddenError("admin only");
      tasks.remove(id);
      res.json({ deleted: true });
    } catch (e) {
      fail(e, res, next);
    }
  });
}
```

- [ ] **Step 4: Wire the routes in**

In `src/web/app.ts`:

Add imports:

```ts
import { ProjectHasTasksError } from "../store/knowledge.js";
import type { TaskStore } from "../store/tasks.js";
import { attachTaskRoutes } from "./taskRoutes.js";
```

Add to `BuildAppOptions`, after `files?: FileStore;`:

```ts
  /** Project tasks. Optional so lightweight test apps can skip it. */
  tasks?: TaskStore;
```

Directly after `attachAuthRoutes(app, authOpts);`:

```ts
  if (opts.tasks) {
    attachTaskRoutes(app, { tasks: opts.tasks, permissions: opts.permissions, aclEnabled });
  }
```

Replace the `catch` in `app.delete("/api/projects/:name", ...)`:

```ts
    } catch (e) {
      if (e instanceof ProjectHasTasksError) {
        res.status(409).json({ error: e.message });
        return;
      }
      next(e);
    }
```

In `src/server.ts`, add the import:

```ts
import { TaskStore } from "./store/tasks.js";
```

After `const activityLog = new ActivityLogStore(db);`:

```ts
  const tasks = new TaskStore(db, activityLog, { aclEnabled: config.projectAclEnabled });
```

Add `tasks,` to the `buildApp({ ... })` call, after `files,`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/tasks-web.test.ts test/web.test.ts && npx tsc -p . --noEmit`
Expected: PASS, and no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/web/taskRoutes.ts src/web/app.ts src/server.ts test/tasks-web.test.ts
git commit -m "feat: add REST routes for project tasks"
```

---

### Task 6: Client data layer and URL state

**Files:**
- Create: `client/src/lib/taskBoard.ts`
- Modify: `client/src/lib/calendarGrid.ts`
- Modify: `client/src/hooks/useHash.ts`
- Modify: `client/src/store/api.ts`
- Modify: `client/src/hooks/useServerEvents.ts`
- Modify: `client/src/components/ActivityLogModal.tsx`
- Create: `test/task-board.test.ts`
- Modify: `test/calendar.test.ts`

**Interfaces:**
- Consumes: the REST endpoints from Task 5.
- Produces:
  - `taskBoard.ts`: `BOARD_STATUSES`, `BoardStatus`, `DONE_PAGE_SIZE`, `NO_FILTER`, `TaskFilter`, `TaskSortKey`, `columnsOf`, `applyMove`, `resolveDrop`, `filterTasks`, `sortTasks`, `allLabels`, `allAssignees`, `apiErrorMessage`
  - `calendarGrid.ts`: `isOverdue(task, today)`, `tasksByDate(tasks, from, to)`, `CalendarTaskEntry<T>`
  - `useHash.ts`: `ProjectViewKind`, `CalendarLocation` with `view` and `taskId`, `buildProjectViewSearch(search, view)`, `buildTaskSearch(search, taskId)`, `buildTaskLink(search, projectId, taskId)`
  - `api.ts`: types `TaskStatus`, `TaskMember`, `TaskLink`, `TaskRow`, `TaskDetail`, `TaskPatch`, `ProjectTasksResponse`, and hooks `useListProjectTasksQuery`, `useListProjectMembersQuery`, `useGetTaskQuery`, `useGetTaskRenderedQuery`, `useAddTaskMutation`, `useUpdateTaskMutation`, `useMoveTaskMutation`, `useDeleteTaskMutation`

- [ ] **Step 1: Write the failing tests**

Create `test/task-board.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  allAssignees,
  allLabels,
  apiErrorMessage,
  applyMove,
  columnsOf,
  filterTasks,
  NO_FILTER,
  resolveDrop,
  sortTasks,
  type BoardStatus,
} from "../client/src/lib/taskBoard.js";

interface Card {
  id: number;
  title: string;
  status: BoardStatus;
  position: number;
  archived: boolean;
  assignee: { id: number; display_name: string } | null;
  labels: string[];
  due_date: string | null;
  updated_at: string;
}

const card = (id: number, status: BoardStatus, position: number, over: Partial<Card> = {}): Card => ({
  id,
  title: `T${id}`,
  status,
  position,
  archived: false,
  assignee: null,
  labels: [],
  due_date: null,
  updated_at: "2026-01-01T00:00:00.000Z",
  ...over,
});

const ids = (cards: { id: number }[]): number[] => cards.map((c) => c.id);

describe("columnsOf", () => {
  it("groups by status in position order and leaves out archived cards", () => {
    const columns = columnsOf([
      card(1, "todo", 2),
      card(2, "todo", 1),
      card(3, "done", 1),
      card(4, "todo", 3, { archived: true }),
    ]);
    expect(ids(columns.todo)).toEqual([2, 1]);
    expect(ids(columns.done)).toEqual([3]);
    expect(columns.doing).toEqual([]);
  });
});

describe("applyMove", () => {
  const board = [card(1, "todo", 1), card(2, "todo", 2), card(3, "doing", 1)];

  it("moves across columns before a card", () => {
    const next = columnsOf(applyMove(board, 1, "doing", 3));
    expect(ids(next.doing)).toEqual([1, 3]);
    expect(ids(next.todo)).toEqual([2]);
    expect(next.doing.map((c) => c.position)).toEqual([1, 2]);
    expect(next.doing[0].status).toBe("doing");
  });

  it("moves to the bottom with no target or a target that has left", () => {
    expect(ids(columnsOf(applyMove(board, 1, "doing", null)).doing)).toEqual([3, 1]);
    expect(ids(columnsOf(applyMove(board, 1, "doing", 2)).doing)).toEqual([3, 1]);
  });

  it("reorders within a column", () => {
    expect(ids(columnsOf(applyMove(board, 2, "todo", 1)).todo)).toEqual([2, 1]);
  });

  it("ignores an unknown card", () => {
    expect(applyMove(board, 99, "doing", null)).toBe(board);
  });
});

describe("resolveDrop", () => {
  const columns = columnsOf([card(1, "todo", 1), card(2, "todo", 2), card(3, "todo", 3), card(4, "doing", 1)]);

  it("does nothing when dropped on itself", () => {
    expect(resolveDrop(columns, 1, 1)).toBeNull();
  });

  it("goes after the target when moving down a column", () => {
    expect(resolveDrop(columns, 1, 2)).toEqual({ status: "todo", beforeId: 3 });
    expect(resolveDrop(columns, 1, 3)).toEqual({ status: "todo", beforeId: null });
  });

  it("goes before the target when moving up a column", () => {
    expect(resolveDrop(columns, 3, 1)).toEqual({ status: "todo", beforeId: 1 });
  });

  it("goes before the target in another column", () => {
    expect(resolveDrop(columns, 1, 4)).toEqual({ status: "doing", beforeId: 4 });
  });

  it("goes to the bottom when dropped on a column", () => {
    expect(resolveDrop(columns, 1, "column:review")).toEqual({ status: "review", beforeId: null });
  });

  it("does nothing for an unknown target", () => {
    expect(resolveDrop(columns, 1, 99)).toBeNull();
    expect(resolveDrop(columns, 1, "column:nope")).toBeNull();
  });
});

describe("filterTasks", () => {
  const ann = { id: 7, display_name: "Ann" };
  const cards = [card(1, "todo", 1, { assignee: ann, labels: ["api"] }), card(2, "todo", 2, { labels: ["ui"] })];

  it("returns everything with no filter", () => {
    expect(filterTasks(cards, NO_FILTER)).toBe(cards);
  });

  it("filters by assignee, unassigned and label", () => {
    expect(ids(filterTasks(cards, { ...NO_FILTER, assigneeId: 7 }))).toEqual([1]);
    expect(ids(filterTasks(cards, { ...NO_FILTER, assigneeId: "none" }))).toEqual([2]);
    expect(ids(filterTasks(cards, { ...NO_FILTER, label: "ui" }))).toEqual([2]);
  });

  it("collects the choices for its controls", () => {
    expect(allLabels(cards)).toEqual(["api", "ui"]);
    expect(allAssignees(cards)).toEqual([ann]);
  });
});

describe("sortTasks", () => {
  const cards = [
    card(1, "done", 1, { title: "b", due_date: null }),
    card(2, "todo", 1, { title: "a", due_date: "2026-02-01" }),
    card(3, "doing", 1, { title: "c", due_date: "2026-01-01" }),
  ];

  it("sorts by status in board order", () => {
    expect(ids(sortTasks(cards, "status", "asc"))).toEqual([2, 3, 1]);
  });

  it("sorts by title, and reverses", () => {
    expect(ids(sortTasks(cards, "title", "asc"))).toEqual([2, 1, 3]);
    expect(ids(sortTasks(cards, "title", "desc"))).toEqual([3, 1, 2]);
  });

  it("keeps tasks without a due date last in both directions", () => {
    expect(ids(sortTasks(cards, "due_date", "asc"))).toEqual([3, 2, 1]);
    expect(ids(sortTasks(cards, "due_date", "desc"))).toEqual([2, 3, 1]);
  });

  it("does not change its input", () => {
    const copy = [...cards];
    sortTasks(cards, "title", "asc");
    expect(cards).toEqual(copy);
  });
});

describe("apiErrorMessage", () => {
  it("prefers the server's message", () => {
    expect(apiErrorMessage({ status: 409, data: { error: "STALE: changed" } }, "Failed")).toBe("STALE: changed");
    expect(apiErrorMessage(new Error("boom"), "Failed")).toBe("Failed");
  });
});
```

Add imports to `test/calendar.test.ts`:

```ts
import { filterDays, isOverdue, monthGrid, shiftMonth, tasksByDate } from "../client/src/lib/calendarGrid.js";
import {
  buildCalendarSearch,
  buildProjectViewSearch,
  buildTaskLink,
  buildTaskSearch,
  parseCalendar,
  withoutCalendar,
} from "../client/src/hooks/useHash.js";
```

(These replace the two existing lines importing from `calendarGrid.js` and `useHash.js`.)

Change the round-trip test's expectations:

```ts
    expect(parseCalendar(q)).toEqual({ projectId: 7, month: "2026-09", view: "calendar", taskId: null });
    expect(parseCalendar("?calendar=7&month=2026-13")).toEqual({
      projectId: 7,
      month: null,
      view: "calendar",
      taskId: null,
    });
```

Add inside the `calendar grid + URL helpers` describe:

```ts
  it("reads the project view and open task, ignoring bad values", () => {
    expect(parseCalendar("?calendar=7&view=board&task=12")).toMatchObject({ view: "board", taskId: 12 });
    expect(parseCalendar("?calendar=7&view=list")).toMatchObject({ view: "list", taskId: null });
    expect(parseCalendar("?calendar=7&view=nope&task=abc")).toMatchObject({ view: "calendar", taskId: null });
    expect(parseCalendar("?calendar=7&task=-1")).toMatchObject({ taskId: null });
    expect(parseCalendar("?calendar=7&task=1.5")).toMatchObject({ taskId: null });
  });

  it("builds view and task queries, keeping other params", () => {
    expect(buildProjectViewSearch("?calendar=7&month=2026-09", "board")).toBe("?calendar=7&month=2026-09&view=board");
    expect(buildProjectViewSearch("?calendar=7&view=board", "calendar")).toBe("?calendar=7");
    expect(buildTaskSearch("?calendar=7&view=board", 12)).toBe("?calendar=7&view=board&task=12");
    expect(buildTaskSearch("?calendar=7&view=board&task=12", null)).toBe("?calendar=7&view=board");
  });

  it("keeps the view and task when changing month, and drops them on leaving", () => {
    const q = "?projects=1,2&calendar=7&view=list&task=3";
    expect(buildCalendarSearch(q, 7, "2026-10")).toBe("?projects=1,2&calendar=7&view=list&task=3&month=2026-10");
    expect(withoutCalendar(q)).toBe("?projects=1,2");
  });

  it("builds a deep link to a task from anywhere", () => {
    expect(buildTaskLink("?projects=1,2&calendar=9&month=2026-01&view=list&task=3", 7, 12)).toBe(
      "?projects=1,2&calendar=7&view=board&task=12",
    );
  });
```

Append a new describe:

```ts
describe("tasks on the calendar", () => {
  const task = (id: number, over: { start_date?: string | null; due_date?: string | null; status?: string } = {}) => ({
    id,
    start_date: null,
    due_date: null,
    status: "todo",
    ...over,
  });

  it("places a task on its start and due dates", () => {
    const map = tasksByDate([task(1, { start_date: "2026-11-02", due_date: "2026-11-05" })], "2026-11-01", "2026-11-30");
    expect(map.get("2026-11-02")?.map((e) => e.kind)).toEqual(["start"]);
    expect(map.get("2026-11-05")?.map((e) => e.kind)).toEqual(["due"]);
  });

  it("shows matching start and due dates once, as due", () => {
    const map = tasksByDate([task(1, { start_date: "2026-11-02", due_date: "2026-11-02" })], "2026-11-01", "2026-11-30");
    expect(map.get("2026-11-02")?.map((e) => e.kind)).toEqual(["due"]);
  });

  it("leaves out undated tasks and dates outside the range, keeping the padding days", () => {
    const map = tasksByDate(
      [task(1), task(2, { due_date: "2026-12-31" }), task(3, { due_date: "2026-11-01" })],
      "2026-11-01",
      "2026-12-05",
    );
    expect([...map.keys()]).toEqual(["2026-11-01"]);
  });

  it("lists due before start, then by id", () => {
    const map = tasksByDate(
      [task(2, { start_date: "2026-11-02" }), task(3, { due_date: "2026-11-02" }), task(1, { due_date: "2026-11-02" })],
      "2026-11-01",
      "2026-11-30",
    );
    expect(map.get("2026-11-02")?.map((e) => e.task.id)).toEqual([1, 3, 2]);
  });

  it("calls a task overdue only before its due date passes and while not done", () => {
    expect(isOverdue(task(1, { due_date: "2026-11-01" }), "2026-11-02")).toBe(true);
    expect(isOverdue(task(1, { due_date: "2026-11-02" }), "2026-11-02")).toBe(false);
    expect(isOverdue(task(1, { due_date: "2026-11-01", status: "done" }), "2026-11-02")).toBe(false);
    expect(isOverdue(task(1), "2026-11-02")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/task-board.test.ts test/calendar.test.ts`
Expected: FAIL with `Failed to load url ../client/src/lib/taskBoard.js`.

- [ ] **Step 3: Write the board helpers**

Create `client/src/lib/taskBoard.ts`:

```ts
/**
 * Board logic with no React or store imports, so the server's test run can
 * exercise it (as with calendarGrid.ts). Types are structural for the same
 * reason.
 */

export const BOARD_STATUSES = ["todo", "doing", "review", "done"] as const;
export type BoardStatus = (typeof BOARD_STATUSES)[number];

/** How many Done cards show before "Show more". */
export const DONE_PAGE_SIZE = 20;

interface BoardCard {
  id: number;
  status: BoardStatus;
  position: number;
  archived: boolean;
}

const byPosition = (a: BoardCard, b: BoardCard): number => a.position - b.position || a.id - b.id;

export function columnsOf<T extends BoardCard>(tasks: T[]): Record<BoardStatus, T[]> {
  const columns: Record<BoardStatus, T[]> = { todo: [], doing: [], review: [], done: [] };
  for (const task of tasks) {
    if (!task.archived) columns[task.status].push(task);
  }
  for (const status of BOARD_STATUSES) columns[status].sort(byPosition);
  return columns;
}

/** The board after a drop, shown at once while the server confirms. Mirrors
 *  TaskStore.move: an absent `beforeId` means the bottom. */
export function applyMove<T extends BoardCard>(
  tasks: T[],
  id: number,
  status: BoardStatus,
  beforeId: number | null,
): T[] {
  const moved = tasks.find((t) => t.id === id);
  if (!moved) return tasks;
  const target = tasks.filter((t) => t.status === status && !t.archived && t.id !== id).sort(byPosition);
  const at = beforeId == null ? -1 : target.findIndex((t) => t.id === beforeId);
  target.splice(at < 0 ? target.length : at, 0, { ...moved, status });
  const renumbered = new Map(target.map((t, i) => [t.id, { ...t, position: i + 1 }]));
  return tasks.map((t) => renumbered.get(t.id) ?? t);
}

/**
 * Where a drop lands. `over` is a card id, or `column:<status>` for a column's
 * empty space. Moving down a column means landing after the card under the
 * pointer, which is what the sortable animation shows.
 */
export function resolveDrop<T extends { id: number }>(
  columns: Record<BoardStatus, T[]>,
  activeId: number,
  over: number | string,
): { status: BoardStatus; beforeId: number | null } | null {
  if (over === activeId) return null;
  if (typeof over === "string") {
    const status = over.replace(/^column:/, "") as BoardStatus;
    return BOARD_STATUSES.includes(status) ? { status, beforeId: null } : null;
  }
  const to = BOARD_STATUSES.find((s) => columns[s].some((t) => t.id === over));
  if (!to) return null;
  const list = columns[to];
  const overIndex = list.findIndex((t) => t.id === over);
  const activeIndex = list.findIndex((t) => t.id === activeId);
  if (activeIndex >= 0 && activeIndex < overIndex) {
    return { status: to, beforeId: list[overIndex + 1]?.id ?? null };
  }
  return { status: to, beforeId: over };
}

export interface TaskFilter {
  /** A user id, "none" for unassigned, or null for everyone. */
  assigneeId: number | "none" | null;
  label: string | null;
}

export const NO_FILTER: TaskFilter = { assigneeId: null, label: null };

interface FilterableTask {
  assignee: { id: number; display_name: string } | null;
  labels: string[];
}

export function filterTasks<T extends FilterableTask>(tasks: T[], filter: TaskFilter): T[] {
  if (filter.assigneeId === null && filter.label === null) return tasks;
  return tasks.filter((t) => {
    if (filter.assigneeId === "none" && t.assignee) return false;
    if (typeof filter.assigneeId === "number" && t.assignee?.id !== filter.assigneeId) return false;
    return filter.label === null || t.labels.includes(filter.label);
  });
}

export function allLabels(tasks: { labels: string[] }[]): string[] {
  return [...new Set(tasks.flatMap((t) => t.labels))].sort((a, b) => a.localeCompare(b));
}

export function allAssignees(tasks: FilterableTask[]): { id: number; display_name: string }[] {
  const byId = new Map<number, { id: number; display_name: string }>();
  for (const t of tasks) if (t.assignee) byId.set(t.assignee.id, t.assignee);
  return [...byId.values()].sort((a, b) => a.display_name.localeCompare(b.display_name));
}

export type TaskSortKey = "id" | "title" | "status" | "assignee" | "due_date" | "updated_at";

interface SortableTask extends FilterableTask {
  id: number;
  title: string;
  status: BoardStatus;
  due_date: string | null;
  updated_at: string;
}

/** A sorted copy. Tasks with no value for the key stay last in both directions. */
export function sortTasks<T extends SortableTask>(tasks: T[], key: TaskSortKey, dir: "asc" | "desc"): T[] {
  const value = (t: T): string | number | null => {
    switch (key) {
      case "id":
        return t.id;
      case "title":
        return t.title.toLocaleLowerCase();
      case "status":
        return BOARD_STATUSES.indexOf(t.status);
      case "assignee":
        return t.assignee?.display_name.toLocaleLowerCase() ?? null;
      case "due_date":
        return t.due_date;
      case "updated_at":
        return t.updated_at;
    }
  };
  const sign = dir === "asc" ? 1 : -1;
  return [...tasks].sort((a, b) => {
    const av = value(a);
    const bv = value(b);
    if (av === null || bv === null) {
      if (av === bv) return a.id - b.id;
      return av === null ? 1 : -1;
    }
    const order =
      typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
    return order === 0 ? a.id - b.id : order * sign;
  });
}

/** The server's `{ error }` message from a failed mutation, or `fallback`. */
export function apiErrorMessage(e: unknown, fallback: string): string {
  if (typeof e === "object" && e && "data" in e) {
    const message = (e as { data?: { error?: unknown } }).data?.error;
    if (typeof message === "string" && message) return message;
  }
  return fallback;
}
```

- [ ] **Step 4: Add calendar helpers**

Append to `client/src/lib/calendarGrid.ts`:

```ts

interface DatedTask {
  id: number;
  start_date: string | null;
  due_date: string | null;
}

export interface CalendarTaskEntry<T> {
  task: T;
  kind: "due" | "start";
}

/**
 * Tasks per day between `from` and `to`, inclusive. Task dates are plain
 * strings with no time zone: unlike page activity, they are never converted.
 * Matching start and due dates show once, as due.
 */
export function tasksByDate<T extends DatedTask>(
  tasks: T[],
  from: string,
  to: string,
): Map<string, CalendarTaskEntry<T>[]> {
  const map = new Map<string, CalendarTaskEntry<T>[]>();
  const put = (date: string | null, entry: CalendarTaskEntry<T>): void => {
    if (!date || date < from || date > to) return;
    const list = map.get(date);
    if (list) list.push(entry);
    else map.set(date, [entry]);
  };
  for (const task of tasks) {
    put(task.due_date, { task, kind: "due" });
    if (task.start_date !== task.due_date) put(task.start_date, { task, kind: "start" });
  }
  for (const list of map.values()) {
    list.sort((a, b) => (a.kind === b.kind ? a.task.id - b.task.id : a.kind === "due" ? -1 : 1));
  }
  return map;
}

export function isOverdue(task: { due_date: string | null; status: string }, today: string): boolean {
  return task.due_date !== null && task.due_date < today && task.status !== "done";
}
```

- [ ] **Step 5: Extend the URL state**

In `client/src/hooks/useHash.ts`, replace `CalendarLocation`:

```ts
export type ProjectViewKind = "calendar" | "board" | "list";

export interface CalendarLocation {
  projectId: number;
  /** `YYYY-MM`, or null for "the current month". */
  month: string | null;
  /** Which tab of the project view. Old calendar links have no `view`. */
  view: ProjectViewKind;
  /** `task=<id>`: the task modal open over that view. */
  taskId: number | null;
}
```

Update the doc comment on `HashLocation.calendar` to read:

```ts
  /** `?calendar=<projectId>&month=YYYY-MM&view=board&task=12` — the project
   *  view, shown in place of the viewer when no knowledge is open. */
```

Replace `parseCalendar`:

```ts
/** Parse `?calendar=7&month=2026-09&view=board&task=12`. Null when `calendar`
 *  is absent or malformed; a bad `month`, `view` or `task` falls back alone. */
export function parseCalendar(search: string): CalendarLocation | null {
  const params = new URLSearchParams(search);
  const projectId = Number(params.get("calendar"));
  if (!Number.isInteger(projectId) || projectId <= 0) return null;
  const month = params.get("month");
  const view = params.get("view");
  const taskId = Number(params.get("task"));
  return {
    projectId,
    month: month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : null,
    view: view === "board" || view === "list" ? view : "calendar",
    taskId: Number.isInteger(taskId) && taskId > 0 ? taskId : null,
  };
}
```

Replace `withoutCalendar`, and add the builders after it:

```ts
/** `search` minus the project-view params — used when leaving the view. */
export function withoutCalendar(search: string): string {
  const params = new URLSearchParams(search);
  params.delete("calendar");
  params.delete("month");
  params.delete("view");
  params.delete("task");
  const q = params.toString().replace(/%2C/g, ",");
  return q ? `?${q}` : "";
}

/** Switch project tab. The calendar is the default, so it needs no param. */
export function buildProjectViewSearch(search: string, view: ProjectViewKind): string {
  const params = new URLSearchParams(search);
  if (view === "calendar") params.delete("view");
  else params.set("view", view);
  const q = params.toString().replace(/%2C/g, ",");
  return q ? `?${q}` : "";
}

/** Open the task modal, or close it with null. */
export function buildTaskSearch(search: string, taskId: number | null): string {
  const params = new URLSearchParams(search);
  if (taskId == null) params.delete("task");
  else params.set("task", String(taskId));
  const q = params.toString().replace(/%2C/g, ",");
  return q ? `?${q}` : "";
}

/** A task on its project's board, from anywhere. Keeps `?projects=`. */
export function buildTaskLink(search: string, projectId: number, taskId: number): string {
  return buildTaskSearch(
    buildProjectViewSearch(buildCalendarSearch(withoutCalendar(search), projectId, null), "board"),
    taskId,
  );
}
```

- [ ] **Step 6: Run the pure tests**

Run: `npx vitest run test/task-board.test.ts test/calendar.test.ts test/url-projects.test.ts`
Expected: PASS

- [ ] **Step 7: Add API types and endpoints**

In `client/src/store/api.ts`, add to the imports at the top:

```ts
import { applyMove } from "../lib/taskBoard";
```

Change `ActivityLogEntry.target` and add fields:

```ts
  target: "knowledge" | "page" | "block" | "image" | "task" | "board_task";
```

```ts
  project_id: number | null;
  task_id: number | null;
  task_title: string | null;
```

(Insert the three fields directly after `block_caption`.)

Add above `export const portalApi = createApi({`:

```ts
// ─── Tasks ───
export type TaskStatus = "todo" | "doing" | "review" | "done";

export interface TaskMember {
  id: number;
  display_name: string;
}

export interface TaskLink {
  id: number;
  url: string;
  label: string | null;
}

export interface TaskRow {
  id: number;
  project_id: number;
  title: string;
  status: TaskStatus;
  position: number;
  assignee: TaskMember | null;
  start_date: string | null;
  due_date: string | null;
  labels: string[];
  blocked_reason: string | null;
  version: number;
  updated_at: string;
  archived: boolean;
}

export interface TaskDetail extends TaskRow {
  project: string;
  description: string;
  session_id: string | null;
  links: TaskLink[];
  created_by: number | null;
  created_at: string;
}

export interface ProjectTasksResponse {
  project: { id: number; name: string };
  can_edit: boolean;
  tasks: TaskRow[];
}

export interface TaskPatch {
  expected_version: number;
  title?: string;
  description?: string;
  status?: TaskStatus;
  assignee_id?: number | null;
  start_date?: string | null;
  due_date?: string | null;
  labels?: string[];
  session_id?: string | null;
  blocked_reason?: string | null;
  add_links?: { url: string; label?: string }[];
  remove_link_ids?: number[];
  archived?: boolean;
}

```

Add `"Tasks"` and `"Task"` to `tagTypes`.

Add after the `getProjectCalendar` endpoint:

```ts
    // The Board and Calendar share one cache entry through the `{ projectId }`
    // argument. moveTask's optimistic update patches exactly that entry.
    listProjectTasks: builder.query<ProjectTasksResponse, { projectId: number; includeArchived?: boolean }>({
      query: ({ projectId, includeArchived }) => ({
        url: `projects/${projectId}/tasks`,
        params: includeArchived ? { include_archived: 1 } : undefined,
      }),
      providesTags: (_r, _e, arg) => [{ type: "Tasks", id: arg.projectId }],
    }),

    listProjectMembers: builder.query<{ members: TaskMember[] }, number>({
      query: (projectId) => `projects/${projectId}/members`,
    }),

    getTask: builder.query<TaskDetail, number>({
      query: (id) => `tasks/${id}`,
      providesTags: (_r, _e, id) => [{ type: "Task", id }],
    }),

    getTaskRendered: builder.query<string, number>({
      query: (id) => ({ url: `tasks/${id}/rendered`, responseHandler: (r) => r.text() }),
      providesTags: (_r, _e, id) => [{ type: "Task", id }],
    }),

    addTask: builder.mutation<TaskDetail, { projectId: number; title: string }>({
      query: ({ projectId, title }) => ({
        url: `projects/${projectId}/tasks`,
        method: "POST",
        body: { title },
      }),
      invalidatesTags: (_r, _e, arg) => [{ type: "Tasks", id: arg.projectId }],
    }),

    updateTask: builder.mutation<TaskDetail, { id: number; projectId: number; patch: TaskPatch }>({
      query: ({ id, patch }) => ({ url: `tasks/${id}`, method: "PATCH", body: patch }),
      invalidatesTags: (_r, _e, arg) => [
        { type: "Tasks", id: arg.projectId },
        { type: "Task", id: arg.id },
      ],
    }),

    moveTask: builder.mutation<
      TaskDetail,
      { id: number; projectId: number; status: TaskStatus; beforeId: number | null; expectedVersion: number }
    >({
      query: ({ id, status, beforeId, expectedVersion }) => ({
        url: `tasks/${id}/move`,
        method: "POST",
        body: { status, before_id: beforeId, expected_version: expectedVersion },
      }),
      // Move the card at once and restore it if the server refuses. The tags
      // below refetch in both cases, so a stale board corrects itself.
      async onQueryStarted({ id, projectId, status, beforeId }, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          portalApi.util.updateQueryData("listProjectTasks", { projectId }, (draft) => {
            draft.tasks = applyMove(draft.tasks, id, status, beforeId);
          }),
        );
        try {
          await queryFulfilled;
        } catch {
          patch.undo();
        }
      },
      invalidatesTags: (_r, _e, arg) => [
        { type: "Tasks", id: arg.projectId },
        { type: "Task", id: arg.id },
      ],
    }),

    deleteTask: builder.mutation<{ deleted: boolean }, { id: number; projectId: number }>({
      query: ({ id }) => ({ url: `tasks/${id}`, method: "DELETE" }),
      invalidatesTags: (_r, _e, arg) => [{ type: "Tasks", id: arg.projectId }],
    }),
```

Add to the exported hooks, after `useGetProjectCalendarQuery,`:

```ts
  useListProjectTasksQuery,
  useListProjectMembersQuery,
  useGetTaskQuery,
  useGetTaskRenderedQuery,
  useAddTaskMutation,
  useUpdateTaskMutation,
  useMoveTaskMutation,
  useDeleteTaskMutation,
```

- [ ] **Step 8: Refresh on the new event**

In `client/src/hooks/useServerEvents.ts`:

Add to the `ServerEvent` union:

```ts
  | { type: "task-changed"; project_id: number; task_id: number }
```

Add `"Tasks",` and `"Task",` to `REFRESH_TAGS`, after `"Revisions",`.

Add a case to the switch, before `case "tool-called":`:

```ts
        case "task-changed": {
          dispatch(
            portalApi.util.invalidateTags([
              { type: "Tasks", id: e.project_id },
              { type: "Task", id: e.task_id },
              { type: "ActivityLog", id: "LIST" },
            ]),
          );
          break;
        }
```

- [ ] **Step 9: Show task rows in the activity log**

In `client/src/components/ActivityLogModal.tsx`, extend the import from `../hooks/useHash` with `buildTaskLink` and `currentQueryString`, keeping `navigateTo`.

In `ActivityRow`, replace the `jumpable` and `onJump` definitions:

```ts
  const taskJumpable =
    entry.target === "board_task" &&
    entry.action !== "delete" &&
    entry.project_id != null &&
    entry.task_id != null;
  const jumpable =
    taskJumpable ||
    (entry.action !== "delete" &&
      entry.knowledge_id != null &&
      !(entry.target === "page" && entry.page_id == null));

  const onJump = () => {
    if (taskJumpable) {
      navigateTo(
        { kid: null },
        { search: buildTaskLink(currentQueryString(), entry.project_id as number, entry.task_id as number) },
      );
    } else if (entry.knowledge_id != null) {
      navigateTo({
        kid: entry.knowledge_id,
        pid: entry.page_id ?? null,
      });
    } else {
      return;
    }
    dispatch(closeActivityLog());
  };
```

In `describeTarget`, add before `case "image":`:

```ts
    case "board_task":
      return `board task T${entry.task_id ?? "?"}${entry.task_title ? ` "${entry.task_title}"` : ""}`;
```

- [ ] **Step 10: Verify and commit**

Run: `npm run typecheck && npx vitest run test/task-board.test.ts test/calendar.test.ts test/url-projects.test.ts`
Expected: PASS, and no type errors.

```bash
git add client/src/lib/taskBoard.ts client/src/lib/calendarGrid.ts client/src/hooks/useHash.ts client/src/store/api.ts client/src/hooks/useServerEvents.ts client/src/components/ActivityLogModal.tsx test/task-board.test.ts test/calendar.test.ts
git commit -m "feat: add the client data layer and URL state for project tasks"
```

---

### Task 7: Project view with Board and List tabs

**Files:**
- Create: `client/src/components/ProjectView.tsx`
- Create: `client/src/components/TaskFilters.tsx`
- Create: `client/src/components/TaskBoard.tsx`
- Create: `client/src/components/TaskListView.tsx`
- Modify: `client/src/components/CalendarView.tsx` (root element)
- Modify: `client/src/components/Sidebar.tsx` (tooltip)
- Modify: `client/src/App.tsx`
- Modify: `client/src/styles/theme.css` (append)

**Interfaces:**
- Consumes: the Task 6 helpers and hooks. `isOverdue` and `todayLocal` from `calendarGrid.ts`.
- Produces: `<ProjectView location={CalendarLocation} />`, `<TaskBoard projectId filter onOpenTask />`, `<TaskListView projectId filter onOpenTask />`, `<TaskFilters projectId filter onChange />`.

These are React components with no component test harness in this repo. Their logic is tested in Task 6. Each step ends with `typecheck`.

- [ ] **Step 1: Write the filter bar**

Create `client/src/components/TaskFilters.tsx`:

```tsx
import { useMemo } from "react";
import { useListProjectTasksQuery } from "../store/api";
import { allAssignees, allLabels, type TaskFilter } from "../lib/taskBoard";

interface Props {
  projectId: number;
  filter: TaskFilter;
  onChange: (next: TaskFilter) => void;
}

/** Assignee and label filters shared by the Board and List tabs. */
export function TaskFilters({ projectId, filter, onChange }: Props): JSX.Element {
  const { data } = useListProjectTasksQuery({ projectId });
  const tasks = useMemo(() => data?.tasks ?? [], [data]);
  const assignees = useMemo(() => allAssignees(tasks), [tasks]);
  const labels = useMemo(() => allLabels(tasks), [tasks]);

  return (
    <div className="task-filters">
      <label>
        Assignee
        <select
          value={filter.assigneeId === null ? "" : String(filter.assigneeId)}
          onChange={(e) => {
            const v = e.target.value;
            onChange({
              ...filter,
              assigneeId: v === "" ? null : v === "none" ? "none" : Number(v),
            });
          }}
        >
          <option value="">Everyone</option>
          <option value="none">Unassigned</option>
          {assignees.map((a) => (
            <option key={a.id} value={a.id}>
              {a.display_name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Label
        <select
          value={filter.label ?? ""}
          onChange={(e) => onChange({ ...filter, label: e.target.value || null })}
        >
          <option value="">Any</option>
          {labels.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
```

- [ ] **Step 2: Write the board**

Create `client/src/components/TaskBoard.tsx`:

```tsx
import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAppDispatch } from "../store";
import { showToast } from "../store/uiSlice";
import {
  useAddTaskMutation,
  useListProjectTasksQuery,
  useMoveTaskMutation,
  type TaskRow,
} from "../store/api";
import { isOverdue, todayLocal } from "../lib/calendarGrid";
import {
  BOARD_STATUSES,
  DONE_PAGE_SIZE,
  apiErrorMessage,
  columnsOf,
  filterTasks,
  resolveDrop,
  type BoardStatus,
  type TaskFilter,
} from "../lib/taskBoard";

const COLUMN_TITLES: Record<BoardStatus, string> = {
  todo: "Todo",
  doing: "Doing",
  review: "Review",
  done: "Done",
};

interface Props {
  projectId: number;
  filter: TaskFilter;
  onOpenTask: (id: number) => void;
}

export function TaskBoard({ projectId, filter, onOpenTask }: Props): JSX.Element {
  const dispatch = useAppDispatch();
  const { data, error, isLoading } = useListProjectTasksQuery({ projectId });
  const [moveTask] = useMoveTaskMutation();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [doneShown, setDoneShown] = useState(DONE_PAGE_SIZE);

  const sensors = useSensors(
    // A small distance keeps a click on a card's title from starting a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const rows = useMemo(() => data?.tasks ?? [], [data]);
  const columns = useMemo(() => columnsOf(filterTasks(rows, filter)), [rows, filter]);
  const canEdit = data?.can_edit ?? false;
  const activeTask = activeId == null ? null : rows.find((t) => t.id === activeId) ?? null;

  const onDragEnd = (e: DragEndEvent): void => {
    setActiveId(null);
    if (!e.over || !canEdit) return;
    const id = Number(e.active.id);
    const drop = resolveDrop(columns, id, e.over.id);
    const task = rows.find((t) => t.id === id);
    if (!drop || !task) return;
    moveTask({
      id,
      projectId,
      status: drop.status,
      beforeId: drop.beforeId,
      expectedVersion: task.version,
    })
      .unwrap()
      .catch((err: unknown) => {
        dispatch(showToast({ message: apiErrorMessage(err, "Could not move the task"), kind: "error" }));
      });
  };

  if (error) {
    const status = (error as { status?: number }).status;
    return (
      <div className="viewer-empty">
        <h2>{status === 403 ? "No access to this project" : "Could not load the tasks"}</h2>
      </div>
    );
  }
  if (isLoading) return <p className="task-loading">Loading tasks…</p>;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={(e) => setActiveId(Number(e.active.id))}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={onDragEnd}
    >
      <div className="task-board">
        {BOARD_STATUSES.map((status) => (
          <Column
            key={status}
            status={status}
            projectId={projectId}
            tasks={status === "done" ? columns.done.slice(0, doneShown) : columns[status]}
            total={columns[status].length}
            canEdit={canEdit}
            onOpenTask={onOpenTask}
            onShowMore={status === "done" ? () => setDoneShown((n) => n + DONE_PAGE_SIZE) : undefined}
          />
        ))}
      </div>
      <DragOverlay>
        {activeTask ? (
          <div className="task-card task-card-overlay">
            <CardBody task={activeTask} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({
  status,
  projectId,
  tasks,
  total,
  canEdit,
  onOpenTask,
  onShowMore,
}: {
  status: BoardStatus;
  projectId: number;
  tasks: TaskRow[];
  total: number;
  canEdit: boolean;
  onOpenTask: (id: number) => void;
  onShowMore?: () => void;
}): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: `column:${status}` });
  return (
    <section className={`task-column${isOver ? " over" : ""}`} aria-label={COLUMN_TITLES[status]}>
      <header className="task-column-header">
        <span>{COLUMN_TITLES[status]}</span>
        <span className="task-column-count">{total}</span>
      </header>
      <div ref={setNodeRef} className="task-column-cards">
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} canEdit={canEdit} onOpenTask={onOpenTask} />
          ))}
        </SortableContext>
      </div>
      {onShowMore && total > tasks.length && (
        <button type="button" className="task-show-more" onClick={onShowMore}>
          Show more ({total - tasks.length})
        </button>
      )}
      {status === "todo" && canEdit && <QuickAdd projectId={projectId} />}
    </section>
  );
}

function TaskCard({
  task,
  canEdit,
  onOpenTask,
}: {
  task: TaskRow;
  canEdit: boolean;
  onOpenTask: (id: number) => void;
}): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: !canEdit,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  };
  return (
    <article ref={setNodeRef} style={style} className="task-card" {...attributes} {...listeners}>
      <CardBody task={task} onOpen={() => onOpenTask(task.id)} />
    </article>
  );
}

function CardBody({ task, onOpen }: { task: TaskRow; onOpen?: () => void }): JSX.Element {
  const overdue = isOverdue(task, todayLocal());
  return (
    <>
      <div className="task-card-top">
        <span className="task-card-id">T{task.id}</span>
        {task.blocked_reason && (
          <span className="task-card-blocked" title={task.blocked_reason}>
            Blocked
          </span>
        )}
      </div>
      <button
        type="button"
        className="task-card-title"
        onClick={onOpen}
        // Enter here opens the task. Without this, the card's keyboard drag
        // handler would take the key first.
        onKeyDown={(e) => e.stopPropagation()}
      >
        {task.title}
      </button>
      <div className="task-card-meta">
        {task.assignee && <span>{task.assignee.display_name}</span>}
        {task.due_date && <span className={overdue ? "task-overdue" : undefined}>{task.due_date}</span>}
      </div>
      {task.labels.length > 0 && (
        <div className="task-card-labels">
          {task.labels.map((l) => (
            <span key={l}>{l}</span>
          ))}
        </div>
      )}
    </>
  );
}

function QuickAdd({ projectId }: { projectId: number }): JSX.Element {
  const dispatch = useAppDispatch();
  const [title, setTitle] = useState("");
  const [addTask, { isLoading }] = useAddTaskMutation();

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    const text = title.trim();
    if (!text) return;
    addTask({ projectId, title: text })
      .unwrap()
      .then(() => setTitle(""))
      .catch((err: unknown) => {
        dispatch(showToast({ message: apiErrorMessage(err, "Could not add the task"), kind: "error" }));
      });
  };

  return (
    <form className="task-quick-add" onSubmit={submit}>
      <input
        type="text"
        value={title}
        maxLength={300}
        placeholder="Add a task"
        aria-label="New task title"
        onChange={(e) => setTitle(e.target.value)}
      />
      <button type="submit" disabled={isLoading || !title.trim()}>
        Add
      </button>
    </form>
  );
}
```

- [ ] **Step 3: Write the list**

Create `client/src/components/TaskListView.tsx`:

```tsx
import { useMemo, useState } from "react";
import { useListProjectTasksQuery } from "../store/api";
import { isOverdue, todayLocal } from "../lib/calendarGrid";
import { filterTasks, sortTasks, type TaskFilter, type TaskSortKey } from "../lib/taskBoard";

const COLUMNS: { key: TaskSortKey; label: string }[] = [
  { key: "id", label: "ID" },
  { key: "title", label: "Title" },
  { key: "status", label: "Status" },
  { key: "assignee", label: "Assignee" },
  { key: "due_date", label: "Due" },
  { key: "updated_at", label: "Updated" },
];

interface Props {
  projectId: number;
  filter: TaskFilter;
  onOpenTask: (id: number) => void;
}

export function TaskListView({ projectId, filter, onOpenTask }: Props): JSX.Element {
  const [showArchived, setShowArchived] = useState(false);
  const [sortKey, setSortKey] = useState<TaskSortKey>("status");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const { data, error, isLoading } = useListProjectTasksQuery(
    showArchived ? { projectId, includeArchived: true } : { projectId },
  );

  const rows = useMemo(
    () => sortTasks(filterTasks(data?.tasks ?? [], filter), sortKey, sortDir),
    [data, filter, sortKey, sortDir],
  );
  const today = todayLocal();

  const onSort = (key: TaskSortKey): void => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  if (error) {
    const status = (error as { status?: number }).status;
    return (
      <div className="viewer-empty">
        <h2>{status === 403 ? "No access to this project" : "Could not load the tasks"}</h2>
      </div>
    );
  }

  return (
    <div className="task-list">
      <label className="task-list-archived">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        Include archived
      </label>
      {isLoading ? (
        <p className="task-loading">Loading tasks…</p>
      ) : rows.length === 0 ? (
        <p className="task-loading">No tasks to show.</p>
      ) : (
        <div className="task-list-scroll">
          <table>
            <thead>
              <tr>
                {COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    aria-sort={c.key === sortKey ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                  >
                    <button type="button" onClick={() => onSort(c.key)}>
                      {c.label}
                      {c.key === sortKey ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                    </button>
                  </th>
                ))}
                <th>Labels</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className={t.archived ? "archived" : undefined}>
                  <td>T{t.id}</td>
                  <td>
                    <button type="button" className="task-list-title" onClick={() => onOpenTask(t.id)}>
                      {t.title}
                    </button>
                    {t.blocked_reason && (
                      <span className="task-card-blocked" title={t.blocked_reason}>
                        Blocked
                      </span>
                    )}
                    {t.archived && <span className="task-list-archived-tag">Archived</span>}
                  </td>
                  <td>{t.status}</td>
                  <td>{t.assignee?.display_name ?? ""}</td>
                  <td className={isOverdue(t, today) ? "task-overdue" : undefined}>{t.due_date ?? ""}</td>
                  <td title={t.updated_at}>{t.updated_at.slice(0, 10)}</td>
                  <td>{t.labels.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Write the project view**

Create `client/src/components/ProjectView.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { CalendarView } from "./CalendarView";
import { TaskBoard } from "./TaskBoard";
import { TaskFilters } from "./TaskFilters";
import { TaskListView } from "./TaskListView";
import {
  buildProjectViewSearch,
  buildTaskSearch,
  currentQueryString,
  navigateTo,
  type CalendarLocation,
  type ProjectViewKind,
} from "../hooks/useHash";
import { NO_FILTER, type TaskFilter } from "../lib/taskBoard";

const TABS: { view: ProjectViewKind; label: string }[] = [
  { view: "calendar", label: "Calendar" },
  { view: "board", label: "Board" },
  { view: "list", label: "List" },
];

/**
 * Everything behind a project's calendar icon: one tab bar over the Calendar,
 * Board and List. Rendered in place of the viewer for `/?calendar=<id>`.
 */
export function ProjectView({ location }: { location: CalendarLocation }): JSX.Element {
  const { projectId, month, view } = location;
  const [filter, setFilter] = useState<TaskFilter>(NO_FILTER);

  useEffect(() => setFilter(NO_FILTER), [projectId]);

  const openTask = useCallback((id: number) => {
    navigateTo({ kid: null }, { search: buildTaskSearch(currentQueryString(), id) });
  }, []);

  return (
    <section className="viewer project-view">
      <div className="project-tabs" role="tablist" aria-label="Project views">
        {TABS.map((tab) => (
          <button
            key={tab.view}
            type="button"
            role="tab"
            aria-selected={view === tab.view}
            className={view === tab.view ? "active" : undefined}
            onClick={() =>
              navigateTo({ kid: null }, { search: buildProjectViewSearch(currentQueryString(), tab.view) })
            }
          >
            {tab.label}
          </button>
        ))}
        {view !== "calendar" && <TaskFilters projectId={projectId} filter={filter} onChange={setFilter} />}
      </div>
      {view === "calendar" && <CalendarView projectId={projectId} month={month} />}
      {view === "board" && <TaskBoard projectId={projectId} filter={filter} onOpenTask={openTask} />}
      {view === "list" && <TaskListView projectId={projectId} filter={filter} onOpenTask={openTask} />}
    </section>
  );
}
```

- [ ] **Step 5: Wire it in**

In `client/src/components/CalendarView.tsx`, change the root element so it can sit inside the tab layout. Replace the opening `<section className="viewer calendar-view">` with `<div className="calendar-view">`, and its closing `</section>` with `</div>`.

Add to the doc comment at the top of that file, replacing its last line:

```ts
 * Rendered inside ProjectView for `/?calendar=<projectId>&month=YYYY-MM`.
```

In `client/src/App.tsx`, replace the `CalendarView` import with:

```ts
import { ProjectView } from "./components/ProjectView";
```

Replace the `<CalendarView ... />` usage with:

```tsx
          <ProjectView location={location.calendar} />
```

In `client/src/components/Sidebar.tsx`, change the calendar button's two strings:

```tsx
            title={`Calendar and tasks of ${project}`}
            aria-label={`Calendar and tasks of ${project}`}
```

- [ ] **Step 6: Add the styles**

Append to `client/src/styles/theme.css`:

```css

/* ─── Project view: tabs, task board, task list ─── */
.project-view {
  display: flex; flex-direction: column;
  background: var(--bg);
}
.project-view .calendar-view { flex: 1; }
.project-tabs {
  display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
  padding: 10px 18px 0;
}
.project-tabs > button {
  height: 30px; padding: 0 12px;
  border: 1px solid transparent; border-radius: var(--radius-sm);
  background: transparent; color: var(--text-2);
  font: inherit; font-size: 13px; cursor: pointer;
}
.project-tabs > button:hover { background: var(--surface-2); }
.project-tabs > button.active {
  background: var(--accent-light); border-color: var(--accent); color: var(--accent-strong);
}
.task-filters { display: flex; gap: 10px; margin-left: auto; flex-wrap: wrap; }
.task-filters label {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px; color: var(--text-3);
}
.task-filters select {
  height: 28px; padding: 0 6px;
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: var(--surface); color: var(--text);
  font: inherit; font-size: 12px;
}
.task-loading { padding: 24px 18px; color: var(--text-3); }

.task-board {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(4, minmax(230px, 1fr));
  gap: 12px;
  padding: 14px 18px 18px;
  overflow-x: auto;
  align-items: start;
}
.task-column {
  display: flex; flex-direction: column; gap: 8px;
  padding: 10px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.task-column.over { border-color: var(--accent); }
.task-column-header {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 12px; font-weight: 600; color: var(--text-2);
  text-transform: uppercase; letter-spacing: .04em;
}
.task-column-count { color: var(--text-3); font-weight: 500; }
.task-column-cards { display: flex; flex-direction: column; gap: 8px; min-height: 48px; }
.task-card {
  display: flex; flex-direction: column; gap: 6px;
  padding: 8px 10px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: grab;
  touch-action: manipulation;
}
.task-card-overlay { cursor: grabbing; border-color: var(--accent); }
.task-card-top { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.task-card-id { font-size: 11px; color: var(--text-3); }
.task-card-blocked {
  padding: 0 6px;
  border-radius: var(--radius-sm);
  background: var(--red-light); color: var(--red);
  font-size: 11px; font-weight: 600;
}
.task-card-title {
  padding: 0; border: none; background: transparent;
  color: var(--text); text-align: left;
  font: inherit; font-size: 13.5px; line-height: 1.35;
  cursor: pointer; overflow-wrap: anywhere;
}
.task-card-title:hover { color: var(--accent-strong); }
.task-card-meta { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; font-size: 11.5px; color: var(--text-2); }
.task-overdue { color: var(--red); font-weight: 600; }
.task-card-labels { display: flex; flex-wrap: wrap; gap: 4px; }
.task-card-labels span {
  padding: 0 6px;
  border-radius: var(--radius-sm);
  background: var(--surface-2); color: var(--text-2);
  font-size: 11px;
}
.task-show-more {
  height: 28px;
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: var(--surface); color: var(--text-2);
  font: inherit; font-size: 12px; cursor: pointer;
}
.task-quick-add { display: flex; gap: 6px; }
.task-quick-add input {
  flex: 1; min-width: 0; height: 30px; padding: 0 8px;
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: var(--surface); color: var(--text);
  font: inherit; font-size: 13px;
}
.task-quick-add button {
  height: 30px; padding: 0 10px;
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: var(--surface); color: var(--text);
  font: inherit; font-size: 13px; cursor: pointer;
}
.task-quick-add button:disabled { color: var(--text-3); cursor: default; }

.task-list { flex: 1; padding: 14px 18px 18px; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.task-list-archived { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text-2); }
.task-list-scroll { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
.task-list table { width: 100%; border-collapse: collapse; font-size: 13px; }
.task-list th, .task-list td { padding: 7px 10px; border-bottom: 1px solid var(--border); text-align: left; white-space: nowrap; }
.task-list th { background: var(--surface-2); }
.task-list th button {
  padding: 0; border: none; background: transparent;
  color: var(--text-2); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer;
}
.task-list tr.archived td { color: var(--text-3); }
.task-list-title {
  padding: 0; border: none; background: transparent;
  color: var(--text); font: inherit; cursor: pointer; text-align: left;
}
.task-list-title:hover { color: var(--accent-strong); }
.task-list td .task-card-blocked, .task-list-archived-tag { margin-left: 8px; }
.task-list-archived-tag { font-size: 11px; color: var(--text-3); }
```

- [ ] **Step 7: Verify and commit**

Run: `npm run typecheck && npx vitest run test/task-board.test.ts test/calendar.test.ts`
Expected: PASS, and no type errors.

```bash
git add client/src/components/ProjectView.tsx client/src/components/TaskFilters.tsx client/src/components/TaskBoard.tsx client/src/components/TaskListView.tsx client/src/components/CalendarView.tsx client/src/components/Sidebar.tsx client/src/App.tsx client/src/styles/theme.css
git commit -m "feat: add Board and List tabs behind the project calendar icon"
```

---

### Task 8: Task modal

**Files:**
- Create: `client/src/lib/taskDraft.ts`
- Create: `client/src/components/TaskModal.tsx`
- Modify: `client/src/components/ProjectView.tsx`
- Modify: `client/src/lib/badgeMenu.ts` (export `writeClipboard`)
- Modify: `client/src/styles/theme.css` (append)
- Create: `test/task-draft.test.ts`

**Interfaces:**
- Consumes: Task 6 hooks and types. `useMermaidCharts(root, deps, theme, pageId?, opts?)`. `useGetAuthMeQuery`.
- Produces: `<TaskModal projectId taskId onClose />`. From `taskDraft.ts`: `TaskDraft`, `draftOf(task)`, `patchFrom(draft, base)`, `changedElsewhere(dirty, baseVersion, latestVersion)`.

- [ ] **Step 1: Write the failing tests**

Create `test/task-draft.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { changedElsewhere, draftOf, patchFrom } from "../client/src/lib/taskDraft.js";

const task = {
  title: "T",
  description: "Body",
  status: "todo" as const,
  assignee: { id: 7, display_name: "Ann" },
  start_date: "2026-11-01",
  due_date: null,
  labels: ["api", "ui"],
  session_id: null,
  blocked_reason: "waiting",
};

describe("draftOf", () => {
  it("turns nulls and lists into form values", () => {
    expect(draftOf(task)).toEqual({
      title: "T",
      description: "Body",
      status: "todo",
      assignee_id: 7,
      start_date: "2026-11-01",
      due_date: "",
      labels: "api, ui",
      session_id: "",
      blocked_reason: "waiting",
    });
  });
});

describe("patchFrom", () => {
  it("returns null when nothing changed", () => {
    expect(patchFrom(draftOf(task), task)).toBeNull();
  });

  it("sends only what changed", () => {
    expect(patchFrom({ ...draftOf(task), title: "New" }, task)).toEqual({ title: "New" });
  });

  it("does not resend an assignee who was left alone", () => {
    expect(patchFrom({ ...draftOf(task), description: "New" }, task)).not.toHaveProperty("assignee_id");
  });

  it("turns emptied fields into null", () => {
    expect(
      patchFrom({ ...draftOf(task), start_date: "", blocked_reason: "  ", assignee_id: null }, task),
    ).toEqual({ start_date: null, blocked_reason: null, assignee_id: null });
  });

  it("compares labels as a list, ignoring spacing", () => {
    expect(patchFrom({ ...draftOf(task), labels: "api,ui" }, task)).toBeNull();
    expect(patchFrom({ ...draftOf(task), labels: "api" }, task)).toEqual({ labels: ["api"] });
    expect(patchFrom({ ...draftOf(task), labels: " " }, task)).toEqual({ labels: [] });
  });

  it("ignores whitespace around the title", () => {
    expect(patchFrom({ ...draftOf(task), title: "  T " }, task)).toBeNull();
  });
});

describe("changedElsewhere", () => {
  it("flags new versions only when there are unsaved edits to protect", () => {
    expect(changedElsewhere(true, 2, 3)).toBe(true);
    expect(changedElsewhere(false, 2, 3)).toBe(false);
    expect(changedElsewhere(true, 3, 3)).toBe(false);
    expect(changedElsewhere(true, 3, undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/task-draft.test.ts`
Expected: FAIL with `Failed to load url ../client/src/lib/taskDraft.js`.

- [ ] **Step 3: Write the draft helpers**

Create `client/src/lib/taskDraft.ts`:

```ts
/**
 * The modal's form state, kept free of React and the store so the server's
 * test run can exercise it. `patchFrom` sends only the fields a person changed,
 * so saving a title cannot overwrite an agent's change to another field, and
 * cannot fail on an assignee who has since lost access.
 */

import type { BoardStatus } from "./taskBoard";

interface DraftableTask {
  title: string;
  description: string;
  status: BoardStatus;
  assignee: { id: number } | null;
  start_date: string | null;
  due_date: string | null;
  labels: string[];
  session_id: string | null;
  blocked_reason: string | null;
}

export interface TaskDraft {
  title: string;
  description: string;
  status: BoardStatus;
  assignee_id: number | null;
  start_date: string;
  due_date: string;
  labels: string;
  session_id: string;
  blocked_reason: string;
}

export interface TaskDraftPatch {
  title?: string;
  description?: string;
  status?: BoardStatus;
  assignee_id?: number | null;
  start_date?: string | null;
  due_date?: string | null;
  labels?: string[];
  session_id?: string | null;
  blocked_reason?: string | null;
}

export function draftOf(task: DraftableTask): TaskDraft {
  return {
    title: task.title,
    description: task.description,
    status: task.status,
    assignee_id: task.assignee?.id ?? null,
    start_date: task.start_date ?? "",
    due_date: task.due_date ?? "",
    labels: task.labels.join(", "),
    session_id: task.session_id ?? "",
    blocked_reason: task.blocked_reason ?? "",
  };
}

const orNull = (value: string): string | null => value.trim() || null;

const parseLabels = (value: string): string[] =>
  value
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean);

/** The fields that differ from `base`, or null when there are none. */
export function patchFrom(draft: TaskDraft, base: DraftableTask): TaskDraftPatch | null {
  const patch: TaskDraftPatch = {};
  const title = draft.title.trim();
  if (title !== base.title) patch.title = title;
  if (draft.description !== base.description) patch.description = draft.description;
  if (draft.status !== base.status) patch.status = draft.status;
  if (draft.assignee_id !== (base.assignee?.id ?? null)) patch.assignee_id = draft.assignee_id;
  if (orNull(draft.start_date) !== base.start_date) patch.start_date = orNull(draft.start_date);
  if (orNull(draft.due_date) !== base.due_date) patch.due_date = orNull(draft.due_date);
  const labels = parseLabels(draft.labels);
  if (labels.join(",") !== base.labels.join(",")) patch.labels = labels;
  if (orNull(draft.session_id) !== base.session_id) patch.session_id = orNull(draft.session_id);
  if (orNull(draft.blocked_reason) !== base.blocked_reason) patch.blocked_reason = orNull(draft.blocked_reason);
  return Object.keys(patch).length > 0 ? patch : null;
}

/** True when the task moved on underneath unsaved edits. The modal then keeps
 *  the typed text on screen and asks, instead of replacing it. */
export function changedElsewhere(dirty: boolean, baseVersion: number, latestVersion: number | undefined): boolean {
  return dirty && latestVersion !== undefined && latestVersion !== baseVersion;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/task-draft.test.ts`
Expected: PASS

- [ ] **Step 5: Export the clipboard helper**

In `client/src/lib/badgeMenu.ts`, change `function writeClipboard(` to `export function writeClipboard(`.

- [ ] **Step 6: Write the modal**

Create `client/src/components/TaskModal.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useAppDispatch, useAppSelector } from "../store";
import { showToast } from "../store/uiSlice";
import {
  useDeleteTaskMutation,
  useGetAuthMeQuery,
  useGetTaskQuery,
  useGetTaskRenderedQuery,
  useListProjectMembersQuery,
  useListProjectTasksQuery,
  useUpdateTaskMutation,
  type TaskDetail,
  type TaskPatch,
} from "../store/api";
import { useMermaidCharts } from "../hooks/useMermaidCharts";
import { writeClipboard } from "../lib/badgeMenu";
import { BOARD_STATUSES, apiErrorMessage, type BoardStatus } from "../lib/taskBoard";
import { changedElsewhere, draftOf, patchFrom, type TaskDraft } from "../lib/taskDraft";

interface Props {
  projectId: number;
  taskId: number;
  onClose: () => void;
}

/**
 * One task's detail, opened over any project tab by `?task=<id>`. Mount it with
 * `key={taskId}`, so each task starts from a clean draft.
 *
 * `base` is the server copy the draft started from. While there are unsaved
 * edits, newer server copies do not replace the draft: the typed text stays on
 * screen, and a banner offers to discard it. Saving against the old version is
 * refused by the server, so another person's or an agent's change is never
 * overwritten silently.
 */
export function TaskModal({ projectId, taskId, onClose }: Props): JSX.Element {
  const dispatch = useAppDispatch();
  const theme = useAppSelector((s) => s.ui.theme);
  const taskQuery = useGetTaskQuery(taskId);
  const rendered = useGetTaskRenderedQuery(taskId);
  const board = useListProjectTasksQuery({ projectId });
  const members = useListProjectMembersQuery(projectId, { refetchOnMountOrArgChange: true });
  const me = useGetAuthMeQuery();
  const [updateTask, { isLoading: saving }] = useUpdateTaskMutation();
  const [deleteTask] = useDeleteTaskMutation();

  const [base, setBase] = useState<TaskDetail | null>(null);
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [editingDescription, setEditingDescription] = useState(false);
  const [bodyEl, setBodyEl] = useState<HTMLElement | null>(null);
  const [newLinkUrl, setNewLinkUrl] = useState("");
  const [newLinkLabel, setNewLinkLabel] = useState("");

  const task = taskQuery.data;
  const canEdit = board.data?.can_edit ?? false;
  const isAdmin = me.data?.user?.is_admin === true || me.data?.auth_enabled === false;
  const dirty = base !== null && draft !== null && patchFrom(draft, base) !== null;
  const stale = base !== null && changedElsewhere(dirty, base.version, task?.version);

  useEffect(() => {
    if (!task || dirty) return;
    setBase(task);
    setDraft(draftOf(task));
  }, [task, dirty]);

  useMermaidCharts(editingDescription ? null : bodyEl, [rendered.data ?? "", theme], theme, undefined, {
    readOnly: true,
  });

  const requestClose = (): void => {
    if (dirty && !window.confirm("Discard your unsaved changes to this task?")) return;
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") requestClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const toastError = (fallback: string) => (err: unknown) => {
    dispatch(showToast({ message: apiErrorMessage(err, fallback), kind: "error" }));
  };

  const save = (): void => {
    if (!draft || !base) return;
    const changes = patchFrom(draft, base);
    if (!changes) return;
    updateTask({ id: taskId, projectId, patch: { expected_version: base.version, ...changes } })
      .unwrap()
      .then((next) => {
        setBase(next);
        setDraft(draftOf(next));
        setEditingDescription(false);
      })
      .catch(toastError("Could not save the task"));
  };

  /** Links and archiving apply at once. Unsaved field edits stay in the draft,
   *  because `patchFrom` compares them against the fields these do not touch. */
  const applyNow = (patch: Omit<TaskPatch, "expected_version">, fallback: string): Promise<boolean> => {
    if (!base) return Promise.resolve(false);
    return updateTask({ id: taskId, projectId, patch: { expected_version: base.version, ...patch } })
      .unwrap()
      .then((next) => {
        setBase(next);
        return true;
      })
      .catch((err: unknown) => {
        toastError(fallback)(err);
        return false;
      });
  };

  const discard = (): void => {
    if (!task) return;
    setBase(task);
    setDraft(draftOf(task));
    setEditingDescription(false);
  };

  const addLink = (e: React.FormEvent): void => {
    e.preventDefault();
    const url = newLinkUrl.trim();
    if (!url) return;
    const label = newLinkLabel.trim();
    void applyNow({ add_links: [{ url, ...(label ? { label } : {}) }] }, "Could not add the link").then((ok) => {
      // A refused link stays in the form, so it can be corrected.
      if (!ok) return;
      setNewLinkUrl("");
      setNewLinkLabel("");
    });
  };

  const remove = (): void => {
    if (!window.confirm(`Delete T${taskId} permanently? This cannot be undone.`)) return;
    deleteTask({ id: taskId, projectId }).unwrap().then(onClose).catch(toastError("Could not delete the task"));
  };

  const copyResume = (): void => {
    if (!base?.session_id) return;
    writeClipboard(
      `claude --resume ${base.session_id}`,
      () => dispatch(showToast({ message: "Copied", kind: "success" })),
      () => dispatch(showToast({ message: "Could not copy", kind: "error" })),
    );
  };

  const set = <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]): void => {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  };

  const memberList = members.data?.members ?? [];
  // A current assignee who has lost access must still show as selected.
  const assigneeOptions =
    base?.assignee && !memberList.some((m) => m.id === base.assignee?.id)
      ? [...memberList, base.assignee]
      : memberList;

  return (
    <div className="modal-backdrop show" onClick={requestClose}>
      <div
        className="modal task-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Task T${taskId}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header cal-panel-header">
          <span>T{taskId}</span>
          <button type="button" className="cal-panel-close" aria-label="Close" onClick={requestClose}>
            ×
          </button>
        </div>

        {taskQuery.error ? (
          <div className="task-modal-body">
            <p>Task not found. It may have been deleted.</p>
          </div>
        ) : !base || !draft ? (
          <div className="task-modal-body">
            <p>Loading…</p>
          </div>
        ) : (
          <div className="task-modal-body">
            {stale && (
              <div className="task-modal-stale" role="alert">
                <span>
                  This task changed while you were editing. Your text is still here. Copy anything you need, then load
                  the latest version.
                </span>
                <button type="button" onClick={discard}>
                  Discard my edits
                </button>
              </div>
            )}

            <label className="task-field task-field-wide">
              Title
              <input
                type="text"
                value={draft.title}
                maxLength={300}
                disabled={!canEdit}
                onChange={(e) => set("title", e.target.value)}
              />
            </label>

            <div className="task-field-grid">
              <label className="task-field">
                Status
                <select
                  value={draft.status}
                  disabled={!canEdit}
                  onChange={(e) => set("status", e.target.value as BoardStatus)}
                >
                  {BOARD_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="task-field">
                Assignee
                <select
                  value={draft.assignee_id ?? ""}
                  disabled={!canEdit}
                  onChange={(e) => set("assignee_id", e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Unassigned</option>
                  {assigneeOptions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.display_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="task-field">
                Start
                <input
                  type="date"
                  value={draft.start_date}
                  disabled={!canEdit}
                  onChange={(e) => set("start_date", e.target.value)}
                />
              </label>
              <label className="task-field">
                Due
                <input
                  type="date"
                  value={draft.due_date}
                  disabled={!canEdit}
                  onChange={(e) => set("due_date", e.target.value)}
                />
              </label>
            </div>

            <label className="task-field task-field-wide">
              Labels (comma-separated)
              <input
                type="text"
                value={draft.labels}
                disabled={!canEdit}
                onChange={(e) => set("labels", e.target.value)}
              />
            </label>

            <label className="task-field task-field-wide">
              Blocked because
              <input
                type="text"
                value={draft.blocked_reason}
                maxLength={1000}
                disabled={!canEdit}
                onChange={(e) => set("blocked_reason", e.target.value)}
              />
            </label>

            <div className="task-field task-field-wide">
              <div className="task-description-header">
                <span>Description</span>
                {canEdit && (
                  <button type="button" onClick={() => setEditingDescription((v) => !v)}>
                    {editingDescription ? "Preview saved" : "Edit"}
                  </button>
                )}
              </div>
              {editingDescription ? (
                <textarea
                  value={draft.description}
                  maxLength={20000}
                  rows={10}
                  onChange={(e) => set("description", e.target.value)}
                />
              ) : (
                <article
                  ref={setBodyEl}
                  className="markdown-body task-description"
                  dangerouslySetInnerHTML={{ __html: rendered.data ?? "" }}
                />
              )}
            </div>

            <div className="task-field task-field-wide">
              <span>Links</span>
              {base.links.length > 0 && (
                <ul className="task-links">
                  {base.links.map((link) => (
                    <li key={link.id}>
                      <a
                        href={link.url}
                        {...(link.url.startsWith("/") ? {} : { target: "_blank", rel: "noopener noreferrer" })}
                      >
                        {link.label ?? link.url}
                      </a>
                      {canEdit && (
                        <button
                          type="button"
                          aria-label={`Remove link ${link.label ?? link.url}`}
                          onClick={() => void applyNow({ remove_link_ids: [link.id] }, "Could not remove the link")}
                        >
                          ×
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {canEdit && (
                <form className="task-link-form" onSubmit={addLink}>
                  <input
                    type="text"
                    placeholder="https://… or /&3/#12"
                    aria-label="Link URL"
                    value={newLinkUrl}
                    onChange={(e) => setNewLinkUrl(e.target.value)}
                  />
                  <input
                    type="text"
                    placeholder="Label"
                    aria-label="Link label"
                    value={newLinkLabel}
                    onChange={(e) => setNewLinkLabel(e.target.value)}
                  />
                  <button type="submit" disabled={!newLinkUrl.trim()}>
                    Add
                  </button>
                </form>
              )}
            </div>

            <div className="task-field task-field-wide">
              <span>Agent session</span>
              <div className="task-session">
                <input
                  type="text"
                  value={draft.session_id}
                  maxLength={200}
                  disabled={!canEdit}
                  aria-label="Agent session id"
                  onChange={(e) => set("session_id", e.target.value)}
                />
                <button type="button" disabled={!base.session_id} onClick={copyResume}>
                  Copy resume command
                </button>
              </div>
            </div>

            <div className="task-modal-actions">
              {canEdit && (
                <button
                  type="button"
                  onClick={() =>
                    void applyNow({ archived: !base.archived }, "Could not change the archive state")
                  }
                >
                  {base.archived ? "Unarchive" : "Archive"}
                </button>
              )}
              {isAdmin && base.archived && (
                <button type="button" className="task-danger" onClick={remove}>
                  Delete permanently
                </button>
              )}
              <span className="task-modal-spacer" />
              <button type="button" onClick={requestClose}>
                Close
              </button>
              {canEdit && (
                <button type="button" className="primary" disabled={!dirty || saving} onClick={save}>
                  {saving ? "Saving…" : "Save"}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Open it from the project view**

In `client/src/components/ProjectView.tsx`:

Add the import:

```ts
import { TaskModal } from "./TaskModal";
```

Change the destructuring:

```ts
  const { projectId, month, view, taskId } = location;
```

Add after `openTask`:

```ts
  const closeTask = useCallback(() => {
    navigateTo({ kid: null }, { search: buildTaskSearch(currentQueryString(), null) });
  }, []);
```

Add before the closing `</section>`:

```tsx
      {taskId != null && <TaskModal key={taskId} projectId={projectId} taskId={taskId} onClose={closeTask} />}
```

- [ ] **Step 8: Add the styles**

Append to `client/src/styles/theme.css`:

```css

/* ─── Task modal ─── */
.task-modal { max-width: 720px; width: 100%; }
.task-modal-body {
  display: flex; flex-direction: column; gap: 12px;
  padding: 14px 18px 18px;
  max-height: 80vh; overflow-y: auto;
}
.task-modal-stale {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  padding: 10px 12px;
  border: 1px solid var(--amber); border-radius: var(--radius-sm);
  background: var(--amber-light); color: var(--text);
  font-size: 13px;
}
.task-field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 600; color: var(--text-2); min-width: 0; }
.task-field input, .task-field select, .task-field textarea {
  padding: 6px 8px;
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: var(--surface); color: var(--text);
  font: inherit; font-size: 13px; font-weight: 400;
}
.task-field input:disabled, .task-field select:disabled { background: var(--surface-2); color: var(--text-2); }
.task-field-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.task-description-header { display: flex; align-items: center; justify-content: space-between; }
.task-description-header button, .task-links button, .task-link-form button, .task-session button, .task-modal-actions button {
  padding: 4px 10px;
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: var(--surface); color: var(--text);
  font: inherit; font-size: 12.5px; font-weight: 400; cursor: pointer;
}
.task-modal-actions button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
.task-modal-actions button:disabled, .task-session button:disabled, .task-link-form button:disabled { opacity: .55; cursor: default; }
.task-modal-actions button.task-danger { color: var(--red); border-color: var(--red); }
.task-description {
  padding: 8px 10px; min-height: 48px;
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  font-weight: 400;
}
.task-links { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-weight: 400; }
.task-links li { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 13px; overflow-wrap: anywhere; }
.task-link-form { display: flex; gap: 6px; flex-wrap: wrap; }
.task-link-form input { flex: 1; min-width: 140px; }
.task-session { display: flex; gap: 6px; flex-wrap: wrap; }
.task-session input { flex: 1; min-width: 180px; }
.task-modal-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.task-modal-spacer { flex: 1; }
```

- [ ] **Step 9: Verify and commit**

Run: `npm run typecheck && npx vitest run test/task-draft.test.ts`
Expected: PASS, and no type errors.

```bash
git add client/src/lib/taskDraft.ts client/src/components/TaskModal.tsx client/src/components/ProjectView.tsx client/src/lib/badgeMenu.ts client/src/styles/theme.css test/task-draft.test.ts
git commit -m "feat: add a task modal that protects unsaved edits"
```

---

### Task 9: Tasks on the calendar

**Files:**
- Modify: `client/src/components/CalendarView.tsx`
- Modify: `client/src/components/ProjectView.tsx`
- Modify: `client/src/styles/theme.css` (append)

**Interfaces:**
- Consumes: `useListProjectTasksQuery`, `TaskRow`, `tasksByDate`, `isOverdue`, `CalendarTaskEntry` from Task 6.
- Produces: `CalendarView` gains the required prop `onOpenTask: (id: number) => void`.

The bucketing and overdue logic is already tested in Task 6.

- [ ] **Step 1: Load tasks into the calendar**

In `client/src/components/CalendarView.tsx`:

Change the store and grid imports:

```ts
import {
  useGetProjectCalendarQuery,
  useListProjectTasksQuery,
  useListProjectsQuery,
  type CalendarDay,
  type TaskRow,
} from "../store/api";
```

```ts
import {
  filterDays,
  isOverdue,
  monthGrid,
  monthOf,
  shiftMonth,
  tasksByDate,
  todayLocal,
  type CalendarTaskEntry,
} from "../lib/calendarGrid";
```

Add after the `K_COLORS` constant:

```ts
type DayTask = CalendarTaskEntry<TaskRow>;
```

Update the doc comment on `useStoredFlag` to mention tasks:

```ts
/**
 * A view toggle remembered in this browser. `showPages` (off by default)
 * lists pages in day cells — the day dialog always shows them; `created` /
 * `edited` (both on by default) pick which kind of change is shown anywhere;
 * `tasks` (on by default) shows task start and due dates.
 */
```

Change `Props`:

```ts
interface Props {
  projectId: number;
  /** `YYYY-MM`, or null for the current month. */
  month: string | null;
  onOpenTask: (id: number) => void;
}
```

Change the component signature, and add inside it after `const [showEdited, toggleEdited] = ...`:

```ts
export function CalendarView({ projectId, month, onOpenTask }: Props): JSX.Element {
```

```ts
  const [showTasks, toggleTasks] = useStoredFlag("tasks", true);
```

After the `byDate` memo, add:

```ts
  const taskQuery = useListProjectTasksQuery({ projectId });
  const tasksOnDay = useMemo(
    () => tasksByDate(showTasks ? taskQuery.data?.tasks ?? [] : [], grid.from, grid.to),
    [showTasks, taskQuery.data, grid.from, grid.to],
  );
  const tasksDue = useMemo(() => {
    let n = 0;
    for (const [date, entries] of tasksOnDay) {
      if (monthOf(date) === shown) n += entries.filter((e) => e.kind === "due").length;
    }
    return n;
  }, [tasksOnDay, shown]);
```

Replace the stats span's content:

```tsx
          <span className="cal-stats">
            {error
              ? ""
              : `${stats.docs} knowledge · ${stats.pages} pages · ${stats.days} active days · ${tasksDue} tasks due`}
            {isFetching ? " · loading…" : ""}
            {taskQuery.error ? " · could not load tasks" : ""}
          </span>
```

Add a toggle, directly before the `Show pages` button:

```tsx
          <button
            type="button"
            className={`cal-toggle cal-toggle-tasks${showTasks ? " on" : ""}`}
            aria-pressed={showTasks}
            onClick={toggleTasks}
            title={showTasks ? "Hide tasks" : "Show tasks"}
          >
            Tasks
          </button>
```

Add two props to `<DayCell ...>`:

```tsx
              tasks={tasksOnDay.get(date) ?? []}
              onOpenTask={onOpenTask}
```

and two to `<DayPanel ...>`:

```tsx
        <DayPanel
          date={openDay}
          day={byDate.get(openDay)}
          tasks={tasksOnDay.get(openDay) ?? []}
          onOpenTask={onOpenTask}
          onClose={() => setOpenDay(null)}
        />
```

- [ ] **Step 2: Show tasks in day cells**

Replace the whole `DayCell` function:

```tsx
function DayCell({
  date,
  day,
  tasks,
  outside,
  today,
  showPages,
  onOpen,
  onOpenTask,
}: {
  date: string;
  day: CalendarDay | undefined;
  tasks: DayTask[];
  outside: boolean;
  today: boolean;
  showPages: boolean;
  onOpen: () => void;
  onOpenTask: (id: number) => void;
}): JSX.Element {
  const dayNum = Number(date.slice(8));
  const total = day?.knowledge.reduce((n, k) => n + k.pages.length, 0) ?? 0;
  const hasItems = total > 0 || tasks.length > 0;

  // Fill the cell line by line, tasks first; whatever doesn't fit becomes
  // "+N more" (pages when they are listed, knowledge when only knowledge is).
  const taskLines = tasks.slice(0, CELL_LINES);
  const knowledge = day?.knowledge ?? [];
  let budget = CELL_LINES - taskLines.length;
  let hidden = tasks.length - taskLines.length;
  const groups: JSX.Element[] = [];
  if (showPages) {
    let shownPages = 0;
    for (const k of knowledge) {
      if (budget < 2) break; // a header alone is not worth a line
      budget--;
      const pages = k.pages.slice(0, budget);
      budget -= pages.length;
      shownPages += pages.length;
      groups.push(<KnowledgeGroup key={k.id} k={k} pages={pages} />);
    }
    hidden += total - shownPages;
  } else {
    for (const k of knowledge.slice(0, budget)) {
      groups.push(<KnowledgeGroup key={k.id} k={k} pages={[]} compact />);
    }
    hidden += Math.max(0, knowledge.length - budget);
  }

  const cls = ["cal-day"];
  if (outside) cls.push("outside");
  if (today) cls.push("today");
  if (hasItems) cls.push("has-items");

  const description = [
    total ? `${total} pages` : "",
    tasks.length ? `${tasks.length} tasks` : "",
  ].filter(Boolean).join(", ");

  return (
    <div className={cls.join(" ")} onClick={hasItems ? onOpen : undefined}>
      <button
        type="button"
        className="cal-daynum"
        onClick={(e) => {
          e.stopPropagation();
          if (hasItems) onOpen();
        }}
        aria-label={`${longDateLabel(date)}${description ? `, ${description}` : ""}`}
      >
        {dayNum}
      </button>
      {total > 0 && <span className="cal-count">{total}</span>}
      <div className="cal-items">
        {taskLines.map((entry) => (
          <TaskLine key={`${entry.task.id}-${entry.kind}`} entry={entry} onOpenTask={onOpenTask} />
        ))}
        {groups}
        {hidden > 0 && (
          <button
            type="button"
            className="cal-more"
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
          >
            +{hidden} more
          </button>
        )}
      </div>
    </div>
  );
}

function TaskLine({ entry, onOpenTask }: { entry: DayTask; onOpenTask: (id: number) => void }): JSX.Element {
  const { task, kind } = entry;
  const cls = ["cal-task", `cal-task-${kind}`];
  if (isOverdue(task, todayLocal())) cls.push("overdue");
  if (task.status === "done") cls.push("done");
  return (
    <button
      type="button"
      className={cls.join(" ")}
      title={`${kind === "due" ? "Due" : "Starts"} — T${task.id} ${task.title}${
        task.blocked_reason ? ` (blocked: ${task.blocked_reason})` : ""
      }`}
      onClick={(e) => {
        e.stopPropagation();
        onOpenTask(task.id);
      }}
    >
      <span className="cal-task-mark" aria-hidden="true">
        {kind === "due" ? "⚑" : "▸"}
      </span>
      <span className="cal-task-text">
        T{task.id} {task.title}
      </span>
      {task.blocked_reason && <span className="cal-task-blocked">!</span>}
    </button>
  );
}
```

- [ ] **Step 3: Show tasks in the day panel**

Replace the signature and body section of `DayPanel`:

```tsx
function DayPanel({
  date,
  day,
  tasks,
  onOpenTask,
  onClose,
}: {
  date: string;
  day: CalendarDay | undefined;
  tasks: DayTask[];
  onOpenTask: (id: number) => void;
  onClose: () => void;
}): JSX.Element {
```

```tsx
        <div className="cal-panel-body">
          {tasks.map((entry) => (
            <TaskLine
              key={`${entry.task.id}-${entry.kind}`}
              entry={entry}
              onOpenTask={(id) => {
                onClose();
                onOpenTask(id);
              }}
            />
          ))}
          {(day?.knowledge ?? []).map((k) => (
            <KnowledgeGroup key={k.id} k={k} pages={k.pages} />
          ))}
          {!day && tasks.length === 0 && <p className="cal-empty">Nothing created, edited or due on this day.</p>}
        </div>
```

- [ ] **Step 4: Pass the handler, and add styles**

In `client/src/components/ProjectView.tsx`, change the calendar line:

```tsx
      {view === "calendar" && <CalendarView projectId={projectId} month={month} onOpenTask={openTask} />}
```

Append to `client/src/styles/theme.css`:

```css

/* ─── Tasks on the calendar ─── */
.cal-task {
  display: flex; align-items: center; gap: 4px; min-width: 0;
  padding: 1px 4px;
  border: none; border-radius: var(--radius-sm);
  background: var(--accent-light); color: var(--accent-strong);
  font: inherit; font-size: 11.5px; text-align: left; cursor: pointer;
}
.cal-task:hover { filter: brightness(.97); }
.cal-task-start { background: var(--surface-2); color: var(--text-2); }
.cal-task.overdue { background: var(--red-light); color: var(--red); font-weight: 600; }
.cal-task.done { background: transparent; color: var(--text-3); }
.cal-task.done .cal-task-text { text-decoration: line-through; }
.cal-task-mark { flex: none; }
.cal-task-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cal-task-blocked { flex: none; color: var(--red); font-weight: 700; }
.cal-panel-body .cal-task { font-size: 13px; padding: 3px 6px; }
.cal-panel-body .cal-task-text { white-space: normal; }
```

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck && npm test`
Expected: PASS, with no type errors.

```bash
git add client/src/components/CalendarView.tsx client/src/components/ProjectView.tsx client/src/styles/theme.css
git commit -m "feat: show task start and due dates on the project calendar"
```

---

### Task 10: Documentation

**Files:**
- Modify: `client/src/components/HelpModal.tsx`
- Modify: `docs/skill/SKILL.md`, then copy to `~/.claude/skills/wikikai/SKILL.md`
- Modify: `AGENTS.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: the finished feature.
- Produces: nothing used by code. The pre-push hook compares the two `SKILL.md` copies.

- [ ] **Step 1: Update the in-app help, English tab**

In `client/src/components/HelpModal.tsx`, add directly after the English `<tr>` that starts `<tr><td>Project calendar</td>`:

```tsx
          <tr><td>Project tasks</td><td>The calendar icon opens the project's <strong>Calendar</strong>, <strong>Board</strong> and <strong>List</strong> tabs. Drag a card to change its status or its place in the queue: the board order is the order agents pick up work. Add a task in the box under <Kbd>Todo</Kbd>, and click a title to open it. Tasks with a start or due date appear on the calendar; overdue tasks are red. Archive a task to hide it. Only an admin can delete an archived task.</td></tr>
```

Add directly after the English `<tr>` for `/?calendar=7&amp;month=2026-09`:

```tsx
          <tr><td><code>/?calendar=7&amp;view=board&amp;task=12</code></td><td>board of project id 7, with task T12 open (<code>view</code> is <code>board</code> or <code>list</code>; omit it for the calendar)</td></tr>
```

Add directly before `<h3>Block ids (<code>@N</code>) + captions</h3>`:

```tsx
      <h3>Tools — Project tasks</h3>
      <table>
        <thead><tr><th>Tool</th><th>Purpose</th></tr></thead>
        <tbody>
          <tr><td><code>add_task</code></td><td>Create a task on a project's board. Args: <code>{`{ project, title, description?, status?, assignee?, start_date?, due_date?, labels?, links?, session_id?, position? }`}</code>.</td></tr>
          <tr><td><code>list_tasks</code></td><td>Compact rows in board order; defaults to todo, doing and review. Pass <code>next: true</code> for the next task to claim.</td></tr>
          <tr><td><code>get_task</code></td><td>One task in full, with description and links.</td></tr>
          <tr><td><code>edit_task</code></td><td>Change any field, move status, add or remove links, archive. <code>expected_version</code> is required, so two sessions cannot claim one task.</td></tr>
        </tbody>
      </table>
      <p>A board task is not a page checkbox: <code>toggle_task</code> flips a <code>- [ ]</code> inside a page.</p>
```

- [ ] **Step 2: Update the in-app help, Thai tab**

Add directly after the Thai `<tr>` that starts `<tr><td>ปฏิทินของ project</td>`:

```tsx
          <tr><td>งานของ project</td><td>ไอคอนปฏิทินจะเปิดแท็บ <strong>Calendar</strong>, <strong>Board</strong> และ <strong>List</strong> ของ project นั้น ลากการ์ดเพื่อเปลี่ยนสถานะหรือลำดับคิว โดยลำดับบนบอร์ดคือลำดับที่ agent จะหยิบงาน เพิ่มงานได้จากช่องใต้ <Kbd>Todo</Kbd> และคลิกชื่องานเพื่อเปิดดู งานที่มีวันเริ่มหรือวันครบกำหนดจะขึ้นบนปฏิทิน และงานที่เลยกำหนดจะเป็นสีแดง ซ่อนงานได้ด้วยการ archive ส่วนการลบงานที่ archive แล้วทำได้เฉพาะ admin</td></tr>
```

Add directly after the Thai `<tr>` for `/?calendar=7&amp;month=2026-09`:

```tsx
          <tr><td><code>/?calendar=7&amp;view=board&amp;task=12</code></td><td>บอร์ดของ project id 7 พร้อมเปิดงาน T12 (<code>view</code> เป็น <code>board</code> หรือ <code>list</code> ไม่ใส่ = ปฏิทิน)</td></tr>
```

- [ ] **Step 3: Update the skill**

In `docs/skill/SKILL.md`:

In the frontmatter `description`, directly before the closing sentence that begins `Skip for transient answers`, add:

```text
Also INVOKE when the user asks to create or update tasks on a project's board, or to pick up work ("ทำงานถัดไป", "next task on the board", "T12").
```

Add directly above `### Interactive checkboxes (GFM, not a fence)`:

```markdown
### Project tasks (the board, not page checkboxes)
A task is tracked work on a project's board, written `T12`. A page checkbox (`- [ ]`, `toggle_task`) is content inside a document. If the user says "next task on the board", or names `T12`, use these tools.

- `add_task({ project, title, description?, status?, assignee?, start_date?, due_date?, labels?, links?, session_id?, position? })` — returns the full task with `version` and `url`.
- `list_tasks({ project, status?, assignee?, label?, include_archived?, limit?, next? })` — compact rows in board order, defaulting to `todo`, `doing` and `review`. `next: true` returns only the next task to claim.
- `get_task({ task_id })` — one task in full, with description and links.
- `edit_task({ task_id, expected_version, ...fields, add_links?, remove_link_ids?, archived?, position? })` — returns the full task with its new `version`. Tasks cannot be deleted over MCP; archive instead.
- `assignee` is `"me"`, or a project member's display name or email. These tools do not take `user_prompt`.

**Picking up work.** When told to do the next task:

1. `list_tasks({ project, next: true })`. An empty list means the queue is empty, so say so and stop.
2. Claim it: `edit_task({ task_id, expected_version, status: "doing", assignee: "me", session_id })`. `STALE` means another session took it, so go back to step 1.
3. Do the work described in the returned `description` and `links`.
4. Finish: `edit_task({ task_id, expected_version, status: "review", add_links: [...] })`, linking the commit or the WikiKai page. Set `done` only when the user says so.

**If stuck**, set `blocked_reason` and stop, leaving the task in `doing`. `next` skips blocked tasks.

**Keep descriptions short.** Up to 20,000 characters, with no revision history, so an overwrite loses the old text. Put anything worth keeping on a wiki page and link it from the task.

```

- [ ] **Step 4: Update repo docs**

In `AGENTS.md`:

Change the line `mcp/server.ts        registers 35 tools on McpServer (input schemas come from handlers.ts)` to say `39 tools`.

Add to the repo layout, after the `store/pages.ts` line:

```text
  store/tasks.ts       project tasks: board order, claims, validation — every task rule
```

Add after the `web/app.ts` line:

```text
  web/taskRoutes.ts    REST routes for project tasks, thin over TaskStore
```

In `README.md`, add to the `Why WikiKai?` list, directly after the `Let AI do the work.` bullet:

```markdown
- **Track the work too.** Each project has a board, a task list and a calendar. AI can pick up the next task, link what it produced, and leave it for your review.
```

- [ ] **Step 5: Sync the skill, verify, and commit**

```bash
cp docs/skill/SKILL.md ~/.claude/skills/wikikai/SKILL.md
cmp docs/skill/SKILL.md ~/.claude/skills/wikikai/SKILL.md
npm run typecheck
git grep --cached -nIE '10\.[0-9]+\.[0-9]+\.[0-9]+|root@|/root/|/mnt/data|ssh |cupcode\.cc' -- docs/superpowers/plans/2026-11-02-project-tasks-core.md docs/superpowers/specs/2026-11-02-project-tasks-core-design.md README.md docs/skill/SKILL.md
```

Expected: `cmp` prints nothing, typecheck passes, and every grep hit has a reason. The AGENTS grep includes `ssh ` and similar, so read each hit.

```bash
git add client/src/components/HelpModal.tsx docs/skill/SKILL.md AGENTS.md README.md
git commit -m "docs: document project tasks in help, skill and repo docs"
```

---

### Task 11: Verify on dev, release, and hand over the deploy

**Files:**
- Create and delete: `scripts/e2e-tasks.local.ts` (one-shot, never committed)
- Modify: `package.json`, `package-lock.json` (version)

**Interfaces:**
- Consumes: everything above. Coordinates for the dev instance come from `CLAUDE.local.md`.
- Produces: tag `v0.33.0` and a GitHub Release. The production deploy and the tutorial `&4` update wait for the owner's confirmation.

- [ ] **Step 1: Run the gates**

Run: `npm run typecheck && npm test`
Expected: PASS. Note the test count in your report. The baseline before this work was 554 tests in 24 files.

- [ ] **Step 2: Build and restart the dev instance**

Use the process name from `CLAUDE.local.md`, and confirm it still has its own database:

```bash
npm run build && pm2 restart <dev-process>
ls -l /proc/$(pm2 pid <dev-process>)/fd | grep index.db
curl -s -o /dev/null -w '%{http_code}\n' https://<dev-site>/login
```

Expected: `index.db` is under the dev data directory, and the status is 200.

- [ ] **Step 3: Run the agent flow over real MCP**

Create `scripts/e2e-tasks.local.ts`. It holds no coordinates, because they come from the environment:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.env.E2E_URL;
const token = process.env.E2E_TOKEN;
if (!url) throw new Error("set E2E_URL to the dev instance's /mcp URL");

async function connect(): Promise<Client> {
  const client = new Client({ name: "e2e-tasks", version: "0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url as string), {
      requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
    }),
  );
  return client;
}

async function call<T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> {
  const res = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: { type: string; text: string }[];
  };
  if (res.isError) throw new Error(res.content[0].text);
  return JSON.parse(res.content[0].text) as T;
}

interface TaskLite {
  id: number;
  version: number;
  status: string;
  url: string;
}

async function main(): Promise<void> {
  const a = await connect();
  const b = await connect();
  // A unique name per run, so the queue starts empty on a repeat run.
  const project = `e2e-tasks-${Date.now()}`;
  await call(a, "add_knowledge", { title: "E2E tasks", project });

  const first = await call<TaskLite>(a, "add_task", { project, title: "First" });
  const second = await call<TaskLite>(a, "add_task", { project, title: "Second" });
  console.log("created", first.url);

  const { tasks: next } = await call<{ tasks: TaskLite[] }>(a, "list_tasks", { project, next: true });
  if (next[0].id !== first.id) throw new Error("next did not return the first task");

  const claims = await Promise.allSettled(
    [a, b].map((c) =>
      call<TaskLite>(c, "edit_task", {
        task_id: first.id,
        expected_version: first.version,
        status: "doing",
        assignee: "me",
        session_id: "e2e",
      }),
    ),
  );
  const won = claims.filter((r) => r.status === "fulfilled");
  const lost = claims.filter((r) => r.status === "rejected");
  const reason = String((lost[0] as PromiseRejectedResult | undefined)?.reason);
  if (won.length !== 1 || lost.length !== 1 || !reason.includes("STALE")) {
    throw new Error(`expected one claim to win: ${JSON.stringify(claims)}`);
  }
  console.log("two claims: one won, one got STALE");

  const claimed = (won[0] as PromiseFulfilledResult<TaskLite>).value;
  const reviewed = await call<TaskLite>(a, "edit_task", {
    task_id: first.id,
    expected_version: claimed.version,
    status: "review",
    add_links: [{ url: "https://example.com/commit/abc", label: "commit" }],
  });
  if (reviewed.status !== "review") throw new Error("not in review");

  const { tasks: after } = await call<{ tasks: TaskLite[] }>(a, "list_tasks", { project, next: true });
  if (after[0].id !== second.id) throw new Error("next did not move on");

  console.log("flow ok. Board:", second.url);
  await a.close();
  await b.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

Run it, passing a token only on this one command line (the token and URL are in `CLAUDE.local.md` or the dev `.env`):

```bash
E2E_URL=https://<dev-site>/mcp E2E_TOKEN=<token> npx tsx scripts/e2e-tasks.local.ts
```

Expected: `two claims: one won, one got STALE`, then `flow ok`.

Delete the script afterwards:

```bash
rm scripts/e2e-tasks.local.ts
git status -s
```

Expected: no output.

- [ ] **Step 4: Ask the owner to check the browser**

This agent may not have a browser. If one is available, do this yourself. Otherwise, ask the owner to open the printed board URL on the dev site and confirm:

1. The calendar icon opens Calendar, with Board and List tabs.
2. A card drags between columns and within one, and stays put after a reload.
3. With two tabs open, a card moved in one appears in the other without a reload.
4. A task with a due date shows on the calendar. An overdue one is red. A done one is struck through.
5. Open a task, type in the description, have an agent (or another tab) change that task, and confirm the banner appears and the typed text stays.
6. Old links of the form `/?calendar=<id>&month=YYYY-MM` still open the calendar.

Fix anything found through the normal test-first loop before going on. Dev data is disposable, so the `e2e-tasks-*` projects can stay.

- [ ] **Step 5: Push and release**

Check no release has been cut in the meantime, then release:

```bash
git fetch origin && git status -sb
npm version 0.33.0 --no-git-tag-version
git add package.json package-lock.json
git commit -m "chore(release): v0.33.0"
git tag -a v0.33.0 -m "v0.33.0 — project tasks: board, list, calendar dates, MCP tools"
git push origin main && git push origin v0.33.0
gh release create v0.33.0 --title "v0.33.0" --notes "Each project now has a task board and list behind its calendar icon, with task dates on the calendar. Four new MCP tools (add_task, list_tasks, get_task, edit_task) let an agent claim the next task, link its work and leave it for review."
```

Expected: the pre-push hook passes, because the skill copies match. If `git status -sb` shows `main` behind, stop and report instead of forcing anything.

- [ ] **Step 6: Hand over the deploy**

Do not deploy without the owner's confirmation. Report:

- The release link.
- That production still runs the old build until the deploy step in `CLAUDE.local.md` runs.
- That after the deploy, tutorial `&4` needs updating through production's MCP: page `#19` (tool count and overview) and page `#26` (MCP workflow), both by `edit_section`.
- That the wikikai skill was changed on this machine's global copy, and other machines' copies need the same update.
