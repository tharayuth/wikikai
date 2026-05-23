import express, { type Express, type Request, type Response, type NextFunction, type ErrorRequestHandler } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderMarkdown } from "../render/markdown.js";
import type { KnowledgeStore } from "../store/knowledge.js";
import type { PageStore } from "../store/pages.js";
import {
  type ImageStore,
  mimeForExt,
  parseImageSrc,
} from "../store/images.js";
import type { PromptLogStore } from "../store/promptLog.js";
import type { ActivityLogStore } from "../store/activityLog.js";
import type { UserStore, SessionStore } from "../store/users.js";
import type { PermissionStore } from "../store/permissions.js";
import type { ToolHandlers } from "../mcp/handlers.js";
import { extractMermaidFences, mermaidViewerHtml } from "./mermaidViewer.js";
import { extractChartConfigs, chartViewerHtml } from "./chartViewer.js";
import { onEvent } from "../lib/events.js";
import { withCallContext } from "../lib/callContext.js";
import {
  attachAuthRoutes,
  requireAuth,
  sessionMiddleware,
} from "./auth.js";
import { ForbiddenError, assertProjectAccess } from "../lib/permissions.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDistDir = path.resolve(here, "..", "..", "client", "dist");

export interface BuildAppOptions {
  knowledge: KnowledgeStore;
  pages: PageStore;
  images: ImageStore;
  promptLog: PromptLogStore;
  activityLog: ActivityLogStore;
  users: UserStore;
  sessions: SessionStore;
  permissions: PermissionStore;
  /** Defaults to true. When false, project-level ACL is bypassed. */
  projectAclEnabled?: boolean;
  handlers: ToolHandlers;
  publicBaseUrl: string;
  mcpHandler?: express.RequestHandler;
  /** When set, /mcp requires `Authorization: Bearer <token>` */
  mcpToken?: string | null;
  /** When true, every web route (SPA + /api) requires a session
   *  cookie; unauthenticated visitors get bounced to /login. */
  webAuth?: boolean;
  /** User id used to tag MCP-source activity-log rows. */
  mcpDefaultUserId?: number | null;
}

export function buildApp(opts: BuildAppOptions): Express {
  const app = express();
  app.use(express.json({ limit: "16mb" }));
  app.disable("x-powered-by");

  const aclEnabled = opts.projectAclEnabled ?? true;

  /**
   * Throw `ForbiddenError` if the caller can't edit the affected
   * project. Admins, anonymous calls, and ACL-disabled mode bypass.
   * Pass a number (knowledge id, resolved via `opts.knowledge.get`)
   * or a project name string directly.
   */
  function gateEdit(req: Request, kidOrProject: number | string): void {
    if (!req.user || !aclEnabled || req.user.is_admin) return;
    let project: string;
    if (typeof kidOrProject === "number") {
      const k = opts.knowledge.get(kidOrProject);
      if (!k) throw new Error(`knowledge ${kidOrProject} not found`);
      project = k.project ?? "";
    } else {
      project = kidOrProject;
    }
    assertProjectAccess(req.user, project, "edit", opts.permissions, {
      enabled: aclEnabled,
    });
  }

  /** Admin-only guard for project-registry mutations. */
  function gateAdmin(req: Request): void {
    if (!aclEnabled) return;
    if (req.user && !req.user.is_admin) {
      throw new ForbiddenError("admin only");
    }
  }

  const authOpts = {
    users: opts.users,
    sessions: opts.sessions,
    permissions: opts.permissions,
    enabled: !!opts.webAuth,
  };

  // Read the session cookie + populate `req.user` AND tag the call
  // context for the activity-log recorder. Runs for every request so
  // both /api and the static SPA can see who's asking.
  app.use(sessionMiddleware(authOpts));
  // Gate guard — when WIKIKAI_WEB_AUTH=1, anonymous /api calls get 401
  // and anonymous SPA loads get redirected to /login.
  app.use(requireAuth(authOpts));
  attachAuthRoutes(app, authOpts);

  // ─── Images: content-addressed binary serving ───
  // Path is /img/<sha256>.<ext>; hash + ext are validated so no traversal
  // and the file is immutable, so we set a year-long cache header.
  app.get("/img/:filename", (req, res, next) => {
    try {
      const parsed = parseImageSrc(`/img/${req.params.filename}`);
      if (!parsed) {
        res.status(400).type("text/plain").send("bad image filename");
        return;
      }
      const meta = opts.images.get(parsed.hash);
      if (!meta) {
        res.status(404).type("text/plain").send("image not found");
        return;
      }
      const file = opts.images.filePath(meta.hash, meta.ext);
      if (!fs.existsSync(file)) {
        res.status(404).type("text/plain").send("image file missing");
        return;
      }
      res.type(mimeForExt(meta.ext) ?? meta.mime);
      res.set("Cache-Control", "public, max-age=31536000, immutable");
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      next(e);
    }
  });

  // Browser-friendly image upload — accepts base64 JSON (same shape as
  // the MCP `add_image` tool). Reuses the handler so dedup + alt + path
  // generation stay in one place.
  app.post("/api/images", async (req, res, next) => {
    try {
      const kidRaw = req.body?.knowledge_id;
      if (typeof kidRaw === "number" && Number.isInteger(kidRaw) && kidRaw > 0) {
        gateEdit(req, kidRaw);
      }
      const result = await opts.handlers.add_image({
        data_base64: req.body?.data_base64,
        mime_type: req.body?.mime_type,
        alt: req.body?.alt,
      });
      res.status(201).json(result);
    } catch (e) {
      const msg = (e as Error).message;
      if (
        msg.startsWith("base64 decode failed") ||
        msg.includes("Invalid enum value") ||
        msg.includes("Required")
      ) {
        res.status(400).json({ error: msg });
        return;
      }
      next(e);
    }
  });

  // ─── Server-Sent Events ───
  // One persistent text/event-stream per client; the server fans out
  // store mutations from src/lib/events.ts so every open tab can
  // invalidate the right RTK Query tags in real time. Lightweight —
  // 25s keep-alive ping, JSON-encoded payload, no auth gate (same
  // policy as the rest of /api which is meant to be network-protected).
  app.get("/api/events", (req, res) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    res.write(`: connected\n\n`);
    const ping = setInterval(() => {
      try {
        res.write(`: ping\n\n`);
      } catch {
        /* socket closed */
      }
    }, 25000);
    const off = onEvent((e) => {
      try {
        res.write(`data: ${JSON.stringify(e)}\n\n`);
      } catch {
        /* socket closed */
      }
    });
    req.on("close", () => {
      clearInterval(ping);
      off();
    });
  });

  // ─── Knowledge API ───
  // Lightweight index of every page (id, kid, position, title) for
  // client-side filter / quick navigation. No content reads, single query.
  app.get("/api/page-titles", (_req, res, next) => {
    try {
      res.json(opts.pages.listAllTitles());
    } catch (e) {
      next(e);
    }
  });

  app.get("/api/knowledge", async (req, res, next) => {
    try {
      if (req.user && aclEnabled && !req.user.is_admin) {
        const visible = new Set(
          opts.permissions.listVisibleProjects(req.user.id, false),
        );
        const all = await opts.handlers.list_knowledge({});
        res.json(
          all.filter(
            (k: { project: string | null }) =>
              k.project != null && visible.has(k.project),
          ),
        );
        return;
      }
      const items = await opts.handlers.list_knowledge({
        project: optional(req.query.project),
        session_id: optional(req.query.session_id),
        tag: optional(req.query.tag),
        search: optional(req.query.search),
        limit: optionalInt(req.query.limit),
        offset: optionalInt(req.query.offset),
      });
      res.json(items);
    } catch (e) {
      next(e);
    }
  });

  app.post("/api/knowledge", async (req, res, next) => {
    try {
      if (typeof req.body?.project !== "string" || !req.body.project.trim()) {
        res.status(400).json({ error: "project is required" });
        return;
      }
      gateEdit(req, req.body.project.trim());
      const result = await opts.handlers.add_knowledge(req.body);
      res.status(201).json(result);
    } catch (e) {
      next(e);
    }
  });

  app.get("/api/knowledge/:id", async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      const k = opts.knowledge.get(id);
      if (!k) {
        res.status(404).json({ error: `knowledge #${id} not found` });
        return;
      }
      if (req.user && aclEnabled && !req.user.is_admin) {
        assertProjectAccess(req.user, k.project ?? "", "view", opts.permissions, { enabled: aclEnabled });
      }
      const out = await opts.handlers.get_knowledge({ id, include_pages: true });
      res.json(out);
    } catch (e) {
      if (isNotFound(e)) {
        res.status(404).json({ error: (e as Error).message });
        return;
      }
      next(e);
    }
  });

  app.patch("/api/knowledge/:id", async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (
        req.body?.project !== undefined &&
        (typeof req.body.project !== "string" || !req.body.project.trim())
      ) {
        res.status(400).json({ error: "project is required" });
        return;
      }
      const existing = opts.knowledge.get(id);
      if (!existing) {
        res.status(404).json({ error: `knowledge #${id} not found` });
        return;
      }
      gateEdit(req, id); // edit on old project
      if (
        typeof req.body?.project === "string" &&
        req.body.project.trim() &&
        req.body.project.trim() !== existing.project
      ) {
        gateEdit(req, req.body.project.trim()); // edit on new project too
      }
      const result = await opts.handlers.edit_knowledge({ id, ...req.body });
      res.json(result);
    } catch (e) {
      if (isNotFound(e)) {
        res.status(404).json({ error: (e as Error).message });
        return;
      }
      next(e);
    }
  });

  app.delete("/api/knowledge/:id", async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (!opts.knowledge.get(id)) {
        res.status(404).json({ error: `knowledge #${id} not found` });
        return;
      }
      gateEdit(req, id);
      const result = await opts.handlers.delete_knowledge({ id });
      res.json(result);
    } catch (e) {
      next(e);
    }
  });

  // Reorder pages within a knowledge. Body: { order: number[] } — full
  // permutation of every existing page id. Used by the Sidebar's drag-drop UI.
  app.post("/api/knowledge/:id/reorder", async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (!opts.knowledge.get(id)) {
        res.status(404).json({ error: `knowledge #${id} not found` });
        return;
      }
      gateEdit(req, id);
      const order = Array.isArray(req.body?.order) ? req.body.order : null;
      if (
        !order ||
        order.length === 0 ||
        !order.every((n: unknown) => Number.isInteger(n) && (n as number) > 0)
      ) {
        res
          .status(400)
          .json({ error: "order must be a non-empty array of positive page ids" });
        return;
      }
      const result = await opts.handlers.reorder_pages({
        knowledge_id: id,
        order,
      });
      res.json(result);
    } catch (e) {
      if (isNotFound(e)) {
        res.status(404).json({ error: (e as Error).message });
        return;
      }
      next(e);
    }
  });

  // ─── Projects: registry + derived names ───
  app.get("/api/projects", (req, res, next) => {
    try {
      const all = opts.knowledge.listProjects();
      if (!req.user || !aclEnabled || req.user.is_admin) {
        res.json({ projects: all });
        return;
      }
      const visible = new Set(
        opts.permissions.listVisibleProjects(req.user.id, false),
      );
      res.json({
        projects: all.filter((p: { name: string }) => visible.has(p.name)),
      });
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/projects", (req, res, next) => {
    try {
      gateAdmin(req);
      const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
      if (!name) {
        res.status(400).json({ error: "name is required" });
        return;
      }
      if (name.length > 100) {
        res.status(400).json({ error: "name must be ≤ 100 chars" });
        return;
      }
      const row = opts.knowledge.registerProject(name);
      res.status(201).json(row);
    } catch (e) {
      next(e);
    }
  });
  app.delete("/api/projects/:name", (req, res, next) => {
    try {
      gateAdmin(req);
      const result = opts.knowledge.unregisterProject(req.params.name);
      res.json(result);
    } catch (e) {
      next(e);
    }
  });

  app.get("/api/knowledge/:id/outline", async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      const k = opts.knowledge.get(id);
      if (!k) {
        res.status(404).json({ error: `knowledge #${id} not found` });
        return;
      }
      if (req.user && aclEnabled && !req.user.is_admin) {
        assertProjectAccess(req.user, k.project ?? "", "view", opts.permissions, { enabled: aclEnabled });
      }
      const out = await opts.handlers.get_outline({ knowledge_id: id });
      res.json(out);
    } catch (e) {
      if (isNotFound(e)) {
        res.status(404).json({ error: (e as Error).message });
        return;
      }
      next(e);
    }
  });

  // Activity log — chronological audit trail of every mutating action
  // (add / edit / delete / toggle / caption / upload / reorder / resize).
  // Snapshots titles + captions at the time of the action so entries
  // stay readable even after the target is renamed or deleted. Used
  // by the "View activity log" dialog in the topbar.
  app.get("/api/activity", (req, res, next) => {
    try {
      const limit = optionalInt(req.query.limit);
      const offset = optionalInt(req.query.offset);
      const kidRaw = optional(req.query.knowledge_id);
      const knowledge_id = kidRaw ? Number(kidRaw) : undefined;
      const visibleProjects =
        !req.user || !aclEnabled || req.user.is_admin
          ? null
          : opts.permissions.listVisibleProjects(req.user.id, false);
      const r = opts.activityLog.list({
        limit,
        offset,
        knowledge_id,
        visibleProjects,
      });
      res.json(r);
    } catch (e) {
      next(e);
    }
  });

  app.get("/api/knowledge/:id/prompts", async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      const meta = opts.knowledge.get(id);
      if (!meta) {
        res.status(404).json({ error: `knowledge #${id} not found` });
        return;
      }
      const limit = optionalInt(req.query.limit);
      const offset = optionalInt(req.query.offset);
      const entries = opts.promptLog.listForKnowledge(id, { limit, offset });
      res.json({ knowledge_id: id, total: entries.length, entries });
    } catch (e) {
      next(e);
    }
  });

  // ─── Pages API ───
  app.get("/api/pages/:pid", async (req, res, next) => {
    try {
      const pid = parseId(req.params.pid);
      const meta = opts.pages.getMetadata(pid);
      if (!meta) {
        res.status(404).json({ error: "page not found" });
        return;
      }
      if (req.user && aclEnabled && !req.user.is_admin) {
        const k = opts.knowledge.get(meta.knowledge_id);
        assertProjectAccess(req.user, k?.project ?? "", "view", opts.permissions, { enabled: aclEnabled });
      }
      const r = opts.pages.readLines(pid);
      res.json({
        id: pid,
        knowledge_id: meta.knowledge_id,
        title: meta.title,
        summary: meta.summary,
        keywords: meta.keywords,
        version: meta.version,
        created_at: meta.created_at,
        updated_at: meta.updated_at,
        total_lines: r.total_lines,
        content: r.content,
      });
    } catch (e) {
      next(e);
    }
  });

  app.get("/api/pages/:pid/rendered", async (req, res, next) => {
    try {
      const pid = parseId(req.params.pid);
      const meta = opts.pages.getMetadata(pid);
      if (!meta) {
        res.status(404).type("text/html").send("<p>not found</p>");
        return;
      }
      if (req.user && aclEnabled && !req.user.is_admin) {
        const k = opts.knowledge.get(meta.knowledge_id);
        assertProjectAccess(req.user, k?.project ?? "", "view", opts.permissions, { enabled: aclEnabled });
      }
      // Optional ?version=N — render that historical revision instead.
      const versionParam = optionalInt(req.query.version);
      let content: string;
      if (versionParam !== undefined && versionParam !== meta.version) {
        const rev = opts.pages.getRevision(pid, versionParam);
        if (!rev) {
          res.status(404).type("text/html").send("<p>revision not found</p>");
          return;
        }
        content = rev.content;
      } else {
        content = opts.pages.readLines(pid).content;
      }
      const html = await renderMarkdown(content);
      res.type("text/html").send(html);
    } catch (e) {
      next(e);
    }
  });

  // List the revision history of a page (no content payload).
  app.get("/api/pages/:pid/revisions", (req, res, next) => {
    try {
      const pid = parseId(req.params.pid);
      const meta = opts.pages.getMetadata(pid);
      if (!meta) {
        res.status(404).json({ error: "page not found" });
        return;
      }
      if (req.user && aclEnabled && !req.user.is_admin) {
        const k = opts.knowledge.get(meta.knowledge_id);
        assertProjectAccess(req.user, k?.project ?? "", "view", opts.permissions, { enabled: aclEnabled });
      }
      res.json({
        page_id: pid,
        current_version: meta.version,
        revisions: opts.pages.listRevisions(pid),
      });
    } catch (e) {
      next(e);
    }
  });

  app.get("/api/pages/:pid/raw", async (req, res, next) => {
    try {
      const pid = parseId(req.params.pid);
      const meta = opts.pages.getMetadata(pid);
      if (!meta) {
        res.status(404).type("text/plain").send("not found");
        return;
      }
      if (req.user && aclEnabled && !req.user.is_admin) {
        const k = opts.knowledge.get(meta.knowledge_id);
        assertProjectAccess(req.user, k?.project ?? "", "view", opts.permissions, { enabled: aclEnabled });
      }
      const versionParam = optionalInt(req.query.version);
      if (versionParam !== undefined && versionParam !== meta.version) {
        const rev = opts.pages.getRevision(pid, versionParam);
        if (!rev) {
          res.status(404).type("text/plain").send("revision not found");
          return;
        }
        res.type("text/plain").send(rev.content);
        return;
      }
      res.type("text/plain").send(opts.pages.readLines(pid).content);
    } catch (e) {
      next(e);
    }
  });

  // Return the raw inner content of a block (`{@N}`) as `text/plain`.
  // For fenced blocks this is the fence body without the ``` markers;
  // for markdown tables it's the full source (header + separator +
  // rows) so a "Copy content" UI in the client can paste a usable
  // chunk back. ACL: viewer-level on the owning project, same as the
  // page raw endpoint.
  app.get("/api/blocks/:id/content", async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      const block = opts.pages.getBlock(id);
      if (!block) {
        res.status(404).type("text/plain").send("not found");
        return;
      }
      if (req.user && aclEnabled && !req.user.is_admin) {
        const k = opts.knowledge.get(block.knowledge_id);
        assertProjectAccess(
          req.user,
          k?.project ?? "",
          "view",
          opts.permissions,
          { enabled: aclEnabled },
        );
      }
      // For tables, `inner` strips the header — return `source` so the
      // copied markdown is self-contained. For every fenced kind,
      // `inner` is exactly the body between ``` markers, which is what
      // a "Copy content" action wants.
      const content = block.kind === "table" ? block.source : block.inner;
      res.type("text/plain").send(content);
    } catch (e) {
      next(e);
    }
  });

  app.patch("/api/pages/:pid", async (req, res, next) => {
    try {
      const pid = parseId(req.params.pid);
      const meta = opts.pages.getMetadata(pid);
      if (!meta) {
        res.status(404).json({ error: "page not found" });
        return;
      }
      gateEdit(req, meta.knowledge_id);
      const r = await opts.handlers.edit_page({ page_id: pid, ...req.body });
      res.json(r);
    } catch (e) {
      if (isNotFound(e)) {
        res.status(404).json({ error: (e as Error).message });
        return;
      }
      next(e);
    }
  });

  app.delete("/api/pages/:pid", async (req, res, next) => {
    try {
      const pid = parseId(req.params.pid);
      const meta = opts.pages.getMetadata(pid);
      if (!meta) {
        res.status(404).json({ error: "page not found" });
        return;
      }
      gateEdit(req, meta.knowledge_id);
      const r = await opts.handlers.delete_page({ page_id: pid });
      res.json(r);
    } catch (e) {
      next(e);
    }
  });

  // Prune historical revisions, keep only the current/live version snapshot.
  app.delete("/api/pages/:pid/revisions", (req, res, next) => {
    try {
      const pid = parseId(req.params.pid);
      const meta = opts.pages.getMetadata(pid);
      if (!meta) {
        res.status(404).json({ error: "page not found" });
        return;
      }
      gateEdit(req, meta.knowledge_id);
      res.json(opts.pages.pruneRevisions(pid));
    } catch (e) {
      next(e);
    }
  });

  // Flip the Nth GFM task checkbox (- [ ] / - [x]) in a page's source.
  // Index is 0-based, page-wide, in document order, skipping any task
  // syntax inside fenced code blocks.
  app.post("/api/pages/:pid/tasks/:index/toggle", (req, res, next) => {
    try {
      const pid = parseId(req.params.pid);
      const idx = Number(req.params.index);
      if (!Number.isInteger(idx) || idx < 0) {
        res.status(400).json({ error: "invalid task index" });
        return;
      }
      const meta = opts.pages.getMetadata(pid);
      if (!meta) {
        res.status(404).json({ error: "page not found" });
        return;
      }
      gateEdit(req, meta.knowledge_id);
      const result = opts.pages.toggleTaskAtIndex(pid, idx);
      if (meta) {
        opts.activityLog.record({
          action: "toggle",
          target: "task",
          knowledge_id: meta.knowledge_id,
          knowledge_title: opts.knowledge.get(meta.knowledge_id)?.title ?? null,
          page_id: pid,
          page_title: meta.title,
        });
      }
      res.json(result);
    } catch (e) {
      next(e);
    }
  });

  // Resize an image via the client-side drag handles. Two flavours:
  //
  //   • Inline markdown img — pass `{ src, occurrence, width?, height? }`.
  //     Persists to the title slot (`![alt](src "WxH")`), keeping `alt`
  //     available for screen-reader / FTS text.
  //   • <img> inside an `html-embed` fence — pass `{ block_id, index,
  //     width?, height? }`. Persists to the `<img>` tag's inline
  //     `style` attribute (`max-width:Npx;max-height:Mpx`), leaving
  //     other style properties intact.
  //
  // Pass `null`/undefined for either dimension to remove that constraint;
  // pass both empty to clear sizing entirely.
  app.post("/api/pages/:pid/image-size", (req, res, next) => {
    try {
      const pid = parseId(req.params.pid);
      const metaForGate = opts.pages.getMetadata(pid);
      if (!metaForGate) {
        res.status(404).json({ error: "page not found" });
        return;
      }
      gateEdit(req, metaForGate.knowledge_id);
      const body = req.body as {
        src?: unknown;
        occurrence?: unknown;
        block_id?: unknown;
        index?: unknown;
        width?: unknown;
        height?: unknown;
      };
      const toDim = (v: unknown): number | undefined => {
        if (v == null) return undefined;
        if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
        if (v <= 0) return undefined;
        return Math.round(v);
      };
      const dims = { width: toDim(body.width), height: toDim(body.height) };

      // html-embed path takes precedence when block_id is present
      if (body.block_id != null) {
        const blockId =
          typeof body.block_id === "number" ? body.block_id : Number(body.block_id);
        if (!Number.isInteger(blockId) || blockId <= 0) {
          res.status(400).json({ error: "invalid block_id" });
          return;
        }
        const imgIndex = typeof body.index === "number" ? body.index : 0;
        if (!Number.isInteger(imgIndex) || imgIndex < 0) {
          res.status(400).json({ error: "invalid index" });
          return;
        }
        const result = opts.pages.setHtmlEmbedImageSize(
          pid,
          blockId,
          imgIndex,
          dims,
        );
        logImageResize(pid, blockId);
        res.json(result);
        return;
      }

      const src = typeof body.src === "string" ? body.src : "";
      if (!src) {
        res.status(400).json({ error: "src or block_id is required" });
        return;
      }
      const occRaw = body.occurrence;
      const occurrence = typeof occRaw === "number" ? occRaw : 0;
      if (!Number.isInteger(occurrence) || occurrence < 0) {
        res.status(400).json({ error: "invalid occurrence" });
        return;
      }
      const result = opts.pages.setInlineImageSize(pid, src, occurrence, dims);
      logImageResize(pid, null);
      res.json(result);
    } catch (e) {
      next(e);
    }
  });

  // Helper for the resize route — keeps the activity-log call out of
  // both branches without duplicating the metadata lookup.
  function logImageResize(pid: number, blockId: number | null): void {
    const meta = opts.pages.getMetadata(pid);
    if (!meta) return;
    opts.activityLog.record({
      action: "resize",
      target: "image",
      knowledge_id: meta.knowledge_id,
      knowledge_title: opts.knowledge.get(meta.knowledge_id)?.title ?? null,
      page_id: pid,
      page_title: meta.title,
      block_id: blockId,
    });
  }

  // ─── Search ───
  app.get("/api/search", async (req, res, next) => {
    try {
      const q = optional(req.query.q);
      if (!q) {
        res.json({ hits: [], total: 0 });
        return;
      }
      const r = await opts.handlers.search({
        query: q,
        project: optional(req.query.project),
        projects: parseProjects(req.query.projects),
        knowledge_id: optionalInt(req.query.knowledge_id),
        limit: optionalInt(req.query.limit),
      });
      res.json(r);
    } catch (e) {
      next(e);
    }
  });

  // ─── Standalone mermaid viewer (opens in a new tab from rendered pages) ───
  app.get("/mermaid/:pid/:idx", (req, res, next) => {
    try {
      const pid = parseId(req.params.pid);
      const idx = Number(req.params.idx);
      if (!Number.isInteger(idx) || idx < 0) {
        res.status(400).type("text/plain").send("invalid index");
        return;
      }
      const meta = opts.pages.getMetadata(pid);
      if (!meta) {
        res.status(404).type("text/html").send("<p>page not found</p>");
        return;
      }
      const content = opts.pages.readLines(pid).content;
      const fences = extractMermaidFences(content);
      if (idx >= fences.length) {
        res
          .status(404)
          .type("text/html")
          .send(
            `<p>mermaid #${idx + 1} not found in page #${pid} (only ${fences.length} mermaid block${fences.length === 1 ? "" : "s"})</p>`,
          );
        return;
      }
      const knowledge = opts.knowledge.get(meta.knowledge_id);
      res.type("text/html").send(
        mermaidViewerHtml({
          pageTitle: meta.title,
          knowledgeTitle: knowledge?.title ?? `&${meta.knowledge_id}`,
          source: fences[idx],
        }),
      );
    } catch (e) {
      next(e);
    }
  });

  // ─── Standalone chart viewer ───
  app.get("/chart/:pid/:idx", (req, res, next) => {
    try {
      const pid = parseId(req.params.pid);
      const idx = Number(req.params.idx);
      if (!Number.isInteger(idx) || idx < 0) {
        res.status(400).type("text/plain").send("invalid index");
        return;
      }
      const meta = opts.pages.getMetadata(pid);
      if (!meta) {
        res.status(404).type("text/html").send("<p>page not found</p>");
        return;
      }
      const content = opts.pages.readLines(pid).content;
      const charts = extractChartConfigs(content);
      if (idx >= charts.length) {
        res
          .status(404)
          .type("text/html")
          .send(
            `<p>chart #${idx + 1} not found in page #${pid} (only ${charts.length} chart${charts.length === 1 ? "" : "s"})</p>`,
          );
        return;
      }
      const knowledge = opts.knowledge.get(meta.knowledge_id);
      const c = charts[idx];
      res.type("text/html").send(
        chartViewerHtml({
          pageTitle: meta.title,
          knowledgeTitle: knowledge?.title ?? `&${meta.knowledge_id}`,
          config: c.config,
          chartTitle: c.title,
        }),
      );
    } catch (e) {
      next(e);
    }
  });

  // ─── MCP transport mount (Bearer token → per-user identification) ───
  // Two token sources, checked in order:
  //   1. The user's personal mcp_token (recommended) — resolves to that
  //      user. Every activity-log row written during the call gets
  //      stamped with their user_id + display_name.
  //   2. The legacy `WIKIKAI_TOKEN` env var (when set) — falls back to
  //      tagging with `mcpDefaultUserId` (usually the bootstrap admin).
  // Anonymous calls are rejected when EITHER token source is present.
  if (opts.mcpHandler) {
    const legacyToken = opts.mcpToken;
    app.all("/mcp", (req, res, next) => {
      const header = req.header("authorization") ?? "";
      const m = /^Bearer\s+(.+)$/i.exec(header.trim());
      const presented = m?.[1].trim() ?? null;

      let userId: number | null = null;
      if (presented) {
        const user = opts.users.getByMcpToken(presented);
        if (user) {
          userId = user.id;
        } else if (legacyToken && presented === legacyToken) {
          userId = opts.mcpDefaultUserId ?? null;
        } else {
          res.status(401).json({ error: "unauthorized" });
          return;
        }
      } else if (legacyToken) {
        // Env requires a token but none was presented
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      // Tag the call context with the acting user — the Proxy in
      // createMcpServer will read this when wrapping each tool call.
      withCallContext({ source: "web", user_id: userId }, () => {
        opts.mcpHandler!(req, res, next);
      });
    });
  }

  // ─── Static client (production) ───
  // In dev, Vite dev server runs on :5173 and proxies /api + /mcp here, so
  // we don't need to serve any HTML. In prod, `npm run build` populates
  // client/dist/ and Express serves it (with SPA fallback for hash routes).
  if (fs.existsSync(clientDistDir)) {
    app.use(express.static(clientDistDir, { index: false, maxAge: "1h" }));
    app.get(/^(?!\/api|\/mcp).*/, (_req, res, next) => {
      const indexHtml = path.join(clientDistDir, "index.html");
      if (!fs.existsSync(indexHtml)) return next();
      res.type("text/html").sendFile(indexHtml);
    });
  } else {
    // Friendly hint when no build exists
    app.get("/", (_req, res) => {
      res
        .status(200)
        .type("text/html")
        .send(
          `<!doctype html><meta charset="utf-8"><title>wikikai</title>
          <h1>wikikai backend running</h1>
          <p>No client build found at <code>${clientDistDir}</code>.</p>
          <p>Run <code>npm run dev</code> (Vite at <a href="http://localhost:5173">:5173</a>) or <code>npm run build:client</code> for production.</p>
          <p>API base: <code>/api</code> · MCP: <code>/mcp</code></p>`,
        );
    });
  }

  // ─── Error handlers ───
  // ForbiddenError → 403 JSON response
  app.use(((err, _req, res, next) => {
    if (err instanceof ForbiddenError) {
      res.status(403).json({ error: err.message });
      return;
    }
    next(err);
  }) as ErrorRequestHandler);

  // Generic error handler → 400 JSON response
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  });

  return app;
}

function optional(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
function parseProjects(v: unknown): string[] | undefined {
  if (Array.isArray(v)) {
    return v.filter((x): x is string => typeof x === "string" && x.length > 0);
  }
  if (typeof v === "string" && v.length > 0) {
    return v.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return undefined;
}
function optionalInt(v: unknown): number | undefined {
  if (typeof v !== "string") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function parseId(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error("invalid id");
  return n;
}
function isNotFound(e: unknown): boolean {
  return e instanceof Error && /not found/i.test(e.message);
}
