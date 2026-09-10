import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../src/store/db.js";
import { KnowledgeStore } from "../src/store/knowledge.js";
import { PageStore } from "../src/store/pages.js";
import { ImageStore } from "../src/store/images.js";
import { FileStore } from "../src/store/files.js";
import { PromptLogStore } from "../src/store/promptLog.js";
import { ActivityLogStore } from "../src/store/activityLog.js";
import { PermissionStore } from "../src/store/permissions.js";
import { UserStore } from "../src/store/users.js";
import { buildToolHandlers } from "../src/mcp/handlers.js";

describe("add_file + attachment lifecycle", () => {
  let dir: string;
  let files: FileStore;
  let pages: PageStore;
  let h: ReturnType<typeof buildToolHandlers>;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "wikikai-file-tool-"));
    const db = openDb(":memory:");
    const knowledge = new KnowledgeStore(db);
    pages = new PageStore(db, path.join(dir, "items"));
    const images = new ImageStore(db, path.join(dir, "images"));
    files = new FileStore(db, path.join(dir, "files"));
    h = buildToolHandlers(
      knowledge,
      pages,
      images,
      new PromptLogStore(db),
      new ActivityLogStore(db),
      { publicBaseUrl: "http://test", imageImportRoots: [fs.realpathSync(dir)], imageImportEnabled: true },
      new PermissionStore(db),
      new UserStore(db),
      db,
      files,
    );
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const b64 = (s: string) => Buffer.from(s).toString("base64");

  it("stores base64 bytes and returns a ready-to-paste fence", async () => {
    const r = await h.add_file({
      data_base64: b64("a,b\n1,2\n"),
      name: "รายงาน.csv",
      description: "ข้อมูลดิบ",
    });
    expect(r.name).toBe("รายงาน.csv");
    expect(r.mime).toBe("text/csv");
    expect(r.size_bytes).toBe(8);
    expect(r.url).toBe(`http://test${r.src}`);
    expect(r.fence.startsWith("```file\n")).toBe(true);
    const json = JSON.parse(r.fence.split("\n")[1]);
    expect(json).toEqual({
      src: r.src,
      name: "รายงาน.csv",
      size_bytes: 8,
      mime: "text/csv",
      description: "ข้อมูลดิบ",
    });
  });

  it("imports from a server-local path, defaulting name to the basename", async () => {
    const fp = path.join(dir, "brief.pdf");
    fs.writeFileSync(fp, "%PDF-1.4 fake");
    const r = await h.add_file({ path: fp });
    expect(r.name).toBe("brief.pdf");
    expect(r.mime).toBe("application/pdf");
    expect(fs.existsSync(files.filePath(r.hash, r.ext))).toBe(true);
  });

  it("rejects bad input", async () => {
    await expect(h.add_file({ data_base64: b64("x") })).rejects.toThrow(/name/);
    await expect(h.add_file({ name: "x.txt" })).rejects.toThrow(/exactly one/);
    await expect(h.add_file({ path: "/etc/hosts" })).rejects.toThrow(/outside/);
  });

  it("deletes the bytes once the last page reference is edited away", async () => {
    const k = await h.add_knowledge({ title: "K", project: "p" });
    const f = await h.add_file({ data_base64: b64("payload"), name: "x.txt" });
    const onDisk = files.filePath(f.hash, f.ext);
    const p1 = await h.add_page({ knowledge_id: k.id, title: "A", content: `# A\n\n${f.fence}\n` });
    const p2 = await h.add_page({ knowledge_id: k.id, title: "B", content: `# B\n\n${f.fence}\n` });

    // Edit raw on A drops it → B still references → keep.
    await h.edit_page({ page_id: p1.id, content: "# A\n\ngone" });
    expect(fs.existsSync(onDisk)).toBe(true);

    // edit_section on B drops it → nobody left → gone.
    await h.edit_section({ page_id: p2.id, heading: "# B", new_content: "# B\n\nalso gone" });
    expect(fs.existsSync(onDisk)).toBe(false);
    expect(files.get(f.hash)).toBeNull();
  });

  it("deletes the bytes when the only referencing page or knowledge is deleted", async () => {
    const k = await h.add_knowledge({ title: "K", project: "p" });
    const f = await h.add_file({ data_base64: b64("one"), name: "one.txt" });
    const g = await h.add_file({ data_base64: b64("two"), name: "two.txt" });
    const p = await h.add_page({ knowledge_id: k.id, title: "A", content: `${f.fence}\n` });
    await h.add_page({ knowledge_id: k.id, title: "B", content: `${g.fence}\n` });

    await h.delete_page({ page_id: p.id });
    expect(files.get(f.hash)).toBeNull();
    expect(files.get(g.hash)).not.toBeNull();

    await h.delete_knowledge({ id: k.id });
    expect(files.get(g.hash)).toBeNull();
    expect(fs.existsSync(files.filePath(g.hash, g.ext))).toBe(false);
  });

  it("replace_text and edit_lines also trigger cleanup", async () => {
    const k = await h.add_knowledge({ title: "K", project: "p" });
    const f = await h.add_file({ data_base64: b64("r"), name: "r.txt" });
    const p = await h.add_page({ knowledge_id: k.id, title: "A", content: `intro\n${f.fence}\n` });
    await h.replace_text({ knowledge_id: k.id, page_id: p.id, find: f.src, replace: "/file/removed" });
    expect(files.get(f.hash)).toBeNull();

    const g = await h.add_file({ data_base64: b64("l"), name: "l.txt" });
    const q = await h.add_page({ knowledge_id: k.id, title: "L", content: `l1\n${g.fence}\n` });
    await h.edit_lines({ page_id: q.id, line_start: 2, line_end: 4, new_text: "plain" });
    expect(files.get(g.hash)).toBeNull();
  });

  it("get_block returns the file fence as a rich block", async () => {
    const k = await h.add_knowledge({ title: "K", project: "p" });
    const f = await h.add_file({ data_base64: b64("blk"), name: "blk.txt" });
    const p = await h.add_page({ knowledge_id: k.id, title: "A", content: `${f.fence}\n` });
    const stored = pages.get(p.id)!.content;
    const id = Number(/```file \{@(\d+)\}/.exec(stored)?.[1]);
    expect(id).toBeGreaterThan(0);
    const blk = await h.get_block({ id });
    expect(blk.kind).toBe("file");
  });
});
