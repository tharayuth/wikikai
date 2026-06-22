import { describe, expect, it } from "vitest";
import {
  buildProjectsSearch,
  parseProjectFilter,
} from "../client/src/hooks/useHash.js";

describe("parseProjectFilter (?projects= menu filter)", () => {
  it("returns null only when the param is entirely absent", () => {
    expect(parseProjectFilter("")).toBeNull();
    expect(parseProjectFilter("?foo=bar")).toBeNull();
  });

  it("parses a comma list of positive ids", () => {
    expect(parseProjectFilter("?projects=1,2")).toEqual({
      ids: [1, 2],
      noProject: false,
    });
    expect(parseProjectFilter("?projects=3")).toEqual({
      ids: [3],
      noProject: false,
    });
  });

  it("trims whitespace and drops non-positive / non-integer junk", () => {
    expect(parseProjectFilter("?projects=1, 2 , x, 0, -3, 4")).toEqual({
      ids: [1, 2, 4],
      noProject: false,
    });
  });

  it("recognises the `none` sentinel as the (no project) bucket", () => {
    expect(parseProjectFilter("?projects=none")).toEqual({
      ids: [],
      noProject: true,
    });
    expect(parseProjectFilter("?projects=1,2,none")).toEqual({
      ids: [1, 2],
      noProject: true,
    });
  });

  it("treats a present-but-empty value as an explicit empty selection", () => {
    // Distinct from absent (null) — this means "Clear all" / show nothing.
    expect(parseProjectFilter("?projects=")).toEqual({
      ids: [],
      noProject: false,
    });
    expect(parseProjectFilter("?projects=x,0,-1")).toEqual({
      ids: [],
      noProject: false,
    });
  });

  it("ignores other query params", () => {
    expect(parseProjectFilter("?q=hello&projects=5,6&page=2")).toEqual({
      ids: [5, 6],
      noProject: false,
    });
  });
});

describe("buildProjectsSearch", () => {
  it("returns an empty string for null (no param = All projects)", () => {
    expect(buildProjectsSearch(null)).toBe("");
  });

  it("returns `?projects=` for an empty list (Clear all)", () => {
    expect(buildProjectsSearch([])).toBe("?projects=");
  });

  it("serialises ids and the `none` sentinel", () => {
    expect(buildProjectsSearch([1, 2])).toBe("?projects=1,2");
    expect(buildProjectsSearch([1, "none"])).toBe("?projects=1,none");
    expect(buildProjectsSearch(["none"])).toBe("?projects=none");
  });

  it("round-trips through parseProjectFilter", () => {
    expect(parseProjectFilter(buildProjectsSearch([7, 9, "none"]))).toEqual({
      ids: [7, 9],
      noProject: true,
    });
  });
});
