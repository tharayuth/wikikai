import { describe, expect, it } from "vitest";
import { openDb } from "../src/store/db.js";
import { ActivityLogStore } from "../src/store/activityLog.js";
import { KnowledgeStore, ProjectHasNotesError } from "../src/store/knowledge.js";
import { onEvent, type WikikaiEvent } from "../src/lib/events.js";
import { withCallContext } from "../src/lib/callContext.js";
import { UserStore } from "../src/store/users.js";
import { NoteConflictError, NoteNotFoundError, NoteStaleError, NoteStore } from "../src/store/notes.js";

function setup() {
  const db = openDb(":memory:");
  const knowledge = new KnowledgeStore(db);
  knowledge.registerProject("alpha");
  knowledge.registerProject("beta");
  const log = new ActivityLogStore(db);
  const notes = new NoteStore(db, log);
  const idOf = (name: string): number =>
    (db.prepare("SELECT id FROM projects WHERE name = ?").get(name) as { id: number }).id;
  return { db, knowledge, log, notes, alpha: idOf("alpha"), beta: idOf("beta") };
}

const titles = (rows: { title: string }[]): string[] => rows.map((n) => n.title);

describe("NoteStore", () => {
  describe("add", () => {
    it("creates a note with its defaults", () => {
      const { notes, alpha } = setup();
      expect(notes.add(alpha, { title: "  Idea  ", body: "Text" })).toMatchObject({
        project_id: alpha,
        title: "Idea",
        body: "Text",
        items: null,
        color: "default",
        labels: [],
        pinned: false,
        archived: false,
        trashed: false,
        version: 1,
      });
    });

    it("records who created it", () => {
      const { db, notes, alpha } = setup();
      const user = new UserStore(db).create({ email: "a@x.test", password: "x", display_name: "A" });
      const note = withCallContext({ source: "web", user_id: user.id }, () => notes.add(alpha, { title: "T" }));
      expect(note.created_by).toBe(user.id);
    });

    it("refuses an empty note", () => {
      const { notes, alpha } = setup();
      expect(() => notes.add(alpha, { title: "  ", body: "  " })).toThrow(/needs a title, text or a list item/);
      expect(() => notes.add(alpha, { items: [{ text: "  ", checked: false }] })).toThrow(/needs a title/);
    });

    it("puts a new note first", () => {
      const { notes, alpha } = setup();
      notes.add(alpha, { title: "Older" });
      notes.add(alpha, { title: "Newer" });
      expect(titles(notes.list(alpha))).toEqual(["Newer", "Older"]);
    });

    it("enforces the limits", () => {
      const { notes, alpha } = setup();
      expect(() => notes.add(alpha, { title: "x".repeat(301) })).toThrow(/title must be/);
      expect(() => notes.add(alpha, { title: "T", body: "x".repeat(20_001) })).toThrow(/body must be/);
      expect(() => notes.add(alpha, { title: "T", color: "pink" as never })).toThrow(/color/);
      expect(() => notes.add(alpha, { title: "T", labels: ["a,b"] })).toThrow(/comma/);
      const many = Array.from({ length: 501 }, (_, i) => ({ text: `i${i}`, checked: false }));
      expect(() => notes.add(alpha, { items: many })).toThrow(/at most 500/);
      expect(() => notes.add(alpha, { items: [{ text: "x".repeat(1001), checked: false }] })).toThrow(/item must be/);
    });

    it("gives list items stable ids and drops blank ones", () => {
      const { notes, alpha } = setup();
      const note = notes.add(alpha, {
        items: [
          { text: " Milk ", checked: false },
          { text: "  ", checked: false },
          { text: "Eggs", checked: true },
        ],
      });
      expect(note.items).toEqual([
        { id: 1, text: "Milk", checked: false },
        { id: 2, text: "Eggs", checked: true },
      ]);
    });
  });

  describe("edit", () => {
    it("checks and bumps the version for content", () => {
      const { notes, alpha } = setup();
      const n = notes.add(alpha, { title: "T" });
      const next = notes.edit(n.id, { expected_version: 1, body: "New" });
      expect(next).toMatchObject({ body: "New", version: 2 });
      expect(() => notes.edit(n.id, { expected_version: 1, body: "Late" })).toThrow(NoteStaleError);
      expect(() => notes.edit(n.id, { title: "No version" })).toThrow(/expected_version/);
    });

    it("does not version colour, pin or archive, so they cannot fail someone typing", () => {
      const { notes, alpha } = setup();
      const n = notes.add(alpha, { title: "T" });
      const next = notes.edit(n.id, { color: "green", pinned: true });
      expect(next).toMatchObject({ color: "green", pinned: true, version: 1 });
      expect(notes.edit(n.id, { expected_version: 1, body: "Typed" }).body).toBe("Typed");
    });

    it("keeps item ids, and numbers new items past the highest", () => {
      const { notes, alpha } = setup();
      const n = notes.add(alpha, { items: [{ text: "A", checked: false }, { text: "B", checked: false }] });
      const next = notes.edit(n.id, {
        expected_version: 1,
        items: [{ id: 2, text: "B", checked: true }, { text: "C", checked: false }],
      });
      expect(next.items).toEqual([
        { id: 2, text: "B", checked: true },
        { id: 3, text: "C", checked: false },
      ]);
    });

    it("may empty a note, because autosave passes through empty while someone retypes", () => {
      const { notes, alpha } = setup();
      const n = notes.add(alpha, { title: "T" });
      expect(notes.edit(n.id, { expected_version: 1, title: "" }).title).toBe("");
    });

    it("turns a text note into a checklist and back", () => {
      const { notes, alpha } = setup();
      const n = notes.add(alpha, { body: "Text" });
      const list = notes.edit(n.id, { expected_version: 1, body: "", items: [{ text: "One", checked: false }] });
      expect(list.items).toHaveLength(1);
      const back = notes.edit(n.id, { expected_version: list.version, items: null, body: "One" });
      expect(back).toMatchObject({ items: null, body: "One" });
    });

    it("refuses an edit naming nothing", () => {
      const { notes, alpha } = setup();
      const n = notes.add(alpha, { title: "T" });
      expect(() => notes.edit(n.id, {})).toThrow("nothing to change");
    });

    it("throws not-found for an unknown note", () => {
      const { notes } = setup();
      expect(() => notes.edit(999, { color: "red" })).toThrow(NoteNotFoundError);
    });
  });

  describe("pin, archive and trash", () => {
    it("lists pinned notes first", () => {
      const { notes, alpha } = setup();
      const a = notes.add(alpha, { title: "A" });
      notes.add(alpha, { title: "B" });
      notes.edit(a.id, { pinned: true });
      expect(titles(notes.list(alpha))).toEqual(["A", "B"]);
    });

    it("unpins a note it archives, and pinning an archived note brings it back", () => {
      const { notes, alpha } = setup();
      const n = notes.add(alpha, { title: "A", pinned: true });
      expect(notes.edit(n.id, { archived: true })).toMatchObject({ archived: true, pinned: false });
      expect(notes.edit(n.id, { pinned: true })).toMatchObject({ archived: false, pinned: true });
    });

    it("separates active, archived and trashed notes", () => {
      const { notes, alpha } = setup();
      notes.add(alpha, { title: "Active" });
      const a = notes.add(alpha, { title: "Archived" });
      const t = notes.add(alpha, { title: "Trashed" });
      notes.edit(a.id, { archived: true });
      notes.edit(t.id, { trashed: true });
      expect(titles(notes.list(alpha))).toEqual(["Active"]);
      expect(titles(notes.list(alpha, "archived"))).toEqual(["Archived"]);
      expect(titles(notes.list(alpha, "trashed"))).toEqual(["Trashed"]);
    });

    it("refuses changes to a trashed note until it is restored", () => {
      const { notes, alpha } = setup();
      const n = notes.add(alpha, { title: "T" });
      notes.edit(n.id, { trashed: true });
      expect(() => notes.edit(n.id, { expected_version: 1, body: "x" })).toThrow(NoteConflictError);
      expect(() => notes.edit(n.id, { color: "red" })).toThrow(NoteConflictError);
      expect(notes.edit(n.id, { trashed: false }).trashed).toBe(false);
    });

    it("deletes permanently only from the trash", () => {
      const { notes, alpha } = setup();
      const n = notes.add(alpha, { title: "T" });
      expect(() => notes.remove(n.id)).toThrow(NoteConflictError);
      notes.edit(n.id, { trashed: true });
      notes.remove(n.id);
      expect(notes.get(n.id)).toBeNull();
    });
  });

  describe("toggleItem", () => {
    it("flips one item with no version check, and bumps the version", () => {
      const { notes, alpha } = setup();
      const n = notes.add(alpha, { items: [{ text: "A", checked: false }, { text: "B", checked: false }] });
      const next = notes.toggleItem(n.id, 2, true);
      expect(next.items).toEqual([
        { id: 1, text: "A", checked: false },
        { id: 2, text: "B", checked: true },
      ]);
      expect(next.version).toBe(2);
    });

    it("refuses an unknown item, a text note and a trashed note", () => {
      const { notes, alpha } = setup();
      const list = notes.add(alpha, { items: [{ text: "A", checked: false }] });
      const text = notes.add(alpha, { body: "Text" });
      expect(() => notes.toggleItem(list.id, 9, true)).toThrow(NoteNotFoundError);
      expect(() => notes.toggleItem(text.id, 1, true)).toThrow(NoteNotFoundError);
      notes.edit(list.id, { trashed: true });
      expect(() => notes.toggleItem(list.id, 1, true)).toThrow(NoteConflictError);
    });
  });

  describe("move", () => {
    it("reorders within a section, with no version bump", () => {
      const { notes, alpha } = setup();
      const c = notes.add(alpha, { title: "C" });
      const b = notes.add(alpha, { title: "B" });
      const a = notes.add(alpha, { title: "A" });
      expect(notes.move(c.id, a.id).version).toBe(1);
      expect(titles(notes.list(alpha))).toEqual(["C", "A", "B"]);
      notes.move(c.id, null);
      expect(titles(notes.list(alpha))).toEqual(["A", "B", "C"]);
      notes.move(a.id, b.id);
      expect(titles(notes.list(alpha))).toEqual(["A", "B", "C"]);
    });

    it("keeps a pinned note among pinned ones: a target in the other section means the bottom", () => {
      const { notes, alpha } = setup();
      const other = notes.add(alpha, { title: "Other" });
      const p2 = notes.add(alpha, { title: "P2", pinned: true });
      const p1 = notes.add(alpha, { title: "P1", pinned: true });
      notes.move(p1.id, other.id);
      expect(titles(notes.list(alpha))).toEqual(["P2", "P1", "Other"]);
      expect(notes.get(p1.id)?.pinned).toBe(true);
      expect(p2.pinned).toBe(true);
    });

    it("refuses a note that is not active", () => {
      const { notes, alpha } = setup();
      const n = notes.add(alpha, { title: "T" });
      notes.edit(n.id, { archived: true });
      expect(() => notes.move(n.id, null)).toThrow(NoteConflictError);
    });
  });

  describe("events and log", () => {
    it("emits note-changed with ids only", () => {
      const { notes, alpha } = setup();
      const events: WikikaiEvent[] = [];
      const off = onEvent((e) => events.push(e));
      const n = notes.add(alpha, { title: "T", body: "Secret text" });
      off();
      expect(events).toContainEqual({ type: "note-changed", project_id: alpha, note_id: n.id });
      expect(JSON.stringify(events)).not.toContain("Secret text");
    });

    it("logs add, trash, restore and delete but not typing, and never the body", () => {
      const { notes, log, alpha } = setup();
      const n = notes.add(alpha, { title: "Plan", body: "Secret text" });
      notes.edit(n.id, { expected_version: 1, body: "More secret text" });
      notes.edit(n.id, { color: "red" });
      notes.edit(n.id, { trashed: true });
      notes.edit(n.id, { trashed: false });
      notes.edit(n.id, { trashed: true });
      notes.remove(n.id);
      const rows = log.list().entries.filter((e) => e.target === "note").reverse();
      expect(rows.map((r) => [r.action, r.task_title])).toEqual([
        ["add", "Plan"],
        ["edit", "Plan (moved to trash)"],
        ["edit", "Plan (restored)"],
        ["edit", "Plan (moved to trash)"],
        ["delete", "Plan"],
      ]);
      expect(rows.every((r) => r.project_id === alpha)).toBe(true);
      expect(JSON.stringify(log.list().entries)).not.toContain("Secret text");
    });

    it("shows a member only the note rows of their projects", () => {
      const { notes, log, alpha, beta } = setup();
      notes.add(alpha, { title: "Mine" });
      notes.add(beta, { title: "Theirs" });
      expect(log.list({ visibleProjects: ["alpha"] }).entries.map((e) => e.task_title)).toEqual(["Mine"]);
    });
  });

  describe("project lifecycle", () => {
    it("refuses to unregister a project that has notes, trashed ones included", () => {
      const { notes, knowledge, alpha } = setup();
      const n = notes.add(alpha, { title: "T" });
      notes.edit(n.id, { trashed: true });
      expect(() => knowledge.unregisterProject("alpha")).toThrow(ProjectHasNotesError);
      notes.remove(n.id);
      expect(knowledge.unregisterProject("alpha").removed).toBe(true);
    });
  });
});
