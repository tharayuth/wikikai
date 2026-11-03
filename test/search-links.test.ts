import { describe, expect, it } from "vitest";
import { buildNoteLink, buildTaskLink, isSearchIdLookup } from "../client/src/hooks/useHash.js";

describe("isSearchIdLookup", () => {
  it("accepts ids for documents, pages, blocks, tasks and notes", () => {
    for (const q of ["&3", "#12", "@47", "T5", "t5", "N12", "n12"]) expect(isSearchIdLookup(q), q).toBe(true);
  });

  it("refuses ordinary words", () => {
    for (const q of ["T", "T5a", "Note1", "Tn5", "5", "&", "ten 5"]) expect(isSearchIdLookup(q), q).toBe(false);
  });
});

describe("task and note links", () => {
  it("opens a task on its project's board, leaving the current project's params behind", () => {
    expect(buildTaskLink("?calendar=9&view=notes&note=3&module=2", 7, 12)).toBe("?calendar=7&view=board&task=12");
  });

  it("opens a note on its project's Notes tab", () => {
    expect(buildNoteLink("?calendar=9&view=board&task=3", 7, 12)).toBe("?calendar=7&view=notes&note=12");
  });

  it("keeps the sidebar's project filter", () => {
    expect(buildTaskLink("?projects=1,2", 7, 12)).toBe("?projects=1,2&calendar=7&view=board&task=12");
  });
});
