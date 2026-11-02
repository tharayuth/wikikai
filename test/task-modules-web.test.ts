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

describe("module and column routes", () => {
  let dir: string;
  let server: Server;
  let tasks: TaskStore;
  let alpha: number;
  let beta: number;
  let alice: string;
  let carol: string;
  let dave: string;

  const api = () => request(server);

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "wikikai-module-web-"));
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
    server = buildApp({
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
    }).listen(0);

    const admin = users.create({ email: "admin@x.test", password: "pw", display_name: "Admin", is_admin: true });
    const a = users.create({ email: "alice@x.test", password: "pw", display_name: "Alice" });
    const c = users.create({ email: "carol@x.test", password: "pw", display_name: "Carol" });
    users.create({ email: "dave@x.test", password: "pw", display_name: "Dave" });
    knowledge.registerProject("alpha");
    knowledge.registerProject("beta");
    permissions.replaceForUser(a.id, [{ project: "alpha", level: "edit" }], admin.id);
    permissions.replaceForUser(c.id, [{ project: "alpha", level: "view" }], admin.id);
    alpha = tasks.ensureProject("alpha").id;
    beta = tasks.ensureProject("beta").id;

    const login = async (email: string): Promise<string> => {
      const res = await api().post("/api/auth/login").send({ email, password: "pw" });
      return res.headers["set-cookie"][0];
    };
    alice = await login("alice@x.test");
    carol = await login("carol@x.test");
    dave = await login("dave@x.test");
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const general = (): number => tasks.modules.list(alpha)[0].id;

  it("refuses anonymous callers", async () => {
    expect((await api().get(`/api/projects/${alpha}/modules`)).status).toBe(401);
    expect((await api().post(`/api/modules/${general()}/columns`).send({ name: "QA", status: "review" })).status).toBe(401);
  });

  it("lists modules with custom columns only, and can_edit for the caller", async () => {
    tasks.modules.addColumn(general(), { name: "QA", status: "review" });
    tasks.add(alpha, { title: "T" });
    const res = await api().get(`/api/projects/${alpha}/modules`).set("Cookie", alice);
    expect(res.status).toBe(200);
    expect(res.body.can_edit).toBe(true);
    expect(res.body.modules).toEqual([
      expect.objectContaining({
        name: "General",
        task_count: 1,
        columns: [expect.objectContaining({ name: "QA", status: "review", position: 1 })],
      }),
    ]);
    const view = await api().get(`/api/projects/${alpha}/modules`).set("Cookie", carol);
    expect(view.status).toBe(200);
    expect(view.body.can_edit).toBe(false);
  });

  it("answers 404 for an unknown project, module or column", async () => {
    expect((await api().get(`/api/projects/999/modules`).set("Cookie", alice)).status).toBe(404);
    expect((await api().patch(`/api/modules/999`).set("Cookie", alice).send({ name: "x" })).status).toBe(404);
    expect((await api().delete(`/api/columns/999`).set("Cookie", alice)).status).toBe(404);
    expect((await api().post(`/api/modules/999/columns`).set("Cookie", alice).send({ name: "x", status: "todo" })).status).toBe(404);
  });

  it("refuses a viewer every structural change", async () => {
    const module = general();
    const column = tasks.modules.addColumn(module, { name: "QA", status: "review" });
    const calls = [
      api().post(`/api/projects/${alpha}/modules`).send({ name: "B" }),
      api().patch(`/api/modules/${module}`).send({ name: "B" }),
      api().delete(`/api/modules/${module}`),
      api().post(`/api/modules/${module}/columns`).send({ name: "B", status: "todo" }),
      api().patch(`/api/columns/${column.id}`).send({ name: "B" }),
      api().delete(`/api/columns/${column.id}`),
    ];
    for (const call of calls) expect((await call.set("Cookie", carol)).status).toBe(403);
  });

  it("refuses a non-member by module and column id", async () => {
    const module = general();
    const column = tasks.modules.addColumn(module, { name: "QA", status: "review" });
    expect((await api().get(`/api/projects/${alpha}/modules`).set("Cookie", dave)).status).toBe(403);
    expect((await api().patch(`/api/modules/${module}`).set("Cookie", dave).send({ name: "B" })).status).toBe(403);
    expect((await api().patch(`/api/columns/${column.id}`).set("Cookie", dave).send({ name: "B" })).status).toBe(403);
  });

  it("answers 201, 400 and 409 when adding a module", async () => {
    const add = (name: string) => api().post(`/api/projects/${alpha}/modules`).set("Cookie", alice).send({ name });
    const created = await add("Backend");
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: "Backend", project_id: alpha });
    expect((await add("   ")).status).toBe(400);
    expect((await add("backend")).status).toBe(409);
  });

  it("renames and moves with PATCH, and needs one of them", async () => {
    const b = tasks.modules.addModule(alpha, "B");
    const patch = (body: object) => api().patch(`/api/modules/${b.id}`).set("Cookie", alice).send(body);
    expect((await patch({})).status).toBe(400);
    expect((await patch({ move: "up" })).status).toBe(400);
    expect((await patch({ name: "C" })).body.name).toBe("C");
    expect((await patch({ move: "left" })).status).toBe(200);
    expect(tasks.modules.list(alpha).map((m) => m.name)).toEqual(["C", "General"]);
  });

  it("answers 409 when deleting a module with tasks or the last one", async () => {
    const b = tasks.modules.addModule(alpha, "B");
    tasks.add(alpha, { title: "T", module_id: b.id });
    expect((await api().delete(`/api/modules/${b.id}`).set("Cookie", alice)).status).toBe(409);
    const emptied = tasks.modules.addModule(alpha, "C");
    expect((await api().delete(`/api/modules/${emptied.id}`).set("Cookie", alice)).status).toBe(200);
    const onlyOne = tasks.modules.list(beta)[0].id;
    expect((await api().delete(`/api/modules/${onlyOne}`).set("Cookie", await adminCookie())).status).toBe(409);
  });

  const adminCookie = async (): Promise<string> => {
    const res = await api().post("/api/auth/login").send({ email: "admin@x.test", password: "pw" });
    return res.headers["set-cookie"][0];
  };

  it("answers 201, 400 and 409 when adding a column", async () => {
    const add = (body: object) => api().post(`/api/modules/${general()}/columns`).set("Cookie", alice).send(body);
    const created = await add({ name: "QA", status: "review" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: "QA", status: "review" });
    expect((await add({ name: "Todo", status: "todo" })).status).toBe(400);
    expect((await add({ name: "Nope", status: "later" })).status).toBe(400);
    expect((await add({ name: "qa", status: "doing" })).status).toBe(409);
  });

  it("deletes a column and keeps its cards", async () => {
    const column = tasks.modules.addColumn(general(), { name: "QA", status: "review" });
    const t = tasks.add(alpha, { title: "T", column_id: column.id });
    expect((await api().delete(`/api/columns/${column.id}`).set("Cookie", alice)).status).toBe(200);
    expect(tasks.get(t.id)).toMatchObject({ column_id: null, status: "review" });
  });

  it("creates, filters, edits and moves tasks by module and column", async () => {
    const b = tasks.modules.addModule(alpha, "B");
    const qa = tasks.modules.addColumn(b.id, { name: "QA", status: "review" });
    const created = await api()
      .post(`/api/projects/${alpha}/tasks`)
      .set("Cookie", alice)
      .send({ title: "T", module_id: b.id, column_id: qa.id });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ module_id: b.id, module: "B", column_id: qa.id, column: "QA", status: "review" });
    tasks.add(alpha, { title: "Other" });

    const filtered = await api().get(`/api/projects/${alpha}/tasks?module_id=${b.id}`).set("Cookie", alice);
    expect(filtered.body.tasks.map((t: { title: string }) => t.title)).toEqual(["T"]);

    const edited = await api()
      .patch(`/api/tasks/${created.body.id}`)
      .set("Cookie", alice)
      .send({ expected_version: created.body.version, column_id: null });
    expect(edited.body).toMatchObject({ column_id: null, column: "Review", version: created.body.version });

    const moved = await api()
      .post(`/api/tasks/${created.body.id}/move`)
      .set("Cookie", alice)
      .send({ status: "review", column_id: qa.id, before_id: null, expected_version: 99 });
    expect(moved.status).toBe(200);
    expect(moved.body.column_id).toBe(qa.id);
  });

  it("answers 400 for a body id from another project, or a status against the column", async () => {
    const other = tasks.modules.list(beta)[0];
    const otherColumn = tasks.modules.addColumn(other.id, { name: "QA", status: "review" });
    const qa = tasks.modules.addColumn(general(), { name: "QA", status: "review" });
    const post = (body: object) => api().post(`/api/projects/${alpha}/tasks`).set("Cookie", alice).send(body);
    expect((await post({ title: "T", module_id: other.id })).status).toBe(400);
    expect((await post({ title: "T", column_id: otherColumn.id })).status).toBe(400);
    expect((await post({ title: "T", column_id: 999 })).status).toBe(400);
    expect((await post({ title: "T", column_id: qa.id, status: "doing" })).status).toBe(400);
  });
});
