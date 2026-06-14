import { describe, expect, it } from "vitest";
import { parseProjectIds } from "../client/src/hooks/useHash.js";

describe("parseProjectIds (?projects= menu filter)", () => {
  it("returns null when the param is absent", () => {
    expect(parseProjectIds("")).toBeNull();
    expect(parseProjectIds("?foo=bar")).toBeNull();
  });

  it("parses a comma list of positive ids", () => {
    expect(parseProjectIds("?projects=1,2")).toEqual([1, 2]);
    expect(parseProjectIds("?projects=3")).toEqual([3]);
  });

  it("trims whitespace and drops non-positive / non-integer junk", () => {
    expect(parseProjectIds("?projects=1, 2 , x, 0, -3, 4")).toEqual([1, 2, 4]);
  });

  it("treats an empty or all-invalid value as no filter (null)", () => {
    expect(parseProjectIds("?projects=")).toBeNull();
    expect(parseProjectIds("?projects=x,0,-1")).toBeNull();
  });

  it("ignores other query params", () => {
    expect(parseProjectIds("?q=hello&projects=5,6&page=2")).toEqual([5, 6]);
  });
});
