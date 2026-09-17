import { describe, expect, it } from "vitest";
import { resolveReadingSelection, type ReadingSelection } from "../client/src/lib/rawSelection";

function selection(text: string, start: number, end: number, line = 0, endLine = line + 1): ReadingSelection {
  return {
    start: { text, offset: start, line, endLine },
    end: { text, offset: end, line, endLine },
    text: text.slice(start, end),
  };
}

describe("reading selection → raw source", () => {
  it("targets the correct repeated paragraph", () => {
    const source = "same text\n\nsame text";
    expect(resolveReadingSelection(source, selection("same text", 0, 4, 2, 3))).toEqual({ from: 11, to: 15 });
  });
  it("preserves a partial Thai selection across bold and a link", () => {
    const source = "เริ่ม **ข้อความ** และ [ลิงก์](https://example.test) จบ";
    const text = "เริ่ม ข้อความ และ ลิงก์ จบ";
    const result = resolveReadingSelection(source, selection(text, text.indexOf("อความ"), text.indexOf(" จบ")));
    expect(result).not.toBeNull();
    expect(source.slice(result!.from, result!.to)).toBe("อความ** และ [ลิงก์");
  });
  it("does not mistake a link destination for the following identical text", () => {
    const source = "[same](same) same";
    expect(resolveReadingSelection(source, selection("same same", 5, 9))).toEqual({ from: 13, to: 17 });
  });
  it("keeps the occurrence within the same paragraph", () => {
    expect(resolveReadingSelection("same **same** same", selection("same same same", 5, 9))).toEqual({ from: 7, to: 11 });
  });
  it("maps collapsed whitespace back to the original source", () => {
    expect(resolveReadingSelection("alpha\n  beta", selection("alpha beta", 6, 10, 0, 2))).toEqual({ from: 8, to: 12 });
  });
  it("maps selections spanning paragraphs", () => {
    const picked = selection("first", 2, 5);
    picked.end = { text: "second", offset: 3, line: 2, endLine: 3 };
    expect(resolveReadingSelection("first\n\nsecond", picked)).toEqual({ from: 2, to: 10 });
  });
  it("handles UTF-16 offsets for emoji", () => {
    expect(resolveReadingSelection("**ไทย😀** ดี", selection("ไทย😀 ดี", 3, 5))).toEqual({ from: 5, to: 7 });
  });
  it("distinguishes repeated table cells", () => {
    const source = "| A | B |\n|---|---|\n| same | same |";
    expect(resolveReadingSelection(source, selection("\nsame\nsame\n", 6, 10, 2, 3))).toEqual({ from: 29, to: 33 });
  });
  it("does not guess between duplicate generated labels", () => {
    expect(resolveReadingSelection("label label", { start: null, end: null, text: "label" })).toBeNull();
  });
  it("does not select missing text after a concurrent edit", () => {
    expect(resolveReadingSelection("replacement", selection("original", 0, 8))).toBeNull();
  });
});
