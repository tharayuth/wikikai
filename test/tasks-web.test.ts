import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import request from "supertest";
import { openDb } from "../src/store/db.js";
import { ActivityLogStore } from "../src/store/activityLog.js";
import { ImageStore } from "../src/store/images.js";
import { KnowledgeStore } from "../src/store/knowledge.js";
import { PageStore } from "../src/store/pages.js";
import { PermissionStore } from "../src/store/permissions.js";
import { PromptLogStore } from "../src/store/promptLog.js";
import { ShareUserStore } from "../src/store/shareUsers.js";
import { TaskStore } from "../src/store/tasks.js";
import { SessionStore, UserStore } from "../src/store/users.js";
import { buildToolHandlers } from "../src/mcp/handlers.js";
import { buildApp } from "../src/web/app.js";

describe("task routes", () => {
  let dir: string;
  let server: Server;
  let tasks: TaskStore;
  let projectId: number;
  let adminCookie: string;
  let aliceCookie: string;
  let carolCookie: string;
  let daveCookie: string;

  const api = () => request(server);

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "wikikai-task-web-"));
    const db = openDb(":memory:");
    const knowledge = new KnowledgeStore(db);
    const pages = new PageStore(db, path.join(dir, "items"));
    const images = new ImageStore(db, path.join(dir, "images"));
    const promptLog = new PromptLogStore(db);
    const activityLog = new ActivityLogStore(db);
    const users = new UserStore(db);
    const sessions = new SessionStore(db, users);
    const permissions = new PermissionStore(db);
    const handlers = buildToolHandlers(
      knowledge,
      pages,
      images,
      promptLog,
      activityLog,
      { publicBaseUrl: "http://test" },
      permissions,
      users,
      db,
    );
    tasks = new TaskStore(db, activityLog);
    const app = buildApp({
      knowledge,
      pages,
      images,
      promptLog,
      activityLog,
      users,
      sessions,
      permissions,
      shareUsers: new ShareUserStore(db),
      handlers,
      publicBaseUrl: "http://test",
      webAuth: true,
      tasks,
    });
    server = app.listen(0);

    const admin = users.create({ email: "admin@x.test", password: "pw", display_name: "Admin", is_admin: true });
    const alice = users.create({ email: "alice@x.test", password: "pw", display_name: "Alice" });
    const carol = users.create({ email: "carol@x.test", password: "pw", display_name: "Carol" });
    users.create({ email: "dave@x.test", password: "pw", display_name: "Dave" });
    knowledge.registerProject("alpha");
    permissions.replaceForUser(alice.id, [{ project: "alpha", level: "edit" }], admin.id);
    permissions.replaceForUser(carol.id, [{ project: "alpha", level: "view" }], admin.id);
    projectId = tasks.ensureProject("alpha").id;

    const login = async (email: string): Promise<string> => {
      const res = await api().post("/api/auth/login").send({ email, password: "pw" });
      return res.headers["set-cookie"][0];
    };
    adminCookie = await login("admin@x.test");
    aliceCookie = await login("alice@x.test");
    carolCookie = await login("carol@x.test");
    daveCookie = await login("dave@x.test");
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("refuses anonymous callers", async () => {
    expect((await api().get(`/api/projects/${projectId}/tasks`)).status).toBe(401);
    expect((await api().post(`/api/projects/${projectId}/tasks`).send({ title: "T" })).status).toBe(401);
  });

  it("lists rows for the views, with can_edit for the caller", async () => {
    tasks.add(projectId, { title: "T", description: "Body", start_date: "2026-11-01" });
    const edit = await api().get(`/api/projects/${projectId}/tasks`).set("Cookie", aliceCookie);
    expect(edit.status).toBe(200);
    expect(edit.body.project).toEqual({ id: projectId, name: "alpha" });
    expect(edit.body.can_edit).toBe(true);
    expect(edit.body.tasks[0]).toMatchObject({ title: "T", start_date: "2026-11-01", position: 1 });
    expect(edit.body.tasks[0].updated_at).toEqual(expect.any(String));
    expect(edit.body.tasks[0]).not.toHaveProperty("description");
    const view = await api().get(`/api/projects/${projectId}/tasks`).set("Cookie", carolCookie);
    expect(view.body.can_edit).toBe(false);
    const admin = await api().get(`/api/projects/${projectId}/tasks`).set("Cookie", adminCookie);
    expect(admin.body.can_edit).toBe(true);
  });

  it("includes done tasks, and archived ones only on request", async () => {
    tasks.add(projectId, { title: "Done", status: "done" });
    const gone = tasks.add(projectId, { title: "Gone" });
    tasks.edit(gone.id, { expected_version: 1, archived: true });
    const plain = await api().get(`/api/projects/${projectId}/tasks`).set("Cookie", aliceCookie);
    expect(plain.body.tasks.map((t: { title: string }) => t.title)).toEqual(["Done"]);
    const all = await api()
      .get(`/api/projects/${projectId}/tasks`)
      .query({ include_archived: 1 })
      .set("Cookie", aliceCookie);
    expect(all.body.tasks).toHaveLength(2);
  });

  it("answers 404 for an unknown project or task", async () => {
    expect((await api().get("/api/projects/9999/tasks").set("Cookie", adminCookie)).status).toBe(404);
    expect((await api().get("/api/projects/9999/members").set("Cookie", adminCookie)).status).toBe(404);
    expect((await api().post("/api/projects/9999/tasks").set("Cookie", adminCookie).send({ title: "T" })).status).toBe(404);
    expect((await api().get("/api/tasks/9999").set("Cookie", adminCookie)).status).toBe(404);
    expect((await api().get("/api/tasks/9999/rendered").set("Cookie", adminCookie)).status).toBe(404);
    expect(
      (await api().patch("/api/tasks/9999").set("Cookie", adminCookie).send({ expected_version: 1, title: "X" })).status,
    ).toBe(404);
  });

  it("creates a task with edit access only", async () => {
    const made = await api().post(`/api/projects/${projectId}/tasks`).set("Cookie", aliceCookie).send({ title: "T" });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ title: "T", status: "todo", version: 1 });
    expect((await api().post(`/api/projects/${projectId}/tasks`).set("Cookie", carolCookie).send({ title: "X" })).status).toBe(403);
    expect((await api().post(`/api/projects/${projectId}/tasks`).set("Cookie", daveCookie).send({ title: "X" })).status).toBe(403);
  });

  it("adds a titled task to the default board's Todo, on a day when one is given", async () => {
    const res = await api()
      .post(`/api/projects/${projectId}/tasks`)
      .set("Cookie", aliceCookie)
      .send({ title: "T", start_date: "2026-11-20", due_date: "2026-11-20" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: "todo",
      column_id: null,
      module_id: tasks.modules.firstModule(projectId).id,
      start_date: "2026-11-20",
      due_date: "2026-11-20",
    });
  });

  it("refuses non-members by task id", async () => {
    const t = tasks.add(projectId, { title: "T" });
    expect((await api().get(`/api/tasks/${t.id}`).set("Cookie", daveCookie)).status).toBe(403);
    expect((await api().get(`/api/tasks/${t.id}/rendered`).set("Cookie", daveCookie)).status).toBe(403);
    expect(
      (await api().patch(`/api/tasks/${t.id}`).set("Cookie", daveCookie).send({ expected_version: 1, title: "X" })).status,
    ).toBe(403);
    expect(
      (await api().post(`/api/tasks/${t.id}/move`).set("Cookie", carolCookie).send({ status: "doing", before_id: null, expected_version: 1 })).status,
    ).toBe(403);
  });

  it("answers 409 with the current version for a stale edit", async () => {
    const t = tasks.add(projectId, { title: "T" });
    tasks.edit(t.id, { expected_version: 1, title: "Changed" });
    const res = await api().patch(`/api/tasks/${t.id}`).set("Cookie", aliceCookie).send({ expected_version: 1, title: "Mine" });
    expect(res.status).toBe(409);
    expect(res.body.current_version).toBe(2);
    expect(res.body.error).toContain("STALE");
  });

  it("requires expected_version on PATCH", async () => {
    const t = tasks.add(projectId, { title: "T" });
    expect((await api().patch(`/api/tasks/${t.id}`).set("Cookie", aliceCookie).send({ title: "X" })).status).toBe(400);
  });

  it("moves a task, answering 409 only when the status change is stale", async () => {
    const a = tasks.add(projectId, { title: "A" });
    const b = tasks.add(projectId, { title: "B" });
    const reorder = await api()
      .post(`/api/tasks/${b.id}/move`)
      .set("Cookie", aliceCookie)
      .send({ status: "todo", before_id: a.id, expected_version: 999 });
    expect(reorder.status).toBe(200);
    expect(reorder.body.position).toBe(1);
    const stale = await api()
      .post(`/api/tasks/${a.id}/move`)
      .set("Cookie", aliceCookie)
      .send({ status: "doing", before_id: null, expected_version: 999 });
    expect(stale.status).toBe(409);
  });

  it.each(["javascript:alert(1)", "//evil.test"])("refuses the link %j", async (url) => {
    const res = await api()
      .post(`/api/projects/${projectId}/tasks`)
      .set("Cookie", aliceCookie)
      .send({ title: "T", links: [{ url }] });
    expect(res.status).toBe(400);
  });

  it("reports open tasks on the project list, only to callers who see the project", async () => {
    tasks.add(projectId, { title: "Open", due_date: "2026-11-01" });
    tasks.add(projectId, { title: "Finished", status: "done", due_date: "2020-01-01" });
    const alpha = (await api().get("/api/projects").set("Cookie", carolCookie)).body.projects.find(
      (p: { name: string }) => p.name === "alpha",
    );
    expect(alpha).toMatchObject({
      open_tasks: 1,
      done_tasks: 1,
      earliest_due: "2026-11-01",
      earliest_start: "2026-11-01",
    });
    const seenByDave = (await api().get("/api/projects").set("Cookie", daveCookie)).body.projects;
    expect(seenByDave.some((p: { name: string }) => p.name === "alpha")).toBe(false);
  });

  it("lists assignable members by id and display name only", async () => {
    const res = await api().get(`/api/projects/${projectId}/members`).set("Cookie", carolCookie);
    expect(res.status).toBe(200);
    expect(res.body.members.map((m: { display_name: string }) => m.display_name)).toEqual(["Admin", "Alice"]);
    expect(Object.keys(res.body.members[0]).sort()).toEqual(["display_name", "id"]);
    expect(JSON.stringify(res.body)).not.toContain("@x.test");
    expect((await api().get(`/api/projects/${projectId}/members`).set("Cookie", daveCookie)).status).toBe(403);
  });

  it("renders the description with the no-transform header", async () => {
    const t = tasks.add(projectId, { title: "T", description: "**bold**" });
    const res = await api().get(`/api/tasks/${t.id}/rendered`).set("Cookie", carolCookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain("<strong>bold</strong>");
    expect(res.headers["cache-control"]).toContain("no-transform");
  });

  it("lets only an admin delete, and only an archived task", async () => {
    const t = tasks.add(projectId, { title: "T" });
    expect((await api().delete(`/api/tasks/${t.id}`).set("Cookie", aliceCookie)).status).toBe(403);
    expect((await api().delete(`/api/tasks/${t.id}`).set("Cookie", adminCookie)).status).toBe(409);
    tasks.edit(t.id, { expected_version: 1, archived: true });
    expect((await api().delete(`/api/tasks/${t.id}`).set("Cookie", adminCookie)).status).toBe(200);
    expect(tasks.get(t.id)).toBeNull();
  });

  it("answers 409 when unregistering a project that has tasks", async () => {
    tasks.add(projectId, { title: "T" });
    const res = await api().delete("/api/projects/alpha").set("Cookie", adminCookie);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/1 task/);
  });
});
