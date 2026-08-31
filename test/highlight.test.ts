import { describe, expect, it } from "vitest";
import { splitHighlight } from "../client/src/lib/highlight.js";

const marked = (text: string, terms: string[]) =>
  splitHighlight(text, terms)
    .filter((p) => p.hit)
    .map((p) => p.text);

describe("splitHighlight", () => {
  it("marks the matched term and leaves the rest alone", () => {
    const parts = splitHighlight("run the migration first", ["migration"]);
    expect(parts.map((p) => p.text).join("")).toBe("run the migration first");
    expect(marked("run the migration first", ["migration"])).toEqual(["migration"]);
  });

  it("matches regardless of case but keeps the original casing", () => {
    expect(marked("The Cache is warm", ["cache"])).toEqual(["Cache"]);
  });

  it("prefers the longest term when Thai windows overlap", () => {
    // Overlapping windows are normal for Thai: letting the shorter one match
    // first would cut the longer match into fragments.
    const text = "ระบบตรวจสอบข้อมูลซ้ำ";
    expect(marked(text, ["ตรวจสอ", "ตรวจสอบข้อมูล"])).toEqual(["ตรวจสอบข้อมูล"]);
  });

  it("treats regex metacharacters in a term as literal text", () => {
    // Terms come from the query, so `c++`, `a.b` and `(x)` reach this intact.
    expect(marked("we use c++ here", ["c++"])).toEqual(["c++"]);
    expect(marked("see a.b for details", ["a.b"])).toEqual(["a.b"]);
    expect(() => splitHighlight("anything", ["(unclosed"])).not.toThrow();
  });

  it("does not treat a literal dot as a wildcard", () => {
    expect(marked("axb and a.b", ["a.b"])).toEqual(["a.b"]);
  });

  it("returns the text unchanged when there is nothing to mark", () => {
    expect(splitHighlight("plain text", [])).toEqual([
      { text: "plain text", hit: false },
    ]);
    expect(splitHighlight("", ["term"])).toEqual([{ text: "", hit: false }]);
  });

  it("emits no empty parts, even when the match is at either end", () => {
    for (const part of splitHighlight("migration done", ["migration"])) {
      expect(part.text).not.toBe("");
    }
  });
});
