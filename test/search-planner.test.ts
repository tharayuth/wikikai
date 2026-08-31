import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "../src/store/search/params.js";
import { planTerms } from "../src/store/search/terms.js";
import { fuse, idf, selectTerms } from "../src/store/search/rank.js";

describe("planTerms", () => {
  it("keeps hyphenated and dotted identifiers in one piece", () => {
    expect(planTerms("better-sqlite3")).toEqual(["better-sqlite3"]);
    expect(planTerms("รง.8")).toContain("รง.8");
  });

  it("drops tokens shorter than a trigram — the index cannot match them", () => {
    // "AI" and "ok" are 2 codepoints; the trigram tokenizer has nothing to
    // match them against, so carrying them would only cost a lookup.
    expect(planTerms("AI is ok")).toEqual([]);
    expect(planTerms("AI QS แทน")).toEqual(["แทน"]);
  });

  it("keeps a short Thai run whole and does not window it", () => {
    expect(planTerms("ข้อมูล")).toEqual(["ข้อมูล"]);
  });

  it("windows a long Thai run so an unsegmented phrase can still match", () => {
    // Thai is written without spaces, so "ทำไมถึงเลือก" arrives as one
    // 12-codepoint token that would have to appear verbatim. Sliding windows
    // give the index something a real page can actually contain.
    const terms = planTerms("ทำไมถึงเลือก");
    expect(terms[0]).toBe("ทำไมถึงเลือก"); // the whole run stays, ranked first
    expect(terms.length).toBeGreaterThan(1);
    for (const t of terms.slice(1)) {
      expect([...t]).toHaveLength(DEFAULT_PARAMS.thaiWindow);
      expect("ทำไมถึงเลือก").toContain(t);
    }
  });

  it("splits mixed scripts and punctuation into separate terms", () => {
    const terms = planTerms("iSingleForm ตรวจสอบ, PMI/Heatmap");
    expect(terms).toContain("iSingleForm");
    expect(terms).toContain("ตรวจสอบ");
    expect(terms).toContain("PMI");
    expect(terms).toContain("Heatmap");
  });

  it("deduplicates repeated terms", () => {
    const terms = planTerms("lock lock LOCK");
    expect(terms.filter((t) => t.toLowerCase() === "lock")).toHaveLength(1);
  });

  it("returns nothing for an empty or unusable query", () => {
    expect(planTerms("   ")).toEqual([]);
    expect(planTerms("a b c")).toEqual([]);
  });
});

describe("idf", () => {
  it("rewards rarity", () => {
    expect(idf(1, 1000)).toBeGreaterThan(idf(500, 1000));
  });

  it("never goes negative, even for a term in every document", () => {
    expect(idf(1000, 1000)).toBeGreaterThanOrEqual(0);
  });
});

describe("selectTerms", () => {
  const N = 1000;

  it("drops terms that match nothing", () => {
    const df = (t: string) => (t === "ghost" ? 0 : 10);
    const picked = selectTerms(["ghost", "real"], df, N, DEFAULT_PARAMS);
    expect(picked.map((t) => t.text)).toEqual(["real"]);
  });

  it("drops terms so common they carry no signal", () => {
    // "the" as a trigram substring appears in a third of everything; keeping
    // it would drown the one term that actually identifies the document.
    const df = (t: string) => (t === "the" ? 900 : 5);
    const picked = selectTerms(["the", "revision"], df, N, DEFAULT_PARAMS);
    expect(picked.map((t) => t.text)).toEqual(["revision"]);
  });

  it("keeps the rarest terms rather than returning nothing at all", () => {
    // Every term is common. Dropping all of them would turn a real query into
    // zero results, which is the failure this whole change exists to remove.
    const df = (t: string) => (t === "ข้อมูล" ? 900 : 800);
    const picked = selectTerms(["ข้อมูล", "ระบบ"], df, N, DEFAULT_PARAMS);
    expect(picked.map((t) => t.text)).toEqual(["ระบบ", "ข้อมูล"]);
  });

  it("orders by rarity and caps how many terms reach the index", () => {
    const dfs: Record<string, number> = { a1: 50, b2: 5, c3: 200, d4: 1 };
    const picked = selectTerms(
      ["a1", "b2", "c3", "d4"],
      (t) => dfs[t] ?? 0,
      N,
      { ...DEFAULT_PARAMS, maxTerms: 3 },
    );
    expect(picked.map((t) => t.text)).toEqual(["d4", "b2", "a1"]);
  });
});

describe("fuse", () => {
  const term = (text: string, idfValue: number) => ({
    text,
    df: 1,
    idf: idfValue,
  });

  it("lets one rare term outweigh several common ones", () => {
    // The failure this fixes: a page matching four filler terms used to beat
    // the page matching the one term that names what you asked for.
    const fused = fuse(
      [
        { term: term("better-sqlite3", 6), hits: [{ pageId: 1, score: 2 }] },
        { term: term("แทน", 0.4), hits: [{ pageId: 2, score: 2 }] },
        { term: term("ทำไมถ", 0.5), hits: [{ pageId: 2, score: 2 }] },
        { term: term("งเลือ", 0.4), hits: [{ pageId: 2, score: 2 }] },
      ],
      4,
      DEFAULT_PARAMS,
    );
    expect(fused[0].pageId).toBe(1);
  });

  it("prefers the page that matches more of the query", () => {
    const fused = fuse(
      [
        {
          term: term("alpha", 2),
          hits: [
            { pageId: 1, score: 1 },
            { pageId: 2, score: 1 },
          ],
        },
        { term: term("beta", 2), hits: [{ pageId: 2, score: 1 }] },
      ],
      2,
      DEFAULT_PARAMS,
    );
    expect(fused[0].pageId).toBe(2);
    expect(fused[0].matched).toEqual(["alpha", "beta"]);
  });

  it("normalises within a term so one loud match cannot dominate", () => {
    // Raw bm25 magnitudes differ wildly between terms. Without per-term
    // normalisation the term with the biggest numbers wins regardless of idf.
    const fused = fuse(
      [
        { term: term("rare", 5), hits: [{ pageId: 1, score: 0.01 }] },
        { term: term("common", 0.2), hits: [{ pageId: 2, score: 1000 }] },
      ],
      2,
      DEFAULT_PARAMS,
    );
    expect(fused[0].pageId).toBe(1);
  });

  it("reports the share of the query each page matched", () => {
    const fused = fuse(
      [
        { term: term("alpha", 1), hits: [{ pageId: 1, score: 1 }] },
        { term: term("beta", 1), hits: [{ pageId: 1, score: 1 }] },
      ],
      4,
      DEFAULT_PARAMS,
    );
    expect(fused[0].matchRatio).toBeCloseTo(0.5);
  });

  it("returns nothing when no term matched anything", () => {
    expect(fuse([], 3, DEFAULT_PARAMS)).toEqual([]);
  });
});
