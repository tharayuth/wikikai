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

describe("note tools", () => {
  let dir: string;
  let h: ToolHandlers;
  let admin: User;
  let alice: User;
  let carol: User;
  let dave: User;

  const as = <T>(user: User, fn: () => T): T =>
    withCallContext({ source: "mcp", user_id: user.id }, fn);

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "wikikai-note-tools-"));
    const db = openDb(":memory:");
    const knowledge = new KnowledgeStore(db);
    const users = new UserStore(db);
    const permissions = new PermissionStore(db);
    admin = users.create({ email: "admin@x.test", password: "x", display_name: "Admin", is_admin: true });
    alice = users.create({ email: "alice@x.test", password: "x", display_name: "Alice" });
    carol = users.create({ email: "carol@x.test", password: "x", display_name: "Carol" });
    dave = users.create({ email: "dave@x.test", password: "x", display_name: "Dave" });
    knowledge.registerProject("alpha");
    knowledge.registerProject("beta");
    permissions.replaceForUser(alice.id, [{ project: "alpha", level: "edit" }], admin.id);
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

  describe("add_note", () => {
    it("creates a note and returns it in full with a notes url", async () => {
      const n = await as(alice, () => h.add_note({ project: "alpha", title: "T", body: "Body", labels: ["ops"] }));
      expect(n).toMatchObject({ title: "T", body: "Body", labels: ["ops"], project: "alpha", version: 1, items: null });
      expect(n.url).toBe(`http://test/?calendar=${n.project_id}&view=notes&note=${n.id}`);
    });

    it("creates a checklist, with unticked boxes unless told otherwise", async () => {
      const n = await as(alice, () =>
        h.add_note({ project: "alpha", items: [{ text: "One" }, { text: "Two", checked: true }] }),
      );
      expect(n.items?.map((i) => [i.text, i.checked])).toEqual([
        ["One", false],
        ["Two", true],
      ]);
    });

    it("still enforces the store's limits, which the schema leaves out", async () => {
      await expect(as(alice, () => h.add_note({ project: "alpha", title: "x".repeat(301) }))).rejects.toThrow(/300/);
      await expect(as(alice, () => h.add_note({ project: "alpha", body: "x".repeat(20_001) }))).rejects.toThrow(/20000/);
      const tooMany = Array.from({ length: 501 }, (_, i) => ({ text: `Item ${i}` }));
      await expect(as(alice, () => h.add_note({ project: "alpha", items: tooMany }))).rejects.toThrow(/500/);
    });

    it("refuses a project it does not know, so a typo cannot create one", async () => {
      await expect(as(admin, () => h.add_note({ project: "nope", title: "T" }))).rejects.toThrow(/nope/);
    });

    it("refuses a caller who can only view", async () => {
      await expect(as(carol, () => h.add_note({ project: "alpha", title: "T" }))).rejects.toThrow(/permission|access|edit/i);
    });
  });

  describe("get_note", () => {
    it("reads one note in full", async () => {
      const added = await as(alice, () => h.add_note({ project: "alpha", title: "T", items: [{ text: "One" }] }));
      const n = await as(carol, () => h.get_note({ note_id: added.id }));
      expect(n).toMatchObject({ id: added.id, title: "T", project: "alpha", url: added.url });
      expect(n.items?.[0]?.text).toBe("One");
    });

    it("refuses a caller who cannot see the project", async () => {
      const added = await as(alice, () => h.add_note({ project: "alpha", title: "T" }));
      await expect(as(dave, () => h.get_note({ note_id: added.id }))).rejects.toThrow(/permission|access|view/i);
    });

    it("says when a note does not exist", async () => {
      await expect(as(alice, () => h.get_note({ note_id: 999 }))).rejects.toThrow(/N999 not found/);
    });
  });

  describe("list_notes", () => {
    it("returns compact rows with a short preview, not the whole body", async () => {
      await as(alice, () => h.add_note({ project: "alpha", title: "Long", body: "x".repeat(500) }));
      const { notes, total } = await as(alice, () => h.list_notes({ project: "alpha" }));
      expect(total).toBe(1);
      const row = notes[0]!;
      expect(row).toMatchObject({ title: "Long", project: "alpha", version: 1, pinned: false, labels: [] });
      expect(row).not.toHaveProperty("body");
      expect(row.preview.length).toBeLessThan(200);
      expect(row.preview.endsWith("…")).toBe(true);
    });

    it("previews a checklist with its boxes", async () => {
      await as(alice, () =>
        h.add_note({ project: "alpha", items: [{ text: "Open" }, { text: "Closed", checked: true }] }),
      );
      const { notes } = await as(alice, () => h.list_notes({ project: "alpha" }));
      expect(notes[0]?.preview).toBe("[ ] Open\n[x] Closed");
    });

    it("finds text in the title, body, list items and labels, ignoring case", async () => {
      await as(alice, () => h.add_note({ project: "alpha", title: "Deploy steps" }));
      await as(alice, () => h.add_note({ project: "alpha", body: "ask about the DEPLOY window" }));
      await as(alice, () => h.add_note({ project: "alpha", items: [{ text: "deploy to staging" }] }));
      await as(alice, () => h.add_note({ project: "alpha", title: "Tagged", labels: ["Deploy"] }));
      await as(alice, () => h.add_note({ project: "alpha", title: "Unrelated" }));
      const { notes, total } = await as(alice, () => h.list_notes({ project: "alpha", query: "deploy" }));
      expect(total).toBe(4);
      expect(notes.some((n) => n.title === "Unrelated")).toBe(false);
    });

    it("finds Thai text", async () => {
      await as(alice, () => h.add_note({ project: "alpha", title: "ประชุมทีม" }));
      const { total } = await as(alice, () => h.list_notes({ project: "alpha", query: "ประชุม" }));
      expect(total).toBe(1);
    });

    it("does not match the field names a checklist is stored with", async () => {
      await as(alice, () => h.add_note({ project: "alpha", items: [{ text: "One" }] }));
      for (const query of ["checked", "text", "false"]) {
        const { total } = await as(alice, () => h.list_notes({ project: "alpha", query }));
        expect(total, query).toBe(0);
      }
    });

    it("lists active notes unless asked for another state", async () => {
      const a = await as(alice, () => h.add_note({ project: "alpha", title: "Archived" }));
      const t = await as(alice, () => h.add_note({ project: "alpha", title: "Trashed" }));
      await as(alice, () => h.add_note({ project: "alpha", title: "Active" }));
      await as(alice, () => h.edit_note({ note_id: a.id, archived: true }));
      await as(alice, () => h.edit_note({ note_id: t.id, trashed: true }));
      const titles = async (state?: "active" | "archived" | "trashed") =>
        (await as(alice, () => h.list_notes({ project: "alpha", state }))).notes.map((n) => n.title);
      expect(await titles()).toEqual(["Active"]);
      expect(await titles("archived")).toEqual(["Archived"]);
      expect(await titles("trashed")).toEqual(["Trashed"]);
    });

    it("counts every match in total, even past the limit", async () => {
      for (const title of ["One", "Two", "Three"]) await as(alice, () => h.add_note({ project: "alpha", title }));
      const { notes, total } = await as(alice, () => h.list_notes({ project: "alpha", limit: 2 }));
      expect(notes).toHaveLength(2);
      expect(total).toBe(3);
    });

    it("searches only the projects a caller can see when no project is named", async () => {
      await as(admin, () => h.add_note({ project: "alpha", title: "Shared word" }));
      await as(admin, () => h.add_note({ project: "beta", title: "Shared word" }));
      const mine = await as(alice, () => h.list_notes({ query: "shared" }));
      expect(mine.notes.map((n) => n.project)).toEqual(["alpha"]);
      expect(mine.total).toBe(1);
      const everything = await as(admin, () => h.list_notes({ query: "shared" }));
      expect(everything.notes.map((n) => n.project).sort()).toEqual(["alpha", "beta"]);
    });

    it("finds nothing for a caller with no projects", async () => {
      await as(admin, () => h.add_note({ project: "alpha", title: "Secret" }));
      expect(await as(dave, () => h.list_notes({ query: "secret" }))).toEqual({ notes: [], total: 0 });
    });

    it("refuses a named project the caller cannot see", async () => {
      await expect(as(dave, () => h.list_notes({ project: "alpha" }))).rejects.toThrow(/permission|access|view/i);
    });
  });

  describe("edit_note", () => {
    it("changes content against the version and returns the next one", async () => {
      const n = await as(alice, () => h.add_note({ project: "alpha", title: "Old" }));
      const edited = await as(alice, () => h.edit_note({ note_id: n.id, expected_version: 1, title: "New" }));
      expect(edited).toMatchObject({ title: "New", version: 2, project: "alpha", url: n.url });
    });

    it("answers STALE when the note changed since it was read", async () => {
      const n = await as(alice, () => h.add_note({ project: "alpha", title: "Old" }));
      await as(alice, () => h.edit_note({ note_id: n.id, expected_version: 1, title: "Theirs" }));
      await expect(as(alice, () => h.edit_note({ note_id: n.id, expected_version: 1, title: "Mine" }))).rejects.toThrow(
        /STALE/,
      );
      expect((await as(alice, () => h.get_note({ note_id: n.id }))).title).toBe("Theirs");
    });

    it("needs a version to change content", async () => {
      const n = await as(alice, () => h.add_note({ project: "alpha", title: "Old" }));
      await expect(as(alice, () => h.edit_note({ note_id: n.id, title: "New" }))).rejects.toThrow(/expected_version/);
    });

    it("pins and archives with no version", async () => {
      const n = await as(alice, () => h.add_note({ project: "alpha", title: "T" }));
      expect(await as(alice, () => h.edit_note({ note_id: n.id, pinned: true }))).toMatchObject({ pinned: true, version: 1 });
      expect(await as(alice, () => h.edit_note({ note_id: n.id, archived: true }))).toMatchObject({ archived: true, version: 1 });
    });

    it("keeps a tick when an edit to the item leaves out checked", async () => {
      const n = await as(alice, () => h.add_note({ project: "alpha", items: [{ text: "One", checked: true }] }));
      const id = n.items![0]!.id;
      const edited = await as(alice, () =>
        h.edit_note({ note_id: n.id, expected_version: 1, items: [{ id, text: "One, reworded" }, { text: "Two" }] }),
      );
      expect(edited.items?.map((i) => [i.text, i.checked])).toEqual([
        ["One, reworded", true],
        ["Two", false],
      ]);
    });

    it("turns a checklist back into plain text with items: null", async () => {
      const n = await as(alice, () => h.add_note({ project: "alpha", items: [{ text: "One" }] }));
      const edited = await as(alice, () => h.edit_note({ note_id: n.id, expected_version: 1, items: null, body: "Text" }));
      expect(edited).toMatchObject({ items: null, body: "Text" });
    });

    it("moves a note to the trash and restores it, refusing edits in between", async () => {
      const n = await as(alice, () => h.add_note({ project: "alpha", title: "T" }));
      expect(await as(alice, () => h.edit_note({ note_id: n.id, trashed: true }))).toMatchObject({ trashed: true });
      await expect(as(alice, () => h.edit_note({ note_id: n.id, expected_version: 1, title: "New" }))).rejects.toThrow(
        /trash/,
      );
      expect(await as(alice, () => h.edit_note({ note_id: n.id, trashed: false }))).toMatchObject({ trashed: false });
    });

    it("refuses a caller who can only view", async () => {
      const n = await as(alice, () => h.add_note({ project: "alpha", title: "T" }));
      await expect(as(carol, () => h.edit_note({ note_id: n.id, pinned: true }))).rejects.toThrow(
        /permission|access|edit/i,
      );
    });

    it("says when a note does not exist", async () => {
      await expect(as(alice, () => h.edit_note({ note_id: 999, pinned: true }))).rejects.toThrow(/N999 not found/);
    });
  });
});
