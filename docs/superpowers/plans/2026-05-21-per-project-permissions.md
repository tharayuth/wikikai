# Per-Project Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate every knowledge / page / activity-log surface (HTTP + MCP) on a per-(user, project) ACL, manageable by admins via the existing Users dialog. Bundle a small UX fix: the Activity Log dialog auto-refreshes via SSE whenever a new log row is recorded.

**Architecture:** A new `project_permissions` junction table is the single source of truth. A pure helper `assertProjectAccess(user, project, need)` is called from every web route and every MCP handler that touches a knowledge document. Admins bypass the check (`is_admin = 1`); non-admins need a row at the right level. List endpoints filter by "visible projects". `ActivityLogStore.record()` broadcasts a new SSE event so any open dialog refreshes without polling.

**Tech Stack:** Node 20 + TypeScript, Express, better-sqlite3, Zod, RTK Query, React 18, Vitest + Supertest.

**Reference:** Design spec → `docs/superpowers/specs/2026-05-21-per-project-permissions-design.md`.

---

## File map

**Server (create)**
- `src/lib/permissions.ts` — `ForbiddenError`, `AccessLevel`, `assertProjectAccess`
- `src/store/permissions.ts` — `PermissionStore` (CRUD on `project_permissions`)
- `test/permissions.test.ts` — unit tests for helper + store

**Server (modify)**
- `src/store/schema.sql` — append `project_permissions` table + index
- `src/lib/config.ts` — read `WIKIKAI_PROJECT_ACL` env (default true)
- `src/server.ts` — instantiate `PermissionStore`, pass into `buildApp` + `buildToolHandlers` + `createMcpServer`
- `src/web/app.ts` — wire `permissions` opt; add project-ACL checks to existing routes; admin-only `/api/projects` mutation; 403 handler; new SSE event type
- `src/web/auth.ts` — add `/api/admin/users/:id/permissions` GET + PUT
- `src/web/sse.ts` — declare new `activity-logged` event in the union (file may need creation if not present — verify first)
- `src/store/activityLog.ts` — broadcast event after insert; filter `list()` by visible projects
- `src/store/knowledge.ts` — `add()` / `update()` reject empty project; new `listVisibleForUser(user, perms)` helper
- `src/mcp/handlers.ts` — Zod `project` required on `add_knowledge` / `edit_knowledge`; every handler resolves the project of the target and calls `assertProjectAccess`

**Client (modify)**
- `client/src/store/api.ts` — new endpoints `listUserPermissions`, `updateUserPermissions`; new tag `Permissions`
- `client/src/components/UsersAdminModal.tsx` — Project-access section in `EditUserForm`
- `client/src/hooks/useServerEvents.ts` — handle `activity-logged`
- `client/src/components/HelpModal.tsx` — permissions section (EN + TH)

**Tests**
- `test/permissions.test.ts` (new)
- `test/web.test.ts` (extend)
- `test/tools.test.ts` (extend)

---

## Task 1 — Schema: add `project_permissions` table

**Files:**
- Modify: `src/store/schema.sql`
- Test: `test/permissions.test.ts` (new)

- [ ] **Step 1.1: Append the table to `src/store/schema.sql`**

Append at the end of the file, after the existing tables:

```sql
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
```

- [ ] **Step 1.2: Write the first failing test**

Create `test/permissions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { openDb } from "../src/store/db.js";

describe("project_permissions table", () => {
  it("exists with the expected columns", () => {
    const db = openDb(":memory:");
    const cols = db
      .prepare("PRAGMA table_info(project_permissions)")
      .all() as Array<{ name: string; type: string; notnull: number }>;
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(
      ["granted_at", "granted_by", "level", "project_name", "user_id"].sort(),
    );
  });
});
```

- [ ] **Step 1.3: Run the test**

Run: `npx vitest run test/permissions.test.ts`
Expected: PASS (the schema file is applied by `openDb` automatically).

If it fails because `openDb` doesn't apply `schema.sql` to in-memory DBs, inspect `src/store/db.ts` and adjust. The existing pattern (used by every other test) is that `openDb(":memory:")` runs `schema.sql` on open.

- [ ] **Step 1.4: Commit**

```bash
git add src/store/schema.sql test/permissions.test.ts
git commit -m "feat(perms): add project_permissions table"
```

---

## Task 2 — `PermissionStore`

**Files:**
- Create: `src/store/permissions.ts`
- Modify: `test/permissions.test.ts`

- [ ] **Step 2.1: Write the failing tests**

Append to `test/permissions.test.ts`:

```ts
import { PermissionStore } from "../src/store/permissions.js";
import { UserStore } from "../src/store/users.js";

describe("PermissionStore", () => {
  function setup() {
    const db = openDb(":memory:");
    const users = new UserStore(db);
    users.create({ email: "admin", password: "x", display_name: "Admin", is_admin: true });
    const alice = users.create({ email: "alice", password: "x", display_name: "Alice" });
    db.prepare("INSERT INTO projects (name, created_at) VALUES (?, ?)").run(
      "examples", new Date().toISOString(),
    );
    db.prepare("INSERT INTO projects (name, created_at) VALUES (?, ?)").run(
      "secret", new Date().toISOString(),
    );
    return { db, users, alice };
  }

  it("get() returns null when no row", () => {
    const { db, alice } = setup();
    const perms = new PermissionStore(db);
    expect(perms.get(alice.id, "examples")).toBeNull();
  });

  it("replaceForUser inserts rows + get() returns them", () => {
    const { db, alice } = setup();
    const perms = new PermissionStore(db);
    perms.replaceForUser(alice.id, [
      { project: "examples", level: "view" },
      { project: "secret", level: "edit" },
    ], /* granted_by */ 1);
    expect(perms.get(alice.id, "examples")).toEqual({ level: "view" });
    expect(perms.get(alice.id, "secret")).toEqual({ level: "edit" });
  });

  it("replaceForUser is atomic — replaces the whole set", () => {
    const { db, alice } = setup();
    const perms = new PermissionStore(db);
    perms.replaceForUser(alice.id, [
      { project: "examples", level: "view" },
      { project: "secret", level: "edit" },
    ], 1);
    perms.replaceForUser(alice.id, [
      { project: "examples", level: "edit" }, // upgrade
      // secret omitted → revoked
    ], 1);
    expect(perms.get(alice.id, "examples")).toEqual({ level: "edit" });
    expect(perms.get(alice.id, "secret")).toBeNull();
  });

  it("listForUser returns sorted rows", () => {
    const { db, alice } = setup();
    const perms = new PermissionStore(db);
    perms.replaceForUser(alice.id, [
      { project: "secret", level: "edit" },
      { project: "examples", level: "view" },
    ], 1);
    expect(perms.listForUser(alice.id)).toEqual([
      { project: "examples", level: "view" },
      { project: "secret", level: "edit" },
    ]);
  });

  it("listVisibleProjects: admin → all known projects, non-admin → granted set", () => {
    const { db, alice } = setup();
    const perms = new PermissionStore(db);
    perms.replaceForUser(alice.id, [{ project: "examples", level: "view" }], 1);
    expect(perms.listVisibleProjects(alice.id, /* is_admin */ false)).toEqual([
      "examples",
    ]);
    expect(perms.listVisibleProjects(1, true).sort()).toEqual(
      ["examples", "secret"].sort(),
    );
  });
});
```

- [ ] **Step 2.2: Run tests to verify they fail**

Run: `npx vitest run test/permissions.test.ts`
Expected: FAIL — `Cannot find module '../src/store/permissions.js'`.

- [ ] **Step 2.3: Implement `PermissionStore`**

Create `src/store/permissions.ts`:

```ts
import type { Db } from "./db.js";

export type AccessLevel = "view" | "edit";
export interface PermissionEntry {
  project: string;
  level: AccessLevel;
}

/**
 * CRUD for `project_permissions`. Missing row ≡ no access — there is no
 * "none" level stored; callers translate absence to none. Admins bypass
 * this store entirely; methods here treat every user the same.
 */
export class PermissionStore {
  constructor(private db: Db) {}

  get(user_id: number, project: string): { level: AccessLevel } | null {
    const row = this.db
      .prepare(
        `SELECT level FROM project_permissions
         WHERE user_id = ? AND project_name = ?`,
      )
      .get(user_id, project) as { level: AccessLevel } | undefined;
    return row ?? null;
  }

  listForUser(user_id: number): PermissionEntry[] {
    return this.db
      .prepare(
        `SELECT project_name AS project, level
         FROM project_permissions
         WHERE user_id = ?
         ORDER BY project_name`,
      )
      .all(user_id) as PermissionEntry[];
  }

  /** Replace the user's entire permission set in one transaction. */
  replaceForUser(
    user_id: number,
    entries: PermissionEntry[],
    granted_by: number | null,
  ): void {
    const now = new Date().toISOString();
    const del = this.db.prepare(
      `DELETE FROM project_permissions WHERE user_id = ?`,
    );
    const ins = this.db.prepare(
      `INSERT INTO project_permissions
         (user_id, project_name, level, granted_at, granted_by)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const tx = this.db.transaction((rows: PermissionEntry[]) => {
      del.run(user_id);
      for (const r of rows) ins.run(user_id, r.project, r.level, now, granted_by);
    });
    tx(entries);
  }

  /**
   * For non-admins: distinct project names the user has any row for.
   * For admins: the UNION of `projects` and distinct `knowledge.project`
   * (same set the existing `/api/projects` lists).
   */
  listVisibleProjects(user_id: number, is_admin: boolean): string[] {
    if (is_admin) {
      const rows = this.db
        .prepare(
          `SELECT name FROM (
             SELECT name FROM projects
             UNION
             SELECT project AS name FROM knowledge WHERE project IS NOT NULL
           ) ORDER BY name`,
        )
        .all() as Array<{ name: string }>;
      return rows.map((r) => r.name);
    }
    const rows = this.db
      .prepare(
        `SELECT project_name AS name FROM project_permissions
         WHERE user_id = ? ORDER BY project_name`,
      )
      .all(user_id) as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }
}
```

- [ ] **Step 2.4: Run tests to verify they pass**

Run: `npx vitest run test/permissions.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 2.5: Commit**

```bash
git add src/store/permissions.ts test/permissions.test.ts
git commit -m "feat(perms): PermissionStore CRUD with replaceForUser transaction"
```

---

## Task 3 — `assertProjectAccess` helper + kill switch

**Files:**
- Create: `src/lib/permissions.ts`
- Modify: `src/lib/config.ts`
- Modify: `test/permissions.test.ts`

- [ ] **Step 3.1: Write failing tests**

Append to `test/permissions.test.ts`:

```ts
import { assertProjectAccess, ForbiddenError } from "../src/lib/permissions.js";

describe("assertProjectAccess", () => {
  function setup() {
    const db = openDb(":memory:");
    const users = new UserStore(db);
    const admin = users.create({
      email: "admin", password: "x", display_name: "Admin", is_admin: true,
    });
    const alice = users.create({
      email: "alice", password: "x", display_name: "Alice",
    });
    db.prepare("INSERT INTO projects (name, created_at) VALUES (?, ?)").run(
      "examples", new Date().toISOString(),
    );
    const perms = new PermissionStore(db);
    perms.replaceForUser(alice.id, [{ project: "examples", level: "view" }], admin.id);
    return { perms, admin, alice };
  }

  it("admin passes any check", () => {
    const { perms, admin } = setup();
    expect(() => assertProjectAccess(admin, "examples", "edit", perms)).not.toThrow();
    expect(() => assertProjectAccess(admin, "anything", "edit", perms)).not.toThrow();
  });

  it("view-only user passes view but not edit", () => {
    const { perms, alice } = setup();
    expect(() => assertProjectAccess(alice, "examples", "view", perms)).not.toThrow();
    expect(() => assertProjectAccess(alice, "examples", "edit", perms)).toThrow(ForbiddenError);
  });

  it("user without a row is denied", () => {
    const { perms, alice } = setup();
    expect(() => assertProjectAccess(alice, "secret", "view", perms)).toThrow(ForbiddenError);
  });

  it("null user is denied", () => {
    const { perms } = setup();
    expect(() => assertProjectAccess(null, "examples", "view", perms)).toThrow(ForbiddenError);
  });

  it("kill switch: when disabled, always passes", () => {
    const { perms, alice } = setup();
    expect(() =>
      assertProjectAccess(alice, "secret", "edit", perms, { enabled: false }),
    ).not.toThrow();
  });
});
```

- [ ] **Step 3.2: Run tests to verify they fail**

Run: `npx vitest run test/permissions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3.3: Implement the helper**

Create `src/lib/permissions.ts`:

```ts
import type { User } from "../store/users.js";
import type { PermissionStore, AccessLevel } from "../store/permissions.js";

export type { AccessLevel };

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

export interface AssertOptions {
  /** When false, the check no-ops (kill switch). Defaults to true. */
  enabled?: boolean;
}

/**
 * Throw `ForbiddenError` if `user` cannot access `project` at `need`
 * level. Admins always pass. Missing user, missing row, and view-only
 * user attempting edit all throw.
 */
export function assertProjectAccess(
  user: User | null,
  project: string,
  need: AccessLevel,
  perms: PermissionStore,
  opts: AssertOptions = {},
): void {
  if (opts.enabled === false) return;
  if (!user) throw new ForbiddenError("auth required");
  if (user.is_admin) return;
  if (!project) throw new ForbiddenError("project is required");
  const row = perms.get(user.id, project);
  if (!row) throw new ForbiddenError(`no access to project '${project}'`);
  if (need === "edit" && row.level !== "edit") {
    throw new ForbiddenError(`edit not allowed on project '${project}'`);
  }
}
```

- [ ] **Step 3.4: Add the kill-switch env var to `Config`**

Modify `src/lib/config.ts`. Find the existing exported `Config` interface and add:

```ts
  /** When false, `assertProjectAccess` no-ops — restores pre-ACL behaviour.
   *  Defaults to true. Set `WIKIKAI_PROJECT_ACL=0` to disable in prod. */
  projectAclEnabled: boolean;
```

And in the function that builds the Config (look for where other env vars like `webAuth` are read), add:

```ts
  const projectAclEnabled = (env.WIKIKAI_PROJECT_ACL ?? "1") !== "0";
```

…and include `projectAclEnabled` in the returned object.

- [ ] **Step 3.5: Run all tests**

Run: `npx vitest run test/permissions.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 3.6: Commit**

```bash
git add src/lib/permissions.ts src/lib/config.ts test/permissions.test.ts
git commit -m "feat(perms): assertProjectAccess helper + WIKIKAI_PROJECT_ACL kill switch"
```

---

## Task 4 — Plumb `PermissionStore` through the server

**Files:**
- Modify: `src/server.ts`
- Modify: `src/web/app.ts` (only the options interface + constructor wiring; route changes are later tasks)
- Modify: `src/mcp/handlers.ts` (only `ToolHandlers` factory signature)
- Modify: `test/web.test.ts` (every existing `buildApp` call site)
- Modify: `test/tools.test.ts` (every existing `buildToolHandlers` call site)

- [ ] **Step 4.1: Add `permissions` + `projectAclEnabled` to `buildApp` opts**

In `src/web/app.ts`, find the existing options interface (around the imports / top of `buildApp`). Add:

```ts
import type { PermissionStore } from "../store/permissions.js";

export interface BuildAppOptions {
  // ...existing fields...
  permissions: PermissionStore;
  projectAclEnabled?: boolean; // default true
}
```

Inside `buildApp`, near the top after destructuring:

```ts
const aclEnabled = opts.projectAclEnabled ?? true;
```

Keep `aclEnabled` available — later tasks use it when calling `assertProjectAccess`.

- [ ] **Step 4.2: Same plumbing for `buildToolHandlers`**

In `src/mcp/handlers.ts`, the factory currently takes positional args. Add a `permissions` parameter as the last positional arg (keeps the existing order from `buildToolHandlers(knowledge, pages, images, promptLog, activityLog, { publicBaseUrl })` valid in tests; just append).

Change the signature to accept a final `permissions` arg. Stash it on the closure:

```ts
export function buildToolHandlers(
  knowledge: KnowledgeStore,
  pages: PageStore,
  images: ImageStore,
  promptLog: PromptLogStore,
  activityLog: ActivityLogStore,
  config: { publicBaseUrl: string; projectAclEnabled?: boolean },
  permissions?: PermissionStore,
): ToolHandlers {
  const aclEnabled = config.projectAclEnabled ?? true;
  // ...handlers reference `permissions` + `aclEnabled` when they call assertProjectAccess
}
```

Mark `permissions` optional for now — Task 9/10 will wire it into individual handlers and tighten the type.

- [ ] **Step 4.3: Wire it up in `src/server.ts`**

Find the section that instantiates stores. Add:

```ts
import { PermissionStore } from "./store/permissions.js";

// ...alongside `new UserStore(db)` etc.:
const permissions = new PermissionStore(db);
```

Pass it into `buildToolHandlers(...)` and `buildApp({ ..., permissions, projectAclEnabled: config.projectAclEnabled })`.

- [ ] **Step 4.4: Update every test call site**

In `test/web.test.ts` and `test/tools.test.ts`, every `buildApp({ ... })` and `buildToolHandlers(...)` call has to pass the new arg. Find each call site (there are several inside `beforeEach` and nested `describe` blocks) and add:

```ts
const permissions = new PermissionStore(db);
// inside buildApp({...}):
permissions,
// inside buildToolHandlers(...):
permissions,
```

Add the import at the top of each test file:

```ts
import { PermissionStore } from "../src/store/permissions.js";
```

- [ ] **Step 4.5: Run all tests to confirm nothing regressed**

Run: `npx vitest run`
Expected: ALL existing tests still PASS (no behavioural change yet — we only threaded the arg).

- [ ] **Step 4.6: Commit**

```bash
git add src/server.ts src/web/app.ts src/mcp/handlers.ts test/web.test.ts test/tools.test.ts
git commit -m "feat(perms): plumb PermissionStore through server/app/handlers"
```

---

## Task 5 — `ForbiddenError` → 403 middleware

**Files:**
- Modify: `src/web/app.ts`
- Modify: `test/web.test.ts`

- [ ] **Step 5.1: Write the failing test**

Append to `test/web.test.ts` inside the top-level `describe("HTTP routes", ...)`:

```ts
it("ForbiddenError surfaces as 403", async () => {
  // Mount a one-off throwaway route via a sub-app pattern — alternatively
  // wait for Task 6 where a real route will trigger this. For now we
  // assert the middleware exists by triggering it via /api/knowledge with
  // a hand-rolled override.  ← actually defer this assertion until Task 6;
  // delete this placeholder if you implement Task 6 in the same session.
});
```

If you're executing tasks sequentially, **skip Step 5.1 and assert via Task 6's tests** — it's cleaner. Keep the middleware itself though.

- [ ] **Step 5.2: Add the error-to-403 mapping**

In `src/web/app.ts`, find the existing 404 / catch-all error handler near the bottom of `buildApp`. Above (or merged into) it, add:

```ts
import { ForbiddenError } from "../lib/permissions.js";

app.use(((err, _req, res, next) => {
  if (err instanceof ForbiddenError) {
    res.status(403).json({ error: err.message });
    return;
  }
  next(err);
}) as ErrorRequestHandler);
```

Make sure the import for `ErrorRequestHandler` is present (`import type { ErrorRequestHandler } from "express";`).

- [ ] **Step 5.3: Run tests**

Run: `npx vitest run`
Expected: PASS (no new tests; existing tests should still pass since no route throws yet).

- [ ] **Step 5.4: Commit**

```bash
git add src/web/app.ts
git commit -m "feat(perms): ForbiddenError → 403 JSON middleware"
```

---

## Task 6 — Admin endpoints: GET / PUT permissions

**Files:**
- Modify: `src/web/auth.ts`
- Modify: `test/web.test.ts`

- [ ] **Step 6.1: Write the failing test**

Append to the `admin CRUD + last-admin guard` test (or add a new sibling test) in `test/web.test.ts`. Add a fresh test block:

```ts
it("admin permissions CRUD", async () => {
  // (Re-use the adminApp setup pattern from the existing "admin CRUD" test
  //  — copy/paste the lines that create db, stores, adminApp and the
  //  initial admin login cookie.)

  // Create alice
  let res = await request(adminApp)
    .post("/api/admin/users")
    .set("Cookie", cookie)
    .send({ email: "alice", password: "pw", display_name: "Alice" });
  const aliceId = res.body.user.id;

  // Register a couple of projects for grant targets
  await request(adminApp)
    .post("/api/projects").set("Cookie", cookie).send({ name: "examples" });
  await request(adminApp)
    .post("/api/projects").set("Cookie", cookie).send({ name: "secret" });

  // GET → empty
  res = await request(adminApp)
    .get(`/api/admin/users/${aliceId}/permissions`)
    .set("Cookie", cookie);
  expect(res.status).toBe(200);
  expect(res.body.permissions).toEqual([]);

  // PUT replaces
  res = await request(adminApp)
    .put(`/api/admin/users/${aliceId}/permissions`)
    .set("Cookie", cookie)
    .send({
      permissions: [
        { project: "examples", level: "view" },
        { project: "secret",   level: "edit" },
      ],
    });
  expect(res.status).toBe(200);

  res = await request(adminApp)
    .get(`/api/admin/users/${aliceId}/permissions`)
    .set("Cookie", cookie);
  expect(res.body.permissions).toEqual([
    { project: "examples", level: "view" },
    { project: "secret",   level: "edit" },
  ]);

  // PUT with smaller list revokes the missing one
  await request(adminApp)
    .put(`/api/admin/users/${aliceId}/permissions`)
    .set("Cookie", cookie)
    .send({ permissions: [{ project: "examples", level: "edit" }] });
  res = await request(adminApp)
    .get(`/api/admin/users/${aliceId}/permissions`)
    .set("Cookie", cookie);
  expect(res.body.permissions).toEqual([{ project: "examples", level: "edit" }]);

  // Non-admin (alice) cannot touch the endpoint
  res = await request(adminApp)
    .post("/api/auth/login")
    .send({ email: "alice", password: "pw" });
  const aliceCookie = res.headers["set-cookie"][0];
  res = await request(adminApp)
    .get(`/api/admin/users/${aliceId}/permissions`)
    .set("Cookie", aliceCookie);
  expect(res.status).toBe(403);

  // Invalid level → 400
  res = await request(adminApp)
    .put(`/api/admin/users/${aliceId}/permissions`)
    .set("Cookie", cookie)
    .send({ permissions: [{ project: "examples", level: "bogus" }] });
  expect(res.status).toBe(400);

  // Unknown project → 400 (FK violation)
  res = await request(adminApp)
    .put(`/api/admin/users/${aliceId}/permissions`)
    .set("Cookie", cookie)
    .send({ permissions: [{ project: "nope", level: "view" }] });
  expect(res.status).toBe(400);
});
```

The setup boilerplate (`adminApp`, `cookie`, `permissions`, etc.) follows the same pattern as the existing `"admin CRUD + last-admin guard"` test — copy that block verbatim. Make sure to construct `adminApp` with `permissions: new PermissionStore(db)` (already added in Task 4).

- [ ] **Step 6.2: Run the test to verify it fails**

Run: `npx vitest run test/web.test.ts -t "admin permissions CRUD"`
Expected: FAIL — endpoints do not exist (404 or similar).

- [ ] **Step 6.3: Implement the endpoints**

In `src/web/auth.ts`, find the `attachAuthRoutes` function. After the existing admin user CRUD routes (`app.post("/api/admin/users/:id/regenerate-mcp-token", ...)`), add:

```ts
import type { PermissionStore } from "../store/permissions.js";

// extend AuthOptions
export interface AuthOptions {
  users: UserStore;
  sessions: SessionStore;
  permissions: PermissionStore; // NEW
  enabled: boolean;
}
```

And inside `attachAuthRoutes`:

```ts
app.get("/api/admin/users/:id/permissions", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  res.json({ permissions: opts.permissions.listForUser(id) });
});

app.put("/api/admin/users/:id/permissions", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const body = req.body as { permissions?: unknown };
  if (!Array.isArray(body.permissions)) {
    res.status(400).json({ error: "permissions[] required" });
    return;
  }
  const cleaned: Array<{ project: string; level: "view" | "edit" }> = [];
  for (const raw of body.permissions) {
    if (
      !raw || typeof raw !== "object" ||
      typeof (raw as { project?: unknown }).project !== "string" ||
      ((raw as { level?: unknown }).level !== "view" &&
       (raw as { level?: unknown }).level !== "edit")
    ) {
      res.status(400).json({ error: "invalid permission entry" });
      return;
    }
    cleaned.push({
      project: (raw as { project: string }).project,
      level:   (raw as { level: "view" | "edit" }).level,
    });
  }
  try {
    opts.permissions.replaceForUser(id, cleaned, req.user!.id);
    res.json({ ok: true });
  } catch (e) {
    // Most likely an FK violation (unknown project) — surface as 400
    res.status(400).json({ error: (e as Error).message });
  }
});
```

- [ ] **Step 6.4: Pass `permissions` through `attachAuthRoutes` callers**

`src/web/app.ts` is where `attachAuthRoutes(app, authOpts)` is called. Update `authOpts`:

```ts
const authOpts = { users, sessions, permissions, enabled: !!opts.webAuth };
```

Now `permissions` is available everywhere `authOpts` flows.

- [ ] **Step 6.5: Run the test to verify it passes**

Run: `npx vitest run test/web.test.ts -t "admin permissions CRUD"`
Expected: PASS.

- [ ] **Step 6.6: Commit**

```bash
git add src/web/auth.ts src/web/app.ts test/web.test.ts
git commit -m "feat(perms): GET/PUT /api/admin/users/:id/permissions"
```

---

## Task 7 — Require non-empty `project` on knowledge create/update

**Files:**
- Modify: `src/mcp/handlers.ts`
- Modify: `src/store/knowledge.ts`
- Modify: `src/web/app.ts` (the `POST /api/knowledge` route)
- Modify: `test/web.test.ts`, `test/tools.test.ts`

- [ ] **Step 7.1: Update Zod schema in `src/mcp/handlers.ts`**

Locate `AddKnowledgeSchema` and the corresponding edit schema. Change `project: z.string().max(100).optional()` (or similar) to:

```ts
project: z.string().min(1, "project is required").max(100),
```

Do the same for `edit_knowledge` if it currently allows project edits. The new requirement: `project` cannot be set to empty / null on either create or edit.

- [ ] **Step 7.2: Update `KnowledgeStore.add()` / `update()`**

In `src/store/knowledge.ts`, in `add()` near the top:

```ts
if (!input.project || !input.project.trim()) {
  throw new Error("project is required");
}
```

In `update()` (or whatever method handles edits), if `patch.project !== undefined`, do the same trim+throw check.

- [ ] **Step 7.3: Update `POST /api/knowledge`**

In `src/web/app.ts`, find the existing `POST /api/knowledge` handler. Before the call to `opts.knowledge.add(...)`:

```ts
if (typeof req.body?.project !== "string" || !req.body.project.trim()) {
  res.status(400).json({ error: "project is required" });
  return;
}
```

- [ ] **Step 7.4: Write a failing test for the rejection**

In `test/web.test.ts`, append:

```ts
it("POST /api/knowledge rejects empty project", async () => {
  const res = await request(app).post("/api/knowledge").send({ title: "X" });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/project/);
});
```

In `test/tools.test.ts`, find existing `add_knowledge` tests and add:

```ts
it("add_knowledge rejects when project missing", async () => {
  await expect(handlers.add_knowledge({ title: "X" })).rejects.toThrow(/project/);
});
```

- [ ] **Step 7.5: Fix every existing test that previously called `add_knowledge` without a project**

Search the test files for `knowledge.add({` and `add_knowledge({` and `POST("/api/knowledge")` — wherever a project is missing, add `project: "examples"` (or whatever the surrounding test already uses).

Run: `npx vitest run` and chase failures one by one.

- [ ] **Step 7.6: Run all tests**

Run: `npx vitest run`
Expected: ALL tests PASS.

- [ ] **Step 7.7: Commit**

```bash
git add src/mcp/handlers.ts src/store/knowledge.ts src/web/app.ts test
git commit -m "feat(perms): require project on knowledge create/update"
```

---

## Task 8 — Web read gating + `/api/knowledge` filter

**Files:**
- Modify: `src/web/app.ts`
- Modify: `src/store/knowledge.ts` (new `listVisibleForUser` helper)
- Modify: `test/web.test.ts`

- [ ] **Step 8.1: Add the failing tests**

Append to `test/web.test.ts`:

```ts
describe("read gating", () => {
  it("non-admin sees only knowledge in projects they have view+ on", async () => {
    // Set up authApp with admin + alice + two knowledge rows in different
    // projects. Grant alice view on one only. Reuse the adminApp pattern.

    // ... after admin creates kA (project='alpha') and kB (project='beta'):
    // ... after PUT /api/admin/users/:alice/permissions with [{alpha,view}]:
    res = await request(authApp).get("/api/knowledge").set("Cookie", aliceCookie);
    expect(res.body.map((k: { id: number; title: string }) => k.title)).toEqual(["A"]);

    // Direct GET of the forbidden one → 403
    res = await request(authApp).get(`/api/knowledge/${kB.id}`).set("Cookie", aliceCookie);
    expect(res.status).toBe(403);

    // Allowed one → 200
    res = await request(authApp).get(`/api/knowledge/${kA.id}`).set("Cookie", aliceCookie);
    expect(res.status).toBe(200);
  });
});
```

Build the setup block fully — copy the auth-app boilerplate. Don't leave any `// ...` in committed test code.

- [ ] **Step 8.2: Run to verify it fails**

Run: `npx vitest run test/web.test.ts -t "read gating"`
Expected: FAIL — non-admin currently sees everything.

- [ ] **Step 8.3: Add `listVisibleForUser` to `KnowledgeStore`**

In `src/store/knowledge.ts`:

```ts
listVisibleForUser(visibleProjects: string[]): Knowledge[] {
  if (visibleProjects.length === 0) return [];
  const placeholders = visibleProjects.map(() => "?").join(",");
  return this.db
    .prepare(
      `SELECT * FROM knowledge WHERE project IN (${placeholders})
       ORDER BY updated_at DESC`,
    )
    .all(...visibleProjects) as Knowledge[];
}
```

- [ ] **Step 8.4: Gate the read routes**

In `src/web/app.ts`, change `GET /api/knowledge`:

```ts
app.get("/api/knowledge", (req, res, next) => {
  try {
    if (req.user && opts.permissions && aclEnabled && !req.user.is_admin) {
      const visible = opts.permissions.listVisibleProjects(req.user.id, false);
      res.json(opts.knowledge.listVisibleForUser(visible));
      return;
    }
    res.json(opts.knowledge.list());
  } catch (e) { next(e); }
});
```

For `GET /api/knowledge/:id`, `/:id/outline`, `GET /api/pages/:pid`, `/:pid/rendered`, `/:pid/raw`, `/:pid/revisions`: each loads a knowledge row internally (or a page → knowledge). Right after that lookup, call:

```ts
assertProjectAccess(req.user ?? null, k.project!, "view", opts.permissions, { enabled: aclEnabled });
```

Replace `k` with whichever variable holds the loaded knowledge row in that handler. Import `assertProjectAccess` at the top of the file.

- [ ] **Step 8.5: Run all tests**

Run: `npx vitest run`
Expected: PASS, including the new gating test. Older tests that hit `/api/knowledge` without auth still pass because `authOpts.enabled` is false in those tests (no `webAuth: true`), so `req.user` is undefined → the gate is skipped (matches existing behaviour).

- [ ] **Step 8.6: Commit**

```bash
git add src/store/knowledge.ts src/web/app.ts test/web.test.ts
git commit -m "feat(perms): gate knowledge/page reads on project view access"
```

---

## Task 9 — Web write gating

**Files:**
- Modify: `src/web/app.ts`
- Modify: `test/web.test.ts`

- [ ] **Step 9.1: Add the failing test**

Append to `test/web.test.ts` (inside the `read gating` describe or sibling):

```ts
it("view-only user cannot mutate; edit user can", async () => {
  // Reuse the alice setup from Task 8.

  // View-only alice tries to PATCH a page in 'alpha' → 403
  res = await request(authApp)
    .patch(`/api/pages/${pA.id}`)
    .set("Cookie", aliceCookie)
    .send({ content: "haha" });
  expect(res.status).toBe(403);

  // Upgrade alice to edit
  await request(authApp)
    .put(`/api/admin/users/${aliceId}/permissions`)
    .set("Cookie", cookie)
    .send({ permissions: [{ project: "alpha", level: "edit" }] });

  res = await request(authApp)
    .patch(`/api/pages/${pA.id}`)
    .set("Cookie", aliceCookie)
    .send({ content: "ok" });
  expect(res.status).toBe(200);
});
```

- [ ] **Step 9.2: Run to verify fail**

Run: `npx vitest run test/web.test.ts -t "view-only user cannot mutate"`
Expected: FAIL.

- [ ] **Step 9.3: Gate every mutating route**

In `src/web/app.ts`, every route that mutates knowledge / page / image / task needs `assertProjectAccess(user, project, "edit", perms, { enabled: aclEnabled })`. Concretely:

| Route | How to find the project |
|---|---|
| `POST /api/knowledge` | from `req.body.project` |
| `PATCH /api/knowledge/:id` | load by id; check **old** project edit; if `req.body.project` provided and differs, also check **new** project edit |
| `DELETE /api/knowledge/:id` | load by id |
| `POST /api/knowledge/:id/pages` | load by id |
| `PATCH /api/pages/:pid`, `DELETE /api/pages/:pid` | `pages.get(pid).knowledge_id → knowledge.get(kid).project` |
| `POST /api/pages/:pid/revisions`, restore | same |
| `PATCH /api/pages/:pid/tasks/:i/toggle` | same |
| `PATCH /api/pages/:pid/image-size`, set-caption, etc. | same |
| `POST /api/images` | check via `knowledge_id` if present in body; otherwise admin-only (image not attached to anything yet) |

Pattern (write a small inline helper near the top of `buildApp` to avoid repetition):

```ts
function gateEdit(req: Request, kidOrProject: number | string): void {
  let project: string;
  if (typeof kidOrProject === "number") {
    const k = opts.knowledge.get(kidOrProject);
    if (!k) throw new NotFoundError(`knowledge ${kidOrProject}`);
    project = k.project!;
  } else {
    project = kidOrProject;
  }
  assertProjectAccess(req.user ?? null, project, "edit", opts.permissions, {
    enabled: aclEnabled,
  });
}
```

Call `gateEdit(req, kid)` (or pass a string project) inside each route. Throws → caught by the 403 middleware from Task 5.

- [ ] **Step 9.4: Run all tests**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 9.5: Commit**

```bash
git add src/web/app.ts test/web.test.ts
git commit -m "feat(perms): gate every knowledge/page/image mutation on edit access"
```

---

## Task 10 — `/api/projects` + `/api/activity-log` filtering

**Files:**
- Modify: `src/web/app.ts`
- Modify: `src/store/activityLog.ts`
- Modify: `test/web.test.ts`

- [ ] **Step 10.1: Add failing tests**

Append to `test/web.test.ts`:

```ts
it("/api/projects returns only visible projects for non-admin", async () => {
  // alice has view on 'alpha' only
  res = await request(authApp).get("/api/projects").set("Cookie", aliceCookie);
  expect(res.body.projects.map((p: { name: string }) => p.name)).toEqual(["alpha"]);
});

it("/api/projects POST/DELETE is admin-only", async () => {
  res = await request(authApp)
    .post("/api/projects").set("Cookie", aliceCookie).send({ name: "x" });
  expect(res.status).toBe(403);
  res = await request(authApp)
    .delete("/api/projects/alpha").set("Cookie", aliceCookie);
  expect(res.status).toBe(403);
});

it("/api/activity-log filters by visible projects", async () => {
  // Admin edits a page in beta (alice can't see)
  await request(authApp)
    .patch(`/api/pages/${pB.id}`)
    .set("Cookie", cookie)
    .send({ content: "admin only" });

  // alice's view of the log doesn't include the beta row
  res = await request(authApp).get("/api/activity-log").set("Cookie", aliceCookie);
  const rowsForBeta = res.body.entries.filter(
    (e: { knowledge_id: number | null }) => e.knowledge_id === kB.id,
  );
  expect(rowsForBeta).toEqual([]);
});
```

- [ ] **Step 10.2: Run to verify fail**

Run: `npx vitest run test/web.test.ts -t "/api/projects"`
Expected: FAIL on at least the first.

- [ ] **Step 10.3: Filter `GET /api/projects`**

In `src/web/app.ts`:

```ts
app.get("/api/projects", (req, res, next) => {
  try {
    const all = opts.knowledge.listProjects();
    if (!req.user || !aclEnabled || req.user.is_admin) {
      res.json({ projects: all });
      return;
    }
    const visible = new Set(opts.permissions.listVisibleProjects(req.user.id, false));
    res.json({ projects: all.filter((p: { name: string }) => visible.has(p.name)) });
  } catch (e) { next(e); }
});
```

- [ ] **Step 10.4: Admin-gate `POST` / `DELETE /api/projects`**

Reuse the `requireAdmin` helper exposed from `auth.ts` (export it if not yet). Or inline the check: if `aclEnabled && !req.user?.is_admin` → throw `ForbiddenError("admin only")`.

- [ ] **Step 10.5: Filter activity log**

In `src/store/activityLog.ts`, extend `list()` to accept an optional filter:

```ts
list(opts: {
  limit?: number;
  offset?: number;
  knowledge_id?: number;
  visibleProjects?: string[] | null; // null = no filter (admin)
} = {}): { entries: ActivityEntry[]; total: number } {
  // ...existing implementation...
  // If visibleProjects is a non-null array, also restrict via a sub-query:
  //   AND knowledge_id IN (SELECT id FROM knowledge WHERE project IN (...))
}
```

In `src/web/app.ts`, the `GET /api/activity-log` route:

```ts
const visible = !req.user || !aclEnabled || req.user.is_admin
  ? null
  : opts.permissions.listVisibleProjects(req.user.id, false);
const out = opts.activityLog.list({ ..., visibleProjects: visible });
```

(SQL detail: when filtering, also drop rows with `knowledge_id IS NULL` for non-admins — those are image uploads / project-level events.)

- [ ] **Step 10.6: Run all tests**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 10.7: Commit**

```bash
git add src/store/activityLog.ts src/web/app.ts test/web.test.ts
git commit -m "feat(perms): filter /api/projects + /api/activity-log per user visibility"
```

---

## Task 11 — MCP gating: reads (list / search / get_*)

**Files:**
- Modify: `src/mcp/handlers.ts`
- Modify: `test/tools.test.ts`

- [ ] **Step 11.1: Add failing tests**

In `test/tools.test.ts`, after the existing setup:

```ts
import { withCallContext } from "../src/lib/callContext.js";

it("list_knowledge filters to visible projects for non-admin", async () => {
  // Create two knowledge rows in different projects
  knowledge.add({ title: "A", project: "alpha" });
  knowledge.add({ title: "B", project: "beta" });

  const alice = users.create({ email: "alice", password: "x", display_name: "Alice" });
  permissions.replaceForUser(alice.id, [{ project: "alpha", level: "view" }], 1);

  const out = await withCallContext(
    { source: "mcp", tool_name: "list_knowledge", user_id: alice.id },
    () => handlers.list_knowledge({}),
  );
  expect(out.items.map((k: { title: string }) => k.title)).toEqual(["A"]);
});

it("get_knowledge throws on a forbidden id", async () => {
  const k = knowledge.add({ title: "B", project: "beta" });
  const alice = users.create({ email: "alice2", password: "x", display_name: "A" });
  permissions.replaceForUser(alice.id, [{ project: "alpha", level: "view" }], 1);
  await expect(
    withCallContext(
      { source: "mcp", tool_name: "get_knowledge", user_id: alice.id },
      () => handlers.get_knowledge({ id: k.id }),
    ),
  ).rejects.toThrow(/no access/);
});
```

(Adjust the `out.items` accessor to whatever the real shape of the response is — check `handlers.ts`.)

- [ ] **Step 11.2: Implement gating in handlers**

In `src/mcp/handlers.ts`, for every read tool that resolves a single knowledge / page (e.g. `get_knowledge`, `get_outline`, `read_page`, `get_block`, `get_table_row`, `list_pages`, `get_prompt_log`), insert at the top of each handler:

```ts
const { user_id } = getCallContext();
const user = user_id ? users.getById(user_id) : null;
const k = knowledge.get(id); // or resolve via pages.get(pid).knowledge_id
if (!k) throw new NotFoundError(`knowledge ${id}`);
assertProjectAccess(user, k.project!, "view", permissions!, { enabled: aclEnabled });
```

For multi-row read tools (`list_knowledge`, `search`), filter the results:

```ts
const { user_id } = getCallContext();
const user = user_id ? users.getById(user_id) : null;
if (user && !user.is_admin && aclEnabled) {
  const visible = new Set(permissions!.listVisibleProjects(user.id, false));
  rows = rows.filter((r) => r.project && visible.has(r.project));
}
```

`users` is not currently a constructor arg to `buildToolHandlers`. Add it:

```ts
export function buildToolHandlers(
  knowledge, pages, images, promptLog, activityLog,
  config: { publicBaseUrl: string; projectAclEnabled?: boolean },
  permissions: PermissionStore,
  users: UserStore,            // NEW
): ToolHandlers { … }
```

Update `src/server.ts` and the two test files to pass `users` as the last arg.

- [ ] **Step 11.3: Run tests**

Run: `npx vitest run test/tools.test.ts`
Expected: PASS.

- [ ] **Step 11.4: Commit**

```bash
git add src/mcp/handlers.ts src/server.ts test/tools.test.ts test/web.test.ts
git commit -m "feat(perms): MCP read tools enforce per-project view access"
```

---

## Task 12 — MCP gating: writes

**Files:**
- Modify: `src/mcp/handlers.ts`
- Modify: `test/tools.test.ts`

- [ ] **Step 12.1: Add failing tests**

```ts
it("add_knowledge denied without edit on the requested project", async () => {
  const alice = users.create({ email: "alice3", password: "x", display_name: "A" });
  permissions.replaceForUser(alice.id, [{ project: "alpha", level: "view" }], 1);
  await expect(
    withCallContext(
      { source: "mcp", tool_name: "add_knowledge", user_id: alice.id },
      () => handlers.add_knowledge({ title: "X", project: "alpha" }),
    ),
  ).rejects.toThrow(/edit/);
});

it("edit_page denied on view-only project", async () => {
  const k = knowledge.add({ title: "K", project: "alpha" });
  const p = pages.add({ knowledge_id: k.id, title: "P", content: "x" });
  const alice = users.create({ email: "alice4", password: "x", display_name: "A" });
  permissions.replaceForUser(alice.id, [{ project: "alpha", level: "view" }], 1);
  await expect(
    withCallContext(
      { source: "mcp", tool_name: "edit_page", user_id: alice.id },
      () => handlers.edit_page({ page_id: p.id, content: "new" }),
    ),
  ).rejects.toThrow(/edit/);
});
```

- [ ] **Step 12.2: Gate every write handler**

For `add_knowledge`, `edit_knowledge`, `delete_knowledge`, `add_page`, `edit_page`, `edit_lines`, `edit_section`, `append_page`, `replace_text`, `delete_page`, `reorder_pages`, `toggle_task`, `set_block_caption`, `add_image`:

```ts
const { user_id } = getCallContext();
const user = user_id ? users.getById(user_id) : null;
// resolve target project: from input.project for add_knowledge,
// otherwise from the existing knowledge / page row.
const project = ...;
assertProjectAccess(user, project, "edit", permissions, { enabled: aclEnabled });
```

For `edit_knowledge` that renames the project, check `edit` on both the old project and the new one.

- [ ] **Step 12.3: Run tests**

Run: `npx vitest run test/tools.test.ts`
Expected: PASS.

- [ ] **Step 12.4: Commit**

```bash
git add src/mcp/handlers.ts test/tools.test.ts
git commit -m "feat(perms): MCP write tools enforce per-project edit access"
```

---

## Task 13 — SSE: `activity-logged` event

**Files:**
- Modify: `src/web/sse.ts` (or wherever the SSE hub lives — verify first)
- Modify: `src/store/activityLog.ts`
- Modify: `client/src/hooks/useServerEvents.ts`
- Modify: `test/web.test.ts`

- [ ] **Step 13.1: Locate the SSE hub**

Run: `grep -rn "broadcast\|sse" src/web/ | head -20`
Find where `knowledge-changed` is currently emitted (likely `src/web/sse.ts` or `src/web/app.ts`). Note the broadcaster signature, e.g. `sse.broadcast({ type, ... })`.

- [ ] **Step 13.2: Add the event type**

In the same file (`src/web/sse.ts` or wherever `ServerEvent` is declared on the server), add a new variant:

```ts
| { type: "activity-logged"; knowledge_id: number | null }
```

- [ ] **Step 13.3: Broadcast from `ActivityLogStore.record()`**

Two options — pick A:

  **A. Inject a broadcaster into `ActivityLogStore`.** Constructor accepts an optional `onRecord?: (entry: ActivityEntry) => void`. Server wires `(e) => sse.broadcast({ type: "activity-logged", knowledge_id: e.knowledge_id })`. Keeps the store free of SSE coupling.

  **B. Emit at every call site.** More plumbing, easy to miss a path.

Go with A.

Modify `src/store/activityLog.ts`:

```ts
export type RecordHook = (entry: ActivityEntry) => void;

export class ActivityLogStore {
  constructor(private db: Db, private onRecord?: RecordHook) {}

  record(entry: RecordInput): void {
    // ...existing insert...
    const inserted = this.db.prepare(`SELECT ... FROM activity_log WHERE id = last_insert_rowid()`).get();
    if (this.onRecord && inserted) {
      try { this.onRecord(inserted as ActivityEntry); } catch { /* never crash a mutation on SSE failure */ }
    }
  }
}
```

In `src/server.ts` (or wherever the store is constructed):

```ts
const activityLog = new ActivityLogStore(db, (e) =>
  sse.broadcast({ type: "activity-logged", knowledge_id: e.knowledge_id }),
);
```

Make sure `sse` is created before `activityLog`.

- [ ] **Step 13.4: Client — handle the new event**

In `client/src/hooks/useServerEvents.ts`, extend the union:

```ts
type ServerEvent =
  // ...existing variants...
  | { type: "activity-logged"; knowledge_id: number | null };
```

In the `switch (e.type)` block, add:

```ts
case "activity-logged": {
  dispatch(portalApi.util.invalidateTags([{ type: "ActivityLog", id: "LIST" }]));
  break;
}
```

- [ ] **Step 13.5: Write the SSE test**

In `test/web.test.ts`:

```ts
it("emits activity-logged after a mutation", async () => {
  // Get a Knowledge to mutate
  const k = knowledge.add({ title: "K", project: "examples" });
  const p = pages.add({ knowledge_id: k.id, title: "P", content: "x" });

  const events: unknown[] = [];
  const agent = request.agent(app);
  const ssePromise = new Promise<void>((resolve) => {
    const req = agent.get("/api/events").buffer(true).parse((res, cb) => {
      res.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        for (const line of text.split("\n")) {
          if (line.startsWith("data:")) {
            try {
              events.push(JSON.parse(line.slice(5).trim()));
              if (events.some((ev) => (ev as { type: string }).type === "activity-logged")) {
                resolve();
              }
            } catch { /* ignore */ }
          }
        }
      });
      res.on("end", () => cb(null, null as unknown as Buffer));
    });
    req.end();
  });

  // Give the SSE handshake a moment, then trigger
  await new Promise((r) => setTimeout(r, 100));
  await request(app).patch(`/api/pages/${p.id}`).send({ content: "new" });

  await Promise.race([
    ssePromise,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 2000)),
  ]);
  expect(events.find((ev: any) => ev.type === "activity-logged")).toBeTruthy();
});
```

Note: SSE-over-supertest is finicky. If this test proves flaky after one run, replace it with a direct unit test of the `onRecord` hook (pass a `vi.fn()` as the callback to `new ActivityLogStore(db, fn)` and assert it was called with the expected shape after `record()`).

- [ ] **Step 13.6: Run all tests**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 13.7: Commit**

```bash
git add src/web/sse.ts src/store/activityLog.ts src/server.ts client/src/hooks/useServerEvents.ts test/web.test.ts
git commit -m "feat(perms): emit activity-logged SSE event on every audit log insert"
```

---

## Task 14 — Client: API endpoints for permissions

**Files:**
- Modify: `client/src/store/api.ts`

- [ ] **Step 14.1: Add types + tag**

Near the existing types in `client/src/store/api.ts`:

```ts
export interface ProjectPermission {
  project: string;
  level: "view" | "edit";
}

// In the createApi `tagTypes` array, add: 'Permissions'
```

- [ ] **Step 14.2: Add endpoints**

In the `endpoints: (builder) => ({ ... })` block, after the existing admin endpoints:

```ts
listUserPermissions: builder.query<
  { permissions: ProjectPermission[] },
  number /* userId */
>({
  query: (userId) => `/api/admin/users/${userId}/permissions`,
  providesTags: (_r, _e, userId) => [{ type: "Permissions", id: userId }],
}),

updateUserPermissions: builder.mutation<
  { ok: true },
  { userId: number; permissions: ProjectPermission[] }
>({
  query: ({ userId, permissions }) => ({
    url: `/api/admin/users/${userId}/permissions`,
    method: "PUT",
    body: { permissions },
  }),
  invalidatesTags: (_r, _e, { userId }) => [
    { type: "Permissions", id: userId },
    "Auth/USERS", // existing tag for the user list
  ],
}),
```

Export `useListUserPermissionsQuery` and `useUpdateUserPermissionsMutation` (RTK Query auto-generates these — verify they appear in the file's export footer).

- [ ] **Step 14.3: Typecheck**

Run: `npx tsc -p client/tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 14.4: Commit**

```bash
git add client/src/store/api.ts
git commit -m "feat(perms): RTK Query endpoints for admin permissions"
```

---

## Task 15 — Client UI: Permissions section in `UsersAdminModal`

**Files:**
- Modify: `client/src/components/UsersAdminModal.tsx`
- Modify: `client/src/styles/theme.css` (if a new class needs styling)

- [ ] **Step 15.1: Add the `ProjectAccessSection` component**

In `UsersAdminModal.tsx`, near the bottom (alongside `EditUserForm`):

```tsx
import {
  useListUserPermissionsQuery,
  useUpdateUserPermissionsMutation,
  useGetProjectsQuery, // assumes this exists in api.ts; if not, add it
  type ProjectPermission,
} from "../store/api";

type Level = "none" | "view" | "edit";

function ProjectAccessSection({ userId }: { userId: number }): JSX.Element {
  const { data: projectsResp } = useGetProjectsQuery();
  const { data: permsResp } = useListUserPermissionsQuery(userId);
  const [update, { isLoading }] = useUpdateUserPermissionsMutation();

  const projects = projectsResp?.projects ?? [];
  const initial: Record<string, Level> = {};
  for (const p of projects) initial[p.name] = "none";
  for (const pp of permsResp?.permissions ?? []) initial[pp.project] = pp.level;

  const [state, setState] = useState<Record<string, Level>>(initial);

  // Reset state whenever the fetched data changes
  useEffect(() => { setState(initial); /* eslint-disable-line */ }, [
    projectsResp, permsResp,
  ]);

  const setAll = (lvl: Level) => {
    const next: Record<string, Level> = {};
    for (const p of projects) next[p.name] = lvl;
    setState(next);
  };

  const save = () => {
    const permissions: ProjectPermission[] = Object.entries(state)
      .filter(([, lvl]) => lvl !== "none")
      .map(([project, level]) => ({ project, level: level as "view" | "edit" }));
    update({ userId, permissions }).catch(() => undefined);
  };

  return (
    <fieldset className="project-access">
      <legend>Project access</legend>
      {projects.map((p) => (
        <div key={p.name} className="project-access-row">
          <span className="project-access-name">{p.name}</span>
          {(["none", "view", "edit"] as Level[]).map((lvl) => (
            <label key={lvl}>
              <input
                type="radio"
                checked={state[p.name] === lvl}
                onChange={() => setState((s) => ({ ...s, [p.name]: lvl }))}
              />
              {lvl}
            </label>
          ))}
        </div>
      ))}
      <div className="project-access-bulk">
        <span>Set all →</span>
        <button type="button" onClick={() => setAll("none")}>none</button>
        <button type="button" onClick={() => setAll("view")}>view</button>
        <button type="button" onClick={() => setAll("edit")}>edit</button>
      </div>
      <div className="project-access-actions">
        <button type="button" className="account-btn primary"
                onClick={save} disabled={isLoading}>
          {isLoading ? "Saving…" : "Save access"}
        </button>
      </div>
    </fieldset>
  );
}
```

- [ ] **Step 15.2: Render it from `EditUserForm`**

Inside `EditUserForm`, after the existing form fields and before the action buttons:

```tsx
{!user.is_admin ? (
  <ProjectAccessSection userId={user.id} />
) : (
  <div className="project-access-admin-note">
    Admin — full access to all projects.
  </div>
)}
```

- [ ] **Step 15.3: Style the new classes**

In `client/src/styles/theme.css`, append:

```css
.project-access {
  border: 1px solid var(--border);
  padding: var(--space-3);
  margin-top: var(--space-3);
  border-radius: var(--radius);
}
.project-access legend { font-weight: 600; padding: 0 var(--space-1); }
.project-access-row {
  display: flex; align-items: center; gap: var(--space-3);
  padding: var(--space-1) 0;
}
.project-access-name { flex: 1; font-family: var(--font-mono); }
.project-access-bulk {
  display: flex; gap: var(--space-1); align-items: center;
  margin-top: var(--space-2); font-size: 0.9em; color: var(--text-muted);
}
.project-access-bulk button { padding: 2px 8px; }
.project-access-actions { margin-top: var(--space-2); }
.project-access-admin-note {
  margin-top: var(--space-3); padding: var(--space-2);
  background: var(--surface-alt); border-left: 3px solid var(--accent);
  color: var(--text-muted);
}
```

Verify the token names against the existing theme.css; substitute the project's actual variable names if `--space-3` etc. don't exist.

- [ ] **Step 15.4: Typecheck + run server tests**

Run: `npx tsc -p client/tsconfig.json --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 15.5: Manual smoke**

```bash
npx tsc -p .
node /Users/kai/Dev/aiportal/dist/index.js &
# open http://localhost:3939, log in as admin, click avatar → Manage users
# → Edit Alice → see new "Project access" section → toggle radios → Save.
```

Confirm: section renders, radios reflect current grants, Save persists, refresh keeps the values.

- [ ] **Step 15.6: Commit**

```bash
git add client/src/components/UsersAdminModal.tsx client/src/styles/theme.css
git commit -m "feat(perms): Project access editor in UsersAdminModal"
```

---

## Task 16 — Documentation

**Files:**
- Modify: `client/src/components/HelpModal.tsx`
- Modify: `README.md`
- Modify: `docs/skill/SKILL.md`
- Possibly: tutorial knowledge `&4` via a one-shot script under `scripts/`

- [ ] **Step 16.1: HelpModal EN tab**

In `client/src/components/HelpModal.tsx`, locate the EN tab content. Add a new section after "Auth":

```tsx
<section>
  <h3>Per-project permissions</h3>
  <p>
    Admins can grant each user <code>view</code> or <code>edit</code>{" "}
    access to specific projects via <strong>Manage users → Edit →
    Project access</strong>. Users without a grant see nothing in that
    project (the sidebar, search, and the MCP API all filter to what
    they're allowed to see). Admins have full access to all projects
    automatically.
  </p>
</section>
```

- [ ] **Step 16.2: HelpModal TH tab**

Mirror the same section in Thai (keep the two tabs in lockstep — repo convention).

- [ ] **Step 16.3: README**

Append a short admin section to `README.md`:

```md
### Per-project permissions

When `WIKIKAI_WEB_AUTH=1`, non-admin users start with no access. An
admin can open **Manage users → Edit → Project access** to grant
`view` or `edit` per project. The grant applies to the web portal and
to the user's MCP token equally. Set `WIKIKAI_PROJECT_ACL=0` to
disable enforcement temporarily.
```

- [ ] **Step 16.4: Tutorial knowledge `&4`**

Write `scripts/tutorial-perms.ts` (or extend an existing tutorial-update script) that:

1. Opens the live DB.
2. Adds or extends a page in knowledge `&4` covering per-project permissions.
3. Bumps the stats on `#19` to reflect the new feature count if applicable.

Run it once locally, then check the result in the browser.

- [ ] **Step 16.5: SKILL.md sync**

```bash
cp ~/.claude/skills/wikikai/SKILL.md docs/skill/SKILL.md
# or edit docs/skill/SKILL.md to add a note about per-user MCP project ACLs,
# then copy that back to ~/.claude/skills/wikikai/SKILL.md.
```

- [ ] **Step 16.6: Commit**

```bash
git add client/src/components/HelpModal.tsx README.md docs/skill/SKILL.md scripts/tutorial-perms.ts
git commit -m "docs(perms): document per-project permissions"
```

---

## Task 17 — Bump version + final verification

**Files:**
- Modify: `package.json`

- [ ] **Step 17.1: Bump semver**

```bash
node -e 'const p=require("./package.json"); const [a,b,c]=p.version.split("."); p.version=`${a}.${+b+1}.0`; require("fs").writeFileSync("package.json", JSON.stringify(p,null,2)+"\n");'
```

(Promote minor since this is a feature.)

- [ ] **Step 17.2: Run the full suite**

```bash
npx vitest run
npx tsc -p . --noEmit
npx tsc -p client/tsconfig.json --noEmit
```

All green.

- [ ] **Step 17.3: Commit + tag**

```bash
git add package.json
git commit -m "chore: bump version for per-project permissions"
git tag "v$(node -p 'require("./package.json").version')"
```

- [ ] **Step 17.4: 5-step leak check**

Before push:

1. `git diff origin/main..HEAD -- data/` — no real data leaked
2. `git log origin/main..HEAD --stat | grep -E "\.env|secret|token"` — none
3. `grep -rn "<your-mcp-token-here>" src test docs 2>/dev/null` — none
4. `git show HEAD~1:.env 2>/dev/null` — should be 404
5. `git ls-files | grep -E "^data/"` — only the index/sample, no real notes

Only push after all five are clean.

---

## Self-review

**Spec coverage check** (run after writing the plan):

- §2 Requirements: deny-by-default → Task 8 (list filter), §3 NULL forbidden → Task 7, three levels → Tasks 1+3+9, admin bypass → Task 3 helper test
- §4 Data model → Task 1 + Task 2
- §5 Auth core → Task 3
- §6 Enforcement points: web reads → Task 8, writes → Task 9, projects → Task 10, activity log → Task 10, MCP reads → Task 11, MCP writes → Task 12
- §7 UI: editor → Tasks 14+15, API endpoints → Tasks 6+14, SSE refresh → Task 13
- §8 Migration + kill switch → Tasks 1, 3
- §9 Testing matrix → covered in each task's TDD steps
- §10 Documentation → Task 16
- §11 No open questions

**Placeholder scan:** none — every step shows the code or the exact command.

**Type consistency:** `PermissionStore.get` returns `{ level } | null`, `assertProjectAccess` reads `.level`, `replaceForUser` accepts `PermissionEntry[]` with `{ project, level }`. UI uses the same `Level = "none" | "view" | "edit"` (none = absence of row); server API never accepts `"none"` — UI translates absence to omission. Consistent across tasks.
