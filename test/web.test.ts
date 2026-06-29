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
    const handlers = buildToolHandlers(knowledge, pages, images, promptLog, activityLog, { publicBaseUrl: "http://test" }, permissions, users, db);
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
        users,
        db,
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

    it("admin permissions CRUD", async () => {
      const db = openDb(":memory:");
      const knowledge = new KnowledgeStore(db);
      const pages = new PageStore(db, tmpDir);
      const images = new ImageStore(db, path.join(tmpDir, "pp-images"));
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
        users,
        db,
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

      // Create alice
      res = await request(adminApp)
        .post("/api/admin/users")
        .set("Cookie", cookie)
        .send({ email: "alice", password: "pw", display_name: "Alice" });
      const aliceId = res.body.user.id;

      // Register two projects
      await request(adminApp)
        .post("/api/projects").set("Cookie", cookie).send({ name: "examples" });
      await request(adminApp)
        .post("/api/projects").set("Cookie", cookie).send({ name: "secret" });

      // GET → empty
      res = await request(adminApp)
        .get(`/api/admin/users/${aliceId}/permissions`)
        .set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(res.body.permissions).toEqual([]);

      // PUT replaces
      res = await request(adminApp)
        .put(`/api/admin/users/${aliceId}/permissions`)
        .set("Cookie", cookie)
        .send({
          permissions: [
            { project: "examples", level: "view" },
            { project: "secret",   level: "edit" },
          ],
        });
      expect(res.status).toBe(200);

      res = await request(adminApp)
        .get(`/api/admin/users/${aliceId}/permissions`)
        .set("Cookie", cookie);
      expect(res.body.permissions).toEqual([
        { project: "examples", level: "view" },
        { project: "secret",   level: "edit" },
      ]);

      // PUT with smaller list revokes the missing one
      await request(adminApp)
        .put(`/api/admin/users/${aliceId}/permissions`)
        .set("Cookie", cookie)
        .send({ permissions: [{ project: "examples", level: "edit" }] });
      res = await request(adminApp)
        .get(`/api/admin/users/${aliceId}/permissions`)
        .set("Cookie", cookie);
      expect(res.body.permissions).toEqual([{ project: "examples", level: "edit" }]);

      // Non-admin (alice) cannot touch the endpoint
      res = await request(adminApp)
        .post("/api/auth/login")
        .send({ email: "alice", password: "pw" });
      const aliceCookie = res.headers["set-cookie"][0];
      res = await request(adminApp)
        .get(`/api/admin/users/${aliceId}/permissions`)
        .set("Cookie", aliceCookie);
      expect(res.status).toBe(403);

      // Invalid level → 400
      res = await request(adminApp)
        .put(`/api/admin/users/${aliceId}/permissions`)
        .set("Cookie", cookie)
        .send({ permissions: [{ project: "examples", level: "bogus" }] });
      expect(res.status).toBe(400);

      // Unknown project → 400 (FK violation)
      res = await request(adminApp)
        .put(`/api/admin/users/${aliceId}/permissions`)
        .set("Cookie", cookie)
        .send({ permissions: [{ project: "nope", level: "view" }] });
      expect(res.status).toBe(400);
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
        users,
        db,
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

    it("non-admin sees only knowledge in projects they have view+ on", async () => {
      const db = openDb(":memory:");
      const knowledge = new KnowledgeStore(db);
      const pages = new PageStore(db, tmpDir);
      const images = new ImageStore(db, path.join(tmpDir, "rg-images"));
      const promptLog = new PromptLogStore(db);
      const activityLog = new ActivityLogStore(db);
      const users = new UserStore(db);
      const sessions = new SessionStore(db, users);
      const permissions = new PermissionStore(db);
      users.create({
        email: "admin", password: "12345", display_name: "Admin", is_admin: true,
      });
      const handlers = buildToolHandlers(
        knowledge, pages, images, promptLog, activityLog,
        { publicBaseUrl: "http://test" },
        permissions,
        users,
        db,
      );
      const authApp = buildApp({
        knowledge, pages, images, promptLog, activityLog,
        users, sessions, permissions, handlers,
        publicBaseUrl: "http://test", webAuth: true,
      });

      // Admin login
      let res = await request(authApp).post("/api/auth/login")
        .send({ email: "admin", password: "12345" });
      const cookie = res.headers["set-cookie"][0];

      // Register projects
      await request(authApp).post("/api/projects").set("Cookie", cookie).send({ name: "alpha" });
      await request(authApp).post("/api/projects").set("Cookie", cookie).send({ name: "beta" });

      // Two knowledge docs in different projects
      const kA = knowledge.add({ title: "A", project: "alpha" });
      const kB = knowledge.add({ title: "B", project: "beta" });

      // Create alice and grant view on alpha only
      res = await request(authApp).post("/api/admin/users").set("Cookie", cookie)
        .send({ email: "alice", password: "pw", display_name: "Alice" });
      const aliceId = res.body.user.id;
      await request(authApp).put(`/api/admin/users/${aliceId}/permissions`).set("Cookie", cookie)
        .send({ permissions: [{ project: "alpha", level: "view" }] });

      // Alice login
      res = await request(authApp).post("/api/auth/login").send({ email: "alice", password: "pw" });
      const aliceCookie = res.headers["set-cookie"][0];

      // /api/knowledge → only A
      res = await request(authApp).get("/api/knowledge").set("Cookie", aliceCookie);
      expect(res.body.map((k: { title: string }) => k.title)).toEqual(["A"]);

      // GET /api/knowledge/:kA → 200
      res = await request(authApp).get(`/api/knowledge/${kA.id}`).set("Cookie", aliceCookie);
      expect(res.status).toBe(200);

      // GET /api/knowledge/:kB → 403
      res = await request(authApp).get(`/api/knowledge/${kB.id}`).set("Cookie", aliceCookie);
      expect(res.status).toBe(403);

      // GET /api/pages/:pid for a page inside kB → 403
      const pB = pages.add({ knowledge_id: kB.id, title: "P", content: "x" });
      res = await request(authApp).get(`/api/pages/${pB.id}`).set("Cookie", aliceCookie);
      expect(res.status).toBe(403);
    });

    it("view-only user cannot mutate; edit user can; admin can rename project", async () => {
      const db = openDb(":memory:");
      const knowledge = new KnowledgeStore(db);
      const pages = new PageStore(db, tmpDir);
      const images = new ImageStore(db, path.join(tmpDir, "wg-images"));
      const promptLog = new PromptLogStore(db);
      const activityLog = new ActivityLogStore(db);
      const users = new UserStore(db);
      const sessions = new SessionStore(db, users);
      const permissions = new PermissionStore(db);
      users.create({ email: "admin", password: "12345", display_name: "Admin", is_admin: true });

      const handlers = buildToolHandlers(
        knowledge, pages, images, promptLog, activityLog,
        { publicBaseUrl: "http://test" },
        permissions,
        users,
        db,
      );
      const authApp = buildApp({
        knowledge, pages, images, promptLog, activityLog,
        users, sessions, permissions, handlers,
        publicBaseUrl: "http://test", webAuth: true,
      });

      // Admin login
      let res = await request(authApp).post("/api/auth/login")
        .send({ email: "admin", password: "12345" });
      const cookie = res.headers["set-cookie"][0];

      // Projects
      await request(authApp).post("/api/projects").set("Cookie", cookie).send({ name: "alpha" });

      // Knowledge + page in alpha
      const k = knowledge.add({ title: "K", project: "alpha" });
      const p = pages.add({ knowledge_id: k.id, title: "P", content: "x" });

      // Alice
      res = await request(authApp).post("/api/admin/users").set("Cookie", cookie)
        .send({ email: "alice", password: "pw", display_name: "Alice" });
      const aliceId = res.body.user.id;
      await request(authApp).put(`/api/admin/users/${aliceId}/permissions`).set("Cookie", cookie)
        .send({ permissions: [{ project: "alpha", level: "view" }] });

      res = await request(authApp).post("/api/auth/login").send({ email: "alice", password: "pw" });
      const aliceCookie = res.headers["set-cookie"][0];

      // View-only Alice → PATCH page = 403
      res = await request(authApp).patch(`/api/pages/${p.id}`).set("Cookie", aliceCookie)
        .send({ content: "haha" });
      expect(res.status).toBe(403);

      // Upgrade to edit
      await request(authApp).put(`/api/admin/users/${aliceId}/permissions`).set("Cookie", cookie)
        .send({ permissions: [{ project: "alpha", level: "edit" }] });

      // Now PATCH succeeds
      res = await request(authApp).patch(`/api/pages/${p.id}`).set("Cookie", aliceCookie)
        .send({ content: "ok" });
      expect(res.status).toBe(200);

      // Alice DELETE knowledge → 200 with edit
      res = await request(authApp).delete(`/api/knowledge/${k.id}`).set("Cookie", aliceCookie);
      expect(res.status).toBe(200);
    });

    it("/api/projects returns only visible projects for non-admin", async () => {
      const db = openDb(":memory:");
      const knowledge = new KnowledgeStore(db);
      const pages = new PageStore(db, tmpDir);
      const images = new ImageStore(db, path.join(tmpDir, "p1-images"));
      const promptLog = new PromptLogStore(db);
      const activityLog = new ActivityLogStore(db);
      const users = new UserStore(db);
      const sessions = new SessionStore(db, users);
      const permissions = new PermissionStore(db);
      users.create({
        email: "admin", password: "12345", display_name: "Admin", is_admin: true,
      });
      const handlers = buildToolHandlers(
        knowledge, pages, images, promptLog, activityLog,
        { publicBaseUrl: "http://test" },
        permissions,
        users,
        db,
      );
      const authApp = buildApp({
        knowledge, pages, images, promptLog, activityLog,
        users, sessions, permissions, handlers,
        publicBaseUrl: "http://test", webAuth: true,
      });

      // Admin login
      let res = await request(authApp).post("/api/auth/login")
        .send({ email: "admin", password: "12345" });
      const cookie = res.headers["set-cookie"][0];

      // Register two projects
      await request(authApp).post("/api/projects").set("Cookie", cookie).send({ name: "alpha" });
      await request(authApp).post("/api/projects").set("Cookie", cookie).send({ name: "beta" });

      // Create alice and grant view on alpha only
      res = await request(authApp).post("/api/admin/users").set("Cookie", cookie)
        .send({ email: "alice", password: "pw", display_name: "Alice" });
      const aliceId = res.body.user.id;
      await request(authApp).put(`/api/admin/users/${aliceId}/permissions`).set("Cookie", cookie)
        .send({ permissions: [{ project: "alpha", level: "view" }] });

      // Admin sees both
      res = await request(authApp).get("/api/projects").set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(res.body.projects.map((p: { name: string }) => p.name).sort())
        .toEqual(["alpha", "beta"]);

      // Alice login
      res = await request(authApp).post("/api/auth/login").send({ email: "alice", password: "pw" });
      const aliceCookie = res.headers["set-cookie"][0];

      // Alice sees only alpha
      res = await request(authApp).get("/api/projects").set("Cookie", aliceCookie);
      expect(res.status).toBe(200);
      expect(res.body.projects.map((p: { name: string }) => p.name)).toEqual(["alpha"]);
    });

    it("/api/projects POST/DELETE is admin-only", async () => {
      const db = openDb(":memory:");
      const knowledge = new KnowledgeStore(db);
      const pages = new PageStore(db, tmpDir);
      const images = new ImageStore(db, path.join(tmpDir, "p2-images"));
      const promptLog = new PromptLogStore(db);
      const activityLog = new ActivityLogStore(db);
      const users = new UserStore(db);
      const sessions = new SessionStore(db, users);
      const permissions = new PermissionStore(db);
      users.create({
        email: "admin", password: "12345", display_name: "Admin", is_admin: true,
      });
      const handlers = buildToolHandlers(
        knowledge, pages, images, promptLog, activityLog,
        { publicBaseUrl: "http://test" },
        permissions,
        users,
        db,
      );
      const authApp = buildApp({
        knowledge, pages, images, promptLog, activityLog,
        users, sessions, permissions, handlers,
        publicBaseUrl: "http://test", webAuth: true,
      });

      // Admin login + register alpha
      let res = await request(authApp).post("/api/auth/login")
        .send({ email: "admin", password: "12345" });
      const cookie = res.headers["set-cookie"][0];
      await request(authApp).post("/api/projects").set("Cookie", cookie).send({ name: "alpha" });

      // Create alice + grant view on alpha
      res = await request(authApp).post("/api/admin/users").set("Cookie", cookie)
        .send({ email: "alice", password: "pw", display_name: "Alice" });
      const aliceId = res.body.user.id;
      await request(authApp).put(`/api/admin/users/${aliceId}/permissions`).set("Cookie", cookie)
        .send({ permissions: [{ project: "alpha", level: "view" }] });

      // Alice login
      res = await request(authApp).post("/api/auth/login").send({ email: "alice", password: "pw" });
      const aliceCookie = res.headers["set-cookie"][0];

      // Alice POST /api/projects → 403
      res = await request(authApp).post("/api/projects").set("Cookie", aliceCookie).send({ name: "x" });
      expect(res.status).toBe(403);

      // Alice DELETE /api/projects/alpha → 403
      res = await request(authApp).delete("/api/projects/alpha").set("Cookie", aliceCookie);
      expect(res.status).toBe(403);
    });

    it("/api/activity-log filters by visible projects", async () => {
      const db = openDb(":memory:");
      const knowledge = new KnowledgeStore(db);
      const pages = new PageStore(db, tmpDir);
      const images = new ImageStore(db, path.join(tmpDir, "p3-images"));
      const promptLog = new PromptLogStore(db);
      const activityLog = new ActivityLogStore(db);
      const users = new UserStore(db);
      const sessions = new SessionStore(db, users);
      const permissions = new PermissionStore(db);
      users.create({
        email: "admin", password: "12345", display_name: "Admin", is_admin: true,
      });
      const handlers = buildToolHandlers(
        knowledge, pages, images, promptLog, activityLog,
        { publicBaseUrl: "http://test" },
        permissions,
        users,
        db,
      );
      const authApp = buildApp({
        knowledge, pages, images, promptLog, activityLog,
        users, sessions, permissions, handlers,
        publicBaseUrl: "http://test", webAuth: true,
      });

      // Admin login
      let res = await request(authApp).post("/api/auth/login")
        .send({ email: "admin", password: "12345" });
      const cookie = res.headers["set-cookie"][0];

      // Register projects
      await request(authApp).post("/api/projects").set("Cookie", cookie).send({ name: "alpha" });
      await request(authApp).post("/api/projects").set("Cookie", cookie).send({ name: "beta" });

      // Knowledge + page in each project
      const kA = knowledge.add({ title: "A", project: "alpha" });
      const kB = knowledge.add({ title: "B", project: "beta" });
      const pA = pages.add({ knowledge_id: kA.id, title: "PA", content: "x" });
      const pB = pages.add({ knowledge_id: kB.id, title: "PB", content: "y" });

      // Make an edit through the API in each so activity_log rows are written
      res = await request(authApp).patch(`/api/pages/${pA.id}`).set("Cookie", cookie)
        .send({ content: "x2" });
      expect(res.status).toBe(200);
      res = await request(authApp).patch(`/api/pages/${pB.id}`).set("Cookie", cookie)
        .send({ content: "y2" });
      expect(res.status).toBe(200);

      // Create alice + grant view on alpha only
      res = await request(authApp).post("/api/admin/users").set("Cookie", cookie)
        .send({ email: "alice", password: "pw", display_name: "Alice" });
      const aliceId = res.body.user.id;
      await request(authApp).put(`/api/admin/users/${aliceId}/permissions`).set("Cookie", cookie)
        .send({ permissions: [{ project: "alpha", level: "view" }] });

      // Alice login
      res = await request(authApp).post("/api/auth/login").send({ email: "alice", password: "pw" });
      const aliceCookie = res.headers["set-cookie"][0];

      // Alice /api/activity → no rows with knowledge_id === kB.id
      res = await request(authApp).get("/api/activity").set("Cookie", aliceCookie);
      expect(res.status).toBe(200);
      const entries = res.body.entries as { knowledge_id: number | null }[];
      expect(entries.some((e) => e.knowledge_id === kB.id)).toBe(false);
      // Should still see kA rows
      expect(entries.some((e) => e.knowledge_id === kA.id)).toBe(true);
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
    const k = knowledge.add({ title: "K", project: "examples" });
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

  it("POST /api/knowledge/:id/pages adds an empty page", async () => {
    const k = knowledge.add({ title: "K", project: "examples" });
    const res = await request(app)
      .post(`/api/knowledge/${k.id}/pages`)
      .send({ title: "New page" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ knowledge_id: k.id, position: 1 });
    expect(res.body).toHaveProperty("url");
    // The page now shows up in the knowledge's page list.
    const list = await request(app).get(`/api/knowledge/${k.id}`);
    expect(list.body.pages).toHaveLength(1);
    expect(list.body.pages[0].title).toBe("New page");
  });

  it("POST /api/knowledge/:id/pages requires a title", async () => {
    const k = knowledge.add({ title: "K", project: "examples" });
    const res = await request(app)
      .post(`/api/knowledge/${k.id}/pages`)
      .send({ title: "   " });
    expect(res.status).toBe(400);
  });

  it("POST /api/knowledge/:id/pages returns 404 for missing knowledge", async () => {
    const res = await request(app)
      .post(`/api/knowledge/9999/pages`)
      .send({ title: "X" });
    expect(res.status).toBe(404);
  });

  it("POST /api/pages/:pid/move moves a page to another knowledge", async () => {
    const k1 = knowledge.add({ title: "K1", project: "examples" });
    const k2 = knowledge.add({ title: "K2", project: "examples" });
    const p = pages.add({ knowledge_id: k1.id, title: "P", content: "body" });
    pages.add({ knowledge_id: k2.id, title: "X", content: "" });

    const res = await request(app)
      .post(`/api/pages/${p.id}/move`)
      .send({ knowledge_id: k2.id });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      from_knowledge_id: k1.id,
      to_knowledge_id: k2.id,
      position: 2,
    });

    const src = await request(app).get(`/api/knowledge/${k1.id}`);
    expect(src.body.pages).toHaveLength(0);
    const dst = await request(app).get(`/api/knowledge/${k2.id}`);
    expect(dst.body.pages.map((pg: { title: string }) => pg.title)).toEqual([
      "X",
      "P",
    ]);
  });

  it("POST /api/pages/:pid/move rejects same-knowledge + bad input", async () => {
    const k = knowledge.add({ title: "K", project: "examples" });
    const p = pages.add({ knowledge_id: k.id, title: "P", content: "" });

    const same = await request(app)
      .post(`/api/pages/${p.id}/move`)
      .send({ knowledge_id: k.id });
    expect(same.status).toBe(400);

    const noKid = await request(app).post(`/api/pages/${p.id}/move`).send({});
    expect(noKid.status).toBe(400);

    const missingTarget = await request(app)
      .post(`/api/pages/${p.id}/move`)
      .send({ knowledge_id: 9999 });
    expect(missingTarget.status).toBe(404);

    const missingPage = await request(app)
      .post(`/api/pages/9999/move`)
      .send({ knowledge_id: k.id });
    expect(missingPage.status).toBe(404);
  });

  it("GET /api/knowledge/:id/outline returns heading tree", async () => {
    const k = knowledge.add({ title: "K", project: "examples" });
    pages.add({ knowledge_id: k.id, title: "P", content: "# T\n\n## A\n\n## B" });
    const res = await request(app).get(`/api/knowledge/${k.id}/outline`);
    expect(res.status).toBe(200);
    expect(res.body.pages[0].headings).toHaveLength(3);
  });

  it("GET /api/pages/:pid + rendered + raw", async () => {
    const k = knowledge.add({ title: "K", project: "examples" });
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

  it("GET /api/blocks/:id/content returns raw inner for a fence block", async () => {
    const k = knowledge.add({ title: "K", project: "examples" });
    const p = pages.add({
      knowledge_id: k.id,
      title: "P",
      content: "```typescript\nconst x = 1;\n```\n",
    });
    // Re-read after injectBlockIds stamps the {@N}.
    const md = pages.get(p.id)!.content;
    const id = Number(/\{@(\d+)\}/.exec(md)![1]);
    const res = await request(app).get(`/api/blocks/${id}/content`);
    expect(res.status).toBe(200);
    expect(res.text).toBe("const x = 1;");
  });

  it("GET /api/blocks/:id/content returns 404 for unknown id", async () => {
    const res = await request(app).get(`/api/blocks/9999999/content`);
    expect(res.status).toBe(404);
  });

  it("DELETE /api/blocks/:id removes the block lines, leaves rest", async () => {
    const k = knowledge.add({ title: "K", project: "examples" });
    const p = pages.add({
      knowledge_id: k.id,
      title: "P",
      content: "intro line\n\n```typescript\nconst x = 1;\n```\n\ntrailing line\n",
    });
    const md = pages.get(p.id)!.content;
    const id = Number(/\{@(\d+)\}/.exec(md)![1]);

    const res = await request(app).delete(`/api/blocks/${id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      block_id: id,
      page_id: p.id,
      deleted: true,
    });

    const after = pages.get(p.id)!.content;
    expect(after).not.toContain("```");
    expect(after).not.toContain("const x = 1");
    expect(after).toContain("intro line");
    expect(after).toContain("trailing line");
  });

  it("DELETE /api/blocks/:id returns 404 for unknown id", async () => {
    const res = await request(app).delete(`/api/blocks/9999999`);
    expect(res.status).toBe(404);
  });

  it("GET /api/knowledge/:id/content concatenates pages in sidebar order", async () => {
    const k = knowledge.add({ title: "K", project: "examples" });
    pages.add({ knowledge_id: k.id, title: "First", content: "hello first" });
    pages.add({ knowledge_id: k.id, title: "Second", content: "hello second" });
    const res = await request(app).get(`/api/knowledge/${k.id}/content`);
    expect(res.status).toBe(200);
    expect(res.text).toContain("## First");
    expect(res.text).toContain("hello first");
    expect(res.text).toContain("---");
    expect(res.text).toContain("## Second");
    expect(res.text).toContain("hello second");
    expect(res.text.indexOf("First")).toBeLessThan(res.text.indexOf("Second"));
  });

  it("GET /api/knowledge/:id/content returns 404 for unknown knowledge", async () => {
    const res = await request(app).get(`/api/knowledge/9999999/content`);
    expect(res.status).toBe(404);
  });

  it("PATCH /api/pages/:pid updates content", async () => {
    const k = knowledge.add({ title: "K", project: "examples" });
    const p = pages.add({ knowledge_id: k.id, title: "P", content: "old" });
    const res = await request(app)
      .patch(`/api/pages/${p.id}`)
      .send({ content: "new" });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(2);
    expect(pages.get(p.id)!.content).toBe("new");
  });

  it("DELETE /api/pages/:pid", async () => {
    const k = knowledge.add({ title: "K", project: "examples" });
    const p = pages.add({ knowledge_id: k.id, title: "P", content: "x" });
    const res = await request(app).delete(`/api/pages/${p.id}`);
    expect(res.status).toBe(200);
    expect(pages.list(k.id)).toHaveLength(0);
  });

  it("GET /api/search returns hits", async () => {
    const k = knowledge.add({ title: "K", project: "examples" });
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
    const k = knowledge.add({ title: "K", project: "examples" });
    pages.add({ knowledge_id: k.id, title: "P", content: "x" });
    await request(app).delete(`/api/knowledge/${k.id}`);
    expect(pages.list(k.id)).toEqual([]);
  });

  it("POST /api/knowledge rejects empty project", async () => {
    const res = await request(app).post("/api/knowledge").send({ title: "X" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/project/);
  });

  it("ActivityLogStore.record emits an activity-logged event", async () => {
    // Lazy-import so the events bus singleton is the one the store uses.
    const { onEvent } = await import("../src/lib/events.js");

    const captured: Array<{ type: string; knowledge_id: number | null }> = [];
    const off = onEvent((e) => {
      if (e.type === "activity-logged") {
        captured.push({ type: e.type, knowledge_id: e.knowledge_id });
      }
    });

    try {
      const k = knowledge.add({ title: "K", project: "examples" });
      // Filter out the knowledge-add ripple — only count rows we record below.
      captured.length = 0;

      const db = openDb(":memory:");
      const log = new ActivityLogStore(db);
      log.record({
        action: "edit",
        target: "knowledge",
        knowledge_id: k.id,
        knowledge_title: "K",
      });

      expect(captured).toHaveLength(1);
      expect(captured[0]).toEqual({
        type: "activity-logged",
        knowledge_id: k.id,
      });

      // null knowledge_id (e.g. image upload) should pass through.
      log.record({ action: "upload", target: "image" });
      expect(captured).toHaveLength(2);
      expect(captured[1]).toEqual({
        type: "activity-logged",
        knowledge_id: null,
      });
    } finally {
      off();
    }
  });

  describe("public share links", () => {
    function makeDoc() {
      const k = knowledge.add({ title: "Shared Doc", project: "examples" });
      const p = pages.add({
        knowledge_id: k.id,
        title: "Page 1",
        content: "# Hello\n\nworld",
      });
      return { kid: k.id, pid: p.id };
    }

    it("enable → public read → rotate → disable lifecycle", async () => {
      const { kid, pid } = makeDoc();

      // off by default
      let r = await request(app).get(`/api/knowledge/${kid}/share`);
      expect(r.status).toBe(200);
      expect(r.body.shared).toBe(false);
      expect(r.body.share_token).toBeNull();

      // enable
      r = await request(app).post(`/api/knowledge/${kid}/share`);
      expect(r.body.shared).toBe(true);
      const token = r.body.share_token as string;
      expect(token).toMatch(/^[a-f0-9]{48}$/);
      expect(r.body.url).toBe(`http://test/share/${token}`);

      // enable is idempotent — same token
      r = await request(app).post(`/api/knowledge/${kid}/share`);
      expect(r.body.share_token).toBe(token);

      // public read — scoped to this doc, no auth
      r = await request(app).get(`/api/share/${token}`);
      expect(r.status).toBe(200);
      expect(r.body.knowledge.id).toBe(kid);
      expect(r.body.knowledge.title).toBe("Shared Doc");
      expect(r.body.pages.map((p: { id: number }) => p.id)).toContain(pid);

      // public rendered page
      r = await request(app).get(`/api/share/${token}/pages/${pid}/rendered`);
      expect(r.status).toBe(200);
      expect(r.text).toContain("<h1");

      // rotate → new token, old one dies
      const rot = await request(app).post(`/api/knowledge/${kid}/share/rotate`);
      const token2 = rot.body.share_token as string;
      expect(token2).not.toBe(token);
      expect((await request(app).get(`/api/share/${token}`)).status).toBe(404);
      expect((await request(app).get(`/api/share/${token2}`)).status).toBe(200);

      // disable → public link 404s
      expect(
        (await request(app).delete(`/api/knowledge/${kid}/share`)).status,
      ).toBe(200);
      expect((await request(app).get(`/api/share/${token2}`)).status).toBe(404);
    });

    it("unknown token → 404", async () => {
      expect((await request(app).get(`/api/share/deadbeef`)).status).toBe(404);
    });

    it("a page id from another knowledge is rejected (scope guard)", async () => {
      const { kid } = makeDoc();
      const other = knowledge.add({ title: "Other", project: "examples" });
      const otherPage = pages.add({
        knowledge_id: other.id,
        title: "Secret",
        content: "secret",
      });
      const token = (await request(app).post(`/api/knowledge/${kid}/share`))
        .body.share_token as string;
      const r = await request(app).get(
        `/api/share/${token}/pages/${otherPage.id}/rendered`,
      );
      expect(r.status).toBe(404);
    });
  });

  it("share routes bypass the login wall when web auth is on", async () => {
    const db = openDb(":memory:");
    const k2 = new KnowledgeStore(db);
    const p2 = new PageStore(db, tmpDir);
    const images = new ImageStore(db, path.join(tmpDir, "sh-img"));
    const promptLog = new PromptLogStore(db);
    const activityLog = new ActivityLogStore(db);
    const users = new UserStore(db);
    const sessions = new SessionStore(db, users);
    const permissions = new PermissionStore(db);
    users.create({
      email: "admin",
      password: "pw",
      display_name: "Admin",
      is_admin: true,
    });
    const handlers = buildToolHandlers(
      k2, p2, images, promptLog, activityLog,
      { publicBaseUrl: "http://test" }, permissions, users, db,
    );
    const authedApp = buildApp({
      knowledge: k2, pages: p2, images, promptLog, activityLog,
      users, sessions, permissions, handlers,
      publicBaseUrl: "http://test", webAuth: true,
    });

    const k = k2.add({ title: "Doc", project: "examples" });
    p2.add({ knowledge_id: k.id, title: "P", content: "hi" });
    const token = k2.enableShare(k.id);

    // a normal gated route without a session → bounced (401 for /api/*)
    expect((await request(authedApp).get(`/api/knowledge/${k.id}`)).status).toBe(
      401,
    );
    // the share route is reachable without a session
    const r = await request(authedApp).get(`/api/share/${token}`);
    expect(r.status).toBe(200);
    expect(r.body.knowledge.id).toBe(k.id);
  });
});
