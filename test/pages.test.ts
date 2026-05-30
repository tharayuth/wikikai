import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../src/store/db.js";
import { KnowledgeStore } from "../src/store/knowledge.js";
import { PageStore, hashRange } from "../src/store/pages.js";

describe("PageStore", () => {
  let tmpDir: string;
  let knowledge: KnowledgeStore;
  let pages: PageStore;
  let kid: number;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aim-page-"));
    const db = openDb(":memory:");
    knowledge = new KnowledgeStore(db);
    pages = new PageStore(db, tmpDir);
    kid = knowledge.add({ title: "Doc", project: "examples" }).id;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ───────── CRUD ─────────

  describe("add", () => {
    it("appends pages and writes files", () => {
      const a = pages.add({ knowledge_id: kid, title: "P1", content: "hello" });
      const b = pages.add({ knowledge_id: kid, title: "P2", content: "world" });
      expect(a.position).toBe(1);
      expect(b.position).toBe(2);
      const fp = path.join(tmpDir, String(kid), `${a.id}.md`);
      expect(fs.readFileSync(fp, "utf8")).toBe("hello");
    });

    it("inserts at explicit position and shifts others", () => {
      const a = pages.add({ knowledge_id: kid, title: "A", content: "a" });
      const b = pages.add({ knowledge_id: kid, title: "B", content: "b" });
      const c = pages.add({ knowledge_id: kid, title: "C", content: "c", position: 2 });
      const list = pages.list(kid);
      expect(list.map((p) => [p.position, p.title])).toEqual([
        [1, "A"],
        [2, "C"],
        [3, "B"],
      ]);
      expect(c.position).toBe(2);
      expect(a.id).not.toBe(b.id);
    });

    it("rejects when knowledge id missing", () => {
      expect(() => pages.add({ knowledge_id: 9999, title: "X", content: "x" })).toThrow();
    });

    it("stores summary and keywords", () => {
      const r = pages.add({
        knowledge_id: kid,
        title: "T",
        content: "c",
        summary: "tip",
        keywords: ["a", "b"],
      });
      const got = pages.get(r.id)!;
      expect(got.summary).toBe("tip");
      expect(got.keywords).toEqual(["a", "b"]);
    });
  });

  describe("list", () => {
    it("returns pages in position order with line_count", () => {
      pages.add({ knowledge_id: kid, title: "A", content: "l1\nl2\nl3" });
      pages.add({ knowledge_id: kid, title: "B", content: "x" });
      const list = pages.list(kid);
      expect(list.map((p) => p.title)).toEqual(["A", "B"]);
      expect(list[0].line_count).toBe(3);
      expect(list[1].line_count).toBe(1);
    });
  });

  describe("update", () => {
    it("replaces content + bumps version", () => {
      const { id } = pages.add({ knowledge_id: kid, title: "T", content: "v1" });
      const r = pages.update(id, { content: "v2" });
      expect(r.version).toBe(2);
      expect(pages.get(id)!.content).toBe("v2");
    });

    it("updates metadata only without changing content", () => {
      const { id } = pages.add({ knowledge_id: kid, title: "T", content: "stay" });
      pages.update(id, { title: "New", summary: "s", keywords: ["k1"] });
      const got = pages.get(id)!;
      expect(got.title).toBe("New");
      expect(got.summary).toBe("s");
      expect(got.keywords).toEqual(["k1"]);
      expect(got.content).toBe("stay");
    });
  });

  describe("append", () => {
    it("appends with newline separator if missing", () => {
      const { id } = pages.add({ knowledge_id: kid, title: "T", content: "line1" });
      pages.append(id, "line2");
      expect(pages.get(id)!.content).toBe("line1\nline2");
    });
    it("does not add extra newline if content already ends with one", () => {
      const { id } = pages.add({ knowledge_id: kid, title: "T", content: "a\n" });
      pages.append(id, "b\n");
      expect(pages.get(id)!.content).toBe("a\nb\n");
    });
  });

  describe("remove", () => {
    it("deletes row, file, and compacts positions", () => {
      const a = pages.add({ knowledge_id: kid, title: "A", content: "a" });
      const b = pages.add({ knowledge_id: kid, title: "B", content: "b" });
      const c = pages.add({ knowledge_id: kid, title: "C", content: "c" });
      pages.remove(b.id);
      const list = pages.list(kid);
      expect(list.map((p) => [p.position, p.title])).toEqual([
        [1, "A"],
        [2, "C"],
      ]);
      expect(fs.existsSync(path.join(tmpDir, String(kid), `${b.id}.md`))).toBe(false);
      expect(a.id).not.toBe(c.id);
    });
    it("is idempotent for missing id", () => {
      expect(() => pages.remove(9999)).not.toThrow();
    });
  });

  describe("reorder", () => {
    it("reorders by id permutation", () => {
      const a = pages.add({ knowledge_id: kid, title: "A", content: "" });
      const b = pages.add({ knowledge_id: kid, title: "B", content: "" });
      const c = pages.add({ knowledge_id: kid, title: "C", content: "" });
      pages.reorder(kid, [c.id, a.id, b.id]);
      const list = pages.list(kid);
      expect(list.map((p) => p.title)).toEqual(["C", "A", "B"]);
    });
    it("rejects bad permutation", () => {
      const a = pages.add({ knowledge_id: kid, title: "A", content: "" });
      expect(() => pages.reorder(kid, [a.id, 9999])).toThrow();
    });
  });

  describe("movePage (relative)", () => {
    it("moves a page immediately before the target", () => {
      const a = pages.add({ knowledge_id: kid, title: "A", content: "" });
      const b = pages.add({ knowledge_id: kid, title: "B", content: "" });
      const c = pages.add({ knowledge_id: kid, title: "C", content: "" });
      const d = pages.add({ knowledge_id: kid, title: "D", content: "" });
      // Move D so it sits right before B → A, D, B, C
      const r = pages.movePage(d.id, { before: b.id });
      expect(r.knowledge_id).toBe(kid);
      expect(r.order).toEqual([a.id, d.id, b.id, c.id]);
      expect(pages.list(kid).map((p) => p.title)).toEqual(["A", "D", "B", "C"]);
    });

    it("moves a page immediately after the target", () => {
      const a = pages.add({ knowledge_id: kid, title: "A", content: "" });
      const b = pages.add({ knowledge_id: kid, title: "B", content: "" });
      const c = pages.add({ knowledge_id: kid, title: "C", content: "" });
      // Move A so it sits right after B → B, A, C
      const r = pages.movePage(a.id, { after: b.id });
      expect(r.order).toEqual([b.id, a.id, c.id]);
      expect(pages.list(kid).map((p) => p.title)).toEqual(["B", "A", "C"]);
    });

    it("rejects when both before and after are provided", () => {
      const a = pages.add({ knowledge_id: kid, title: "A", content: "" });
      const b = pages.add({ knowledge_id: kid, title: "B", content: "" });
      expect(() => pages.movePage(a.id, { before: b.id, after: b.id })).toThrow(
        /Provide either `before` or `after`/,
      );
    });

    it("rejects when neither before nor after is provided", () => {
      const a = pages.add({ knowledge_id: kid, title: "A", content: "" });
      expect(() => pages.movePage(a.id, {})).toThrow(
        /Provide either `before` or `after`/,
      );
    });

    it("rejects when target is in a different knowledge", () => {
      const otherKid = knowledge.add({ title: "Other", project: "examples" }).id;
      const a = pages.add({ knowledge_id: kid, title: "A", content: "" });
      const other = pages.add({
        knowledge_id: otherKid,
        title: "Other",
        content: "",
      });
      expect(() => pages.movePage(a.id, { before: other.id })).toThrow(
        /different knowledge/,
      );
    });

    it("rejects when page_id == target", () => {
      const a = pages.add({ knowledge_id: kid, title: "A", content: "" });
      expect(() => pages.movePage(a.id, { before: a.id })).toThrow(
        /must be different/,
      );
    });

    it("rejects unknown page or target", () => {
      const a = pages.add({ knowledge_id: kid, title: "A", content: "" });
      expect(() => pages.movePage(99999, { before: a.id })).toThrow(/not found/);
      expect(() => pages.movePage(a.id, { before: 99999 })).toThrow(/not found/);
    });
  });

  describe("movePageTo (absolute)", () => {
    it("position=1 makes the page first", () => {
      const a = pages.add({ knowledge_id: kid, title: "A", content: "" });
      const b = pages.add({ knowledge_id: kid, title: "B", content: "" });
      const c = pages.add({ knowledge_id: kid, title: "C", content: "" });
      const r = pages.movePageTo(c.id, 1);
      expect(r.order).toEqual([c.id, a.id, b.id]);
      expect(pages.list(kid).map((p) => p.title)).toEqual(["C", "A", "B"]);
    });

    it("position=N (page_count) makes the page last", () => {
      const a = pages.add({ knowledge_id: kid, title: "A", content: "" });
      const b = pages.add({ knowledge_id: kid, title: "B", content: "" });
      const c = pages.add({ knowledge_id: kid, title: "C", content: "" });
      const r = pages.movePageTo(a.id, 3);
      expect(r.order).toEqual([b.id, c.id, a.id]);
      expect(pages.list(kid).map((p) => p.title)).toEqual(["B", "C", "A"]);
    });

    it("position in the middle shifts other pages around", () => {
      const a = pages.add({ knowledge_id: kid, title: "A", content: "" });
      const b = pages.add({ knowledge_id: kid, title: "B", content: "" });
      const c = pages.add({ knowledge_id: kid, title: "C", content: "" });
      const d = pages.add({ knowledge_id: kid, title: "D", content: "" });
      // Move D to position 2 → A, D, B, C
      const r = pages.movePageTo(d.id, 2);
      expect(r.order).toEqual([a.id, d.id, b.id, c.id]);
    });

    it("rejects position out of range", () => {
      const a = pages.add({ knowledge_id: kid, title: "A", content: "" });
      pages.add({ knowledge_id: kid, title: "B", content: "" });
      expect(() => pages.movePageTo(a.id, 0)).toThrow(/out of range/);
      expect(() => pages.movePageTo(a.id, 99)).toThrow(/out of range/);
    });

    it("rejects unknown page", () => {
      expect(() => pages.movePageTo(99999, 1)).toThrow(/not found/);
    });
  });

  // ───────── Line ops ─────────

  describe("readLines", () => {
    it("returns slice + total + hash", () => {
      const { id } = pages.add({ knowledge_id: kid, title: "T", content: "a\nb\nc\nd\ne" });
      const r = pages.readLines(id, 2, 4);
      expect(r.content).toBe("b\nc\nd");
      expect(r.total_lines).toBe(5);
      expect(r.line_start).toBe(2);
      expect(r.line_end).toBe(4);
      expect(r.hash).toBe(hashRange("b\nc\nd"));
    });
    it("clamps end to total", () => {
      const { id } = pages.add({ knowledge_id: kid, title: "T", content: "a\nb" });
      const r = pages.readLines(id, 1, 999);
      expect(r.content).toBe("a\nb");
      expect(r.line_end).toBe(2);
    });
  });

  describe("editLines", () => {
    it("replaces line range", () => {
      const { id } = pages.add({ knowledge_id: kid, title: "T", content: "a\nb\nc\nd" });
      pages.editLines(id, 2, 3, "B\nC\nC2");
      expect(pages.get(id)!.content).toBe("a\nB\nC\nC2\nd");
    });
    it("honours expectedHash when provided", () => {
      const { id } = pages.add({ knowledge_id: kid, title: "T", content: "a\nb\nc" });
      const r = pages.readLines(id, 2, 2);
      expect(() => pages.editLines(id, 2, 2, "B", r.hash)).not.toThrow();
      expect(() => pages.editLines(id, 1, 1, "A", "badhash")).toThrow(/hash mismatch/);
    });
  });

  describe("editSection", () => {
    it("replaces content under matching heading until next equal-or-higher heading", () => {
      const content = [
        "# Title",
        "",
        "## A",
        "old a",
        "",
        "## B",
        "old b1",
        "old b2",
        "",
        "## C",
        "old c",
      ].join("\n");
      const { id } = pages.add({ knowledge_id: kid, title: "T", content });
      const r = pages.editSection(id, "## B", "new b1\nnew b2\nnew b3");
      expect(r.replaced_lines).toBeGreaterThan(0);
      const got = pages.get(id)!.content;
      expect(got).toContain("## B\nnew b1\nnew b2\nnew b3");
      expect(got).toContain("## C\nold c");
      expect(got).toContain("## A\nold a");
      expect(got).not.toContain("old b1");
    });
    it("throws when section heading not found", () => {
      const { id } = pages.add({ knowledge_id: kid, title: "T", content: "# x" });
      expect(() => pages.editSection(id, "## Missing", "x")).toThrow();
    });

    it("strips the heading when callers accidentally include it in new_content", () => {
      const content = ["# Title", "", "## B", "old"].join("\n");
      const { id } = pages.add({ knowledge_id: kid, title: "T", content });
      // Caller passes the heading + blank + body — common LLM pattern when
      // they paste back a section verbatim.
      pages.editSection(id, "## B", "## B\n\nfresh body");
      const got = pages.get(id)!.content;
      // Heading appears EXACTLY once
      expect((got.match(/^## B$/gm) ?? []).length).toBe(1);
      expect(got).toContain("## B\nfresh body");
    });

    it("strips the heading even with leading blank lines in new_content", () => {
      const content = ["## X", "old"].join("\n");
      const { id } = pages.add({ knowledge_id: kid, title: "T", content });
      pages.editSection(id, "## X", "\n\n## X\nbody");
      const got = pages.get(id)!.content;
      expect((got.match(/^## X$/gm) ?? []).length).toBe(1);
      expect(got).toContain("## X\nbody");
    });

    it("preserves the block @N when converting a table to an html-embed via edit_section", () => {
      const content = [
        "## chart",
        "",
        "| a | b |",
        "|---|---|",
        "| 1 | 2 |",
        "",
        "after",
      ].join("\n");
      const { id } = pages.add({ knowledge_id: kid, title: "T", content });
      const raw0 = fs.readFileSync(
        path.join(tmpDir, String(kid), `${id}.md`),
        "utf8",
      );
      const oldId = Number(/\{@(\d+)\}/.exec(raw0)![1]);
      // AI converts the table to an html-embed WITHOUT carrying the {@N}
      pages.editSection(
        id,
        "## chart",
        "```html-embed\n<table><tr><td>a</td><td>b</td></tr></table>\n```",
      );
      const raw1 = fs.readFileSync(
        path.join(tmpDir, String(kid), `${id}.md`),
        "utf8",
      );
      // Same id stamped into the new fence's info string — not a new one
      expect(raw1).toMatch(new RegExp(`\`\`\`html-embed.*\\{@${oldId}\\}`));
      // No additional ids introduced
      expect((raw1.match(/\{@\d+\}/g) ?? []).length).toBe(1);
    });

    it("preserves the block @N when converting an html-embed to a table via edit_lines", () => {
      const initial = [
        "before",
        "",
        "```html-embed",
        "<div>hi</div>",
        "```",
        "",
        "after",
      ].join("\n");
      const { id } = pages.add({ knowledge_id: kid, title: "T", content: initial });
      const raw0 = fs.readFileSync(
        path.join(tmpDir, String(kid), `${id}.md`),
        "utf8",
      );
      const oldId = Number(/\{@(\d+)\}/.exec(raw0)![1]);
      // Find the fence's actual line range (injectBlockIds may insert nothing
      // beyond editing the fence-open line in place, so 3..5 stays right).
      const lines0 = raw0.split("\n");
      const fenceOpen = lines0.findIndex((l) => /^```html-embed/.test(l));
      const fenceClose = lines0.findIndex(
        (l, i) => i > fenceOpen && /^```\s*$/.test(l),
      );
      pages.editLines(
        id,
        fenceOpen + 1,
        fenceClose + 1,
        "| a | b |\n|---|---|\n| 1 | 2 |",
      );
      const raw1 = fs.readFileSync(
        path.join(tmpDir, String(kid), `${id}.md`),
        "utf8",
      );
      // The table now carries the same id as a trailing line
      expect(raw1).toMatch(new RegExp(`\\| 1 \\| 2 \\|\\n\\n\\{@${oldId}\\}`));
      expect((raw1.match(/\{@\d+\}/g) ?? []).length).toBe(1);
    });

    it("leaves the new content alone when the caller already supplied {@N}", () => {
      const content = "## s\n\n```stats\n[{\"num\":\"1\",\"label\":\"x\"}]\n```";
      const { id } = pages.add({ knowledge_id: kid, title: "T", content });
      const raw0 = fs.readFileSync(
        path.join(tmpDir, String(kid), `${id}.md`),
        "utf8",
      );
      const oldId = Number(/\{@(\d+)\}/.exec(raw0)![1]);
      // AI explicitly carries the id forward into the new content
      pages.editSection(
        id,
        "## s",
        `\`\`\`mermaid {@${oldId}}\nflowchart TD\n  A --> B\n\`\`\``,
      );
      const raw1 = fs.readFileSync(
        path.join(tmpDir, String(kid), `${id}.md`),
        "utf8",
      );
      expect(raw1).toContain(`\`\`\`mermaid {@${oldId}}`);
      expect((raw1.match(/\{@\d+\}/g) ?? []).length).toBe(1);
    });

    it("does NOT strip a deeper heading at the top of new_content", () => {
      const content = ["## Outer", "old"].join("\n");
      const { id } = pages.add({ knowledge_id: kid, title: "T", content });
      // A deeper subheading is legitimate body content — must NOT be stripped
      pages.editSection(id, "## Outer", "### Sub\nbody");
      const got = pages.get(id)!.content;
      expect(got).toContain("## Outer\n### Sub\nbody");
    });
  });

  describe("replaceText", () => {
    it("replaces across all pages of knowledge by default", () => {
      const a = pages.add({ knowledge_id: kid, title: "A", content: "foo bar foo" });
      const b = pages.add({ knowledge_id: kid, title: "B", content: "no match" });
      const r = pages.replaceText(kid, undefined, "foo", "FOO");
      expect(r.replacements).toEqual([
        { page_id: a.id, page_title: "A", count: 2 },
      ]);
      expect(pages.get(a.id)!.content).toBe("FOO bar FOO");
      expect(pages.get(b.id)!.content).toBe("no match");
    });
    it("restricts to single page when pid given", () => {
      const a = pages.add({ knowledge_id: kid, title: "A", content: "foo foo" });
      pages.add({ knowledge_id: kid, title: "B", content: "foo" });
      const r = pages.replaceText(kid, a.id, "foo", "X");
      expect(r.replacements).toHaveLength(1);
      expect(r.replacements[0].page_id).toBe(a.id);
    });
    it("honours count limit", () => {
      const a = pages.add({ knowledge_id: kid, title: "A", content: "x x x x x" });
      const r = pages.replaceText(kid, a.id, "x", "y", 2);
      expect(pages.get(a.id)!.content).toBe("y y x x x");
      expect(r.replacements[0].count).toBe(2);
    });
  });

  // ───────── Outline ─────────

  describe("outline", () => {
    it("returns page titles + heading hierarchy without content", () => {
      pages.add({
        knowledge_id: kid,
        title: "Intro",
        content: "# Top\n\n## Section A\nbla\n\n## Section B\n### Sub\nx",
      });
      pages.add({ knowledge_id: kid, title: "Outro", content: "# Last\n\n## Wrap" });
      const out = pages.outline(kid);
      expect(out.pages).toHaveLength(2);
      expect(out.pages[0].title).toBe("Intro");
      expect(out.pages[0].headings.map((h) => [h.level, h.text])).toEqual([
        [1, "Top"],
        [2, "Section A"],
        [2, "Section B"],
        [3, "Sub"],
      ]);
      expect(out.pages[0].headings[1].line).toBe(3);
      expect(out.pages[1].headings.map((h) => h.text)).toEqual(["Last", "Wrap"]);
    });

    it("omits `blocks` field when include_blocks: false", () => {
      pages.add({
        knowledge_id: kid,
        title: "Intro",
        content:
          "# Top\n\n```stats {@1 \"KPI cards\"}\n[]\n```\n",
      });
      const out = pages.outline(kid, { include_blocks: false });
      expect(out.pages).toHaveLength(1);
      expect("blocks" in out.pages[0]).toBe(false);
    });

    it("includes blocks by default (no arg) and for include_blocks: true", () => {
      pages.add({
        knowledge_id: kid,
        title: "Intro",
        content:
          "# Top\n\n```stats {@1 \"KPI cards\"}\n[]\n```\n",
      });
      const a = pages.outline(kid);
      const b = pages.outline(kid, { include_blocks: true });
      expect(a.pages[0].blocks).toBeDefined();
      expect(b.pages[0].blocks).toBeDefined();
      expect(a.pages[0].blocks).toEqual(b.pages[0].blocks);
    });

    it("enumerates fence + table blocks with kind, caption, line range, and row_count for tables", () => {
      const content = [
        "# Page",
        "",
        "```stats {@10 \"KPI\"}",
        "[{\"label\":\"a\",\"value\":1}]",
        "```",
        "",
        "Some prose.",
        "",
        "| name | qty |",
        "| --- | --- |",
        "| apple | 3 |",
        "| banana | 5 |",
        "| cherry | 7 |",
        "",
        "{@20 \"Inventory\"}",
        "",
        "```mermaid {@30}",
        "flowchart LR; A-->B",
        "```",
      ].join("\n");
      pages.add({ knowledge_id: kid, title: "P", content });
      const out = pages.outline(kid);
      const blocks = out.pages[0].blocks!;
      expect(blocks.map((b) => b.id)).toEqual([10, 20, 30]);
      // sorted by line_start ascending
      for (let i = 1; i < blocks.length; i++) {
        expect(blocks[i].line_start).toBeGreaterThan(blocks[i - 1].line_start);
      }
      const stats = blocks.find((b) => b.id === 10)!;
      expect(stats.kind).toBe("stats");
      expect(stats.caption).toBe("KPI");
      expect("row_count" in stats).toBe(false);
      const table = blocks.find((b) => b.id === 20)!;
      expect(table.kind).toBe("table");
      expect(table.caption).toBe("Inventory");
      expect(table.row_count).toBe(3);
      expect(table.line_start).toBe(9); // header row
      expect(table.line_end).toBe(13); // last data row (1-based)
      const mermaid = blocks.find((b) => b.id === 30)!;
      expect(mermaid.kind).toBe("mermaid");
      expect(mermaid.caption).toBeNull();
    });

    it("returns an empty blocks array for a page with no annotated blocks", () => {
      pages.add({
        knowledge_id: kid,
        title: "Plain",
        content: "# Top\n\nJust prose, no blocks.\n",
      });
      const out = pages.outline(kid);
      expect(out.pages[0].blocks).toEqual([]);
    });
  });

  // ───────── Search (FTS5) ─────────

  describe("search", () => {
    beforeEach(() => {
      pages.add({
        knowledge_id: kid,
        title: "Architecture",
        content: "We use Postgres and Redis.\nThe ingestion pipeline writes WAL.",
        keywords: ["arch"],
      });
      pages.add({
        knowledge_id: kid,
        title: "Metrics",
        content: "Latency p95 is 42ms.\nRedis cache miss rate.",
        keywords: ["perf"],
      });
    });

    it("finds matches with line number and snippet", () => {
      const hits = pages.search("Redis");
      expect(hits.length).toBeGreaterThan(0);
      const titles = hits.map((h) => h.page_title);
      expect(titles).toContain("Architecture");
      expect(titles).toContain("Metrics");
      for (const h of hits) {
        expect(h.line).toBeGreaterThan(0);
        expect(h.snippet.toLowerCase()).toContain("redis");
      }
    });

    it("filters by knowledge_id", () => {
      const otherK = knowledge.add({ title: "Other", project: "examples" }).id;
      pages.add({ knowledge_id: otherK, title: "Z", content: "Redis here too" });
      const hits = pages.search("Redis", { knowledge_id: kid });
      for (const h of hits) expect(h.knowledge_id).toBe(kid);
    });

    it("ranks keywords matches", () => {
      const hits = pages.search("arch");
      expect(hits[0].page_title).toBe("Architecture");
    });

    it("returns empty for blank query", () => {
      expect(pages.search("   ")).toEqual([]);
    });
  });

  // ───────── Cascade delete ─────────

  describe("toggleTaskAtIndex", () => {
    it("flips GFM `- [ ]` and `- [x]` markers", () => {
      const p = pages.add({
        knowledge_id: kid,
        title: "tasks",
        content: "- [ ] one\n- [x] two\n- [ ] three",
      });
      pages.toggleTaskAtIndex(p.id, 0);
      pages.toggleTaskAtIndex(p.id, 1);
      const after = pages.getMetadata(p.id) && fs.readFileSync(
        path.join(tmpDir, String(kid), `${p.id}.md`),
        "utf8",
      );
      expect(after).toBe("- [x] one\n- [ ] two\n- [ ] three");
    });

    it("flips <input type=checkbox> inside html-embed, round-trips both ways", () => {
      const initial =
        "- [ ] before\n\n```html-embed\n<input type=\"checkbox\" checked disabled>\n<input type=\"checkbox\" disabled>\n```\n\n- [x] after";
      const p = pages.add({ knowledge_id: kid, title: "mix", content: initial });
      // Index 0 = GFM "before", 1 = html "checked", 2 = html unchecked, 3 = GFM "after"
      pages.toggleTaskAtIndex(p.id, 1); // uncheck the checked html
      const fp = path.join(tmpDir, String(kid), `${p.id}.md`);
      let raw = fs.readFileSync(fp, "utf8");
      expect(raw).toContain('<input type="checkbox" disabled>');
      expect(raw).not.toContain('<input type="checkbox" checked disabled>');
      // Toggle back — re-check it; output must still be a valid <input> tag
      pages.toggleTaskAtIndex(p.id, 1);
      raw = fs.readFileSync(fp, "utf8");
      const lines = raw.split("\n");
      // Two html lines remain valid <input ...> tags
      const inputs = lines.filter((l) => l.startsWith("<input"));
      expect(inputs).toHaveLength(2);
      for (const l of inputs) {
        expect(l).toMatch(/^<input type="checkbox"/);
      }
      // The first html row is checked again
      expect(inputs[0]).toMatch(/\bchecked\b/);
    });

    it("flips `[ ]`/`[x]` inside markdown table cells", () => {
      const initial = [
        "| Step | Done | Owner |",
        "|------|------|-------|",
        "| Cut release | [x] | DevOps |",
        "| Smoke test | [ ] | QA |",
        "| Roll forward | [ ] | Release |",
      ].join("\n");
      const p = pages.add({ knowledge_id: kid, title: "rel", content: initial });
      // Indices: 0 = first [x], 1 = first [ ], 2 = second [ ]
      pages.toggleTaskAtIndex(p.id, 1); // tick QA
      pages.toggleTaskAtIndex(p.id, 0); // uncheck DevOps
      const after = fs.readFileSync(
        path.join(tmpDir, String(kid), `${p.id}.md`),
        "utf8",
      );
      const rows = after.split("\n");
      expect(rows[2]).toBe("| Cut release | [ ] | DevOps |");
      expect(rows[3]).toBe("| Smoke test | [x] | QA |");
      expect(rows[4]).toBe("| Roll forward | [ ] | Release |");
    });

    it("preserves index continuity across GFM list + table cells", () => {
      const initial = [
        "- [ ] before list",
        "",
        "| Task | Done |",
        "|------|------|",
        "| Build | [ ] |",
        "| Ship | [ ] |",
        "",
        "- [ ] after list",
      ].join("\n");
      const p = pages.add({ knowledge_id: kid, title: "mix", content: initial });
      // Order: 0=before, 1=Build cell, 2=Ship cell, 3=after
      pages.toggleTaskAtIndex(p.id, 2); // Ship
      const after = fs.readFileSync(
        path.join(tmpDir, String(kid), `${p.id}.md`),
        "utf8",
      );
      const lines = after.split("\n");
      expect(lines[0]).toBe("- [ ] before list");
      expect(lines[4]).toBe("| Build | [ ] |");
      expect(lines[5]).toBe("| Ship | [x] |");
      // Server injects a blank + `{@N}` line under the table on save —
      // the "after list" line shifts to index 9.
      expect(lines[6]).toBe("");
      expect(lines[7]).toMatch(/^\{@\d+\}$/);
      expect(lines[9]).toBe("- [ ] after list");
    });

    it("matches `[ ]`/`[x]` anywhere in a cell (not just at the start)", () => {
      const initial = [
        "| Note | Status |",
        "|------|--------|",
        "| Step 1 [ ] more | [x] |",
      ].join("\n");
      const p = pages.add({ knowledge_id: kid, title: "n", content: initial });
      // Two checkboxes: 0 = mid-cell `[ ]`, 1 = right-cell `[x]`
      pages.toggleTaskAtIndex(p.id, 0);
      pages.toggleTaskAtIndex(p.id, 1);
      const after = fs.readFileSync(
        path.join(tmpDir, String(kid), `${p.id}.md`),
        "utf8",
      );
      const lines = after.split("\n");
      expect(lines[2]).toBe("| Step 1 [x] more | [ ] |");
    });

    it("counts multiple `[ ]` markers in the same cell", () => {
      const initial = [
        "| Items |",
        "|-------|",
        "| [ ] one [ ] two [x] three |",
      ].join("\n");
      const p = pages.add({ knowledge_id: kid, title: "m", content: initial });
      // Flip middle [ ] (index 1) and last [x] (index 2)
      pages.toggleTaskAtIndex(p.id, 1);
      pages.toggleTaskAtIndex(p.id, 2);
      const after = fs.readFileSync(
        path.join(tmpDir, String(kid), `${p.id}.md`),
        "utf8",
      );
      const lines = after.split("\n");
      expect(lines[2]).toBe("| [ ] one [x] two [ ] three |");
    });

    it("rejects toggle when expected_version doesn't match (race guard)", () => {
      const p = pages.add({
        knowledge_id: kid,
        title: "race",
        content: "- [ ] one\n- [ ] two\n",
      });
      // Page is v1 after add. Toggle once → v2.
      const r1 = pages.toggleTaskAtIndex(p.id, 0, { expectedVersion: 1 });
      expect(r1.version).toBe(2);
      // Now toggle again with stale expectation v1 → must throw
      expect(() =>
        pages.toggleTaskAtIndex(p.id, 1, { expectedVersion: 1 }),
      ).toThrow(/version mismatch/);
      // Without expected_version it still works (backwards-compatible)
      const r2 = pages.toggleTaskAtIndex(p.id, 1);
      expect(r2.version).toBe(3);
    });

    it("does NOT match `[xyz]` or markdown links — only `[ ]`/`[x]`/`[X]`", () => {
      const initial = [
        "| Cell |",
        "|------|",
        "| see [link](http://x) and [abc] and [x] |",
      ].join("\n");
      const p = pages.add({ knowledge_id: kid, title: "v", content: initial });
      pages.toggleTaskAtIndex(p.id, 0);
      const after = fs.readFileSync(
        path.join(tmpDir, String(kid), `${p.id}.md`),
        "utf8",
      );
      const lines = after.split("\n");
      // Only the [x] gets toggled — link and [abc] left alone
      expect(lines[2]).toBe(
        "| see [link](http://x) and [abc] and [ ] |",
      );
      expect(() => pages.toggleTaskAtIndex(p.id, 1)).toThrow();
    });
  });

  describe("table @N annotation", () => {
    it("appends a {@N} line under a table on save (injectBlockIds)", () => {
      const p = pages.add({
        knowledge_id: kid,
        title: "t",
        content:
          "intro\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nafter table",
      });
      const raw = fs.readFileSync(
        path.join(tmpDir, String(kid), `${p.id}.md`),
        "utf8",
      );
      // Canonical form: <last row> + blank line + {@N}
      expect(raw).toMatch(/\| 1 \| 2 \|\n\n\{@\d+\}\n\nafter table/);
    });

    it("leaves an existing {@N} alone", () => {
      const p = pages.add({
        knowledge_id: kid,
        title: "t",
        content: "| a |\n|---|\n| 1 |\n{@99999}\n",
      });
      const raw = fs.readFileSync(
        path.join(tmpDir, String(kid), `${p.id}.md`),
        "utf8",
      );
      // The existing id is preserved; no extra annotation appended.
      expect(raw).toContain("{@99999}");
      // Count {@...} lines — exactly one
      expect((raw.match(/^\{@\d+\}/gm) ?? []).length).toBe(1);
    });

    it("getBlock returns kind:'table' with header+sep+rows source", () => {
      const p = pages.add({
        knowledge_id: kid,
        title: "t",
        content: "| col1 | col2 |\n|------|------|\n| a    | b    |\n| c    | d    |\n",
      });
      const raw = fs.readFileSync(
        path.join(tmpDir, String(kid), `${p.id}.md`),
        "utf8",
      );
      const id = Number(/\{@(\d+)\}/.exec(raw)![1]);
      const b = pages.getBlock(id);
      expect(b).toBeTruthy();
      expect(b!.kind).toBe("table");
      expect(b!.source).toContain("| col1 | col2 |");
      expect(b!.source).toContain("|------|------|");
      expect(b!.inner).not.toContain("col1");
      expect(b!.inner).toContain("| a    | b    |");
      // line_end is the last row, not the annotation line
      const sourceLines = b!.source.split("\n");
      expect(b!.line_end - b!.line_start + 1).toBe(sourceLines.length);
    });

    it("getTableRow returns the requested row as {col: value}", () => {
      const p = pages.add({
        knowledge_id: kid,
        title: "t",
        content: "| name | age |\n|------|-----|\n| Alice | 30 |\n| Bob   | 25 |\n| Cara  | 40 |\n",
      });
      const raw = fs.readFileSync(
        path.join(tmpDir, String(kid), `${p.id}.md`),
        "utf8",
      );
      const id = Number(/\{@(\d+)\}/.exec(raw)![1]);
      expect(pages.getTableRow(id, 0).columns).toEqual({ name: "Alice", age: "30" });
      expect(pages.getTableRow(id, 1).columns).toEqual({ name: "Bob", age: "25" });
      expect(pages.getTableRow(id, -1).columns).toEqual({ name: "Cara", age: "40" });
      expect(pages.getTableRow(id, -1).row_index).toBe(2);
      expect(() => pages.getTableRow(id, 99)).toThrow(/out of range/);
    });

    it("getTableRow throws when the block isn't a table", () => {
      const p = pages.add({
        knowledge_id: kid,
        title: "t",
        content: "```stats\n[{\"num\":\"1\",\"label\":\"x\"}]\n```\n",
      });
      const raw = fs.readFileSync(
        path.join(tmpDir, String(kid), `${p.id}.md`),
        "utf8",
      );
      const id = Number(/\{@(\d+)\}/.exec(raw)![1]);
      expect(() => pages.getTableRow(id, 0)).toThrow(/not a table/);
    });

    it("stamps {@N} into the info string of text/typescript/bash code fences", () => {
      const p = pages.add({
        knowledge_id: kid,
        title: "t",
        content:
          "```text\nplain\n```\n\n" +
          "```typescript\nconst x = 1;\n```\n\n" +
          "```bash\necho hi\n```\n\n" +
          "```python\nprint('hi')\n```\n",
      });
      const raw = fs.readFileSync(
        path.join(tmpDir, String(kid), `${p.id}.md`),
        "utf8",
      );
      expect(raw).toMatch(/```text \{@\d+\}/);
      expect(raw).toMatch(/```typescript \{@\d+\}/);
      expect(raw).toMatch(/```bash \{@\d+\}/);
      // python must NOT receive an id (still in allow-list audit)
      expect(raw).not.toMatch(/```python \{@\d+\}/);
    });

    it("getBlock resolves a code-fence block and reports kind = language", () => {
      const p = pages.add({
        knowledge_id: kid,
        title: "t",
        content: "```typescript\nconst foo = 42;\nconsole.log(foo);\n```\n",
      });
      const raw = fs.readFileSync(
        path.join(tmpDir, String(kid), `${p.id}.md`),
        "utf8",
      );
      const id = Number(/\{@(\d+)\}/.exec(raw)![1]);
      const b = pages.getBlock(id);
      expect(b).toBeTruthy();
      expect(b!.kind).toBe("typescript");
      expect(b!.inner).toBe("const foo = 42;\nconsole.log(foo);");
      expect(b!.source).toContain("```typescript");
      expect(b!.source).toContain("```");
    });

    it("getBlockSummary returns schema+row_count without source/inner for tables", () => {
      const p = pages.add({
        knowledge_id: kid,
        title: "t",
        content:
          "| name | age | city |\n|------|-----|------|\n| Alice | 30 | NY |\n| Bob | 25 | LA |\n",
      });
      const raw = fs.readFileSync(
        path.join(tmpDir, String(kid), `${p.id}.md`),
        "utf8",
      );
      const id = Number(/\{@(\d+)\}/.exec(raw)![1]);
      const s = pages.getBlockSummary(id);
      expect(s).toBeTruthy();
      expect(s!.kind).toBe("table");
      expect(s!.columns).toEqual(["name", "age", "city"]);
      expect(s!.row_count).toBe(2);
      expect(s!.line_start).toBeGreaterThan(0);
      expect(s!.line_end).toBeGreaterThanOrEqual(s!.line_start);
      // No body bytes
      expect((s as Record<string, unknown>).source).toBeUndefined();
      expect((s as Record<string, unknown>).inner).toBeUndefined();
    });

    it("getBlockSummary omits columns/row_count for non-table blocks", () => {
      const p = pages.add({
        knowledge_id: kid,
        title: "t",
        content: '```stats\n[{"num":"1","label":"x"}]\n```\n',
      });
      const raw = fs.readFileSync(
        path.join(tmpDir, String(kid), `${p.id}.md`),
        "utf8",
      );
      const id = Number(/\{@(\d+)\}/.exec(raw)![1]);
      const s = pages.getBlockSummary(id);
      expect(s!.kind).toBe("stats");
      expect((s as Record<string, unknown>).columns).toBeUndefined();
      expect((s as Record<string, unknown>).row_count).toBeUndefined();
    });

    it("findTableRows filters by q (substring, case-insensitive)", () => {
      const p = pages.add({
        knowledge_id: kid,
        title: "t",
        content:
          "| name | role |\n|------|------|\n| Alice | admin |\n| Bob | viewer |\n| Carla | admin |\n",
      });
      const raw = fs.readFileSync(
        path.join(tmpDir, String(kid), `${p.id}.md`),
        "utf8",
      );
      const id = Number(/\{@(\d+)\}/.exec(raw)![1]);
      const r = pages.findTableRows(id, { q: "ADMIN" });
      expect(r.total_matched).toBe(2);
      expect(r.truncated).toBe(false);
      expect(r.columns).toEqual(["name", "role"]);
      expect(r.matches.map((m) => m.columns.name)).toEqual(["Alice", "Carla"]);
      // source_line is the absolute page line of the data row
      expect(r.matches[0].row_index).toBe(0);
      expect(r.matches[1].row_index).toBe(2);
    });

    it("findTableRows filters by where (exact, multi-key AND)", () => {
      const p = pages.add({
        knowledge_id: kid,
        title: "t",
        content:
          "| name | role | city |\n|------|------|------|\n| Alice | admin | NY |\n| Bob | admin | LA |\n| Carla | admin | NY |\n",
      });
      const raw = fs.readFileSync(
        path.join(tmpDir, String(kid), `${p.id}.md`),
        "utf8",
      );
      const id = Number(/\{@(\d+)\}/.exec(raw)![1]);
      const r = pages.findTableRows(id, {
        where: { role: "admin", city: "NY" },
      });
      expect(r.matches.map((m) => m.columns.name)).toEqual(["Alice", "Carla"]);
    });

    it("findTableRows respects columns filter on q", () => {
      const p = pages.add({
        knowledge_id: kid,
        title: "t",
        content:
          "| name | bio |\n|------|-----|\n| Alice | likes admin tools |\n| admin-bot | runs jobs |\n",
      });
      const raw = fs.readFileSync(
        path.join(tmpDir, String(kid), `${p.id}.md`),
        "utf8",
      );
      const id = Number(/\{@(\d+)\}/.exec(raw)![1]);
      // q across all cols matches both rows
      expect(pages.findTableRows(id, { q: "admin" }).total_matched).toBe(2);
      // q restricted to `name` only matches the admin-bot row
      const onlyName = pages.findTableRows(id, {
        q: "admin",
        columns: ["name"],
      });
      expect(onlyName.matches.map((m) => m.columns.name)).toEqual(["admin-bot"]);
    });

    it("findTableRows truncates and reports total_matched", () => {
      const rows = Array.from({ length: 10 }, (_, i) => `| r${i} | v${i} |`).join(
        "\n",
      );
      const p = pages.add({
        knowledge_id: kid,
        title: "t",
        content: `| name | val |\n|------|-----|\n${rows}\n`,
      });
      const raw = fs.readFileSync(
        path.join(tmpDir, String(kid), `${p.id}.md`),
        "utf8",
      );
      const id = Number(/\{@(\d+)\}/.exec(raw)![1]);
      const r = pages.findTableRows(id, { limit: 3 });
      expect(r.total_matched).toBe(10);
      expect(r.matches).toHaveLength(3);
      expect(r.truncated).toBe(true);
    });

    it("findTableRows throws when the block isn't a table", () => {
      const p = pages.add({
        knowledge_id: kid,
        title: "t",
        content: '```stats\n[{"num":"1","label":"x"}]\n```\n',
      });
      const raw = fs.readFileSync(
        path.join(tmpDir, String(kid), `${p.id}.md`),
        "utf8",
      );
      const id = Number(/\{@(\d+)\}/.exec(raw)![1]);
      expect(() => pages.findTableRows(id, { q: "x" })).toThrow(/not a table/);
    });

    it("getTableRows returns a slice via offset (start=1, offset=2)", () => {
      const p = pages.add({
        knowledge_id: kid,
        title: "t",
        content:
          "| n | v |\n|---|---|\n| a | 1 |\n| b | 2 |\n| c | 3 |\n| d | 4 |\n",
      });
      const raw = fs.readFileSync(
        path.join(tmpDir, String(kid), `${p.id}.md`),
        "utf8",
      );
      const id = Number(/\{@(\d+)\}/.exec(raw)![1]);
      const r = pages.getTableRows(id, { start: 1, offset: 2 });
      expect(r.matches.map((m) => m.columns.n)).toEqual(["b", "c"]);
      expect(r.matches.map((m) => m.row_index)).toEqual([1, 2]);
      expect(r.row_count).toBe(4);
      expect(r.truncated).toBe(false);
    });

    it("getTableRows handles end + negative wrap", () => {
      const p = pages.add({
        knowledge_id: kid,
        title: "t",
        content:
          "| n |\n|---|\n| a |\n| b |\n| c |\n| d |\n",
      });
      const raw = fs.readFileSync(
        path.join(tmpDir, String(kid), `${p.id}.md`),
        "utf8",
      );
      const id = Number(/\{@(\d+)\}/.exec(raw)![1]);
      // start=-2 (= row 2), end=-1 (= last row 3) → rows c, d
      const r = pages.getTableRows(id, { start: -2, end: -1 });
      expect(r.matches.map((m) => m.columns.n)).toEqual(["c", "d"]);
    });

    it("getTableRows returns single row when neither end nor offset", () => {
      const p = pages.add({
        knowledge_id: kid,
        title: "t",
        content: "| n |\n|---|\n| a |\n| b |\n",
      });
      const raw = fs.readFileSync(
        path.join(tmpDir, String(kid), `${p.id}.md`),
        "utf8",
      );
      const id = Number(/\{@(\d+)\}/.exec(raw)![1]);
      const r = pages.getTableRows(id, { start: 0 });
      expect(r.matches).toHaveLength(1);
      expect(r.matches[0].columns.n).toBe("a");
    });

    it("getTableRows throws when both end and offset supplied", () => {
      const p = pages.add({
        knowledge_id: kid,
        title: "t",
        content: "| n |\n|---|\n| a |\n",
      });
      const raw = fs.readFileSync(
        path.join(tmpDir, String(kid), `${p.id}.md`),
        "utf8",
      );
      const id = Number(/\{@(\d+)\}/.exec(raw)![1]);
      expect(() =>
        pages.getTableRows(id, { start: 0, end: 0, offset: 1 }),
      ).toThrow(/either `end` or `offset`/);
    });

    it("getTableRowsWithCheckbox filters by all-checked / all-unchecked", () => {
      const p = pages.add({
        knowledge_id: kid,
        title: "t",
        content:
          "| Task | Done |\n|------|------|\n| a    | [ ]  |\n| b    | [x]  |\n| c    | plain text |\n| d    | [x]  |\n",
      });
      const raw = fs.readFileSync(
        path.join(tmpDir, String(kid), `${p.id}.md`),
        "utf8",
      );
      const id = Number(/\{@(\d+)\}/.exec(raw)![1]);
      const all = pages.getTableRowsWithCheckbox(id);
      // Rows with any checkbox: a, b, d (not c)
      expect(all.matches.map((m) => m.columns.Task)).toEqual(["a", "b", "d"]);
      const checked = pages.getTableRowsWithCheckbox(id, { checked: true });
      expect(checked.matches.map((m) => m.columns.Task)).toEqual(["b", "d"]);
      const unchecked = pages.getTableRowsWithCheckbox(id, { checked: false });
      expect(unchecked.matches.map((m) => m.columns.Task)).toEqual(["a"]);
    });

    it("updateTableRows replaces rows in-place and preserves {@N}", () => {
      const p = pages.add({
        knowledge_id: kid,
        title: "t",
        content:
          "| n | v |\n|---|---|\n| a | 1 |\n| b | 2 |\n| c | 3 |\n",
      });
      const raw = fs.readFileSync(
        path.join(tmpDir, String(kid), `${p.id}.md`),
        "utf8",
      );
      const id = Number(/\{@(\d+)\}/.exec(raw)![1]);
      const r = pages.updateTableRows(id, {
        start: 1,
        end: 1,
        newRows: ["| B | 20 |"],
      });
      expect(r.page_version).toBe(2);
      expect(r.updated_count).toBe(1);
      const after = fs.readFileSync(
        path.join(tmpDir, String(kid), `${p.id}.md`),
        "utf8",
      );
      expect(after).toContain("| a | 1 |");
      expect(after).toContain("| B | 20 |");
      expect(after).toContain("| c | 3 |");
      expect(after).toContain(`{@${id}}`);
      // Row b should be gone
      expect(after).not.toContain("| b | 2 |");
    });

    it("updateTableRows can grow the table (shrink/expand via new_rows length)", () => {
      const p = pages.add({
        knowledge_id: kid,
        title: "t",
        content: "| n |\n|---|\n| a |\n| b |\n",
      });
      const raw = fs.readFileSync(
        path.join(tmpDir, String(kid), `${p.id}.md`),
        "utf8",
      );
      const id = Number(/\{@(\d+)\}/.exec(raw)![1]);
      const r = pages.updateTableRows(id, {
        start: 0,
        end: 1,
        newRows: ["| x |", "| y |", "| z |"],
      });
      expect(r.updated_count).toBe(3);
      const after = pages.getTableRows(id, { start: 0, end: 99 });
      expect(after.matches.map((m) => m.columns.n)).toEqual(["x", "y", "z"]);
    });

    it("updateTableRows throws on STALE expected_version", () => {
      const p = pages.add({
        knowledge_id: kid,
        title: "t",
        content: "| n |\n|---|\n| a |\n",
      });
      const raw = fs.readFileSync(
        path.join(tmpDir, String(kid), `${p.id}.md`),
        "utf8",
      );
      const id = Number(/\{@(\d+)\}/.exec(raw)![1]);
      expect(() =>
        pages.updateTableRows(id, {
          start: 0,
          newRows: ["| Q |"],
          expectedVersion: 999,
        }),
      ).toThrow(/STALE/);
    });

    it("updateTableRows rejects invalid row syntax", () => {
      const p = pages.add({
        knowledge_id: kid,
        title: "t",
        content: "| n |\n|---|\n| a |\n",
      });
      const raw = fs.readFileSync(
        path.join(tmpDir, String(kid), `${p.id}.md`),
        "utf8",
      );
      const id = Number(/\{@(\d+)\}/.exec(raw)![1]);
      expect(() =>
        pages.updateTableRows(id, { start: 0, newRows: ["no pipes here"] }),
      ).toThrow(/start and end with/);
    });

    it("updateTableRows throws on non-table blocks", () => {
      const p = pages.add({
        knowledge_id: kid,
        title: "t",
        content: '```stats\n[{"num":"1","label":"x"}]\n```\n',
      });
      const raw = fs.readFileSync(
        path.join(tmpDir, String(kid), `${p.id}.md`),
        "utf8",
      );
      const id = Number(/\{@(\d+)\}/.exec(raw)![1]);
      expect(() =>
        pages.updateTableRows(id, { start: 0, newRows: ["| a |"] }),
      ).toThrow(/not a markdown table block/);
    });

    it("appendTableRows adds rows at the END (above the {@N} annotation)", () => {
      const p = pages.add({
        knowledge_id: kid,
        title: "t",
        content: "| n | v |\n|---|---|\n| a | 1 |\n| b | 2 |\n",
      });
      const raw = fs.readFileSync(
        path.join(tmpDir, String(kid), `${p.id}.md`),
        "utf8",
      );
      const id = Number(/\{@(\d+)\}/.exec(raw)![1]);
      const r = pages.appendTableRows(id, {
        newRows: ["| c | 3 |", "| d | 4 |"],
      });
      expect(r.appended_count).toBe(2);
      expect(r.new_row_indices).toEqual([2, 3]);
      const after = fs.readFileSync(
        path.join(tmpDir, String(kid), `${p.id}.md`),
        "utf8",
      );
      // Rows must appear above the annotation line.
      const lines = after.split("\n");
      const annLine = lines.findIndex((l) => l.trim() === `{@${id}}`);
      const cLine = lines.findIndex((l) => l.includes("| c | 3 |"));
      const dLine = lines.findIndex((l) => l.includes("| d | 4 |"));
      expect(cLine).toBeGreaterThan(-1);
      expect(dLine).toBeGreaterThan(-1);
      expect(cLine).toBeLessThan(annLine);
      expect(dLine).toBeLessThan(annLine);
      // Sequence: a, b, c, d
      const slice = pages.getTableRows(id, { start: 0, end: 99 });
      expect(slice.matches.map((m) => m.columns.n)).toEqual([
        "a",
        "b",
        "c",
        "d",
      ]);
    });

    it("appendTableRows rejects non-table block and bad row syntax", () => {
      const p1 = pages.add({
        knowledge_id: kid,
        title: "t",
        content: '```stats\n[{"num":"1","label":"x"}]\n```\n',
      });
      const raw1 = fs.readFileSync(
        path.join(tmpDir, String(kid), `${p1.id}.md`),
        "utf8",
      );
      const id1 = Number(/\{@(\d+)\}/.exec(raw1)![1]);
      expect(() =>
        pages.appendTableRows(id1, { newRows: ["| a |"] }),
      ).toThrow(/not a markdown table block/);

      const p2 = pages.add({
        knowledge_id: kid,
        title: "t2",
        content: "| n |\n|---|\n| a |\n",
      });
      const raw2 = fs.readFileSync(
        path.join(tmpDir, String(kid), `${p2.id}.md`),
        "utf8",
      );
      const id2 = Number(/\{@(\d+)\}/.exec(raw2)![1]);
      expect(() =>
        pages.appendTableRows(id2, { newRows: ["nopipe"] }),
      ).toThrow(/start and end with/);
      // STALE
      expect(() =>
        pages.appendTableRows(id2, {
          newRows: ["| z |"],
          expectedVersion: 999,
        }),
      ).toThrow(/STALE/);
    });

    it("insertTableRows at=0 puts rows at the top", () => {
      const p = pages.add({
        knowledge_id: kid,
        title: "t",
        content: "| n |\n|---|\n| a |\n| b |\n",
      });
      const raw = fs.readFileSync(
        path.join(tmpDir, String(kid), `${p.id}.md`),
        "utf8",
      );
      const id = Number(/\{@(\d+)\}/.exec(raw)![1]);
      const r = pages.insertTableRows(id, { at: 0, newRows: ["| Z |"] });
      expect(r.inserted_count).toBe(1);
      expect(r.new_row_indices).toEqual([0]);
      const slice = pages.getTableRows(id, { start: 0, end: 99 });
      expect(slice.matches.map((m) => m.columns.n)).toEqual(["Z", "a", "b"]);
    });

    it("insertTableRows at=row_count behaves like append", () => {
      const p = pages.add({
        knowledge_id: kid,
        title: "t",
        content: "| n |\n|---|\n| a |\n| b |\n",
      });
      const raw = fs.readFileSync(
        path.join(tmpDir, String(kid), `${p.id}.md`),
        "utf8",
      );
      const id = Number(/\{@(\d+)\}/.exec(raw)![1]);
      const r = pages.insertTableRows(id, { at: 2, newRows: ["| c |"] });
      expect(r.new_row_indices).toEqual([2]);
      const slice = pages.getTableRows(id, { start: 0, end: 99 });
      expect(slice.matches.map((m) => m.columns.n)).toEqual(["a", "b", "c"]);
    });

    it("insertTableRows rejects out-of-range and negative at", () => {
      const p = pages.add({
        knowledge_id: kid,
        title: "t",
        content: "| n |\n|---|\n| a |\n",
      });
      const raw = fs.readFileSync(
        path.join(tmpDir, String(kid), `${p.id}.md`),
        "utf8",
      );
      const id = Number(/\{@(\d+)\}/.exec(raw)![1]);
      expect(() =>
        pages.insertTableRows(id, { at: 2, newRows: ["| Q |"] }),
      ).toThrow(/out of range/);
      expect(() =>
        pages.insertTableRows(id, { at: -1, newRows: ["| Q |"] }),
      ).toThrow(/out of range/);
      // STALE
      expect(() =>
        pages.insertTableRows(id, {
          at: 0,
          newRows: ["| Q |"],
          expectedVersion: 999,
        }),
      ).toThrow(/STALE/);
    });
  });

  describe("insertLines & addLines", () => {
    it("insertLines puts new content BEFORE the given line", () => {
      const p = pages.add({
        knowledge_id: kid,
        title: "t",
        content: "A\nB\nC\n",
      });
      const r = pages.insertLines(p.id, 2, "X");
      expect(r.inserted_lines).toBe(1);
      const cur = fs.readFileSync(
        path.join(tmpDir, String(kid), `${p.id}.md`),
        "utf8",
      );
      expect(cur).toBe("A\nX\nB\nC\n");
    });

    it("insertLines multi-line, at=1 (top), at=total+1 (end)", () => {
      const p = pages.add({
        knowledge_id: kid,
        title: "t",
        content: "B\nC\n",
      });
      pages.insertLines(p.id, 1, "A1\nA2");
      let cur = fs.readFileSync(
        path.join(tmpDir, String(kid), `${p.id}.md`),
        "utf8",
      );
      expect(cur).toBe("A1\nA2\nB\nC\n");
      // total_lines is now 4 → at=5 appends
      const r2 = pages.insertLines(p.id, 5, "D");
      expect(r2.inserted_lines).toBe(1);
      cur = fs.readFileSync(
        path.join(tmpDir, String(kid), `${p.id}.md`),
        "utf8",
      );
      expect(cur).toBe("A1\nA2\nB\nC\nD\n");
    });

    it("insertLines rejects out-of-range and honours expected_hash", () => {
      const p = pages.add({
        knowledge_id: kid,
        title: "t",
        content: "A\nB\nC\n",
      });
      expect(() => pages.insertLines(p.id, 0, "X")).toThrow(/out of range/);
      expect(() => pages.insertLines(p.id, 5, "X")).toThrow(/out of range/);
      const ref = pages.readLines(p.id, 2, 2);
      expect(() =>
        pages.insertLines(p.id, 2, "X", ref.hash),
      ).not.toThrow();
      expect(() =>
        pages.insertLines(p.id, 2, "X", "badhash"),
      ).toThrow(/hash mismatch/);
    });

    it("addLines appends to the end (with separator)", () => {
      const p = pages.add({
        knowledge_id: kid,
        title: "t",
        content: "A\nB",
      });
      const r = pages.addLines(p.id, "C\nD");
      expect(r.appended_lines).toBe(2);
      const cur = fs.readFileSync(
        path.join(tmpDir, String(kid), `${p.id}.md`),
        "utf8",
      );
      // Original had no trailing newline → server adds one before append.
      expect(cur).toBe("A\nB\nC\nD");
    });

    it("addLines honours expected_hash on last line", () => {
      const p = pages.add({
        knowledge_id: kid,
        title: "t",
        content: "A\nB\nC\n",
      });
      const last = pages.readLines(p.id, 3, 3);
      expect(() => pages.addLines(p.id, "D", last.hash)).not.toThrow();
      expect(() => pages.addLines(p.id, "E", "badhash")).toThrow(
        /hash mismatch/,
      );
    });
  });

  describe("setInlineImageSize", () => {
    it("adds a title slot with WxH when none existed", () => {
      const { id } = pages.add({
        knowledge_id: kid,
        title: "T",
        content: "before\n\n![cat](/img/cat.png)\n\nafter",
      });
      const r = pages.setInlineImageSize(id, "/img/cat.png", 0, {
        width: 300,
        height: 200,
      });
      expect(r.version).toBe(2);
      const raw = fs.readFileSync(
        path.join(tmpDir, String(kid), `${id}.md`),
        "utf8",
      );
      expect(raw).toContain('![cat](/img/cat.png "300x200")');
    });

    it("updates an existing WxH title", () => {
      const { id } = pages.add({
        knowledge_id: kid,
        title: "T",
        content: '![cat](/img/cat.png "100x80")',
      });
      pages.setInlineImageSize(id, "/img/cat.png", 0, {
        width: 400,
        height: 250,
      });
      const raw = fs.readFileSync(
        path.join(tmpDir, String(kid), `${id}.md`),
        "utf8",
      );
      expect(raw).toContain('![cat](/img/cat.png "400x250")');
    });

    it("preserves caption text and uses w=/h= tokens when caption is present", () => {
      const { id } = pages.add({
        knowledge_id: kid,
        title: "T",
        content: '![cat](/img/cat.png "my cat photo")',
      });
      pages.setInlineImageSize(id, "/img/cat.png", 0, {
        width: 300,
      });
      const raw = fs.readFileSync(
        path.join(tmpDir, String(kid), `${id}.md`),
        "utf8",
      );
      expect(raw).toContain('![cat](/img/cat.png "my cat photo w=300")');
    });

    it("drops the title slot when both dimensions are removed", () => {
      const { id } = pages.add({
        knowledge_id: kid,
        title: "T",
        content: '![cat](/img/cat.png "300x200")',
      });
      pages.setInlineImageSize(id, "/img/cat.png", 0, {});
      const raw = fs.readFileSync(
        path.join(tmpDir, String(kid), `${id}.md`),
        "utf8",
      );
      expect(raw.trim()).toBe("![cat](/img/cat.png)");
    });

    it("targets the right occurrence when src appears multiple times", () => {
      const { id } = pages.add({
        knowledge_id: kid,
        title: "T",
        content: [
          "first ![](/img/x.png)",
          "",
          "second ![](/img/x.png)",
          "",
          "third ![](/img/x.png)",
        ].join("\n"),
      });
      // Resize the middle one
      pages.setInlineImageSize(id, "/img/x.png", 1, { width: 250 });
      const raw = fs.readFileSync(
        path.join(tmpDir, String(kid), `${id}.md`),
        "utf8",
      );
      const lines = raw.split("\n");
      expect(lines[0]).toBe("first ![](/img/x.png)");
      expect(lines[2]).toBe('second ![](/img/x.png "250x")');
      expect(lines[4]).toBe("third ![](/img/x.png)");
    });

    it("throws when the src doesn't exist on the page", () => {
      const { id } = pages.add({
        knowledge_id: kid,
        title: "T",
        content: "![cat](/img/cat.png)",
      });
      expect(() =>
        pages.setInlineImageSize(id, "/img/missing.png", 0, { width: 100 }),
      ).toThrow(/not found/);
    });
  });

  describe("summarizePageContent", () => {
    it("replaces annotated fence blocks with single-line placeholders", () => {
      const content = [
        "# Page",
        "",
        "Intro prose.",
        "",
        '```mermaid {@111 "Architecture: API → DB"}',
        "flowchart TD",
        "  A --> B",
        "  C --> D",
        "```",
        "",
        "More prose.",
        "",
        '```chart {@222 "Monthly revenue"}',
        '{"type":"bar","data":{"labels":["Jan"],"datasets":[]}}',
        "```",
      ].join("\n");
      const r = pages.summarizePageContent(content);
      // Placeholders include the block's source line count so AI knows
      // how much text is hiding behind each `@N`.
      expect(r.skeleton).toContain(
        "[@111 mermaid 5 lines: Architecture: API → DB]",
      );
      expect(r.skeleton).toContain(
        "[@222 chart 3 lines: Monthly revenue]",
      );
      // Diagram source bodies must NOT survive in the skeleton
      expect(r.skeleton).not.toContain("flowchart TD");
      expect(r.skeleton).not.toContain('{"type":"bar"');
      // blocks index lists both with correct source line ranges
      expect(r.blocks).toHaveLength(2);
      expect(r.blocks[0]).toMatchObject({
        id: 111,
        kind: "mermaid",
        caption: "Architecture: API → DB",
      });
      expect(r.blocks[1]).toMatchObject({
        id: 222,
        kind: "chart",
        caption: "Monthly revenue",
      });
      expect(r.blocks[0].source_line_start).toBe(5);
      expect(r.blocks[0].source_line_end).toBe(9);
    });

    it("replaces annotated markdown tables with table placeholder + dims", () => {
      const content = [
        "Before",
        "",
        "| name | age |",
        "|------|-----|",
        "| Alice | 30 |",
        "| Bob | 25 |",
        "| Cara | 40 |",
        "",
        '{@333 "User roster"}',
        "",
        "After",
      ].join("\n");
      const r = pages.summarizePageContent(content);
      expect(r.skeleton).toContain("[@333 table 3r × 2c: User roster]");
      // Row data must NOT survive
      expect(r.skeleton).not.toContain("Alice");
      expect(r.skeleton).not.toContain("|------|");
      // Prose still present
      expect(r.skeleton).toContain("Before");
      expect(r.skeleton).toContain("After");
      expect(r.blocks).toEqual([
        {
          id: 333,
          kind: "table",
          caption: "User roster",
          source_line_start: 3,
          source_line_end: 7,
        },
      ]);
    });

    it("leaves unannotated fences (plain code blocks) untouched", () => {
      const content = [
        "Sample code:",
        "",
        "```typescript",
        "const x = 1;",
        "```",
        "",
        "End.",
      ].join("\n");
      const r = pages.summarizePageContent(content);
      // ts code is kept verbatim — no @N → no placeholder
      expect(r.skeleton).toContain("const x = 1;");
      expect(r.skeleton).toContain("```typescript");
      expect(r.blocks).toEqual([]);
    });

    it("uses generic descriptor when caption is missing", () => {
      const content = [
        "```stats {@444}",
        '[{"num":"1","label":"x"}]',
        "```",
      ].join("\n");
      const r = pages.summarizePageContent(content);
      expect(r.skeleton).toBe("[@444 stats 3 lines]");
      expect(r.blocks[0]).toMatchObject({ id: 444, caption: null });
    });
  });

  describe("block captions", () => {
    it("getBlock returns the caption from a fence annotation", () => {
      const { id } = pages.add({
        knowledge_id: kid,
        title: "T",
        content:
          '```stats {@5555 "Q1 KPIs at a glance"}\n[{"num":"1","label":"x"}]\n```',
      });
      // The user-supplied id stays through injectBlockIds (already
      // present) — pages.getBlock should find it.
      const b = pages.getBlock(5555);
      expect(b).toBeTruthy();
      expect(b!.kind).toBe("stats");
      expect(b!.caption).toBe("Q1 KPIs at a glance");
      // Sanity: page_id matches the just-created page
      expect(b!.page_id).toBe(id);
    });

    it("getBlock returns the caption from a markdown-table trailing annotation", () => {
      const { id: pid } = pages.add({
        knowledge_id: kid,
        title: "T",
        content:
          '| a | b |\n|---|---|\n| 1 | 2 |\n\n{@6666 "Tiny demo table"}',
      });
      const b = pages.getBlock(6666);
      expect(b).toBeTruthy();
      expect(b!.kind).toBe("table");
      expect(b!.caption).toBe("Tiny demo table");
      expect(b!.page_id).toBe(pid);
    });

    it("getBlockSummary returns caption alongside columns/row_count", () => {
      pages.add({
        knowledge_id: kid,
        title: "T",
        content:
          '| name | age |\n|------|-----|\n| Alice | 30 |\n\n{@7777 "User roster"}',
      });
      const s = pages.getBlockSummary(7777);
      expect(s!.caption).toBe("User roster");
      expect(s!.columns).toEqual(["name", "age"]);
      expect(s!.row_count).toBe(1);
    });

    it("setBlockCaption sets, updates, and clears the caption", () => {
      const { id: pid } = pages.add({
        knowledge_id: kid,
        title: "T",
        content: '```mermaid {@8888}\nflowchart TD\n  A --> B\n```',
      });
      // Set
      let r = pages.setBlockCaption(8888, "Initial caption");
      expect(r.caption).toBe("Initial caption");
      let raw = fs.readFileSync(
        path.join(tmpDir, String(kid), `${pid}.md`),
        "utf8",
      );
      expect(raw).toContain('```mermaid {@8888 "Initial caption"}');
      // Update
      r = pages.setBlockCaption(8888, "Updated caption");
      raw = fs.readFileSync(
        path.join(tmpDir, String(kid), `${pid}.md`),
        "utf8",
      );
      expect(raw).toContain('```mermaid {@8888 "Updated caption"}');
      // Clear
      r = pages.setBlockCaption(8888, null);
      expect(r.caption).toBeNull();
      raw = fs.readFileSync(
        path.join(tmpDir, String(kid), `${pid}.md`),
        "utf8",
      );
      expect(raw).toContain("```mermaid {@8888}");
    });

    it("preserveBlockIds carries caption across block-type conversions", () => {
      const content = [
        "## chart",
        "",
        "| a | b |",
        "|---|---|",
        "| 1 | 2 |",
        "",
        '{@9999 "Quarterly revenue"}',
      ].join("\n");
      const { id: pid } = pages.add({
        knowledge_id: kid,
        title: "T",
        content,
      });
      // AI converts the table to an html-embed WITHOUT carrying either
      // the id OR the caption — server should preserve both.
      pages.editSection(
        pid,
        "## chart",
        "```html-embed\n<table><tr><td>a</td><td>b</td></tr></table>\n```",
      );
      const raw = fs.readFileSync(
        path.join(tmpDir, String(kid), `${pid}.md`),
        "utf8",
      );
      expect(raw).toContain('```html-embed {@9999 "Quarterly revenue"}');
    });

    it("setBlockCaption rejects when block id doesn't exist", () => {
      expect(() => pages.setBlockCaption(123456789, "x")).toThrow(
        /not found/,
      );
    });
  });

  describe("setHtmlEmbedImageSize", () => {
    it("adds a style attr with max-width when none existed", () => {
      const { id } = pages.add({
        knowledge_id: kid,
        title: "T",
        content: "```html-embed\n<img src=\"/img/a.png\" alt=\"a\">\n```",
      });
      const raw0 = fs.readFileSync(
        path.join(tmpDir, String(kid), `${id}.md`),
        "utf8",
      );
      const blockId = Number(/\{@(\d+)\}/.exec(raw0)![1]);
      pages.setHtmlEmbedImageSize(id, blockId, 0, { width: 240 });
      const raw1 = fs.readFileSync(
        path.join(tmpDir, String(kid), `${id}.md`),
        "utf8",
      );
      expect(raw1).toContain(
        '<img src="/img/a.png" alt="a" style="max-width:240px">',
      );
    });

    it("preserves other style properties when updating max-width", () => {
      const { id } = pages.add({
        knowledge_id: kid,
        title: "T",
        content:
          "```html-embed\n<img src=\"/img/a.png\" style=\"border-radius:8px;border:1px solid red;max-width:100px\">\n```",
      });
      const raw0 = fs.readFileSync(
        path.join(tmpDir, String(kid), `${id}.md`),
        "utf8",
      );
      const blockId = Number(/\{@(\d+)\}/.exec(raw0)![1]);
      pages.setHtmlEmbedImageSize(id, blockId, 0, {
        width: 400,
        height: 300,
      });
      const raw1 = fs.readFileSync(
        path.join(tmpDir, String(kid), `${id}.md`),
        "utf8",
      );
      // Old max-width gone, new max-width + max-height added, border kept
      expect(raw1).toContain("border-radius:8px");
      expect(raw1).toContain("border:1px solid red");
      expect(raw1).toContain("max-width:400px");
      expect(raw1).toContain("max-height:300px");
      // Only one max-width / max-height
      const matches = raw1.match(/max-width/g);
      expect(matches?.length).toBe(1);
    });

    it("targets the right occurrence inside a fence with multiple <img>", () => {
      const { id } = pages.add({
        knowledge_id: kid,
        title: "T",
        content: [
          "```html-embed",
          '<img src="/img/a.png">',
          '<img src="/img/b.png">',
          '<img src="/img/c.png">',
          "```",
        ].join("\n"),
      });
      const raw0 = fs.readFileSync(
        path.join(tmpDir, String(kid), `${id}.md`),
        "utf8",
      );
      const blockId = Number(/\{@(\d+)\}/.exec(raw0)![1]);
      // Resize the middle one (index 1)
      pages.setHtmlEmbedImageSize(id, blockId, 1, { width: 200 });
      const raw1 = fs.readFileSync(
        path.join(tmpDir, String(kid), `${id}.md`),
        "utf8",
      );
      const lines = raw1.split("\n");
      expect(lines.find((l) => l.includes("/img/a.png"))).toBe(
        '<img src="/img/a.png">',
      );
      expect(lines.find((l) => l.includes("/img/b.png"))).toBe(
        '<img src="/img/b.png" style="max-width:200px">',
      );
      expect(lines.find((l) => l.includes("/img/c.png"))).toBe(
        '<img src="/img/c.png">',
      );
    });

    it("throws when the block isn't an html-embed", () => {
      const { id } = pages.add({
        knowledge_id: kid,
        title: "T",
        content: '```stats\n[{"num":"1","label":"x"}]\n```',
      });
      const raw0 = fs.readFileSync(
        path.join(tmpDir, String(kid), `${id}.md`),
        "utf8",
      );
      const blockId = Number(/\{@(\d+)\}/.exec(raw0)![1]);
      expect(() =>
        pages.setHtmlEmbedImageSize(id, blockId, 0, { width: 100 }),
      ).toThrow(/not html-embed/);
    });
  });

  describe("cascade", () => {
    it("page rows are removed when knowledge is deleted (FK CASCADE)", () => {
      pages.add({ knowledge_id: kid, title: "A", content: "a" });
      pages.add({ knowledge_id: kid, title: "B", content: "b" });
      expect(pages.list(kid)).toHaveLength(2);
      knowledge.remove(kid);
      expect(pages.list(kid)).toHaveLength(0);
    });
  });

  // ───────── Phase 2a: scoped mutation feedback ─────────
  // Every fine-grained mutation returns the new line range it occupies,
  // a hash of that range (chainable as the next edit's expected_hash with
  // no re-read), a full page_hash that equals read_page's hash, and a
  // changed/noop status. See knowledge &50 (#324).
  describe("mutation feedback (Phase 2a)", () => {
    it("editLines returns changed_range, page_hash, and a chainable changed_range_hash", () => {
      const { id } = pages.add({
        knowledge_id: kid,
        title: "P",
        content: "line1\nline2\nline3",
      });
      const r = pages.editLines(id, 2, 2, "LINE2a\nLINE2b");
      expect(r.status).toBe("changed");
      expect(r.changed_range?.before).toEqual({ line_start: 2, line_end: 2 });
      expect(r.changed_range?.after).toEqual({ line_start: 2, line_end: 3 });

      // page_hash must equal a full read so the agent can trust it directly.
      expect(r.page_hash).toBe(pages.readLines(id).hash);

      // changed_range_hash gates a chained edit on the after-range with no re-read.
      expect(() =>
        pages.editLines(
          id,
          r.changed_range!.after!.line_start,
          r.changed_range!.after!.line_end,
          "x",
          r.changed_range_hash,
        ),
      ).not.toThrow();
    });

    it("editLines is a no-op when the new text equals the existing slice", () => {
      const { id } = pages.add({
        knowledge_id: kid,
        title: "P",
        content: "a\nb\nc",
      });
      const version = pages.getMetadata(id)!.version;
      const r = pages.editLines(id, 2, 2, "b");
      expect(r.status).toBe("noop");
      expect(r.version).toBe(version); // no version bump on a no-op
      expect(pages.getMetadata(id)!.version).toBe(version);
    });

    it("editSection returns changed_range and a page_hash that matches read", () => {
      const { id } = pages.add({
        knowledge_id: kid,
        title: "P",
        content: "# T\n\n## A\n\nold body\n\n## B\n\nkeep",
      });
      const r = pages.editSection(id, "## A", "new body");
      expect(r.status).toBe("changed");
      expect(r.changed_range?.after?.line_start).toBeGreaterThan(0);
      expect(r.page_hash).toBe(pages.readLines(id).hash);
    });

    it("addLines reports the appended range and page_hash", () => {
      const { id } = pages.add({ knowledge_id: kid, title: "P", content: "x\ny" });
      const r = pages.addLines(id, "z");
      expect(r.status).toBe("changed");
      expect(r.changed_range?.after?.line_end).toBe(r.new_line_count);
      expect(r.page_hash).toBe(pages.readLines(id).hash);
    });

    it("insertLines reports the inserted range and page_hash", () => {
      const { id } = pages.add({ knowledge_id: kid, title: "P", content: "a\nc" });
      const r = pages.insertLines(id, 2, "b");
      expect(r.status).toBe("changed");
      expect(r.changed_range?.after).toEqual({ line_start: 2, line_end: 2 });
      expect(r.page_hash).toBe(pages.readLines(id).hash);
    });

    // Phase 2b: affected structure scoped to the changed range.
    it("editLines surfaces a server-stamped block id intersecting the edit", () => {
      const { id } = pages.add({
        knowledge_id: kid,
        title: "P",
        content: "intro\n\noutro",
      });
      // Insert a stats fence (no {@N} — the server stamps one on save).
      const r = pages.editLines(
        id,
        2,
        2,
        '```stats\n[{"num":"1","label":"x"}]\n```',
      );
      expect(r.affected).toBeDefined();
      expect(r.affected!.blocks).toHaveLength(1);
      expect(r.affected!.blocks[0].kind).toBe("stats");
      expect(r.affected!.blocks[0].id).toBeGreaterThan(0); // stamped id is visible
    });

    it("editSection surfaces the affected heading and keeps affected scoped", () => {
      const { id } = pages.add({
        knowledge_id: kid,
        title: "P",
        content: "# T\n\n## A\n\nold\n\n## B\n\nkeep",
      });
      const r = pages.editSection(id, "## A", "new body");
      expect(r.affected!.headings.map((h) => h.text)).toContain("A");
      // Scoped: the untouched "## B" heading must NOT appear.
      expect(r.affected!.headings.map((h) => h.text)).not.toContain("B");
    });

    it("checkbox rows carry a global task_index that maps to toggleTaskAtIndex", () => {
      // A GFM task BEFORE the table must shift the table cells' global
      // index — this is the bug the plan flags (row_index != toggle index).
      const { id } = pages.add({
        knowledge_id: kid,
        title: "P",
        content: [
          "- [ ] gfm task zero", // task_index 0
          "",
          "| item | done |",
          "|------|------|",
          "| a | [ ] |", // task_index 1
          "| b | [ ] |", // task_index 2
        ].join("\n"),
      });
      // Resolve the table's @N by reading the stamped source.
      const raw = fs.readFileSync(
        path.join(tmpDir, String(kid), `${id}.md`),
        "utf8",
      );
      const tableId = Number(/\{@(\d+)\}/.exec(raw)![1]);
      const res = pages.getTableRowsWithCheckbox(tableId, {});
      expect(res.matches).toHaveLength(2);
      // First data row "a" is task_index 1 (gfm task was 0), not 0.
      const rowA = res.matches.find((m) => m.columns.item === "a")!;
      expect(rowA.checkboxes).toHaveLength(1);
      expect(rowA.checkboxes[0].task_index).toBe(1);
      // Toggling that index must flip row a's cell, leaving the gfm task alone.
      const t = pages.toggleTaskAtIndex(id, rowA.checkboxes[0].task_index);
      expect(t.done).toBe(true);
      const after = pages.getTableRowsWithCheckbox(tableId, {});
      expect(
        after.matches.find((m) => m.columns.item === "a")!.checkboxes[0].checked,
      ).toBe(true);
      // The gfm task (#0) must remain unchecked.
      const raw2 = fs.readFileSync(
        path.join(tmpDir, String(kid), `${id}.md`),
        "utf8",
      );
      expect(raw2).toContain("- [ ] gfm task zero");
    });

    it("affected blocks carry row_count for tables", () => {
      const { id } = pages.add({
        knowledge_id: kid,
        title: "P",
        content: "intro\n\nend",
      });
      const r = pages.editLines(
        id,
        2,
        2,
        "| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |",
      );
      const table = r.affected!.blocks.find((b) => b.kind === "table");
      expect(table).toBeDefined();
      expect(table!.row_count).toBe(2);
    });
  });
});
