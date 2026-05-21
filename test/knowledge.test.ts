import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../src/store/db.js";
import { KnowledgeStore } from "../src/store/knowledge.js";

describe("KnowledgeStore (metadata only)", () => {
  let store: KnowledgeStore;

  beforeEach(() => {
    store = new KnowledgeStore(openDb(":memory:"));
  });

  describe("add", () => {
    it("returns incrementing ids", () => {
      const a = store.add({ title: "A", project: "examples" });
      const b = store.add({ title: "B", project: "examples" });
      expect(a.id).toBe(1);
      expect(b.id).toBe(2);
    });

    it("stores all metadata fields", () => {
      const { id } = store.add({
        title: "T",
        project: "proj",
        session_id: "sess-uuid",
        user_prompt: "ถามอะไรซักอย่าง",
        tags: ["a", "b"],
        author: "claude-code",
      });
      const got = store.get(id)!;
      expect(got.title).toBe("T");
      expect(got.project).toBe("proj");
      expect(got.session_id).toBe("sess-uuid");
      expect(got.user_prompt).toBe("ถามอะไรซักอย่าง");
      expect(got.tags).toEqual(["a", "b"]);
      expect(got.author).toBe("claude-code");
      expect(got.version).toBe(1);
      expect(got.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("requires title", () => {
      expect(() => store.add({ title: "", project: "examples" })).toThrow();
    });

    it("requires project", () => {
      expect(() =>
        store.add({ title: "T" } as unknown as Parameters<typeof store.add>[0]),
      ).toThrow(/project/);
    });
  });

  describe("get", () => {
    it("returns null for missing", () => {
      expect(store.get(999)).toBeNull();
    });
  });

  describe("update", () => {
    it("bumps version and updates fields", () => {
      const { id } = store.add({ title: "Old", project: "examples", tags: ["x"] });
      const r = store.update(id, { title: "New", tags: ["y", "z"] });
      expect(r.version).toBe(2);
      const got = store.get(id)!;
      expect(got.title).toBe("New");
      expect(got.tags).toEqual(["y", "z"]);
    });

    it("throws on missing id", () => {
      expect(() => store.update(999, { title: "x" })).toThrow();
    });

    it("preserves untouched fields", () => {
      const { id } = store.add({
        title: "T",
        project: "p1",
        session_id: "s1",
        user_prompt: "old prompt",
      });
      store.update(id, { title: "T2" });
      const got = store.get(id)!;
      expect(got.project).toBe("p1");
      expect(got.session_id).toBe("s1");
      expect(got.user_prompt).toBe("old prompt");
    });
  });

  describe("list", () => {
    beforeEach(() => {
      store.add({ title: "A1", project: "isf", tags: ["er"] });
      store.add({ title: "A2", project: "isf", tags: ["chart"] });
      store.add({ title: "B", project: "wikikai" });
      store.add({ title: "C", project: "examples", session_id: "sess-1" });
    });

    it("newest first", () => {
      const all = store.list({});
      expect(all).toHaveLength(4);
      expect(all[0].title).toBe("C");
    });

    it("filters by project", () => {
      const r = store.list({ project: "isf" });
      expect(r.map((x) => x.title).sort()).toEqual(["A1", "A2"]);
    });

    it("filters by session_id", () => {
      const r = store.list({ session_id: "sess-1" });
      expect(r).toHaveLength(1);
      expect(r[0].title).toBe("C");
    });

    it("filters by tag", () => {
      const r = store.list({ tag: "er" });
      expect(r).toHaveLength(1);
      expect(r[0].title).toBe("A1");
    });

    it("searches title / project / tags", () => {
      const r = store.list({ search: "isf" });
      expect(r.map((x) => x.title).sort()).toEqual(["A1", "A2"]);
    });

    it("respects limit + offset", () => {
      const page1 = store.list({ limit: 2, offset: 0 });
      const page2 = store.list({ limit: 2, offset: 2 });
      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
      expect(page1[0].id).not.toBe(page2[0].id);
    });
  });

  describe("remove", () => {
    it("removes the row", () => {
      const { id } = store.add({ title: "T", project: "examples" });
      store.remove(id);
      expect(store.get(id)).toBeNull();
    });
  });
});
