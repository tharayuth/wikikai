import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../src/store/db.js";
import {
  FileStore,
  cleanupRemovedFileRefs,
  extForFileName,
  extractFileHashesSet,
  parseFileSrc,
  sanitizeFileName,
} from "../src/store/files.js";
import { KnowledgeStore } from "../src/store/knowledge.js";
import { PageStore } from "../src/store/pages.js";

describe("FileStore", () => {
  let dir: string;
  let store: FileStore;
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "wikikai-files-"));
    db = openDb(":memory:");
    store = new FileStore(db, path.join(dir, "files"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("stores bytes under the hash, keeps the original name, infers mime", () => {
    const meta = store.add(Buffer.from("a,b\n1,2\n"), "รายงาน Q3.csv");
    expect(meta.name).toBe("รายงาน Q3.csv");
    expect(meta.ext).toBe("csv");
    expect(meta.mime).toBe("text/csv");
    expect(meta.size_bytes).toBe(8);
    expect(meta.src).toMatch(/^\/file\/[a-f0-9]{64}\.csv$/);
    expect(fs.existsSync(store.filePath(meta.hash, meta.ext))).toBe(true);
    expect(fs.readdirSync(path.join(dir, "files", meta.hash.slice(0, 2)))).toEqual([
      `${meta.hash}.csv`,
    ]);
  });

  it("dedupes identical content and honours an explicit mime", () => {
    const a = store.add(Buffer.from("same"), "one.bin", "application/x-custom");
    const b = store.add(Buffer.from("same"), "two.bin");
    expect(b.hash).toBe(a.hash);
    expect(b.name).toBe("one.bin");
    expect(b.mime).toBe("application/x-custom");
    expect(store.listAllHashes()).toHaveLength(1);
  });

  it("sanitises names and falls back to bin", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("  ")).toBe("file");
    expect(extForFileName("archive.tar.gz")).toBe("gz");
    expect(extForFileName("noext")).toBe("bin");
    expect(parseFileSrc("/file/" + "a".repeat(64) + ".pdf")).toEqual({ hash: "a".repeat(64), ext: "pdf" });
    expect(parseFileSrc("/file/../x")).toBeNull();
  });

  it("rejects empty uploads", () => {
    expect(() => store.add(Buffer.alloc(0), "x.txt")).toThrow(/empty/);
  });

  it("removes file + row", () => {
    const meta = store.add(Buffer.from("bye"), "bye.txt");
    expect(store.remove(meta.hash)).toBe(true);
    expect(fs.existsSync(store.filePath(meta.hash, meta.ext))).toBe(false);
    expect(store.get(meta.hash)).toBeNull();
    expect(store.remove(meta.hash)).toBe(false);
  });

  it("cleans up a dropped reference only when no other page still uses it", () => {
    const knowledge = new KnowledgeStore(db);
    const pages = new PageStore(db, path.join(dir, "items"));
    const kid = knowledge.add({ title: "K", project: "p" }).id;
    const meta = store.add(Buffer.from("shared"), "shared.txt");
    const fence = "```file\n" + JSON.stringify({ src: meta.src, name: meta.name }) + "\n```\n";
    const p1 = pages.add({ knowledge_id: kid, title: "A", content: "# A\n\n" + fence });
    const p2 = pages.add({ knowledge_id: kid, title: "B", content: "# B\n\n" + fence });

    expect(extractFileHashesSet(fence)).toEqual(new Set([meta.hash]));
    expect(pages.allReferencedFileHashes()).toEqual(new Set([meta.hash]));

    pages.update(p1.id, { content: "# A\n\nno file" });
    expect(cleanupRemovedFileRefs(new Set([meta.hash]), p1.id, db, store)).toBe(0);
    expect(store.get(meta.hash)).not.toBeNull();

    pages.update(p2.id, { content: "# B\n\nno file" });
    expect(cleanupRemovedFileRefs(new Set([meta.hash]), p2.id, db, store)).toBe(1);
    expect(store.get(meta.hash)).toBeNull();
    expect(fs.existsSync(store.filePath(meta.hash, meta.ext))).toBe(false);
  });
});
