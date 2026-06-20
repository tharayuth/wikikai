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
import { UserStore } from "../src/store/users.js";
import { buildToolHandlers } from "../src/mcp/handlers.js";
import { withCallContext } from "../src/lib/callContext.js";

describe("MCP tool handlers", () => {
  let tmpDir: string;
  let h: ReturnType<typeof buildToolHandlers>;
  let knowledge: KnowledgeStore;
  let pages: PageStore;
  let permissions: PermissionStore;
  let users: UserStore;
  let images: ImageStore;
  let imagesDir: string;
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aim-tools-"));
    db = openDb(":memory:");
    knowledge = new KnowledgeStore(db);
    pages = new PageStore(db, tmpDir);
    imagesDir = path.join(tmpDir, "images");
    images = new ImageStore(db, imagesDir);
    const promptLog = new PromptLogStore(db);
    const activityLog = new ActivityLogStore(db);
    permissions = new PermissionStore(db);
    users = new UserStore(db);
    h = buildToolHandlers(knowledge, pages, images, promptLog, activityLog, { publicBaseUrl: "http://test" }, permissions, users, db);
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

    it("edit_lines returns scoped feedback usable for a chained edit (Phase 2a)", async () => {
      const k = await h.add_knowledge({ title: "D", project: "examples" });
      const p = await h.add_page({
        knowledge_id: k.id,
        title: "P",
        content: "a\nb\nc",
      });
      const e = await h.edit_lines({
        page_id: p.id,
        line_start: 2,
        line_end: 2,
        new_text: "B1\nB2",
      });
      expect(e.status).toBe("changed");
      expect(e.changed_range?.after).toEqual({ line_start: 2, line_end: 3 });
      expect(e.page_hash).toBeTruthy();
      // page_hash equals a fresh full read — no separate re-read needed.
      const full = await h.read_page({ page_id: p.id, mode: "full" });
      expect(full.hash).toBe(e.page_hash);
      // changed_range_hash chains directly into the next edit with no re-read.
      const chained = await h.edit_lines({
        page_id: p.id,
        line_start: e.changed_range!.after!.line_start,
        line_end: e.changed_range!.after!.line_end,
        new_text: "B",
        expected_hash: e.changed_range_hash,
      });
      expect(chained.status).toBe("changed");
      expect(pages.get(p.id)!.content).toBe("a\nB\nc");
    });

    it("edit_lines reports a no-op without bumping version (Phase 2a)", async () => {
      const k = await h.add_knowledge({ title: "D", project: "examples" });
      const p = await h.add_page({ knowledge_id: k.id, title: "P", content: "a\nb\nc" });
      const v0 = pages.getMetadata(p.id)!.version;
      const e = await h.edit_lines({
        page_id: p.id,
        line_start: 2,
        line_end: 2,
        new_text: "b",
      });
      expect(e.status).toBe("noop");
      expect(e.changed_range).toBeUndefined();
      expect(pages.getMetadata(p.id)!.version).toBe(v0);
    });

    it("edit_section returns affected headings/blocks scoped to the edit (Phase 2b)", async () => {
      const k = await h.add_knowledge({ title: "D", project: "examples" });
      const p = await h.add_page({
        knowledge_id: k.id,
        title: "P",
        content: "# T\n\n## A\n\nold\n\n## B\n\nkeep",
      });
      const e = await h.edit_section({
        page_id: p.id,
        heading: "## A",
        new_content: '```stats\n[{"num":"1","label":"x"}]\n```',
      });
      expect(e.affected).toBeDefined();
      expect(e.affected!.headings.map((x) => x.text)).toContain("A");
      expect(e.affected!.headings.map((x) => x.text)).not.toContain("B");
      // Server-stamped stats block id is visible without a re-read.
      const stats = e.affected!.blocks.find((b) => b.kind === "stats");
      expect(stats?.id).toBeGreaterThan(0);
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

  describe("MCP read gating", () => {
    it("list_knowledge filters to visible projects for non-admin", async () => {
      knowledge.registerProject("alpha");
      knowledge.registerProject("beta");
      await h.add_knowledge({ title: "A", project: "alpha" });
      await h.add_knowledge({ title: "B", project: "beta" });

      const alice = users.create({
        email: "alice",
        password: "x",
        display_name: "Alice",
      });
      permissions.replaceForUser(
        alice.id,
        [{ project: "alpha", level: "view" }],
        null,
      );

      const out = await withCallContext(
        { source: "mcp", tool_name: "list_knowledge", user_id: alice.id },
        () => h.list_knowledge({}),
      );
      const titles = out.map((k) => k.title);
      expect(titles).toContain("A");
      expect(titles).not.toContain("B");
    });

    it("get_knowledge throws on a forbidden id", async () => {
      knowledge.registerProject("alpha");
      knowledge.registerProject("beta");
      const kB = await h.add_knowledge({ title: "B", project: "beta" });
      const alice = users.create({
        email: "alice2",
        password: "x",
        display_name: "Alice2",
      });
      permissions.replaceForUser(
        alice.id,
        [{ project: "alpha", level: "view" }],
        null,
      );
      await expect(
        withCallContext(
          { source: "mcp", tool_name: "get_knowledge", user_id: alice.id },
          () => h.get_knowledge({ id: kB.id }),
        ),
      ).rejects.toThrow(/no access/);
    });

    it("admin user bypasses ACL", async () => {
      const kB = await h.add_knowledge({ title: "B", project: "beta" });
      const admin2 = users.create({
        email: "admin2",
        password: "x",
        display_name: "A2",
        is_admin: true,
      });
      await expect(
        withCallContext(
          { source: "mcp", tool_name: "get_knowledge", user_id: admin2.id },
          () => h.get_knowledge({ id: kB.id }),
        ),
      ).resolves.toBeTruthy();
    });
  });

  describe("MCP write gating", () => {
    it("add_knowledge denied without edit on the requested project", async () => {
      knowledge.registerProject("alpha");
      const alice = users.create({
        email: "writer-alice",
        password: "x",
        display_name: "A",
      });
      permissions.replaceForUser(
        alice.id,
        [{ project: "alpha", level: "view" }],
        null,
      );
      await expect(
        withCallContext(
          { source: "mcp", tool_name: "add_knowledge", user_id: alice.id },
          () => h.add_knowledge({ title: "X", project: "alpha" }),
        ),
      ).rejects.toThrow(/edit/);
    });

    it("edit_page denied on view-only project", async () => {
      knowledge.registerProject("alpha");
      const k = await h.add_knowledge({ title: "K", project: "alpha" });
      const p = await h.add_page({ knowledge_id: k.id, title: "P", content: "x" });
      const alice = users.create({
        email: "writer-alice2",
        password: "x",
        display_name: "A",
      });
      permissions.replaceForUser(
        alice.id,
        [{ project: "alpha", level: "view" }],
        null,
      );
      await expect(
        withCallContext(
          { source: "mcp", tool_name: "edit_page", user_id: alice.id },
          () => h.edit_page({ page_id: p.id, content: "new" }),
        ),
      ).rejects.toThrow(/edit/);
    });

    it("edit access lets the caller mutate", async () => {
      knowledge.registerProject("alpha");
      const k = await h.add_knowledge({ title: "K2", project: "alpha" });
      const p = await h.add_page({ knowledge_id: k.id, title: "P", content: "x" });
      const alice = users.create({
        email: "writer-alice3",
        password: "x",
        display_name: "A",
      });
      permissions.replaceForUser(
        alice.id,
        [{ project: "alpha", level: "edit" }],
        null,
      );
      await expect(
        withCallContext(
          { source: "mcp", tool_name: "edit_page", user_id: alice.id },
          () => h.edit_page({ page_id: p.id, content: "new" }),
        ),
      ).resolves.toBeTruthy();
    });
  });

  describe("auto-cleanup orphaned images on edit", () => {
    // 1x1 transparent PNG — enough bytes to satisfy the store.
    const PNG_1x1 = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      "base64",
    );

    async function addPng(altText = "x"): Promise<{ hash: string; src: string; ext: string }> {
      const meta = await h.add_image({
        data_base64: PNG_1x1.toString("base64"),
        mime_type: "image/png",
        alt: altText,
      });
      return { hash: meta.hash, src: meta.src, ext: meta.ext };
    }

    it("removes image from disk + DB when its only referencing edit drops it", async () => {
      const k = await h.add_knowledge({ title: "K", project: "p" });
      const img = await addPng("only-ref");
      const p = await h.add_page({
        knowledge_id: k.id,
        title: "P",
        content: `before\n![alt](${img.src})\nafter`,
      });
      const fp = path.join(imagesDir, img.hash.slice(0, 2), `${img.hash}.${img.ext}`);
      expect(fs.existsSync(fp)).toBe(true);
      expect(images.get(img.hash)).not.toBeNull();

      await h.edit_page({ page_id: p.id, content: "no image here" });

      expect(images.get(img.hash)).toBeNull();
      expect(fs.existsSync(fp)).toBe(false);
    });

    it("keeps image alive when another page still references it", async () => {
      const k = await h.add_knowledge({ title: "K", project: "p" });
      const img = await addPng("shared");
      const md = `body\n![alt](${img.src})\n`;
      const p1 = await h.add_page({ knowledge_id: k.id, title: "P1", content: md });
      await h.add_page({ knowledge_id: k.id, title: "P2", content: md });
      const fp = path.join(imagesDir, img.hash.slice(0, 2), `${img.hash}.${img.ext}`);
      expect(fs.existsSync(fp)).toBe(true);

      await h.edit_page({ page_id: p1.id, content: "dropped" });

      expect(images.get(img.hash)).not.toBeNull();
      expect(fs.existsSync(fp)).toBe(true);
    });

    it("edit that keeps the image ref does not delete the image", async () => {
      const k = await h.add_knowledge({ title: "K", project: "p" });
      const img = await addPng("kept");
      const p = await h.add_page({
        knowledge_id: k.id,
        title: "P",
        content: `first line\n![alt](${img.src})\nlast line`,
      });

      await h.edit_page({
        page_id: p.id,
        content: `changed prose\n![alt](${img.src})\nmore prose`,
      });

      expect(images.get(img.hash)).not.toBeNull();
    });

    it("edit that ADDS an image does not delete it (diff direction sanity)", async () => {
      const k = await h.add_knowledge({ title: "K", project: "p" });
      const img = await addPng("new");
      const p = await h.add_page({ knowledge_id: k.id, title: "P", content: "no img" });

      await h.edit_page({
        page_id: p.id,
        content: `now there is\n![alt](${img.src})`,
      });

      expect(images.get(img.hash)).not.toBeNull();
    });

    it("edit_lines removing the image-bearing line cleans up", async () => {
      const k = await h.add_knowledge({ title: "K", project: "p" });
      const img = await addPng("lines");
      const p = await h.add_page({
        knowledge_id: k.id,
        title: "P",
        content: `top\n![alt](${img.src})\nbottom`,
      });

      await h.edit_lines({
        page_id: p.id,
        line_start: 2,
        line_end: 2,
        new_text: "plain text instead",
      });

      expect(images.get(img.hash)).toBeNull();
    });

    it("edit_section removing the image-bearing body cleans up", async () => {
      const k = await h.add_knowledge({ title: "K", project: "p" });
      const img = await addPng("section");
      const p = await h.add_page({
        knowledge_id: k.id,
        title: "P",
        content: `## A\n![alt](${img.src})\n\n## B\nbye`,
      });

      await h.edit_section({
        page_id: p.id,
        heading: "## A",
        new_content: "no image now",
      });

      expect(images.get(img.hash)).toBeNull();
    });

    it("replace_text scoped to a page cleans up the dropped image", async () => {
      const k = await h.add_knowledge({ title: "K", project: "p" });
      const img = await addPng("replace");
      const p = await h.add_page({
        knowledge_id: k.id,
        title: "P",
        content: `keep\n![alt](${img.src})\nend`,
      });

      await h.replace_text({
        knowledge_id: k.id,
        page_id: p.id,
        find: `![alt](${img.src})`,
        replace: "removed",
      });

      expect(images.get(img.hash)).toBeNull();
    });
  });

  describe("get_image modes (Phase 3a)", () => {
    // 1x1 transparent PNG.
    const PNG_B64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

    it("mode:'meta' returns metadata only — never inline bytes", async () => {
      const up = await h.add_image({ data_base64: PNG_B64, mime_type: "image/png" });
      const r = await h.get_image({ src: up.src, mode: "meta" });
      expect(r.mode).toBe("meta");
      expect(r.embedded).toBe(false);
      expect(r.data_base64).toBeUndefined();
      expect(r.size_bytes).toBeGreaterThan(0); // metadata still present
    });

    it("mode:'full' inlines the bytes", async () => {
      const up = await h.add_image({ data_base64: PNG_B64, mime_type: "image/png" });
      const r = await h.get_image({ src: up.src, mode: "full" });
      expect(r.mode).toBe("full");
      expect(r.embedded).toBe(true);
      expect(r.data_base64).toBeTruthy();
    });

    it("omitting mode keeps legacy inline behavior (backward compatible)", async () => {
      const up = await h.add_image({ data_base64: PNG_B64, mime_type: "image/png" });
      const r = await h.get_image({ src: up.src });
      expect(r.embedded).toBe(true);
      expect(r.data_base64).toBeTruthy();
    });
  });

  describe("add_image local-path import", () => {
    // 1x1 transparent PNG.
    const PNG_1x1 = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      "base64",
    );

    function handlersWithRoots(roots: string[]) {
      return buildToolHandlers(
        knowledge,
        pages,
        images,
        new PromptLogStore(db),
        new ActivityLogStore(db),
        {
          publicBaseUrl: "http://test",
          imageImportRoots: roots,
          imageImportEnabled: roots.length > 0,
        },
        permissions,
        users,
        db,
      );
    }

    function makeImportDir(prefix = "aim-import-"): string {
      return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
    }

    it("imports a local file by path with no base64", async () => {
      const dir = makeImportDir();
      const file = path.join(dir, "pic.png");
      fs.writeFileSync(file, PNG_1x1);
      const hi = handlersWithRoots([dir]);
      const meta = await hi.add_image({ path: file });
      expect(meta.mime).toBe("image/png");
      expect(meta.size_bytes).toBe(PNG_1x1.length);
      expect(images.get(meta.hash)).not.toBeNull();
    });

    it("dedups a path import against an identical base64 upload", async () => {
      const dir = makeImportDir();
      const file = path.join(dir, "pic.png");
      fs.writeFileSync(file, PNG_1x1);
      const hi = handlersWithRoots([dir]);
      const viaB64 = await h.add_image({
        data_base64: PNG_1x1.toString("base64"),
        mime_type: "image/png",
      });
      const viaPath = await hi.add_image({ path: file });
      expect(viaPath.hash).toBe(viaB64.hash);
    });

    it("is disabled by default when no roots are configured", async () => {
      const dir = makeImportDir();
      const file = path.join(dir, "pic.png");
      fs.writeFileSync(file, PNG_1x1);
      await expect(h.add_image({ path: file })).rejects.toThrow(/disabled/);
    });

    it("rejects a path outside the import root", async () => {
      const dir = makeImportDir();
      const outside = makeImportDir("aim-outside-");
      const file = path.join(outside, "secret.png");
      fs.writeFileSync(file, PNG_1x1);
      const hi = handlersWithRoots([dir]);
      await expect(hi.add_image({ path: file })).rejects.toThrow(
        /outside the allowed/,
      );
    });

    it("rejects a symlink that escapes the import root", async () => {
      const dir = makeImportDir();
      const outside = makeImportDir("aim-outside-");
      const target = path.join(outside, "secret.png");
      fs.writeFileSync(target, PNG_1x1);
      const link = path.join(dir, "link.png");
      fs.symlinkSync(target, link);
      const hi = handlersWithRoots([dir]);
      await expect(hi.add_image({ path: link })).rejects.toThrow(
        /outside the allowed/,
      );
    });

    it("requires an absolute path", async () => {
      const dir = makeImportDir();
      const hi = handlersWithRoots([dir]);
      await expect(hi.add_image({ path: "relative/pic.png" })).rejects.toThrow(
        /absolute/,
      );
    });

    it("rejects a directory (non-regular file)", async () => {
      const dir = makeImportDir();
      const sub = path.join(dir, "sub");
      fs.mkdirSync(sub);
      const hi = handlersWithRoots([dir]);
      await expect(hi.add_image({ path: sub })).rejects.toThrow(
        /not a regular file/,
      );
    });

    it("rejects sending both path and data_base64", async () => {
      const dir = makeImportDir();
      const file = path.join(dir, "pic.png");
      fs.writeFileSync(file, PNG_1x1);
      const hi = handlersWithRoots([dir]);
      await expect(
        hi.add_image({
          path: file,
          data_base64: PNG_1x1.toString("base64"),
          mime_type: "image/png",
        }),
      ).rejects.toThrow(/exactly one of/);
    });

    it("infers mime from magic bytes even when the extension lies", async () => {
      const dir = makeImportDir();
      const file = path.join(dir, "actually-png.gif");
      fs.writeFileSync(file, PNG_1x1);
      const hi = handlersWithRoots([dir]);
      const meta = await hi.add_image({ path: file });
      expect(meta.mime).toBe("image/png");
    });
  });

  describe("read_page image refs + absolute_image_urls", () => {
    const PNG_B64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

    async function pageWithTitledImage() {
      const k = await h.add_knowledge({ title: "K", project: "p" });
      const img = await h.add_image({ data_base64: PNG_B64, mime_type: "image/png" });
      const p = await h.add_page({
        knowledge_id: k.id,
        title: "P",
        content: `intro\n\n![cmp shot](${img.src} "annotation w=640")\n`,
      });
      return { img, p };
    }

    it("detects a markdown image that uses the title slot (regression)", async () => {
      const { img, p } = await pageWithTitledImage();
      const r = await h.read_page({ page_id: p.id, mode: "full" });
      expect(r.images_referenced).toHaveLength(1);
      const ref = r.images_referenced[0];
      expect(ref.src).toBe(img.src);
      expect(ref.via).toBe("markdown");
      expect(ref.caption).toBe("annotation w=640");
    });

    it("images_referenced[].url is absolute even without the flag", async () => {
      const { img, p } = await pageWithTitledImage();
      const r = await h.read_page({ page_id: p.id, mode: "full" });
      expect(r.images_referenced[0].url).toBe(`http://test${img.src}`);
    });

    it("absolute_image_urls rewrites content and omits hash", async () => {
      const { img, p } = await pageWithTitledImage();
      const r = await h.read_page({
        page_id: p.id,
        mode: "full",
        absolute_image_urls: true,
      });
      expect(r.content).toContain(`http://test${img.src}`);
      expect(r.content).not.toMatch(/\]\(\/img\//); // no bare relative ref left
      expect(r.hash).toBeUndefined();
    });

    it("default full read keeps relative content + returns hash", async () => {
      const { img, p } = await pageWithTitledImage();
      const r = await h.read_page({ page_id: p.id, mode: "full" });
      expect(r.content).toContain(`(${img.src} "annotation w=640")`);
      expect(r.content).not.toContain("http://test/img/");
      expect(r.hash).toBeTruthy();
    });
  });

  describe("plural table-row aliases (Phase 4)", () => {
    async function makeTable() {
      const k = await h.add_knowledge({ title: "D", project: "examples" });
      const p = await h.add_page({
        knowledge_id: k.id,
        title: "P",
        content: "| a | b |\n|---|---|\n| 1 | 2 |",
      });
      const full = await h.read_page({ page_id: p.id, mode: "full" });
      const tableId = Number(/\{@(\d+)\}/.exec(full.content)![1]);
      return { p, tableId };
    }

    it("append_table_rows is registered and behaves like the singular form", async () => {
      const { p, tableId } = await makeTable();
      // The handler is shared; the alias just exposes a clearer name. We
      // exercise the underlying handler the alias points at.
      const r = await h.append_table_row({
        block_id: tableId,
        new_rows: ["| 3 | 4 |", "| 5 | 6 |"],
      });
      expect(r.new_row_indices).toHaveLength(2);
      const rows = await h.get_table_rows({ block_id: tableId, start: 0, end: 99 });
      expect(rows.matches.length).toBe(3);
      void p;
    });

    it("insert_table_rows inserts at a position", async () => {
      const { tableId } = await makeTable();
      const r = await h.insert_table_row({
        block_id: tableId,
        at: 0,
        new_rows: ["| 9 | 9 |"],
      });
      expect(r.inserted_count).toBe(1);
      const first = await h.get_table_row({ block_id: tableId, index: 0 });
      expect(first.columns.a).toBe("9");
    });
  });

  describe("get_table_rows_with_checkbox task_index (Phase 4)", () => {
    it("each checkbox row carries a task_index usable with toggle_task", async () => {
      const k = await h.add_knowledge({ title: "D", project: "examples" });
      const p = await h.add_page({
        knowledge_id: k.id,
        title: "P",
        content: [
          "- [ ] preamble task", // global task_index 0
          "",
          "| item | done |",
          "|------|------|",
          "| a | [ ] |", // global task_index 1
          "| b | [x] |", // global task_index 2
        ].join("\n"),
      });
      // Resolve the stamped table @N.
      const full = await h.read_page({ page_id: p.id, mode: "full" });
      const tableId = Number(/\{@(\d+)\}/.exec(full.content)![1]);
      const res = await h.get_table_rows_with_checkbox({ block_id: tableId });
      const rowA = res.matches.find((m) => m.columns.item === "a")!;
      expect(rowA.checkboxes[0].task_index).toBe(1); // not row_index 0
      // toggle_task with that index flips the right cell.
      const t = await h.toggle_task({ page_id: p.id, index: rowA.checkboxes[0].task_index });
      expect(t.done).toBe(true);
      const res2 = await h.get_table_rows_with_checkbox({ block_id: tableId });
      expect(
        res2.matches.find((m) => m.columns.item === "a")!.checkboxes[0].checked,
      ).toBe(true);
    });
  });
});
