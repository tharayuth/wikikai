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
