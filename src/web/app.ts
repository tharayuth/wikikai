import express, { type Express, type Request, type Response, type NextFunction } from "express";
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
import type { ToolHandlers } from "../mcp/handlers.js";
import { extractMermaidFences, mermaidViewerHtml } from "./mermaidViewer.js";
import { extractChartConfigs, chartViewerHtml } from "./chartViewer.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDistDir = path.resolve(here, "..", "..", "client", "dist");

export interface BuildAppOptions {
  knowledge: KnowledgeStore;
  pages: PageStore;
  images: ImageStore;
  promptLog: PromptLogStore;
  handlers: ToolHandlers;
  publicBaseUrl: string;
  mcpHandler?: express.RequestHandler;
  /** When set, /mcp requires `Authorization: Bearer <token>` */
  mcpToken?: string | null;
}

export function buildApp(opts: BuildAppOptions): Express {
  const app = express();
  app.use(express.json({ limit: "16mb" }));
  app.disable("x-powered-by");

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

  app.get("/api/knowledge/:id", async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
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
      const result = await opts.handlers.delete_knowledge({ id });
      res.json(result);
    } catch (e) {
      next(e);
    }
  });

  // ─── Projects: registry + derived names ───
  app.get("/api/projects", (_req, res, next) => {
    try {
      res.json({ projects: opts.knowledge.listProjects() });
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/projects", (req, res, next) => {
    try {
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
      const result = opts.knowledge.unregisterProject(req.params.name);
      res.json(result);
    } catch (e) {
      next(e);
    }
  });

  app.get("/api/knowledge/:id/outline", async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
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

  // ─── Checklist toggle (rendered checkboxes write back to the page) ───
  app.patch("/api/blocks/:bid/checklist/:idx", async (req, res, next) => {
    try {
      const bid = parseId(req.params.bid);
      const idx = parseInt(req.params.idx, 10);
      if (!Number.isFinite(idx) || idx < 0) {
        res.status(400).json({ error: "idx must be a non-negative integer" });
        return;
      }
      if (typeof req.body?.done !== "boolean") {
        res.status(400).json({ error: "`done` must be a boolean" });
        return;
      }
      const result = await opts.handlers.toggle_checklist_item({
        block_id: bid,
        index: idx,
        done: req.body.done,
      });
      res.json(result);
    } catch (e) {
      if (isNotFound(e)) {
        res.status(404).json({ error: (e as Error).message });
        return;
      }
      const msg = (e as Error).message;
      if (msg.startsWith("block ") || msg.includes("out of range")) {
        res.status(400).json({ error: msg });
        return;
      }
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

  app.patch("/api/pages/:pid", async (req, res, next) => {
    try {
      const pid = parseId(req.params.pid);
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
      res.json(opts.pages.pruneRevisions(pid));
    } catch (e) {
      next(e);
    }
  });

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

  // ─── MCP transport mount (with optional bearer token auth) ───
  if (opts.mcpHandler) {
    const token = opts.mcpToken;
    app.all("/mcp", (req, res, next) => {
      if (token) {
        const header = req.header("authorization") ?? "";
        const m = /^Bearer\s+(.+)$/i.exec(header.trim());
        if (!m || m[1].trim() !== token) {
          res.status(401).json({ error: "unauthorized" });
          return;
        }
      }
      opts.mcpHandler!(req, res, next);
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

  // ─── Error handler ───
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
