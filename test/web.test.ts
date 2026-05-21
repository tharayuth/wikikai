import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { openDb } from "../src/store/db.js";
import { KnowledgeStore } from "../src/store/knowledge.js";
import { PageStore } from "../src/store/pages.js";
import { ImageStore } from "../src/store/images.js";
import { PromptLogStore } from "../src/store/promptLog.js";
import { ActivityLogStore } from "../src/store/activityLog.js";
import { SessionStore, UserStore } from "../src/store/users.js";
import { PermissionStore } from "../src/store/permissions.js";
import { buildToolHandlers } from "../src/mcp/handlers.js";
import { buildApp } from "../src/web/app.js";

describe("HTTP routes", () => {
  let tmpDir: string;
  let knowledge: KnowledgeStore;
  let pages: PageStore;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aim-web-"));
    const db = openDb(":memory:");
    knowledge = new KnowledgeStore(db);
    pages = new PageStore(db, tmpDir);
    const images = new ImageStore(db, path.join(tmpDir, "images"));
    const promptLog = new PromptLogStore(db);
    const activityLog = new ActivityLogStore(db);
    const users = new UserStore(db);
    const sessions = new SessionStore(db, users);
    const permissions = new PermissionStore(db);
    const handlers = buildToolHandlers(knowledge, pages, images, promptLog, activityLog, { publicBaseUrl: "http://test" }, permissions);
    app = buildApp({ knowledge, pages, images, promptLog, activityLog, users, sessions, permissions, handlers, publicBaseUrl: "http://test" });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("auth (opt-in)", () => {
    it("/api/auth/me returns null user when no session", async () => {
      const res = await request(app).get("/api/auth/me");
      expect(res.status).toBe(200);
      expect(res.body.user).toBeNull();
      expect(res.body.auth_enabled).toBe(false);
    });

    it("admin CRUD + last-admin guard", async () => {
      const db = openDb(":memory:");
      const knowledge = new KnowledgeStore(db);
      const pages = new PageStore(db, tmpDir);
      const images = new ImageStore(db, path.join(tmpDir, "ad-images"));
      const promptLog = new PromptLogStore(db);
      const activityLog = new ActivityLogStore(db);
      const users = new UserStore(db);
      const sessions = new SessionStore(db, users);
      const permissions = new PermissionStore(db);
      users.create({
        email: "admin",
        password: "12345",
        display_name: "Admin",
        is_admin: true,
      });
      const handlers = buildToolHandlers(
        knowledge,
        pages,
        images,
        promptLog,
        activityLog,
        { publicBaseUrl: "http://test" },
        permissions,
      );
      const adminApp = buildApp({
        knowledge,
        pages,
        images,
        promptLog,
        activityLog,
        users,
        sessions,
        permissions,
        handlers,
        publicBaseUrl: "http://test",
        webAuth: true,
      });

      // Log in as admin
      let res = await request(adminApp)
        .post("/api/auth/login")
        .send({ email: "admin", password: "12345" });
      const cookie = res.headers["set-cookie"][0];

      // List → just admin
      res = await request(adminApp)
        .get("/api/admin/users")
        .set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(res.body.users).toHaveLength(1);
      expect(res.body.users[0].email).toBe("admin");
      expect(res.body.users[0].mcp_token).toBeTruthy();

      // Create a member
      res = await request(adminApp)
        .post("/api/admin/users")
        .set("Cookie", cookie)
        .send({
          email: "alice",
          password: "secret",
          display_name: "Alice",
        });
      expect(res.status).toBe(200);
      const aliceId = res.body.user.id;
      expect(res.body.user.is_admin).toBe(false);
      expect(res.body.user.mcp_token).toBeTruthy();

      // Update Alice's name + password
      res = await request(adminApp)
        .patch(`/api/admin/users/${aliceId}`)
        .set("Cookie", cookie)
        .send({ display_name: "Alice in WL", password: "newpw" });
      expect(res.body.user.display_name).toBe("Alice in WL");

      // Regenerate Alice's MCP token
      const oldTok = res.body.user.mcp_token;
      res = await request(adminApp)
        .post(`/api/admin/users/${aliceId}/regenerate-mcp-token`)
        .set("Cookie", cookie);
      expect(res.body.mcp_token).toBeTruthy();
      expect(res.body.mcp_token).not.toBe(oldTok);

      // Last-admin guard: try to demote admin → 400
      res = await request(adminApp)
        .patch("/api/admin/users/1")
        .set("Cookie", cookie)
        .send({ is_admin: false });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/last admin/);

      // Last-admin guard: try to delete admin → 400
      res = await request(adminApp)
        .delete("/api/admin/users/1")
        .set("Cookie", cookie);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/yourself|last admin/);

      // Non-admin gating: alice logs in, /api/admin/users → 403
      res = await request(adminApp)
        .post("/api/auth/login")
        .send({ email: "alice", password: "newpw" });
      const aliceCookie = res.headers["set-cookie"][0];
      res = await request(adminApp)
        .get("/api/admin/users")
        .set("Cookie", aliceCookie);
      expect(res.status).toBe(403);

      // Delete Alice via admin
      res = await request(adminApp)
        .delete(`/api/admin/users/${aliceId}`)
        .set("Cookie", cookie);
      expect(res.status).toBe(200);
      // Alice's session should be gone now (FK CASCADE on sessions)
      res = await request(adminApp)
        .get("/api/auth/me")
        .set("Cookie", aliceCookie);
      expect(res.body.user).toBeNull();
    });

    it("login → me → logout flow", async () => {
      // Set up a user
      const db = openDb(":memory:");
      const knowledge = new KnowledgeStore(db);
      const pages = new PageStore(db, tmpDir);
      const images = new ImageStore(db, path.join(tmpDir, "auth-images"));
      const promptLog = new PromptLogStore(db);
      const activityLog = new ActivityLogStore(db);
      const users = new UserStore(db);
      const sessions = new SessionStore(db, users);
      const permissions = new PermissionStore(db);
      users.create({
        email: "alice@example.com",
        password: "correct-horse-battery-staple",
        display_name: "Alice",
      });
      const handlers = buildToolHandlers(
        knowledge,
        pages,
        images,
        promptLog,
        activityLog,
        { publicBaseUrl: "http://test" },
        permissions,
      );
      const authApp = buildApp({
        knowledge,
        pages,
        images,
        promptLog,
        activityLog,
        users,
        sessions,
        permissions,
        handlers,
        publicBaseUrl: "http://test",
        webAuth: true,
      });

      // Wrong password → 401
      let res = await request(authApp)
        .post("/api/auth/login")
        .send({ email: "alice@example.com", password: "wrong" });
      expect(res.status).toBe(401);

      // Correct → 200 + Set-Cookie
      res = await request(authApp)
        .post("/api/auth/login")
        .send({ email: "alice@example.com", password: "correct-horse-battery-staple" });
      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe("alice@example.com");
      const cookie = res.headers["set-cookie"][0];
      expect(cookie).toMatch(/wikikai_session=/);

      // /api/auth/me with cookie → user info
      res = await request(authApp).get("/api/auth/me").set("Cookie", cookie);
      expect(res.body.user.email).toBe("alice@example.com");
      expect(res.body.auth_enabled).toBe(true);

      // Anonymous /api/knowledge → 401
      res = await request(authApp).get("/api/knowledge");
      expect(res.status).toBe(401);

      // With cookie → 200
      res = await request(authApp).get("/api/knowledge").set("Cookie", cookie);
      expect(res.status).toBe(200);

      // Logout clears cookie + session
      res = await request(authApp)
        .post("/api/auth/logout")
        .set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(res.headers["set-cookie"][0]).toMatch(/Max-Age=0/);
    });
  });

  it("GET / responds (built dist OR backend-only placeholder)", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
  });

  it("GET /api/knowledge returns []", async () => {
    const res = await request(app).get("/api/knowledge");
    expect(res.body).toEqual([]);
  });

  it("GET /api/knowledge/:id with pages", async () => {
    const k = knowledge.add({ title: "K" });
    pages.add({ knowledge_id: k.id, title: "P1", content: "a" });
    pages.add({ knowledge_id: k.id, title: "P2", content: "b" });
    const res = await request(app).get(`/api/knowledge/${k.id}`);
    expect(res.status).toBe(200);
    expect(res.body.pages).toHaveLength(2);
    expect(res.body.pages[0]).toHaveProperty("url");
  });

  it("GET /api/knowledge/:id returns 404 for missing", async () => {
    const res = await request(app).get(`/api/knowledge/9999`);
    expect(res.status).toBe(404);
  });

  it("GET /api/knowledge/:id/outline returns heading tree", async () => {
    const k = knowledge.add({ title: "K" });
    pages.add({ knowledge_id: k.id, title: "P", content: "# T\n\n## A\n\n## B" });
    const res = await request(app).get(`/api/knowledge/${k.id}/outline`);
    expect(res.status).toBe(200);
    expect(res.body.pages[0].headings).toHaveLength(3);
  });

  it("GET /api/pages/:pid + rendered + raw", async () => {
    const k = knowledge.add({ title: "K" });
    const p = pages.add({ knowledge_id: k.id, title: "P", content: "# H\n\ntext" });

    const meta = await request(app).get(`/api/pages/${p.id}`);
    expect(meta.body.title).toBe("P");
    expect(meta.body.content).toContain("text");
    expect(meta.body.total_lines).toBe(3);

    const rendered = await request(app).get(`/api/pages/${p.id}/rendered`);
    expect(rendered.text).toContain("<h1");

    const raw = await request(app).get(`/api/pages/${p.id}/raw`);
    expect(raw.text).toBe("# H\n\ntext");
  });

  it("PATCH /api/pages/:pid updates content", async () => {
    const k = knowledge.add({ title: "K" });
    const p = pages.add({ knowledge_id: k.id, title: "P", content: "old" });
    const res = await request(app)
      .patch(`/api/pages/${p.id}`)
      .send({ content: "new" });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(2);
    expect(pages.get(p.id)!.content).toBe("new");
  });

  it("DELETE /api/pages/:pid", async () => {
    const k = knowledge.add({ title: "K" });
    const p = pages.add({ knowledge_id: k.id, title: "P", content: "x" });
    const res = await request(app).delete(`/api/pages/${p.id}`);
    expect(res.status).toBe(200);
    expect(pages.list(k.id)).toHaveLength(0);
  });

  it("GET /api/search returns hits", async () => {
    const k = knowledge.add({ title: "K" });
    pages.add({ knowledge_id: k.id, title: "P", content: "Postgres is great" });
    const res = await request(app).get(`/api/search?q=Postgres`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
    expect(res.body.hits[0].url).toMatch(/\/&\d+\/#\d+:\d+$/);
  });

  it("GET /api/search returns empty when q missing", async () => {
    const res = await request(app).get(`/api/search`);
    expect(res.body).toEqual({ hits: [], total: 0 });
  });

  it("DELETE /api/knowledge/:id cascades pages", async () => {
    const k = knowledge.add({ title: "K" });
    pages.add({ knowledge_id: k.id, title: "P", content: "x" });
    await request(app).delete(`/api/knowledge/${k.id}`);
    expect(pages.list(k.id)).toEqual([]);
  });
});
