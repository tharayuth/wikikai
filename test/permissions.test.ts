import { describe, expect, it } from "vitest";
import { openDb } from "../src/store/db.js";

describe("project_permissions table", () => {
  it("exists with the expected columns", () => {
    const db = openDb(":memory:");
    const cols = db
      .prepare("PRAGMA table_info(project_permissions)")
      .all() as Array<{ name: string; type: string; notnull: number }>;
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(
      ["granted_at", "granted_by", "level", "project_name", "user_id"].sort(),
    );
  });
});
