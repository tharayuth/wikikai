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
import { NoteStore } from "../src/store/notes.js";
import { PageStore } from "../src/store/pages.js";
import { PermissionStore } from "../src/store/permissions.js";
import { PromptLogStore } from "../src/store/promptLog.js";
import { ShareUserStore } from "../src/store/shareUsers.js";
import { TaskStore } from "../src/store/tasks.js";
import { SessionStore, UserStore } from "../src/store/users.js";
import { buildToolHandlers } from "../src/mcp/handlers.js";
import { buildApp } from "../src/web/app.js";

describe("note routes", () => {
  let dir: string;
  let server: Server;
  let notes: NoteStore;
  let alpha: number;
  let admin: string;
  let alice: string;
  let carol: string;
  let dave: string;

  const api = () => request(server);

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "wikikai-note-web-"));
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
    const tasks = new TaskStore(db, activityLog);
    notes = new NoteStore(db, activityLog);
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
      notes,
    }).listen(0);

    const a = users.create({ email: "admin@x.test", password: "pw", display_name: "Admin", is_admin: true });
    const al = users.create({ email: "alice@x.test", password: "pw", display_name: "Alice" });
    const c = users.create({ email: "carol@x.test", password: "pw", display_name: "Carol" });
    users.create({ email: "dave@x.test", password: "pw", display_name: "Dave" });
    knowledge.registerProject("alpha");
    permissions.replaceForUser(al.id, [{ project: "alpha", level: "edit" }], a.id);
    permissions.replaceForUser(c.id, [{ project: "alpha", level: "view" }], a.id);
    alpha = tasks.ensureProject("alpha").id;

    const login = async (email: string): Promise<string> => {
      const res = await api().post("/api/auth/login").send({ email, password: "pw" });
      return res.headers["set-cookie"][0];
    };
    admin = await login("admin@x.test");
    alice = await login("alice@x.test");
    carol = await login("carol@x.test");
    dave = await login("dave@x.test");
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("refuses anonymous callers", async () => {
    expect((await api().get(`/api/projects/${alpha}/notes`)).status).toBe(401);
    expect((await api().post(`/api/projects/${alpha}/notes`).send({ title: "T" })).status).toBe(401);
  });

  it("lists notes by state, with can_edit for the caller", async () => {
    notes.add(alpha, { title: "Active" });
    const archived = notes.add(alpha, { title: "Archived" });
    notes.edit(archived.id, { archived: true });
    const edit = await api().get(`/api/projects/${alpha}/notes`).set("Cookie", alice);
    expect(edit.status).toBe(200);
    expect(edit.body.can_edit).toBe(true);
    expect(edit.body.notes.map((n: { title: string }) => n.title)).toEqual(["Active"]);
    const view = await api().get(`/api/projects/${alpha}/notes?state=archived`).set("Cookie", carol);
    expect(view.body.can_edit).toBe(false);
    expect(view.body.notes.map((n: { title: string }) => n.title)).toEqual(["Archived"]);
  });

  it("answers 400 for an unknown state, and 404 for an unknown project or note", async () => {
    expect((await api().get(`/api/projects/${alpha}/notes?state=nope`).set("Cookie", alice)).status).toBe(400);
    expect((await api().get(`/api/projects/999/notes`).set("Cookie", alice)).status).toBe(404);
    expect((await api().get(`/api/notes/999`).set("Cookie", alice)).status).toBe(404);
    expect((await api().patch(`/api/notes/999`).set("Cookie", alice).send({ color: "red" })).status).toBe(404);
  });

  it("refuses a viewer every change", async () => {
    const n = notes.add(alpha, { items: [{ text: "A", checked: false }] });
    const calls = [
      api().post(`/api/projects/${alpha}/notes`).send({ title: "T" }),
      api().patch(`/api/notes/${n.id}`).send({ color: "red" }),
      api().post(`/api/notes/${n.id}/items/1`).send({ checked: true }),
      api().post(`/api/notes/${n.id}/move`).send({ before_id: null }),
      api().delete(`/api/notes/${n.id}`),
    ];
    for (const call of calls) expect((await call.set("Cookie", carol)).status).toBe(403);
    expect((await api().get(`/api/notes/${n.id}`).set("Cookie", carol)).status).toBe(200);
  });

  it("refuses a non-member by project and by note id", async () => {
    const n = notes.add(alpha, { title: "T" });
    expect((await api().get(`/api/projects/${alpha}/notes`).set("Cookie", dave)).status).toBe(403);
    expect((await api().get(`/api/notes/${n.id}`).set("Cookie", dave)).status).toBe(403);
    expect((await api().patch(`/api/notes/${n.id}`).set("Cookie", dave).send({ color: "red" })).status).toBe(403);
  });

  it("creates with 201, and answers 400 for an empty note", async () => {
    const post = (body: object) => api().post(`/api/projects/${alpha}/notes`).set("Cookie", alice).send(body);
    const created = await post({ title: "T", color: "blue", labels: ["a"], pinned: true });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ title: "T", color: "blue", labels: ["a"], pinned: true });
    expect((await post({ title: " " })).status).toBe(400);
    expect((await post({ title: "T", color: "pink" })).status).toBe(400);
  });

  it("answers 409 with the current version for a stale edit", async () => {
    const n = notes.add(alpha, { title: "T" });
    notes.edit(n.id, { expected_version: 1, body: "Theirs" });
    const res = await api().patch(`/api/notes/${n.id}`).set("Cookie", alice).send({ expected_version: 1, body: "Mine" });
    expect(res.status).toBe(409);
    expect(res.body.current_version).toBe(2);
  });

  it("toggles an item and moves a note", async () => {
    const a = notes.add(alpha, { items: [{ text: "A", checked: false }] });
    const b = notes.add(alpha, { title: "B" });
    const toggled = await api().post(`/api/notes/${a.id}/items/1`).set("Cookie", alice).send({ checked: true });
    expect(toggled.body.items[0].checked).toBe(true);
    expect((await api().post(`/api/notes/${a.id}/items/9`).set("Cookie", alice).send({ checked: true })).status).toBe(404);
    const moved = await api().post(`/api/notes/${a.id}/move`).set("Cookie", alice).send({ before_id: b.id });
    expect(moved.status).toBe(200);
    expect(notes.list(alpha).map((n) => n.id)).toEqual([a.id, b.id]);
  });

  it("lets a member delete only from the trash", async () => {
    const n = notes.add(alpha, { title: "T" });
    expect((await api().delete(`/api/notes/${n.id}`).set("Cookie", alice)).status).toBe(409);
    notes.edit(n.id, { trashed: true });
    expect((await api().patch(`/api/notes/${n.id}`).set("Cookie", alice).send({ color: "red" })).status).toBe(409);
    expect((await api().delete(`/api/notes/${n.id}`).set("Cookie", alice)).status).toBe(200);
    expect(notes.get(n.id)).toBeNull();
  });

  it("answers 409 when unregistering a project that has notes", async () => {
    notes.add(alpha, { title: "T" });
    const res = await api().delete("/api/projects/alpha").set("Cookie", admin);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/1 note/);
  });
});
