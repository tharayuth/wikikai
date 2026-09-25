import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import sharp from "sharp";
import type { Server } from "node:http";
import { openDb, type Db } from "../src/store/db.js";
import { KnowledgeStore } from "../src/store/knowledge.js";
import { PageStore, relativizeAssetUrls } from "../src/store/pages.js";
import { ImageStore, readImageSize } from "../src/store/images.js";
import { PromptLogStore } from "../src/store/promptLog.js";
import { ActivityLogStore } from "../src/store/activityLog.js";
import { SessionStore, UserStore } from "../src/store/users.js";
import { PermissionStore } from "../src/store/permissions.js";
import { ShareUserStore } from "../src/store/shareUsers.js";
import { FileStore } from "../src/store/files.js";
import { buildToolHandlers, type ToolHandlers } from "../src/mcp/handlers.js";
import { buildApp } from "../src/web/app.js";
import { UploadTicketStore } from "../src/lib/uploadTickets.js";

function png(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 40, g: 90, b: 160 } } })
    .png()
    .toBuffer();
}

describe("readImageSize", () => {
  it("reads PNG, JPEG, GIF and WebP headers", async () => {
    const base = sharp({ create: { width: 321, height: 123, channels: 3, background: "#888" } });
    expect(readImageSize(await base.clone().png().toBuffer())).toEqual({ width: 321, height: 123 });
    expect(readImageSize(await base.clone().jpeg().toBuffer())).toEqual({ width: 321, height: 123 });
    expect(readImageSize(await base.clone().gif().toBuffer())).toEqual({ width: 321, height: 123 });
    expect(readImageSize(await base.clone().webp().toBuffer())).toEqual({ width: 321, height: 123 });
    expect(readImageSize(await base.clone().webp({ lossless: true }).toBuffer())).toEqual({ width: 321, height: 123 });
    expect(readImageSize(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
  });
});

describe("image store + get_image scaled copies", () => {
  let tmp: string;
  let db: Db;
  let images: ImageStore;
  let h: ToolHandlers;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wk-img-"));
    db = openDb(":memory:");
    images = new ImageStore(db, path.join(tmp, "images"));
    h = buildToolHandlers(
      new KnowledgeStore(db),
      new PageStore(db, path.join(tmp, "items")),
      images,
      new PromptLogStore(db),
      new ActivityLogStore(db),
      { publicBaseUrl: "https://wiki.example.test", imageReadMaxEdge: 1280 },
      new PermissionStore(db),
      new UserStore(db),
      db,
      new FileStore(db, path.join(tmp, "files")),
    );
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("records dimensions on upload and returns a path-only markdown snippet", async () => {
    const r = await h.store_image(await png(2000, 1000), "image/png", "Login [screen]");
    expect(r).toMatchObject({ width: 2000, height: 1000 });
    expect(r.markdown).toBe(`![Login screen](${r.src})`);
    expect(r.markdown).not.toContain("example.test");
    expect(r.warnings).toEqual([]);
  });

  it("warns about narrow images and JPEG screenshots", async () => {
    const narrow = await h.store_image(await png(1000, 500), "image/png");
    expect(narrow.warnings.join(" ")).toMatch(/500x/);
    const jpg = await sharp(await png(1600, 900)).jpeg().toBuffer();
    const j = await h.store_image(jpg, "image/jpeg");
    expect(j.warnings.join(" ")).toMatch(/PNG/);
  });

  it("inlines a WebP copy capped at the read size by default, cached on disk", async () => {
    const up = await h.store_image(await png(2000, 1000), "image/png");
    const r = await h.get_image({ hash: up.hash, mode: "full" });
    expect(r.served).toMatchObject({ mime: "image/webp", width: 1280, height: 640, resized: true });
    const bytes = Buffer.from(r.data_base64!, "base64");
    expect(readImageSize(bytes)).toEqual({ width: 1280, height: 640 });
    const cached = path.join(tmp, "images", "variants", up.hash.slice(0, 2), `${up.hash}-1280.webp`);
    expect(fs.existsSync(cached)).toBe(true);
    const again = await h.get_image({ hash: up.hash, mode: "full" });
    expect(again.data_base64).toBe(r.data_base64);
  });

  it("honours max_edge and original, and never enlarges", async () => {
    const up = await h.store_image(await png(2000, 1000), "image/png");
    const small = await h.get_image({ hash: up.hash, mode: "full", max_edge: 500 });
    expect(small.served).toMatchObject({ width: 500, height: 250 });
    const orig = await h.get_image({ hash: up.hash, mode: "full", original: true });
    expect(orig.served).toMatchObject({ mime: "image/png", width: 2000, resized: false });
    const tiny = await h.store_image(await png(300, 200), "image/png");
    const t = await h.get_image({ hash: tiny.hash, mode: "full" });
    expect(t.served).toMatchObject({ mime: "image/png", width: 300, resized: false });
  });

  it("backfills dimensions for rows stored before they were recorded", async () => {
    const up = await h.store_image(await png(900, 300), "image/png");
    db.prepare(`UPDATE images SET width = NULL, height = NULL`).run();
    expect(images.get(up.hash)).toMatchObject({ width: 900, height: 300 });
  });

  it("removing an image removes its scaled copies", async () => {
    const up = await h.store_image(await png(2000, 1000), "image/png");
    await h.get_image({ hash: up.hash, mode: "full" });
    const dir = path.join(tmp, "images", "variants", up.hash.slice(0, 2));
    expect(fs.readdirSync(dir)).toHaveLength(1);
    images.remove(up.hash);
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  it("stores image/jpg as image/jpeg and serves the canonical type", async () => {
    const jpg = await sharp(await png(300, 200)).jpeg().toBuffer();
    const up = await h.store_image(jpg, "image/jpg");
    expect(up.mime).toBe("image/jpeg");
    db.prepare(`UPDATE images SET mime = 'image/jpg'`).run(); // a row stored before the fix
    const r = await h.get_image({ hash: up.hash, mode: "full" });
    expect(r.mime).toBe("image/jpeg");
    expect(r.served).toMatchObject({ mime: "image/jpeg", resized: false });
  });

  it("rasterizes SVG to WebP for inlining, even with original: true", async () => {
    const svg = Buffer.from(
      "<svg xmlns='http://www.w3.org/2000/svg' width='400' height='200'><rect width='400' height='200' fill='#36c'/></svg>",
    );
    const up = await h.store_image(svg, "image/svg+xml");
    for (const args of [{}, { original: true }, { max_edge: 100 }]) {
      const r = await h.get_image({ hash: up.hash, mode: "full", ...args });
      expect(r.served?.mime, JSON.stringify(args)).toBe("image/webp");
      const size = readImageSize(Buffer.from(r.data_base64!, "base64"));
      expect(size!.width / size!.height).toBeCloseTo(2, 1);
    }
  });

  it("get_image rejects hash and src together", async () => {
    const up = await h.store_image(await png(100, 100), "image/png");
    await expect(h.get_image({ hash: up.hash, src: up.src })).rejects.toThrow(/exactly one/);
  });

  it("add_image without a path points the agent at get_upload_url", async () => {
    await expect(h.add_image({})).rejects.toThrow(/get_upload_url/);
  });
});

describe("curl upload via get_upload_url", () => {
  let tmp: string;
  let db: Db;
  let server: Server;
  let h: ToolHandlers;
  let tickets: UploadTicketStore;
  let clock: number;

  function boot(webAuth: boolean): void {
    db = openDb(":memory:");
    const knowledge = new KnowledgeStore(db);
    const pages = new PageStore(db, path.join(tmp, "items"));
    const images = new ImageStore(db, path.join(tmp, "images"));
    const promptLog = new PromptLogStore(db);
    const activityLog = new ActivityLogStore(db);
    const users = new UserStore(db);
    const sessions = new SessionStore(db, users);
    const permissions = new PermissionStore(db);
    const files = new FileStore(db, path.join(tmp, "files"));
    clock = Date.parse("2026-09-23T00:00:00Z");
    tickets = new UploadTicketStore(15 * 60 * 1000, () => clock);
    h = buildToolHandlers(
      knowledge, pages, images, promptLog, activityLog,
      { publicBaseUrl: "https://wiki.example.test", uploadTickets: tickets },
      permissions, users, db, files,
    );
    const app = buildApp({
      knowledge, pages, images, promptLog, activityLog, users, sessions, permissions,
      shareUsers: new ShareUserStore(db), files, handlers: h,
      publicBaseUrl: "https://wiki.example.test", webAuth, uploadTickets: tickets,
    });
    server = app.listen(0);
  }

  /** Path part of a ticket URL, so supertest can hit the local server. */
  const pathOf = (url: string) => new URL(url).pathname;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wk-up-"));
  });
  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("stores an image sent as the raw body and logs the upload", async () => {
    boot(false);
    const link = await h.get_upload_url({});
    expect(link.image_url).toMatch(/^https:\/\/wiki\.example\.test\/api\/upload\/[\w-]+\/image$/);
    const res = await request(server)
      .post(`${pathOf(link.image_url)}?alt=Dashboard`)
      // Real curl labels the body form-urlencoded, but supertest would
      // re-encode a Buffer under that type — octet-stream keeps it raw here.
      .set("Content-Type", "application/octet-stream")
      .send(await png(1600, 900));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ mime: "image/png", width: 1600, alt: "Dashboard" });
    expect(res.body.markdown).toBe(`![Dashboard](${res.body.src})`);
    const row = db.prepare(`SELECT source, tool_name, target FROM activity_log`).get();
    expect(row).toEqual({ source: "mcp", tool_name: "get_upload_url", target: "image" });
  });

  it("stores a file under its given name", async () => {
    boot(false);
    const link = await h.get_upload_url({});
    const res = await request(server)
      .post(`${pathOf(link.file_url)}?name=report.csv&description=Q3`)
      .set("Content-Type", "application/octet-stream")
      .send(Buffer.from("a,b\n1,2\n"));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "report.csv" });
    expect(res.body.fence).toContain('"description":"Q3"');
  });

  it("rejects unknown and expired links, non-images, empty bodies and missing names", async () => {
    boot(false);
    const link = await h.get_upload_url({});
    const img = await png(10, 10);
    const bad = await request(server).post("/api/upload/nope/image").send(img);
    expect(bad.status).toBe(404);
    const notImage = await request(server)
      .post(pathOf(link.image_url))
      .set("Content-Type", "application/octet-stream")
      .send(Buffer.from("hello"));
    expect(notImage.status).toBe(415);
    const empty = await request(server).post(pathOf(link.image_url));
    expect(empty.status).toBe(400);
    const noName = await request(server)
      .post(pathOf(link.file_url))
      .set("Content-Type", "application/octet-stream")
      .send(Buffer.from("x"));
    expect(noName.status).toBe(400);
    clock += 16 * 60 * 1000;
    const expired = await request(server)
      .post(pathOf(link.image_url))
      .set("Content-Type", "application/octet-stream")
      .send(img);
    expect(expired.status).toBe(404);
  });

  it("is reachable without a session when web auth is on", async () => {
    boot(true);
    const link = await h.get_upload_url({});
    const res = await request(server)
      .post(pathOf(link.image_url))
      .set("Content-Type", "application/octet-stream")
      .send(await png(20, 20));
    expect(res.status).toBe(201);
    const other = await request(server).get("/api/knowledge");
    expect(other.status).toBe(401);
  });
});

describe("own-domain asset links are stored as paths", () => {
  const hash = "a".repeat(64);

  it("strips this server's origin from /img/ and /file/ links only", () => {
    const src = [
      `![a](https://wiki.example.test/img/${hash}.png)`,
      `[b](http://wiki.example.test/file/${hash}.pdf)`,
      `![c](https://other.example/img/${hash}.png)`,
      `[d](https://wiki.example.test/&3/#12)`,
    ].join("\n");
    expect(relativizeAssetUrls(src, ["https://wiki.example.test"])).toBe(
      [
        `![a](/img/${hash}.png)`,
        `[b](/file/${hash}.pdf)`,
        `![c](https://other.example/img/${hash}.png)`,
        `[d](https://wiki.example.test/&3/#12)`,
      ].join("\n"),
    );
  });

  it("applies on every page write once origins are set", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wk-rel-"));
    const db = openDb(":memory:");
    const k = new KnowledgeStore(db).add({ title: "K", project: "p" });
    const pages = new PageStore(db, tmp);
    pages.setAssetOrigins(["https://wiki.example.test/"]);
    const p = pages.add({ knowledge_id: k.id, title: "P", content: `![x](https://wiki.example.test/img/${hash}.png)` });
    expect(pages.get(p.id)!.content).toBe(`![x](/img/${hash}.png)`);
    pages.update(p.id, { content: `see https://wiki.example.test/file/${hash}.zip` });
    expect(pages.get(p.id)!.content).toBe(`see /file/${hash}.zip`);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
