import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../src/store/db.js";
import { KnowledgeStore } from "../src/store/knowledge.js";
import { PageStore } from "../src/store/pages.js";

describe("PageStore.search", () => {
  let tmpDir: string;
  let knowledge: KnowledgeStore;
  let pages: PageStore;
  let kid: number;
  let otherKid: number;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wk-search-"));
    const db = openDb(":memory:");
    knowledge = new KnowledgeStore(db);
    pages = new PageStore(db, tmpDir);
    kid = knowledge.add({ title: "WikiKai internals", project: "docs" }).id;
    otherKid = knowledge.add({ title: "Field notes", project: "notes" }).id;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const add = (
    knowledgeId: number,
    title: string,
    content: string,
    keywords: string[] = [],
  ) => pages.add({ knowledge_id: knowledgeId, title, content, keywords });

  describe("whole-sentence queries", () => {
    it("answers a Thai question whose words never appear as one phrase", () => {
      // The phrase "ทำไมถึงเลือก" appears nowhere on the page. Under the old
      // planner every whitespace token had to appear verbatim, so a question
      // like this returned nothing at all.
      const target = add(
        kid,
        "การตัดสินใจเรื่องฐานข้อมูล",
        "เราเลือกใช้ better-sqlite3 แทน ORM เพราะ prepared statement เร็วกว่า",
      );
      add(kid, "อย่างอื่น", "หน้านี้พูดเรื่องอื่นทั้งหมด ไม่เกี่ยวกับฐานข้อมูล");

      const hits = pages.search("ทำไมถึงเลือก better-sqlite3 แทน ORM");
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].page_id).toBe(target.id);
    });

    it("answers an English question that includes filler words", () => {
      const target = add(
        kid,
        "Revisions",
        "Every version bump snapshots the page so you can roll back.",
      );
      // Filler words only look like filler once the corpus shows how common
      // they are, so give the index enough pages to tell them apart.
      for (let i = 0; i < 10; i++) {
        add(kid, `Aside ${i}`, "How does the coffee machine work in the office?");
      }

      const hits = pages.search("how does the revision system work");
      expect(hits[0].page_id).toBe(target.id);
    });
  });

  describe("ranking", () => {
    it("lets the rare term decide, not the common ones", () => {
      // The distractor matches three ordinary words; the target matches the one
      // term that identifies what was asked about.
      const target = add(
        kid,
        "Storage",
        "The driver is better-sqlite3 and it is synchronous.",
      );
      for (let i = 0; i < 8; i++) {
        add(kid, `Filler ${i}`, "The system stores data and the system works.");
      }

      const hits = pages.search("the system that stores data with better-sqlite3");
      expect(hits[0].page_id).toBe(target.id);
    });

    it("ranks a title match above the same words buried in prose", () => {
      const buried = add(
        kid,
        "Miscellaneous notes",
        "Somewhere in here we mention the heatmap in passing, once.",
      );
      const titled = add(kid, "Heatmap", "Colour scale and bucket boundaries.");

      const hits = pages.search("heatmap");
      expect(hits.map((h) => h.page_id).slice(0, 2)).toContain(titled.id);
      expect(hits[0].page_id).not.toBe(buried.id);
    });

    it("counts a keyword hit even when the body never says the word", () => {
      const target = add(kid, "Colour scale", "Bucket boundaries and legend.", [
        "heatmap",
      ]);
      const hits = pages.search("heatmap");
      expect(hits.map((h) => h.page_id)).toContain(target.id);
    });
  });

  describe("hit payload", () => {
    it("reports which terms matched and what share of the query they are", () => {
      const target = add(
        kid,
        "Deploy",
        "Run the migration, then restart the service.",
      );
      const hits = pages.search("migration restart");
      const hit = hits.find((h) => h.page_id === target.id);
      expect(hit).toBeDefined();
      expect(hit!.matched_terms.sort()).toEqual(["migration", "restart"]);
      expect(hit!.match_ratio).toBe(1);
    });

    it("marks a partial match as partial", () => {
      const target = add(kid, "Deploy", "Run the migration before anything else.");
      add(kid, "Recovery", "Rollback restores the previous release.");
      const hit = pages
        .search("migration rollback")
        .find((h) => h.page_id === target.id);
      expect(hit!.match_ratio).toBeLessThan(1);
    });

    it("ignores a term nobody wrote when reporting the share matched", () => {
      // A term matching nothing in the corpus cannot tell two pages apart, so
      // counting it would mark every hit partial and mean nothing.
      const target = add(kid, "Deploy", "Run the migration before anything else.");
      const hit = pages
        .search("migration zzzznotawordzzzz")
        .find((h) => h.page_id === target.id);
      expect(hit!.match_ratio).toBe(1);
    });

    it("points at the line holding the rarest matched term", () => {
      const target = add(
        kid,
        "Runbook",
        [
          "# Runbook",
          "The service is started by the operator.",
          "",
          "Then export WIKIKAI_TOKEN before the first request.",
        ].join("\n"),
      );
      for (let i = 0; i < 10; i++) {
        add(kid, `Service note ${i}`, "The service is started by the operator.");
      }
      const hits = pages.search("service WIKIKAI_TOKEN");
      const hit = hits.find((h) => h.page_id === target.id);
      expect(hit!.line).toBe(4);
      expect(hit!.snippet).toContain("WIKIKAI_TOKEN");
    });

    it("quotes enough text to judge a hit without opening the page", () => {
      // The old excerpt came from FTS5's snippet(), whose window is measured in
      // trigram tokens — barely wider than the match itself.
      add(
        kid,
        "Long prose",
        `Preamble line.\n${"context ".repeat(40)}rollback ${"more context ".repeat(40)}`,
      );
      const hits = pages.search("rollback");
      expect(hits[0].snippet.length).toBeGreaterThan(80);
      expect(hits[0].snippet).toContain("rollback");
    });

    it("falls back to the opening prose when only the title matched", () => {
      const target = add(
        kid,
        "Zephyr",
        "# Overview\n\nThis page never states its own name in the body.",
      );
      const hit = pages.search("zephyr").find((h) => h.page_id === target.id);
      expect(hit!.line).toBe(1);
      expect(hit!.snippet).toContain("never states");
      expect(hit!.snippet.startsWith("#")).toBe(false);
    });

    it("carries the prose under a heading when the match is the heading", () => {
      // Quoting "## Cache" back to someone who searched for "cache" repeats
      // their own query; the paragraph under it is the part that answers.
      const target = add(
        kid,
        "Architecture",
        "# Architecture\n\n## Cache\n\nFive layers, invalidated on write.",
      );
      const hit = pages.search("cache").find((h) => h.page_id === target.id);
      expect(hit!.line).toBe(3);
      expect(hit!.snippet).toContain("Five layers");
    });
  });

  describe("filters", () => {
    it("honours the project filter", () => {
      add(kid, "Docs page", "shared vocabulary term");
      const outside = add(otherKid, "Notes page", "shared vocabulary term");
      const hits = pages.search("vocabulary", { project: "docs" });
      expect(hits.map((h) => h.page_id)).not.toContain(outside.id);
      expect(hits.length).toBeGreaterThan(0);
    });

    it("hides archived pages unless asked for them", () => {
      const archived = add(kid, "Old page", "deprecated approach described here");
      pages.setArchived(archived.id, true);
      expect(pages.search("deprecated").map((h) => h.page_id)).not.toContain(
        archived.id,
      );
      expect(
        pages
          .search("deprecated", { includeArchived: true })
          .map((h) => h.page_id),
      ).toContain(archived.id);
    });
  });

  describe("countMatches", () => {
    it("reports the true total, not the number of rows returned", () => {
      for (let i = 0; i < 12; i++) {
        add(kid, `Page ${i}`, "every page here mentions telemetry once");
      }
      const hits = pages.search("telemetry", { limit: 3 });
      expect(hits).toHaveLength(3);
      expect(pages.countMatches("telemetry")).toBe(12);
    });

    it("respects the same filters as the search itself", () => {
      add(kid, "Docs page", "telemetry sample");
      add(otherKid, "Notes page", "telemetry sample");
      expect(pages.countMatches("telemetry")).toBe(2);
      expect(pages.countMatches("telemetry", { project: "docs" })).toBe(1);
    });

    it("counts an id lookup as the one thing it resolves to", () => {
      const p = add(kid, "Anything", "body");
      expect(pages.countMatches(`#${p.id}`)).toBe(1);
    });
  });

  describe("queries the index cannot serve", () => {
    it("returns nothing when every token is shorter than a trigram", () => {
      add(kid, "Page", "some content");
      expect(pages.search("a b")).toEqual([]);
      expect(pages.countMatches("a b")).toBe(0);
    });

    it("returns nothing rather than throwing on FTS syntax characters", () => {
      add(kid, "Page", "some content");
      expect(() => pages.search('content" OR "')).not.toThrow();
      expect(() => pages.search("NEAR(a b)")).not.toThrow();
    });
  });
});
