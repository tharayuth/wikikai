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

describe("search over tasks and notes", () => {
  let dir: string;
  let h: ToolHandlers;
  let admin: User;
  let alice: User;
  let dave: User;

  const as = <T>(user: User, fn: () => T): T => withCallContext({ source: "mcp", user_id: user.id }, fn);
  const task = (title: string, project = "alpha", extra: Record<string, unknown> = {}) =>
    as(admin, () => h.add_task({ project, title, ...extra }));
  const note = (fields: { title?: string; body?: string; labels?: string[]; items?: { text: string }[] }, project = "alpha") =>
    as(admin, () => h.add_note({ project, ...fields }));

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "wikikai-search-items-"));
    const db = openDb(":memory:");
    const knowledge = new KnowledgeStore(db);
    const users = new UserStore(db);
    const permissions = new PermissionStore(db);
    admin = users.create({ email: "admin@x.test", password: "x", display_name: "Admin", is_admin: true });
    alice = users.create({ email: "alice@x.test", password: "x", display_name: "Alice" });
    dave = users.create({ email: "dave@x.test", password: "x", display_name: "Dave" });
    knowledge.registerProject("alpha");
    knowledge.registerProject("beta");
    permissions.replaceForUser(alice.id, [{ project: "alpha", level: "view" }], admin.id);
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

  it("returns tasks and notes beside the page hits, with links that open them", async () => {
    const t = await task("Fix the gateway timeout");
    const n = await note({ title: "Gateway ideas" });
    const r = await as(admin, () => h.search({ query: "gateway" }));
    expect(r.tasks_total).toBe(1);
    expect(r.tasks[0]).toMatchObject({
      id: t.id,
      project: "alpha",
      project_id: t.project_id,
      title: "Fix the gateway timeout",
      status: "todo",
      column: "Todo",
      archived: false,
      match_ratio: 1,
      matched_terms: ["gateway"],
      url: `http://test/?calendar=${t.project_id}&view=board&task=${t.id}`,
    });
    expect(r.notes_total).toBe(1);
    expect(r.notes[0]).toMatchObject({
      id: n.id,
      project: "alpha",
      project_id: n.project_id,
      title: "Gateway ideas",
      archived: false,
      url: `http://test/?calendar=${n.project_id}&view=notes&note=${n.id}`,
    });
    expect(r.hits).toEqual([]);
    expect(r.total).toBe(0);
  });

  it("finds a task by its description, labels and blocked reason", async () => {
    const byBody = await task("One", "alpha", { description: "the zebra crossing" });
    const byLabel = await task("Two", "alpha", { labels: ["zebra"] });
    const stuck = await task("Three");
    await as(admin, () => h.edit_task({ task_id: stuck.id, expected_version: 1, blocked_reason: "waiting for zebra" }));
    const r = await as(admin, () => h.search({ query: "zebra" }));
    expect(r.tasks.map((t) => t.id).sort()).toEqual([byBody.id, byLabel.id, stuck.id].sort());
    expect(r.tasks.find((t) => t.id === byBody.id)?.snippet).toContain("zebra");
  });

  it("finds a note by its body, list items and labels", async () => {
    const byBody = await note({ body: "the zebra crossing" });
    const byItem = await note({ items: [{ text: "feed the zebra" }] });
    const byLabel = await note({ title: "Three", labels: ["zebra"] });
    const r = await as(admin, () => h.search({ query: "zebra" }));
    expect(r.notes.map((n) => n.id).sort()).toEqual([byBody.id, byItem.id, byLabel.id].sort());
    expect(r.notes.find((n) => n.id === byItem.id)?.snippet).toContain("feed the zebra");
  });

  it("does not match the field names a checklist is stored with", async () => {
    await note({ items: [{ text: "One" }] });
    expect((await as(admin, () => h.search({ query: "checked" }))).notes_total).toBe(0);
  });

  it("finds Thai text from a whole question", async () => {
    await task("แก้หน้าเข้าสู่ระบบ");
    await note({ title: "ขั้นตอนเข้าสู่ระบบใหม่" });
    const r = await as(admin, () => h.search({ query: "เข้าสู่ระบบ" }));
    expect(r.tasks_total).toBe(1);
    expect(r.notes_total).toBe(1);
  });

  it("leaves archived items out unless asked, and never returns a trashed note", async () => {
    const t = await task("Zebra task");
    await as(admin, () => h.edit_task({ task_id: t.id, expected_version: 1, archived: true }));
    const archived = await note({ title: "Zebra archived" });
    await as(admin, () => h.edit_note({ note_id: archived.id, archived: true }));
    const trashed = await note({ title: "Zebra trashed" });
    await as(admin, () => h.edit_note({ note_id: trashed.id, trashed: true }));

    const plain = await as(admin, () => h.search({ query: "zebra" }));
    expect(plain.tasks_total).toBe(0);
    expect(plain.notes_total).toBe(0);

    const all = await as(admin, () => h.search({ query: "zebra", include_archived: true }));
    expect(all.tasks.map((x) => [x.id, x.archived])).toEqual([[t.id, true]]);
    expect(all.notes.map((x) => [x.id, x.archived])).toEqual([[archived.id, true]]);
  });

  it("honours the project filter", async () => {
    await task("Zebra in alpha");
    const inBeta = await task("Zebra in beta", "beta");
    await note({ title: "Zebra in alpha" });
    const noteInBeta = await note({ title: "Zebra in beta" }, "beta");
    const r = await as(admin, () => h.search({ query: "zebra", project: "beta" }));
    expect(r.tasks.map((x) => x.id)).toEqual([inBeta.id]);
    expect(r.notes.map((x) => x.id)).toEqual([noteInBeta.id]);
  });

  it("returns only what the caller can see", async () => {
    const mine = await task("Zebra in alpha");
    await task("Zebra in beta", "beta");
    const myNote = await note({ title: "Zebra in alpha" });
    await note({ title: "Zebra in beta" }, "beta");
    const r = await as(alice, () => h.search({ query: "zebra" }));
    expect(r.tasks.map((x) => x.id)).toEqual([mine.id]);
    expect(r.tasks_total).toBe(1);
    expect(r.notes.map((x) => x.id)).toEqual([myNote.id]);
    expect(r.notes_total).toBe(1);
  });

  it("finds nothing for a caller with no projects, or one naming a project they cannot see", async () => {
    await task("Zebra");
    await note({ title: "Zebra" });
    const empty = { hits: [], total: 0, tasks: [], tasks_total: 0, notes: [], notes_total: 0 };
    expect(await as(dave, () => h.search({ query: "zebra" }))).toEqual(empty);
    await task("Zebra in beta", "beta");
    expect(await as(alice, () => h.search({ query: "zebra", project: "beta" }))).toEqual(empty);
  });

  it("stays out of the way when the search is scoped to one document", async () => {
    await task("Zebra");
    await note({ title: "Zebra" });
    const r = await as(admin, () => h.search({ query: "zebra", knowledge_id: 999 }));
    expect(r.tasks_total).toBe(0);
    expect(r.notes_total).toBe(0);
  });

  it("counts every match in the totals, even past the limit", async () => {
    for (const title of ["Zebra one", "Zebra two", "Zebra three"]) {
      await task(title);
      await note({ title });
    }
    const r = await as(admin, () => h.search({ query: "zebra", limit: 2 }));
    expect(r.tasks).toHaveLength(2);
    expect(r.tasks_total).toBe(3);
    expect(r.notes).toHaveLength(2);
    expect(r.notes_total).toBe(3);
  });

  describe("T12 and N12", () => {
    it("finds that task or note first, in either case, even with a short id", async () => {
      const t = await task("Anything");
      const n = await note({ title: "Whatever" });
      for (const query of [`T${t.id}`, `t${t.id}`]) {
        const r = await as(admin, () => h.search({ query }));
        expect(r.tasks[0]?.id, query).toBe(t.id);
      }
      for (const query of [`N${n.id}`, `n${n.id}`]) {
        const r = await as(admin, () => h.search({ query }));
        expect(r.notes[0]?.id, query).toBe(n.id);
      }
    });

    it("also lists tasks that mention the id, with the task itself first and only once", async () => {
      // A two-character id has no term long enough to search for, so reach T10.
      for (let i = 0; i < 9; i++) await task(`Filler ${i}`);
      const target = await task("Placeholder");
      await as(admin, () =>
        h.edit_task({ task_id: target.id, expected_version: 1, title: `T${target.id} mentions itself` }),
      );
      const mention = await task(`Follow up on T${target.id}`);
      const r = await as(admin, () => h.search({ query: `T${target.id}` }));
      expect(r.tasks.map((x) => x.id)).toEqual([target.id, mention.id]);
      expect(r.tasks_total).toBe(2);
    });

    it("finds an archived task by id, and marks it", async () => {
      const t = await task("Anything");
      await as(admin, () => h.edit_task({ task_id: t.id, expected_version: 1, archived: true }));
      const r = await as(admin, () => h.search({ query: `T${t.id}` }));
      expect(r.tasks[0]).toMatchObject({ id: t.id, archived: true });
    });

    it("does not reveal a trashed note by id", async () => {
      const n = await note({ title: "Gone" });
      await as(admin, () => h.edit_note({ note_id: n.id, trashed: true }));
      expect((await as(admin, () => h.search({ query: `N${n.id}` }))).notes_total).toBe(0);
    });

    it("ignores the project filter but never the permissions", async () => {
      const inBeta = await task("Beta work", "beta");
      const betaNote = await note({ title: "Beta note" }, "beta");
      const anywhere = await as(admin, () => h.search({ query: `T${inBeta.id}`, project: "alpha" }));
      expect(anywhere.tasks[0]?.id).toBe(inBeta.id);
      expect((await as(alice, () => h.search({ query: `T${inBeta.id}` }))).tasks_total).toBe(0);
      expect((await as(alice, () => h.search({ query: `N${betaNote.id}` }))).notes_total).toBe(0);
      expect((await as(dave, () => h.search({ query: `T${inBeta.id}` }))).tasks_total).toBe(0);
    });

    it("says nothing for an id that does not exist", async () => {
      const r = await as(admin, () => h.search({ query: "T9999" }));
      expect(r.tasks_total).toBe(0);
    });
  });

  it("returns no tasks or notes for a page or block id lookup", async () => {
    await task("Mentions #12 in the title");
    const r = await as(admin, () => h.search({ query: "#12" }));
    expect(r).toEqual({ hits: [], total: 0, tasks: [], tasks_total: 0, notes: [], notes_total: 0 });
  });
});
