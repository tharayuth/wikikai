import { describe, expect, it } from "vitest";
import { openDb } from "../src/store/db.js";
import { PermissionStore } from "../src/store/permissions.js";
import { UserStore } from "../src/store/users.js";

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

describe("PermissionStore", () => {
  function setup() {
    const db = openDb(":memory:");
    const users = new UserStore(db);
    users.create({ email: "admin", password: "x", display_name: "Admin", is_admin: true });
    const alice = users.create({ email: "alice", password: "x", display_name: "Alice" });
    db.prepare("INSERT INTO projects (name, created_at) VALUES (?, ?)").run(
      "examples", new Date().toISOString(),
    );
    db.prepare("INSERT INTO projects (name, created_at) VALUES (?, ?)").run(
      "secret", new Date().toISOString(),
    );
    return { db, users, alice };
  }

  it("get() returns null when no row", () => {
    const { db, alice } = setup();
    const perms = new PermissionStore(db);
    expect(perms.get(alice.id, "examples")).toBeNull();
  });

  it("replaceForUser inserts rows + get() returns them", () => {
    const { db, alice } = setup();
    const perms = new PermissionStore(db);
    perms.replaceForUser(alice.id, [
      { project: "examples", level: "view" },
      { project: "secret", level: "edit" },
    ], /* granted_by */ 1);
    expect(perms.get(alice.id, "examples")).toEqual({ level: "view" });
    expect(perms.get(alice.id, "secret")).toEqual({ level: "edit" });
  });

  it("replaceForUser is atomic — replaces the whole set", () => {
    const { db, alice } = setup();
    const perms = new PermissionStore(db);
    perms.replaceForUser(alice.id, [
      { project: "examples", level: "view" },
      { project: "secret", level: "edit" },
    ], 1);
    perms.replaceForUser(alice.id, [
      { project: "examples", level: "edit" }, // upgrade
      // secret omitted → revoked
    ], 1);
    expect(perms.get(alice.id, "examples")).toEqual({ level: "edit" });
    expect(perms.get(alice.id, "secret")).toBeNull();
  });

  it("listForUser returns sorted rows", () => {
    const { db, alice } = setup();
    const perms = new PermissionStore(db);
    perms.replaceForUser(alice.id, [
      { project: "secret", level: "edit" },
      { project: "examples", level: "view" },
    ], 1);
    expect(perms.listForUser(alice.id)).toEqual([
      { project: "examples", level: "view" },
      { project: "secret", level: "edit" },
    ]);
  });

  it("listVisibleProjects: admin → all known projects, non-admin → granted set", () => {
    const { db, alice } = setup();
    const perms = new PermissionStore(db);
    perms.replaceForUser(alice.id, [{ project: "examples", level: "view" }], 1);
    expect(perms.listVisibleProjects(alice.id, /* is_admin */ false)).toEqual([
      "examples",
    ]);
    expect(perms.listVisibleProjects(1, true).sort()).toEqual(
      ["examples", "secret"].sort(),
    );
  });
});
