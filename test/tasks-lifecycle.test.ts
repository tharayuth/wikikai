import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../src/store/db.js";
import { ActivityLogStore } from "../src/store/activityLog.js";
import { FileStore } from "../src/store/files.js";
import { ImageStore } from "../src/store/images.js";
import { KnowledgeStore, ProjectHasTasksError } from "../src/store/knowledge.js";
import { sweepOrphanedAssets } from "../src/store/orphanGc.js";
import { PageStore } from "../src/store/pages.js";
import { PermissionStore } from "../src/store/permissions.js";
import { TaskStore } from "../src/store/tasks.js";
import { UserStore } from "../src/store/users.js";

describe("tasks and the things around them", () => {
  let dir: string;
  let db: ReturnType<typeof openDb>;
  let knowledge: KnowledgeStore;
  let tasks: TaskStore;
  let projectId: number;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "wikikai-tasks-"));
    db = openDb(":memory:");
    knowledge = new KnowledgeStore(db);
    knowledge.registerProject("alpha");
    tasks = new TaskStore(db, new ActivityLogStore(db));
    projectId = tasks.ensureProject("alpha").id;
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  describe("attachments", () => {
    it("keeps a file used only by a task, archived or not, until the task is deleted", () => {
      const pages = new PageStore(db, path.join(dir, "items"));
      const images = new ImageStore(db, path.join(dir, "images"));
      const files = new FileStore(db, path.join(dir, "files"));
      const meta = files.add(Buffer.from("report"), "report.txt", "text/plain");
      const sweep = () => sweepOrphanedAssets({ db, pages, images, files, graceMs: 0 });

      const t = tasks.add(projectId, {
        title: "T",
        description: `[report](/file/${meta.hash}.${meta.ext})`,
      });
      expect(sweep().removed_files).toBe(0);
      expect(files.get(meta.hash)).not.toBeNull();

      tasks.edit(t.id, { expected_version: 1, archived: true });
      expect(sweep().removed_files).toBe(0);
      expect(files.get(meta.hash)).not.toBeNull();

      tasks.remove(t.id);
      expect(sweep().removed_files).toBe(1);
      expect(files.get(meta.hash)).toBeNull();
    });
  });

  describe("unregistering a project", () => {
    it("refuses while tasks exist, counting archived ones, and keeps everything", () => {
      const t = tasks.add(projectId, { title: "T" });
      tasks.add(projectId, { title: "U" });
      tasks.edit(t.id, { expected_version: 1, archived: true });
      expect(() => knowledge.unregisterProject("alpha")).toThrow(ProjectHasTasksError);
      expect(() => knowledge.unregisterProject("alpha")).toThrow(/2 task/);
      expect(tasks.getProject(projectId)?.name).toBe("alpha");
      expect(tasks.list(projectId, { includeArchived: true })).toHaveLength(2);
    });

    it("has the foreign key as a backstop", () => {
      tasks.add(projectId, { title: "T" });
      expect(() => db.prepare("DELETE FROM projects WHERE id = ?").run(projectId)).toThrow(/FOREIGN KEY/);
    });

    it("still works once the tasks are gone, or for a project with none", () => {
      const t = tasks.add(projectId, { title: "T" });
      tasks.edit(t.id, { expected_version: 1, archived: true });
      tasks.remove(t.id);
      expect(knowledge.unregisterProject("alpha")).toEqual({ name: "alpha", removed: true });
    });
  });

  describe("renaming a project", () => {
    it("keeps its tasks, and access follows the new name", () => {
      const users = new UserStore(db);
      const admin = users.create({ email: "a@x.test", password: "x", display_name: "Admin", is_admin: true });
      const alice = users.create({ email: "b@x.test", password: "x", display_name: "Alice" });
      new PermissionStore(db).replaceForUser(alice.id, [{ project: "alpha", level: "edit" }], admin.id);
      const t = tasks.add(projectId, { title: "T", assignee_id: alice.id });

      knowledge.renameProject("alpha", "gamma");

      expect(tasks.get(t.id)).toMatchObject({ project: "gamma", project_id: projectId });
      expect(tasks.listMembers("gamma").map((m) => m.display_name)).toContain("Alice");
      expect(tasks.edit(t.id, { expected_version: 1, assignee_id: alice.id }).assignee?.id).toBe(alice.id);
    });
  });
});
