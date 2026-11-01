import { describe, expect, it } from "vitest";
import {
  withDocumentlessProjects,
  type SidebarProject,
} from "../client/src/lib/sidebarGroups.js";

const proj = (
  id: number | null,
  name: string,
  registered = true,
): SidebarProject => ({ id, name, registered });

const groups: [string, string[]][] = [
  ["Alpha", ["doc-1"]],
  ["(no project)", ["doc-2"]],
];

const wide = { narrowed: false };

describe("withDocumentlessProjects", () => {
  it("appends registered projects with no group after the existing groups", () => {
    const out = withDocumentlessProjects(
      groups,
      [proj(1, "Alpha"), proj(2, "Beta"), proj(3, "Gamma")],
      wide,
    );
    expect(out).toEqual([
      ["Alpha", ["doc-1"]],
      ["(no project)", ["doc-2"]],
      ["Beta", []],
      ["Gamma", []],
    ]);
  });

  it("keeps the order the API returned them in", () => {
    const out = withDocumentlessProjects(
      [],
      [proj(9, "Zed"), proj(2, "Ann"), proj(5, "Mid")],
      wide,
    );
    expect(out.map(([name]) => name)).toEqual(["Zed", "Ann", "Mid"]);
  });

  it("shows a fresh install: no documents at all, one registered project", () => {
    expect(withDocumentlessProjects([], [proj(1, "Only")], wide)).toEqual([
      ["Only", []],
    ]);
  });

  it("skips projects that already have a group", () => {
    const out = withDocumentlessProjects(groups, [proj(1, "Alpha")], wide);
    expect(out).toBe(groups);
  });

  it("skips unregistered names and rows without an id", () => {
    const out = withDocumentlessProjects(
      [],
      [proj(null, "FromDocsOnly", false), proj(null, "NoId", true), proj(4, "Ghost", false)],
      wide,
    );
    expect(out).toEqual([]);
  });

  it("does not add the same name twice", () => {
    const out = withDocumentlessProjects(
      [],
      [proj(1, "Dup"), proj(2, "Dup")],
      wide,
    );
    expect(out).toEqual([["Dup", []]]);
  });

  it("returns the groups unchanged when narrowed", () => {
    const out = withDocumentlessProjects(groups, [proj(2, "Beta")], {
      narrowed: true,
    });
    expect(out).toBe(groups);
  });

  it("returns an empty list when narrowed and there are no groups", () => {
    expect(
      withDocumentlessProjects([], [proj(2, "Beta")], { narrowed: true }),
    ).toEqual([]);
  });

  describe("?projects= filter", () => {
    const projects = [proj(1, "Alpha"), proj(2, "Beta"), proj(3, "Gamma")];

    it("keeps only the documentless projects whose id is selected", () => {
      const out = withDocumentlessProjects([], projects, {
        narrowed: false,
        urlFilter: { ids: [3, 1] },
      });
      expect(out).toEqual([
        ["Alpha", []],
        ["Gamma", []],
      ]);
    });

    it("hides every documentless project for an explicit empty selection", () => {
      const out = withDocumentlessProjects([], projects, {
        narrowed: false,
        urlFilter: { ids: [] },
      });
      expect(out).toEqual([]);
    });

    it("treats an absent filter as no filter", () => {
      const out = withDocumentlessProjects([], projects, {
        narrowed: false,
        urlFilter: null,
      });
      expect(out.map(([name]) => name)).toEqual(["Alpha", "Beta", "Gamma"]);
    });

    it("leaves narrowed lists alone whatever the filter says", () => {
      const out = withDocumentlessProjects(groups, projects, {
        narrowed: true,
        urlFilter: { ids: [1, 2, 3] },
      });
      expect(out).toBe(groups);
    });
  });
});
