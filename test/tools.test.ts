import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../src/store/db.js";
import { KnowledgeStore } from "../src/store/knowledge.js";
import { PageStore } from "../src/store/pages.js";
import { ImageStore } from "../src/store/images.js";
import { PromptLogStore } from "../src/store/promptLog.js";
import { ActivityLogStore } from "../src/store/activityLog.js";
import { PermissionStore } from "../src/store/permissions.js";
import { buildToolHandlers } from "../src/mcp/handlers.js";

describe("MCP tool handlers", () => {
  let tmpDir: string;
  let h: ReturnType<typeof buildToolHandlers>;
  let knowledge: KnowledgeStore;
  let pages: PageStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aim-tools-"));
    const db = openDb(":memory:");
    knowledge = new KnowledgeStore(db);
    pages = new PageStore(db, tmpDir);
    const images = new ImageStore(db, path.join(tmpDir, "images"));
    const promptLog = new PromptLogStore(db);
    const activityLog = new ActivityLogStore(db);
    const permissions = new PermissionStore(db);
    h = buildToolHandlers(knowledge, pages, images, promptLog, activityLog, { publicBaseUrl: "http://test" }, permissions);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("add_knowledge", () => {
    it("creates knowledge and returns id + url", async () => {
      const r = await h.add_knowledge({ title: "Doc 1", project: "p" });
      expect(r.id).toBe(1);
      expect(r.url).toBe("http://test/&1");
      expect(r.first_page).toBeUndefined();
    });

    it("creates first_page when provided", async () => {
      const r = await h.add_knowledge({
        title: "Doc",
        project: "examples",
        first_page: { title: "Intro", content: "# Hi" },
      });
      expect(r.first_page).toEqual(expect.objectContaining({ id: 1, position: 1 }));
    });

    it("add_knowledge rejects when project missing", async () => {
      await expect(
        h.add_knowledge({ title: "X" } as unknown as Parameters<typeof h.add_knowledge>[0]),
      ).rejects.toThrow(/project/);
    });
  });

  describe("get_knowledge", () => {
    it("returns metadata + pages by default", async () => {
      const k = await h.add_knowledge({
        title: "Doc",
        project: "examples",
        first_page: { title: "P1", content: "a" },
      });
      await h.add_page({ knowledge_id: k.id, title: "P2", content: "b" });
      const got = await h.get_knowledge({ id: k.id });
      expect(got.pages).toHaveLength(2);
      expect(got.pages![0]).toHaveProperty("url");
    });

    it("omits pages when include_pages=false", async () => {
      const k = await h.add_knowledge({ title: "Doc", project: "examples" });
      const got = await h.get_knowledge({ id: k.id, include_pages: false });
      expect(got.pages).toBeUndefined();
    });

    it("throws for missing", async () => {
      await expect(h.get_knowledge({ id: 999 })).rejects.toThrow();
    });
  });

  describe("get_outline", () => {
    it("returns title + page outlines", async () => {
      const k = await h.add_knowledge({
        title: "K",
        project: "examples",
        first_page: { title: "P1", content: "# T\n\n## A\nx\n\n## B\ny" },
      });
      const out = await h.get_outline({ knowledge_id: k.id });
      expect(out.title).toBe("K");
      expect(out.pages[0].headings.map((x) => x.text)).toEqual(["T", "A", "B"]);
    });
  });

  describe("add_page / list_pages / delete_page", () => {
    it("end-to-end", async () => {
      const k = await h.add_knowledge({ title: "Doc", project: "examples" });
      const a = await h.add_page({ knowledge_id: k.id, title: "A", content: "a" });
      const b = await h.add_page({ knowledge_id: k.id, title: "B", content: "b" });
      const list = await h.list_pages({ knowledge_id: k.id });
      expect(list.map((p) => p.title)).toEqual(["A", "B"]);
      expect(list[0].url).toBe(`http://test/&${k.id}/#${a.id}`);
      await h.delete_page({ page_id: a.id });
      const list2 = await h.list_pages({ knowledge_id: k.id });
      expect(list2.map((p) => p.title)).toEqual(["B"]);
      expect(b.position).toBe(2);
    });
  });

  describe("edit_page + append_page", () => {
    it("edit_page replaces content + bumps version", async () => {
      const k = await h.add_knowledge({ title: "D", project: "examples" });
      const p = await h.add_page({ knowledge_id: k.id, title: "P", content: "v1" });
      const r = await h.edit_page({ page_id: p.id, content: "v2" });
      expect(r.version).toBe(2);
      expect(pages.get(p.id)!.content).toBe("v2");
    });

    it("append_page returns new line count", async () => {
      const k = await h.add_knowledge({ title: "D", project: "examples" });
      const p = await h.add_page({ knowledge_id: k.id, title: "P", content: "a" });
      const r = await h.append_page({ page_id: p.id, text: "b\nc" });
      expect(r.new_line_count).toBe(3);
    });
  });

  describe("reorder_pages", () => {
    it("reorders by id permutation", async () => {
      const k = await h.add_knowledge({ title: "D", project: "examples" });
      const a = await h.add_page({ knowledge_id: k.id, title: "A", content: "" });
      const b = await h.add_page({ knowledge_id: k.id, title: "B", content: "" });
      const c = await h.add_page({ knowledge_id: k.id, title: "C", content: "" });
      await h.reorder_pages({ knowledge_id: k.id, order: [c.id, a.id, b.id] });
      const list = await h.list_pages({ knowledge_id: k.id });
      expect(list.map((p) => p.title)).toEqual(["C", "A", "B"]);
    });
  });

  describe("read_page + edit_lines + edit_section + replace_text", () => {
    it("read_page mode:'full' returns slice + hash + url with line", async () => {
      const k = await h.add_knowledge({ title: "D", project: "examples" });
      const p = await h.add_page({ knowledge_id: k.id, title: "P", content: "a\nb\nc" });
      // Explicit mode:"full" — default is now "summary" which omits hash.
      const r = await h.read_page({
        page_id: p.id,
        line_start: 2,
        line_end: 2,
        mode: "full",
      });
      expect(r.content).toBe("b");
      expect(r.url).toBe(`http://test/&${k.id}/#${p.id}:2`);
      expect(r.hash).toBeTruthy();
    });

    it("read_page defaults to summary mode when caller omits `mode`", async () => {
      const k = await h.add_knowledge({ title: "D", project: "examples" });
      const p = await h.add_page({
        knowledge_id: k.id,
        title: "P",
        content: 'intro\n\n```mermaid {@900 "Arch"}\nflowchart TD\n  A --> B\n```\n',
      });
      const r = await h.read_page({ page_id: p.id });
      expect(r.mode).toBe("summary");
      expect(r.content).toContain("[@900 mermaid 4 lines: Arch]");
      // Body must not survive
      expect(r.content).not.toContain("flowchart TD");
      // Hash omitted in summary mode by default
      expect(r.hash).toBeUndefined();
    });

    it("read_page mode:'summary' returns skeleton + blocks index", async () => {
      const k = await h.add_knowledge({ title: "D", project: "examples" });
      const p = await h.add_page({
        knowledge_id: k.id,
        title: "P",
        content: [
          "intro",
          "",
          '```mermaid {@500 "Arch overview"}',
          "flowchart TD",
          "  A --> B",
          "```",
          "",
          "outro",
        ].join("\n"),
      });
      const r = await h.read_page({ page_id: p.id, mode: "summary" });
      expect(r.mode).toBe("summary");
      expect(r.content).toContain("[@500 mermaid 4 lines: Arch overview]");
      expect(r.content).not.toContain("flowchart TD");
      expect(r.blocks).toBeDefined();
      expect(r.blocks!).toHaveLength(1);
      expect(r.blocks![0].id).toBe(500);
      expect(r.blocks![0].caption).toBe("Arch overview");
      // Hash deliberately absent in summary mode
      expect(r.hash).toBeUndefined();
      // Source line count exposed so AI knows the real page size
      expect(r.source_total_lines).toBeGreaterThan(r.total_lines);
    });

    it("read_page strips html-embed inline styles by default, omits hash", async () => {
      const k = await h.add_knowledge({ title: "D", project: "examples" });
      const p = await h.add_page({
        knowledge_id: k.id,
        title: "P",
        content: [
          "intro",
          "",
          '```html-embed {@700 "Card grid"}',
          '<div style="display:grid;gap:12px">',
          '  <div style="background:#fef3c7;padding:8px">hello</div>',
          '  <div class="card" style="background:#dbeafe">world</div>',
          "</div>",
          "```",
        ].join("\n"),
      });
      // Full mode — styles stripped, hash omitted because stripping
      // changed the content. Need mode:"full" since default is summary
      // (which would collapse the whole html-embed to a placeholder).
      const r1 = await h.read_page({ page_id: p.id, mode: "full" });
      expect(r1.content).not.toContain('style=');
      expect(r1.content).toContain("hello");
      expect(r1.content).toContain("world");
      // Non-style attrs like class survive
      expect(r1.content).toContain('class="card"');
      expect(r1.hash).toBeUndefined();
      // Opt-in keeps styles + hash
      const r2 = await h.read_page({
        page_id: p.id,
        mode: "full",
        include_styles: true,
      });
      expect(r2.content).toContain('style="display:grid');
      expect(r2.content).toContain('style="background:#fef3c7');
      expect(r2.hash).toBeTruthy();
    });

    it("read_page leaves pages without html-embed alone — hash present in full mode", async () => {
      const k = await h.add_knowledge({ title: "D", project: "examples" });
      const p = await h.add_page({
        knowledge_id: k.id,
        title: "P",
        content: "just\nplain\nprose\n",
      });
      // No html-embed → nothing to strip → hash still returned even
      // though include_styles defaults to false.
      const r = await h.read_page({ page_id: p.id, mode: "full" });
      expect(r.hash).toBeTruthy();
    });

    it("get_block strips html-embed inline styles by default, opt-in keeps them", async () => {
      const k = await h.add_knowledge({ title: "D", project: "examples" });
      await h.add_page({
        knowledge_id: k.id,
        title: "P",
        content: [
          '```html-embed {@701 "Status grid"}',
          '<div style="display:grid">',
          '  <div style="background:red">A</div>',
          '  <div style="background:green">B</div>',
          "</div>",
          "```",
        ].join("\n"),
      });
      const stripped = await h.get_block({ id: 701 });
      expect(stripped.kind).toBe("html-embed");
      expect(stripped.source).not.toContain('style=');
      expect(stripped.source).toContain("A");
      expect(stripped.source).toContain("B");
      const full = await h.get_block({ id: 701, include_styles: true });
      expect(full.source).toContain('style="background:red"');
      expect(full.source).toContain('style="background:green"');
    });

    it("read_page includes parent knowledge structure (& context)", async () => {
      const k = await h.add_knowledge({ title: "Doc title", project: "examples" });
      const a = await h.add_page({ knowledge_id: k.id, title: "A", content: "aa" });
      const b = await h.add_page({ knowledge_id: k.id, title: "B", content: "bb" });
      const r = await h.read_page({ page_id: a.id });
      expect(r.knowledge).toBeDefined();
      expect(r.knowledge.id).toBe(k.id);
      expect(r.knowledge.title).toBe("Doc title");
      expect(r.knowledge.url).toBe(`http://test/&${k.id}`);
      expect(r.knowledge.pages).toHaveLength(2);
      const current = r.knowledge.pages.find((p) => p.is_current);
      expect(current?.id).toBe(a.id);
      const other = r.knowledge.pages.find((p) => !p.is_current);
      expect(other?.id).toBe(b.id);
    });

    it("edit_lines with expected_hash gate", async () => {
      const k = await h.add_knowledge({ title: "D", project: "examples" });
      const p = await h.add_page({ knowledge_id: k.id, title: "P", content: "a\nb\nc" });
      const r = await h.read_page({
        page_id: p.id,
        line_start: 2,
        line_end: 2,
        mode: "full",
      });
      const e = await h.edit_lines({
        page_id: p.id,
        line_start: 2,
        line_end: 2,
        new_text: "B",
        expected_hash: r.hash,
      });
      expect(e.version).toBe(2);
      expect(pages.get(p.id)!.content).toBe("a\nB\nc");
      await expect(
        h.edit_lines({
          page_id: p.id,
          line_start: 1,
          line_end: 1,
          new_text: "A",
          expected_hash: "bogus",
        }),
      ).rejects.toThrow(/hash mismatch/);
    });

    it("edit_section replaces under heading", async () => {
      const k = await h.add_knowledge({ title: "D", project: "examples" });
      const p = await h.add_page({
        knowledge_id: k.id,
        title: "P",
        content: "# T\n\n## A\nold\n\n## B\nb",
      });
      await h.edit_section({ page_id: p.id, heading: "## A", new_content: "new!" });
      const got = pages.get(p.id)!.content;
      expect(got).toContain("## A\nnew!");
      expect(got).toContain("## B\nb");
    });

    it("replace_text returns per-page counts and total", async () => {
      const k = await h.add_knowledge({ title: "D", project: "examples" });
      await h.add_page({ knowledge_id: k.id, title: "A", content: "foo foo bar" });
      await h.add_page({ knowledge_id: k.id, title: "B", content: "foo only here" });
      const r = await h.replace_text({ knowledge_id: k.id, find: "foo", replace: "X" });
      expect(r.total).toBe(3);
      expect(r.replacements).toHaveLength(2);
    });
  });

  describe("search", () => {
    it("returns hits with url containing line", async () => {
      const k = await h.add_knowledge({ title: "K", project: "examples" });
      await h.add_page({
        knowledge_id: k.id,
        title: "Page",
        content: "Redis sits in cache.\nLine two has no match.",
      });
      const r = await h.search({ query: "Redis" });
      expect(r.total).toBeGreaterThan(0);
      expect(r.hits[0].url).toMatch(/\/&\d+\/#\d+:\d+$/);
      expect(r.hits[0].line).toBe(1);
    });
  });

  describe("get_example", () => {
    it("returns full default with outline + total_lines", async () => {
      const r = await h.get_example({});
      expect(r.kind).toBe("full");
      expect(r.content).toContain("```mermaid");
      expect(r.total_lines).toBeGreaterThan(10);
      expect(r.outline.length).toBeGreaterThan(0);
      expect(r.outline[0]).toHaveProperty("level");
      expect(r.outline[0]).toHaveProperty("text");
      expect(r.outline[0]).toHaveProperty("line");
    });

    it("outline_only returns headings without body", async () => {
      const r = await h.get_example({ kind: "full", outline_only: true });
      expect(r.content).toBe("");
      expect(r.outline.length).toBeGreaterThan(3);
      expect(r.total_lines).toBeGreaterThan(10);
      // outline lines should be 1-based and within total_lines
      for (const h of r.outline) {
        expect(h.line).toBeGreaterThan(0);
        expect(h.line).toBeLessThanOrEqual(r.total_lines);
      }
    });

    it("line_start/line_end returns just the slice", async () => {
      const full = await h.get_example({ kind: "full" });
      const total = full.total_lines;
      const r = await h.get_example({ kind: "full", line_start: 1, line_end: 5 });
      expect(r.line_start).toBe(1);
      expect(r.line_end).toBe(5);
      expect(r.total_lines).toBe(total);
      expect(r.content.split("\n").length).toBe(5);
    });

    it("clamps line_end to total_lines", async () => {
      const r = await h.get_example({ kind: "minimal", line_start: 1, line_end: 9999 });
      expect(r.line_end).toBe(r.total_lines);
    });

    it("rejects unknown kind", async () => {
      await expect(h.get_example({ kind: "bogus" as never })).rejects.toThrow();
    });
  });

  describe("delete_knowledge", () => {
    it("deletes knowledge, pages, and files", async () => {
      const k = await h.add_knowledge({ title: "K", project: "examples" });
      const p = await h.add_page({ knowledge_id: k.id, title: "P", content: "x" });
      const fp = path.join(tmpDir, String(k.id), `${p.id}.md`);
      expect(fs.existsSync(fp)).toBe(true);
      await h.delete_knowledge({ id: k.id });
      expect(fs.existsSync(fp)).toBe(false);
      expect(await h.list_pages({ knowledge_id: k.id })).toEqual([]);
    });
  });
});
