import { describe, expect, it } from "vitest";
import { rankRecords, type SearchableRecord } from "../src/store/search/records.js";

const record = (id: number, fields: Partial<SearchableRecord>): SearchableRecord => ({
  id,
  title: "",
  body: "",
  keywords: [],
  ...fields,
});

describe("rankRecords", () => {
  it("matches a term anywhere in the title, body or keywords, ignoring case", () => {
    const hits = rankRecords(
      [
        record(1, { title: "Deploy steps" }),
        record(2, { body: "ask about the DEPLOY window" }),
        record(3, { keywords: ["deploy"] }),
        record(4, { title: "Unrelated" }),
      ],
      "deploy",
    );
    expect(hits.map((h) => h.id).sort()).toEqual([1, 2, 3]);
  });

  it("puts a hit in the title above a hit in the keywords, and those above the body", () => {
    const hits = rankRecords(
      [
        record(1, { body: "cache" }),
        record(2, { keywords: ["cache"] }),
        record(3, { title: "cache" }),
      ],
      "cache",
      { minScoreRatio: 0 },
    );
    expect(hits.map((h) => h.id)).toEqual([3, 2, 1]);
  });

  it("reports which terms matched and what share of the query they are", () => {
    const hits = rankRecords([record(1, { title: "redis cache" }), record(2, { title: "redis queue" })], "redis cache", {
      minScoreRatio: 0,
      maxDfRatio: 1,
    });
    expect(hits[0]).toMatchObject({ id: 1, matchRatio: 1 });
    expect(hits[0]?.matched.sort()).toEqual(["cache", "redis"]);
    expect(hits[1]).toMatchObject({ id: 2, matchRatio: 0.5, matched: ["redis"] });
  });

  it("finds a Thai phrase from a longer question with no spaces", () => {
    const hits = rankRecords(
      [record(1, { title: "แก้หน้าเข้าสู่ระบบ" }), record(2, { title: "ประชุมทีมประจำสัปดาห์" })],
      "งานแก้หน้าเข้าสู่ระบบอยู่ตรงไหน",
    );
    expect(hits.map((h) => h.id)).toEqual([1]);
  });

  it("lets the rare word decide rather than the word on every record", () => {
    const common = Array.from({ length: 20 }, (_, i) => record(i + 1, { title: `update item ${i}` }));
    const hits = rankRecords([...common, record(99, { title: "update postgres" })], "update postgres");
    expect(hits[0]?.id).toBe(99);
    expect(hits).toHaveLength(1);
  });

  it("quotes the line that matched", () => {
    const [hit] = rankRecords([record(1, { body: "First line\nThe gateway times out\nLast line" })], "gateway");
    expect(hit?.snippet).toContain("gateway");
    expect(hit?.snippet).not.toContain("Last line");
  });

  it("quotes the opening when only the title matched, and nothing when there is no body", () => {
    const [withBody] = rankRecords([record(1, { title: "gateway", body: "Opening words" })], "gateway");
    expect(withBody?.snippet).toBe("Opening words");
    const [noBody] = rankRecords([record(1, { title: "gateway" })], "gateway");
    expect(noBody?.snippet).toBe("");
  });

  it("finds nothing for a query with no usable term, or when nothing matches", () => {
    expect(rankRecords([record(1, { title: "ab cd" })], "ab")).toEqual([]);
    expect(rankRecords([record(1, { title: "alpha" })], "   ")).toEqual([]);
    expect(rankRecords([record(1, { title: "alpha" })], "bravo")).toEqual([]);
    expect(rankRecords([], "alpha")).toEqual([]);
  });
});
