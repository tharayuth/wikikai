import { describe, expect, it, vi } from "vitest";
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

  describe("openTaskSummaries", () => {
    it("counts open tasks per project with the earliest due date", () => {
      const { tasks, knowledge, alpha } = setup();
      knowledge.registerProject("beta");
      const beta = tasks.ensureProject("beta");
      tasks.add(alpha.id, { title: "Later", due_date: "2026-12-01" });
      tasks.add(alpha.id, { title: "Sooner", status: "doing", due_date: "2026-11-01" });
      tasks.add(alpha.id, { title: "No date", status: "review" });
      tasks.add(beta.id, { title: "No date" });
      const summaries = tasks.openTaskSummaries();
      expect(summaries.get(alpha.id)).toEqual({ open_tasks: 3, earliest_due: "2026-11-01" });
      expect(summaries.get(beta.id)).toEqual({ open_tasks: 1, earliest_due: null });
    });

    it("leaves out done and archived tasks, and projects with nothing open", () => {
      const { tasks, alpha } = setup();
      tasks.add(alpha.id, { title: "Done", status: "done", due_date: "2020-01-01" });
      const gone = tasks.add(alpha.id, { title: "Gone", due_date: "2020-01-01" });
      tasks.edit(gone.id, { expected_version: 1, archived: true });
      expect(tasks.openTaskSummaries().has(alpha.id)).toBe(false);
    });

    it("counts a blocked task as open", () => {
      const { tasks, alpha } = setup();
      const stuck = tasks.add(alpha.id, { title: "Stuck", due_date: "2020-01-01" });
      tasks.edit(stuck.id, { expected_version: 1, blocked_reason: "Waiting" });
      expect(tasks.openTaskSummaries().get(alpha.id)).toEqual({ open_tasks: 1, earliest_due: "2020-01-01" });
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

    it("keeps a change the audit log refused, announces it, and reports on stderr", () => {
      const { db, alpha } = setup();
      const broken = new TaskStore(db, { record() { throw new Error("boom"); } } as unknown as ActivityLogStore);
      const seen: WikikaiEvent[] = [];
      const off = onEvent((e) => seen.push(e));
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const t = broken.add(alpha.id, { title: "Kept" });
        expect(t).toMatchObject({ title: "Kept", project_id: alpha.id });
        expect(broken.get(t.id)?.title).toBe("Kept");
        expect(seen.filter((e) => e.type === "task-changed")).toEqual([
          { type: "task-changed", project_id: alpha.id, task_id: t.id },
        ]);
        expect(errors).toHaveBeenCalledTimes(1);
        expect(String(errors.mock.calls[0][0])).toContain(`T${t.id}`);
      } finally {
        off();
        errors.mockRestore();
      }
    });
  });
});
