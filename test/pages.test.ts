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
    kid = knowledge.add({ title: "Doc" }).id;
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
      const otherK = knowledge.add({ title: "Other" }).id;
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
});
