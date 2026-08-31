import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Db } from "../src/store/db.js";
import { openDb, purgeOrphanFtsRows } from "../src/store/db.js";
import { KnowledgeStore } from "../src/store/knowledge.js";
import { PageStore } from "../src/store/pages.js";

/**
 * `pages_fts` is a virtual table, so it can never be a foreign-key target:
 * deleting a knowledge row cascades `pages` but leaves the index rows behind.
 * Those ghosts are invisible in results (the search JOIN drops them) yet they
 * stay in the collection statistics bm25 ranks with — every score in the app
 * is then computed against a corpus partly made of deleted pages.
 */
describe("FTS index hygiene", () => {
  let tmpDir: string;
  let db: Db;
  let knowledge: KnowledgeStore;
  let pages: PageStore;

  const ftsCount = () =>
    (db.prepare(`SELECT count(*) AS c FROM pages_fts`).get() as { c: number }).c;
  const pageCount = () =>
    (db.prepare(`SELECT count(*) AS c FROM pages`).get() as { c: number }).c;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wk-fts-"));
    db = openDb(":memory:");
    knowledge = new KnowledgeStore(db);
    pages = new PageStore(db, tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("leaves no index rows behind when a whole knowledge is deleted", () => {
    const kid = knowledge.add({ title: "Doomed", project: "examples" }).id;
    pages.add({ knowledge_id: kid, title: "P1", content: "alpha content" });
    pages.add({ knowledge_id: kid, title: "P2", content: "beta content" });
    const keep = knowledge.add({ title: "Kept", project: "examples" }).id;
    pages.add({ knowledge_id: keep, title: "K1", content: "gamma content" });
    expect(ftsCount()).toBe(3);

    // Same order the delete_knowledge handler uses: purge what cascade
    // cannot reach, then drop the row.
    pages.purgeKnowledge(kid);
    knowledge.remove(kid);

    expect(pageCount()).toBe(1);
    expect(ftsCount()).toBe(1);
  });

  it("keeps deleting a single page clean too", () => {
    const kid = knowledge.add({ title: "Doc", project: "examples" }).id;
    const p = pages.add({ knowledge_id: kid, title: "P1", content: "alpha" });
    pages.add({ knowledge_id: kid, title: "P2", content: "beta" });
    pages.remove(p.id);
    expect(pageCount()).toBe(1);
    expect(ftsCount()).toBe(1);
  });

  it("repairs a database that already accumulated ghost rows", () => {
    const kid = knowledge.add({ title: "Doc", project: "examples" }).id;
    pages.add({ knowledge_id: kid, title: "P1", content: "alpha" });
    // Simulate the pre-fix bug: page rows vanish, index rows survive.
    db.prepare(`DELETE FROM pages WHERE knowledge_id = ?`).run(kid);
    expect(ftsCount()).toBe(1);
    expect(pageCount()).toBe(0);

    expect(purgeOrphanFtsRows(db)).toBe(1);
    expect(ftsCount()).toBe(0);
    expect(purgeOrphanFtsRows(db)).toBe(0); // idempotent
  });
});
