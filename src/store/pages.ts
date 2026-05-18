import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Db } from "./db.js";

export interface PageMetadata {
  id: number;
  knowledge_id: number;
  position: number;
  title: string;
  summary: string | null;
  keywords: string[];
  created_at: string;
  updated_at: string;
  version: number;
}

export interface PageWithStats extends PageMetadata {
  line_count: number;
}

export interface PageEntry extends PageMetadata {
  content: string;
  line_count: number;
}

export interface AddPageInput {
  knowledge_id: number;
  title: string;
  content: string;
  summary?: string;
  keywords?: string[];
  position?: number;
}

export interface UpdatePageInput {
  title?: string;
  content?: string;
  summary?: string;
  keywords?: string[];
}

export interface SearchHit {
  knowledge_id: number;
  knowledge_title: string;
  /** Optional project the parent knowledge belongs to (null when unset). */
  project: string | null;
  page_id: number;
  page_title: string;
  /** 1-based tab order of the page within its knowledge. */
  page_position: number;
  /** Line where the match was located (1-based). */
  line: number;
  /** Nearest preceding heading (## / ### …) containing the matched line, or null
   *  when the match is in the preamble before any heading. */
  heading: {
    level: number;
    text: string;
    line: number;
    id: string;
  } | null;
  snippet: string;
  score: number;
  /** Set when the hit came from an `@N` block-id lookup. */
  block_id?: number;
}

interface PageRow {
  id: number;
  knowledge_id: number;
  position: number;
  title: string;
  summary: string | null;
  keywords: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

function parseKeywords(k: string | null): string[] {
  if (!k) return [];
  return k.split(",").map((t) => t.trim()).filter(Boolean);
}

function joinKeywords(k: string[] | undefined): string | null {
  if (!k || k.length === 0) return null;
  return k.map((t) => t.trim()).filter(Boolean).join(",");
}

function rowToMetadata(row: PageRow): PageMetadata {
  return {
    id: row.id,
    knowledge_id: row.knowledge_id,
    position: row.position,
    title: row.title,
    summary: row.summary,
    keywords: parseKeywords(row.keywords),
    created_at: row.created_at,
    updated_at: row.updated_at,
    version: row.version,
  };
}

function countLines(s: string): number {
  if (s.length === 0) return 0;
  // count separators + 1 (so "a\nb" = 2 lines, "a\n" = 1 logical line + empty trailing)
  let n = 1;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  // if the string ends with newline, the trailing "" isn't really a line — strip
  if (s.endsWith("\n")) n--;
  return n;
}

export function hashRange(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

export class PageStore {
  constructor(private db: Db, private itemsDir: string) {
    fs.mkdirSync(itemsDir, { recursive: true });
    this.migrateFtsTokenizer("trigram");
    this.backfillRevisions();
    this.backfillBlockIds();
  }

  // ─────────── Block lookup (@N) ───────────

  /**
   * Find a rich block by its global `@N` id. Uses FTS to locate the page
   * cheaply, then scans that page's source for the exact `{@N}` annotation
   * on a fence line and returns both the wrapping source (with ``` markers)
   * and the inner body, plus parent page/knowledge context. Returns null if
   * the id isn't present in any page.
   */
  getBlock(blockId: number): {
    block_id: number;
    kind: string;
    source: string;
    inner: string;
    line_start: number;
    line_end: number;
    page_id: number;
    page_position: number;
    page_title: string;
    knowledge_id: number;
    knowledge_title: string;
    project: string | null;
  } | null {
    const annotation = `{@${blockId}}`;
    const row = this.db
      .prepare(
        `SELECT pages_fts.rowid AS page_id FROM pages_fts
         WHERE pages_fts MATCH @q LIMIT 1`,
      )
      .get({ q: `"${annotation}"` }) as { page_id: number } | undefined;
    if (!row) return null;
    const meta = this.getMetadata(row.page_id);
    if (!meta) return null;
    const content = this.readContent(meta.knowledge_id, row.page_id);
    const lines = content.split("\n");
    let startIdx = -1;
    let kind = "";
    let fenceMarker = "";
    for (let i = 0; i < lines.length; i++) {
      const m = /^(\s*)(```+)\s*([A-Za-z0-9_-]+)[^\n]*?\{@(\d+)\}/.exec(lines[i]);
      if (m && Number(m[4]) === blockId) {
        startIdx = i;
        kind = m[3].toLowerCase();
        fenceMarker = m[2];
        break;
      }
    }
    if (startIdx === -1) return null;
    let endIdx = -1;
    const closeRe = new RegExp(`^\\s*${fenceMarker.replace(/`/g, "`")}+\\s*$`);
    for (let i = startIdx + 1; i < lines.length; i++) {
      if (closeRe.test(lines[i])) {
        endIdx = i;
        break;
      }
    }
    if (endIdx === -1) return null;
    const source = lines.slice(startIdx, endIdx + 1).join("\n");
    const inner = lines.slice(startIdx + 1, endIdx).join("\n");
    const knowledge = this.db
      .prepare(`SELECT title, project FROM knowledge WHERE id = ?`)
      .get(meta.knowledge_id) as { title: string; project: string | null } | undefined;
    return {
      block_id: blockId,
      kind,
      source,
      inner,
      line_start: startIdx + 1,
      line_end: endIdx + 1,
      page_id: row.page_id,
      page_position: meta.position,
      page_title: meta.title,
      knowledge_id: meta.knowledge_id,
      knowledge_title: knowledge?.title ?? "",
      project: knowledge?.project ?? null,
    };
  }

  // ─────────── Block IDs (@N) ───────────

  /**
   * Allocate the next global block id. Atomic via single-row UPDATE.
   * Never returns a previously-used id even after blocks are deleted.
   */
  private allocBlockId(): number {
    const row = this.db
      .prepare(`UPDATE block_seq SET next_id = next_id + 1 WHERE id = 0 RETURNING next_id - 1 AS allocated`)
      .get() as { allocated: number } | undefined;
    if (!row) throw new Error("block_seq row missing");
    return row.allocated;
  }

  /**
   * Scan markdown for rich fenced blocks (mermaid/chart/chart-grid/stats/
   * steps/html-embed) and ensure each has a `{@N}` annotation in its info
   * string. Blocks that already have one are left as-is. Returns the
   * possibly-modified content.
   */
  private injectBlockIds(content: string): string {
    const lines = content.split("\n");
    const RICH = new Set([
      "mermaid",
      "chart",
      "chart-grid",
      "stats",
      "steps",
      "html-embed",
      "images",
    ]);
    let inFence = false;
    let fenceMarker = "";
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!inFence) {
        const open = /^(\s*)(```+)\s*([A-Za-z0-9_-]+)(.*)$/.exec(line);
        if (open) {
          const [, indent, marker, lang, rest] = open;
          inFence = true;
          fenceMarker = marker;
          if (RICH.has(lang.toLowerCase()) && !/\{@\d+\}/.test(rest)) {
            const newId = this.allocBlockId();
            // Preserve any other trailing tokens by appending the annotation
            lines[i] = `${indent}${marker}${lang}${rest.replace(/\s*$/, "")} {@${newId}}`;
          }
        }
      } else {
        // Look for matching closing fence (same marker length)
        const close = new RegExp(`^\\s*${fenceMarker.replace(/`/g, "`")}+\\s*$`);
        if (close.test(line)) {
          inFence = false;
          fenceMarker = "";
        }
      }
    }
    return lines.join("\n");
  }

  /** Backfill block IDs into every page's content on startup. Skips pages
   *  whose content already has a `{@N}` somewhere (cheap check — we don't
   *  re-scan to find partially-annotated pages; injectBlockIds is run on
   *  every save afterwards so partial pages catch up naturally). */
  private backfillBlockIds(): void {
    const pageRows = this.db
      .prepare(`SELECT id, knowledge_id FROM pages`)
      .all() as Array<{ id: number; knowledge_id: number }>;
    let touched = 0;
    for (const row of pageRows) {
      const content = this.readContent(row.knowledge_id, row.id);
      const next = this.injectBlockIds(content);
      if (next !== content) {
        this.writeContent(row.knowledge_id, row.id, next);
        // Re-sync FTS with new content; don't bump page version (this is a
        // schema migration, not an author edit).
        const meta = this.getMetadata(row.id);
        if (meta) {
          this.syncFts(row.id, meta.title, meta.keywords, next);
        }
        touched++;
      }
    }
    if (touched > 0) {
      // eslint-disable-next-line no-console
      console.log(`[wikikai] backfilled block ids into ${touched} pages`);
    }
  }

  /**
   * Seed page_revisions for pre-existing pages that have no history at all.
   * Records a single snapshot at the page's current version so the UI has
   * at least one entry to render. Pages with any existing revision rows are
   * skipped.
   */
  private backfillRevisions(): void {
    const rows = this.db
      .prepare(
        `SELECT p.id, p.knowledge_id, p.title, p.summary, p.keywords,
                p.version, p.updated_at
         FROM pages p
         WHERE NOT EXISTS (
           SELECT 1 FROM page_revisions r WHERE r.page_id = p.id
         )`,
      )
      .all() as Array<{
      id: number;
      knowledge_id: number;
      title: string;
      summary: string | null;
      keywords: string | null;
      version: number;
      updated_at: string;
    }>;
    if (rows.length === 0) return;
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO page_revisions
        (page_id, version, title, content, summary, keywords, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const tx = this.db.transaction(() => {
      for (const r of rows) {
        const content = this.readContent(r.knowledge_id, r.id);
        insert.run(
          r.id,
          r.version,
          r.title,
          content,
          r.summary,
          r.keywords,
          r.updated_at,
        );
      }
    });
    tx();
    // eslint-disable-next-line no-console
    console.log(`[wikikai] seeded page_revisions for ${rows.length} pages`);
  }

  /**
   * If the pages_fts virtual table was created with an older tokenizer
   * (e.g. unicode61, which doesn't tokenize Thai/CJK), drop it and rebuild
   * with the desired tokenizer, then reindex from `pages` + on-disk files.
   * Safe to call on every startup; no-op when already on the desired
   * tokenizer.
   */
  private migrateFtsTokenizer(desired: string): void {
    const row = this.db
      .prepare(
        `SELECT sql FROM sqlite_master WHERE type='table' AND name='pages_fts'`,
      )
      .get() as { sql: string } | undefined;
    if (!row) return; // schema.sql will create it fresh
    if (new RegExp(`tokenize\\s*=\\s*['"]${desired}\\b`, "i").test(row.sql)) {
      return; // already on the desired tokenizer
    }
    // eslint-disable-next-line no-console
    console.log(`[wikikai] rebuilding pages_fts with tokenize='${desired}' …`);
    const pagesRows = this.db
      .prepare(`SELECT id, knowledge_id, title, keywords FROM pages`)
      .all() as Array<{
      id: number;
      knowledge_id: number;
      title: string;
      keywords: string | null;
    }>;
    this.db.exec(`DROP TABLE pages_fts`);
    this.db.exec(
      `CREATE VIRTUAL TABLE pages_fts USING fts5(content, title, keywords, tokenize='${desired}')`,
    );
    const insert = this.db.prepare(
      `INSERT INTO pages_fts(rowid, content, title, keywords) VALUES (?, ?, ?, ?)`,
    );
    const tx = this.db.transaction(() => {
      for (const p of pagesRows) {
        const content = this.readContent(p.knowledge_id, p.id);
        insert.run(p.id, content, p.title, p.keywords ?? "");
      }
    });
    tx();
    // eslint-disable-next-line no-console
    console.log(`[wikikai] pages_fts rebuilt — ${pagesRows.length} pages reindexed`);
  }

  private dirFor(knowledgeId: number): string {
    const dir = path.resolve(this.itemsDir, String(knowledgeId));
    const baseResolved = path.resolve(this.itemsDir);
    if (!dir.startsWith(baseResolved + path.sep) && dir !== baseResolved) {
      throw new Error("Resolved page dir escapes items directory");
    }
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  private filePath(knowledgeId: number, pageId: number): string {
    return path.join(this.dirFor(knowledgeId), `${pageId}.md`);
  }

  private readContent(knowledgeId: number, pageId: number): string {
    const fp = this.filePath(knowledgeId, pageId);
    return fs.existsSync(fp) ? fs.readFileSync(fp, "utf8") : "";
  }

  /**
   * Persist page content to disk, annotating any rich fenced blocks that
   * don't already have a `{@N}` id with a freshly-allocated one. Returns
   * the post-annotation content so callers can keep FTS / revisions in
   * sync with what's actually on disk.
   */
  private writeContent(knowledgeId: number, pageId: number, content: string): string {
    const annotated = this.injectBlockIds(content);
    fs.writeFileSync(this.filePath(knowledgeId, pageId), annotated, "utf8");
    return annotated;
  }

  // ─────────── CRUD ───────────

  add(input: AddPageInput): { id: number; position: number; created_at: string } {
    if (!input.title || !input.title.trim()) throw new Error("title is required");
    if (typeof input.content !== "string") throw new Error("content is required");

    const ownerExists = this.db
      .prepare(`SELECT id FROM knowledge WHERE id = ?`)
      .get(input.knowledge_id);
    if (!ownerExists) throw new Error(`knowledge #${input.knowledge_id} not found`);

    return this.db.transaction(() => {
      const maxPos = (this.db
        .prepare(`SELECT COALESCE(MAX(position), 0) AS m FROM pages WHERE knowledge_id = ?`)
        .get(input.knowledge_id) as { m: number }).m;

      let position = input.position ?? maxPos + 1;
      if (position < 1) position = 1;
      if (position > maxPos + 1) position = maxPos + 1;

      if (position <= maxPos) {
        this.db
          .prepare(
            `UPDATE pages SET position = position + 1 WHERE knowledge_id = ? AND position >= ?`,
          )
          .run(input.knowledge_id, position);
      }

      const now = new Date().toISOString();
      const result = this.db
        .prepare(
          `INSERT INTO pages (knowledge_id, position, title, summary, keywords, created_at, updated_at, version)
           VALUES (@knowledge_id, @position, @title, @summary, @keywords, @now, @now, 1)`,
        )
        .run({
          knowledge_id: input.knowledge_id,
          position,
          title: input.title.trim(),
          summary: input.summary ?? null,
          keywords: joinKeywords(input.keywords),
          now,
        });
      const id = Number(result.lastInsertRowid);
      const finalContent = this.writeContent(input.knowledge_id, id, input.content);
      this.syncFts(id, input.title.trim(), input.keywords ?? [], finalContent);
      this.saveRevision(id, 1, input.title.trim(), finalContent, input.summary ?? null, joinKeywords(input.keywords), now);
      this.bumpKnowledge(input.knowledge_id);
      return { id, position, created_at: now };
    })();
  }

  getMetadata(pageId: number): PageMetadata | null {
    const row = this.db.prepare(`SELECT * FROM pages WHERE id = ?`).get(pageId) as
      | PageRow
      | undefined;
    return row ? rowToMetadata(row) : null;
  }

  get(pageId: number): PageEntry | null {
    const meta = this.getMetadata(pageId);
    if (!meta) return null;
    const content = this.readContent(meta.knowledge_id, pageId);
    return { ...meta, content, line_count: countLines(content) };
  }

  list(knowledgeId: number): PageWithStats[] {
    const rows = this.db
      .prepare(`SELECT * FROM pages WHERE knowledge_id = ? ORDER BY position ASC, id ASC`)
      .all(knowledgeId) as PageRow[];
    return rows.map((row) => {
      const content = this.readContent(knowledgeId, row.id);
      return { ...rowToMetadata(row), line_count: countLines(content) };
    });
  }

  /**
   * Lightweight index of all pages — just the fields needed for client-side
   * filtering. Skips file reads so it stays cheap even with many pages.
   */
  listAllTitles(): { knowledge_id: number; id: number; position: number; title: string }[] {
    return this.db
      .prepare(
        `SELECT knowledge_id, id, position, title FROM pages ORDER BY knowledge_id ASC, position ASC, id ASC`,
      )
      .all() as { knowledge_id: number; id: number; position: number; title: string }[];
  }

  update(pageId: number, patch: UpdatePageInput): { id: number; version: number; updated_at: string } {
    const meta = this.getMetadata(pageId);
    if (!meta) throw new Error(`page #${pageId} not found`);

    const newTitle = patch.title !== undefined ? patch.title.trim() : meta.title;
    const newSummary = patch.summary !== undefined ? patch.summary : meta.summary;
    const newKeywords =
      patch.keywords !== undefined ? joinKeywords(patch.keywords) : meta.keywords.join(",") || null;

    const now = new Date().toISOString();
    const nextVersion = meta.version + 1;

    this.db
      .prepare(
        `UPDATE pages SET title=@title, summary=@summary, keywords=@keywords, updated_at=@now, version=@version WHERE id=@id`,
      )
      .run({
        id: pageId,
        title: newTitle,
        summary: newSummary,
        keywords: newKeywords,
        now,
        version: nextVersion,
      });

    let content: string;
    if (patch.content !== undefined) {
      content = this.writeContent(meta.knowledge_id, pageId, patch.content);
    } else {
      content = this.readContent(meta.knowledge_id, pageId);
    }

    this.syncFts(pageId, newTitle, parseKeywords(newKeywords), content);
    this.saveRevision(pageId, nextVersion, newTitle, content, newSummary, newKeywords, now);
    this.bumpKnowledge(meta.knowledge_id);
    return { id: pageId, version: nextVersion, updated_at: now };
  }

  append(pageId: number, text: string): { id: number; version: number; new_line_count: number } {
    const meta = this.getMetadata(pageId);
    if (!meta) throw new Error(`page #${pageId} not found`);
    const cur = this.readContent(meta.knowledge_id, pageId);
    const sep = cur.length > 0 && !cur.endsWith("\n") ? "\n" : "";
    const next = this.writeContent(meta.knowledge_id, pageId, cur + sep + text);
    const r = this.bumpVersion(pageId);
    this.syncFts(pageId, meta.title, meta.keywords, next);
    this.saveRevision(pageId, r.version, meta.title, next, meta.summary, joinKeywords(meta.keywords), new Date().toISOString());
    this.bumpKnowledge(meta.knowledge_id);
    return { id: pageId, version: r.version, new_line_count: countLines(next) };
  }

  /**
   * Flip the Nth interactive checkbox in a page's source. Two kinds are
   * counted together, in document order:
   *   • GFM `- [ ]` / `- [x]` task-list items at the start of a line.
   *   • `<input type="checkbox" ...>` tags inside an `html-embed` fence.
   * Any other fenced code block is skipped so a sample of `- [ ]` in a
   * `md` fence doesn't get its source flipped. Mutates the page, bumps
   * version + revision + FTS like other edits. Throws on out-of-range.
   */
  toggleTaskAtIndex(
    pageId: number,
    index: number,
  ): { index: number; done: boolean; version: number; updated_at: string } {
    const meta = this.getMetadata(pageId);
    if (!meta) throw new Error(`page #${pageId} not found`);
    const content = this.readContent(meta.knowledge_id, pageId);
    const lines = content.split("\n");
    const taskRe = /^(\s*[-*+]\s+)\[([ xX])\]/;
    const htmlCheckboxRe = /<input\b([^>]*)>/gi;
    type GfmTarget = { kind: "gfm"; line: number; match: RegExpExecArray };
    type HtmlTarget = {
      kind: "html";
      line: number;
      offset: number;
      raw: string;
      attrs: string;
    };
    let inFence = false;
    let fenceLang = "";
    let fenceMarker = "";
    let count = 0;
    let target: GfmTarget | HtmlTarget | null = null;
    for (let i = 0; i < lines.length && !target; i++) {
      if (!inFence) {
        const open = /^(\s*)(```+)\s*([A-Za-z0-9_-]+)?/.exec(lines[i]);
        if (open) {
          inFence = true;
          fenceMarker = open[2];
          fenceLang = (open[3] ?? "").toLowerCase();
          continue;
        }
        const m = taskRe.exec(lines[i]);
        if (!m) continue;
        if (count === index) {
          target = { kind: "gfm", line: i, match: m };
          break;
        }
        count++;
      } else {
        const closeRe = new RegExp(`^\\s*${fenceMarker}+\\s*$`);
        if (closeRe.test(lines[i])) {
          inFence = false;
          fenceLang = "";
          fenceMarker = "";
          continue;
        }
        if (fenceLang !== "html-embed") continue;
        htmlCheckboxRe.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = htmlCheckboxRe.exec(lines[i])) !== null) {
          const attrs = m[1] ?? "";
          if (!/\btype\s*=\s*['"]checkbox['"]/i.test(attrs)) continue;
          if (count === index) {
            target = {
              kind: "html",
              line: i,
              offset: m.index,
              raw: m[0],
              attrs,
            };
            break;
          }
          count++;
        }
      }
    }
    if (!target) {
      throw new Error(`task index ${index} not found on page #${pageId}`);
    }

    let done: boolean;
    if (target.kind === "gfm") {
      const wasChecked = target.match[2].toLowerCase() === "x";
      done = !wasChecked;
      const newMark = wasChecked ? " " : "x";
      lines[target.line] = lines[target.line].replace(
        taskRe,
        `$1[${newMark}]`,
      );
    } else {
      const wasChecked = /\bchecked\b/i.test(target.attrs);
      done = !wasChecked;
      const stripped = target.attrs
        .replace(/\s*\bchecked\b\s*/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      const nextAttrs = wasChecked
        ? stripped
        : stripped
          ? `${stripped} checked`
          : "checked";
      const flipped = `<input ${nextAttrs}>`;
      const line = lines[target.line];
      lines[target.line] =
        line.substring(0, target.offset) +
        flipped +
        line.substring(target.offset + target.raw.length);
    }

    const next = this.writeContent(meta.knowledge_id, pageId, lines.join("\n"));
    const r = this.bumpVersion(pageId);
    const now = new Date().toISOString();
    this.syncFts(pageId, meta.title, meta.keywords, next);
    this.saveRevision(
      pageId,
      r.version,
      meta.title,
      next,
      meta.summary,
      joinKeywords(meta.keywords),
      now,
    );
    this.bumpKnowledge(meta.knowledge_id);
    return { index, done, version: r.version, updated_at: now };
  }

  /**
   * Drop every historical revision row for `pageId` except the latest two
   * (the live snapshot + the one immediately before it, so an "undo" against
   * the current edit is still possible). Returns the number of rows removed
   * and which versions stayed. Safe to call when there is nothing to prune
   * (≤ 2 revisions exist) — returns `{ removed: 0 }`.
   */
  pruneRevisions(pageId: number): { removed: number; kept_versions: number[] } {
    const meta = this.getMetadata(pageId);
    if (!meta) throw new Error(`page #${pageId} not found`);
    const keepRows = this.db
      .prepare(
        `SELECT version FROM page_revisions WHERE page_id = ? ORDER BY version DESC LIMIT 2`,
      )
      .all(pageId) as { version: number }[];
    const kept_versions = keepRows.map((r) => r.version);
    if (kept_versions.length === 0) return { removed: 0, kept_versions };
    const placeholders = kept_versions.map(() => "?").join(", ");
    const info = this.db
      .prepare(
        `DELETE FROM page_revisions WHERE page_id = ? AND version NOT IN (${placeholders})`,
      )
      .run(pageId, ...kept_versions);
    return { removed: Number(info.changes ?? 0), kept_versions };
  }

  remove(pageId: number): void {
    const meta = this.getMetadata(pageId);
    if (!meta) return;
    return this.db.transaction(() => {
      const fp = this.filePath(meta.knowledge_id, pageId);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
      this.db.prepare(`DELETE FROM pages WHERE id = ?`).run(pageId);
      // compact positions
      this.db
        .prepare(
          `UPDATE pages SET position = position - 1 WHERE knowledge_id = ? AND position > ?`,
        )
        .run(meta.knowledge_id, meta.position);
      this.db.prepare(`DELETE FROM pages_fts WHERE rowid = ?`).run(pageId);
      this.bumpKnowledge(meta.knowledge_id);
    })();
  }

  reorder(knowledgeId: number, order: number[]): void {
    const existing = this.list(knowledgeId);
    const existingIds = new Set(existing.map((p) => p.id));
    if (order.length !== existing.length || !order.every((id) => existingIds.has(id))) {
      throw new Error("order must be a permutation of existing page ids");
    }
    this.db.transaction(() => {
      // Two-pass to avoid unique conflicts if you ever add UNIQUE (kid,pos)
      const TEMP_OFFSET = 100000;
      const stmt = this.db.prepare(`UPDATE pages SET position = ? WHERE id = ?`);
      order.forEach((id, idx) => stmt.run(idx + 1 + TEMP_OFFSET, id));
      order.forEach((id, idx) => stmt.run(idx + 1, id));
      this.bumpKnowledge(knowledgeId);
    })();
  }

  // ─────────── Line operations ───────────

  readLines(pageId: number, lineStart?: number, lineEnd?: number): {
    content: string;
    total_lines: number;
    line_start: number;
    line_end: number;
    hash: string;
  } {
    const meta = this.getMetadata(pageId);
    if (!meta) throw new Error(`page #${pageId} not found`);
    const all = this.readContent(meta.knowledge_id, pageId);
    const lines = all.split("\n");
    const total = countLines(all);
    const start = Math.max(1, lineStart ?? 1);
    const end = Math.min(total, lineEnd ?? total);
    if (start > end) {
      return { content: "", total_lines: total, line_start: start, line_end: end, hash: hashRange("") };
    }
    const slice = lines.slice(start - 1, end).join("\n");
    return {
      content: slice,
      total_lines: total,
      line_start: start,
      line_end: end,
      hash: hashRange(slice),
    };
  }

  editLines(
    pageId: number,
    lineStart: number,
    lineEnd: number,
    newText: string,
    expectedHash?: string,
  ): { id: number; version: number; new_line_count: number } {
    const meta = this.getMetadata(pageId);
    if (!meta) throw new Error(`page #${pageId} not found`);
    const all = this.readContent(meta.knowledge_id, pageId);
    const lines = all.split("\n");
    const total = lines.length;
    if (lineStart < 1 || lineEnd < lineStart) {
      throw new Error(`invalid line range ${lineStart}..${lineEnd}`);
    }
    const safeEnd = Math.min(lineEnd, total);
    const oldSlice = lines.slice(lineStart - 1, safeEnd).join("\n");
    if (expectedHash && hashRange(oldSlice) !== expectedHash) {
      throw new Error(
        `hash mismatch — expected ${expectedHash} but got ${hashRange(oldSlice)}. ` +
          `Re-read the range before editing.`,
      );
    }
    const newLines = newText.split("\n");
    const draft = [
      ...lines.slice(0, lineStart - 1),
      ...newLines,
      ...lines.slice(safeEnd),
    ].join("\n");
    const next = this.writeContent(meta.knowledge_id, pageId, draft);
    const r = this.bumpVersion(pageId);
    this.syncFts(pageId, meta.title, meta.keywords, next);
    this.saveRevision(pageId, r.version, meta.title, next, meta.summary, joinKeywords(meta.keywords), new Date().toISOString());
    this.bumpKnowledge(meta.knowledge_id);
    return { id: pageId, version: r.version, new_line_count: countLines(next) };
  }

  editSection(
    pageId: number,
    heading: string,
    newContent: string,
  ): { id: number; version: number; new_line_count: number; replaced_lines: number } {
    const meta = this.getMetadata(pageId);
    if (!meta) throw new Error(`page #${pageId} not found`);
    const all = this.readContent(meta.knowledge_id, pageId);
    const lines = all.split("\n");
    const wantedLevel = /^(#+)/.exec(heading.trim());
    if (!wantedLevel) throw new Error(`heading must start with #, e.g. "## 3. Title"`);
    const targetLevel = wantedLevel[1].length;
    const targetHeadingText = heading.trim();
    let startIdx = -1;
    let inFence = false;
    for (let i = 0; i < lines.length; i++) {
      if (/^```/.test(lines[i])) inFence = !inFence;
      if (inFence) continue;
      if (lines[i].trim() === targetHeadingText) {
        startIdx = i;
        break;
      }
    }
    if (startIdx === -1) throw new Error(`section heading not found: ${heading}`);
    let endIdx = lines.length;
    inFence = false;
    for (let i = startIdx + 1; i < lines.length; i++) {
      if (/^```/.test(lines[i])) inFence = !inFence;
      if (inFence) continue;
      const hm = /^(#+)\s/.exec(lines[i]);
      if (hm && hm[1].length <= targetLevel) {
        endIdx = i;
        break;
      }
    }
    const replacedLines = endIdx - startIdx;
    const newSlice = (heading.trim() + "\n" + newContent.replace(/^\n+|\n+$/g, "")).split("\n");
    const draft = [
      ...lines.slice(0, startIdx),
      ...newSlice,
      ...(endIdx < lines.length ? [""] : []),
      ...lines.slice(endIdx),
    ].join("\n");
    const next = this.writeContent(meta.knowledge_id, pageId, draft);
    const r = this.bumpVersion(pageId);
    this.syncFts(pageId, meta.title, meta.keywords, next);
    this.saveRevision(pageId, r.version, meta.title, next, meta.summary, joinKeywords(meta.keywords), new Date().toISOString());
    this.bumpKnowledge(meta.knowledge_id);
    return { id: pageId, version: r.version, new_line_count: countLines(next), replaced_lines: replacedLines };
  }

  replaceText(
    knowledgeId: number,
    pageId: number | undefined,
    find: string,
    replace: string,
    count?: number,
  ): { replacements: { page_id: number; page_title: string; count: number }[] } {
    if (!find) throw new Error("find is required");
    const targets = pageId !== undefined ? [this.getMetadata(pageId)].filter((m): m is PageMetadata => m !== null) : this.list(knowledgeId);
    const result: { page_id: number; page_title: string; count: number }[] = [];
    let remaining = typeof count === "number" ? count : Infinity;
    for (const meta of targets) {
      if (meta.knowledge_id !== knowledgeId) continue;
      const cur = this.readContent(knowledgeId, meta.id);
      let occurrences = 0;
      let next = "";
      let i = 0;
      while (i < cur.length) {
        if (remaining > 0 && cur.startsWith(find, i)) {
          next += replace;
          i += find.length;
          occurrences++;
          remaining--;
        } else {
          next += cur[i];
          i++;
        }
      }
      if (occurrences > 0) {
        const finalContent = this.writeContent(knowledgeId, meta.id, next);
        const r = this.bumpVersion(meta.id);
        this.syncFts(meta.id, meta.title, meta.keywords, finalContent);
        this.saveRevision(
          meta.id,
          r.version,
          meta.title,
          finalContent,
          meta.summary,
          joinKeywords(meta.keywords),
          new Date().toISOString(),
        );
        result.push({ page_id: meta.id, page_title: meta.title, count: occurrences });
      }
      if (remaining <= 0) break;
    }
    if (result.length > 0) this.bumpKnowledge(knowledgeId);
    return { replacements: result };
  }

  // ─────────── Outline ───────────

  outline(knowledgeId: number): {
    pages: {
      id: number;
      title: string;
      position: number;
      summary: string | null;
      line_count: number;
      headings: { level: number; text: string; line: number; id: string }[];
    }[];
  } {
    const pages = this.list(knowledgeId);
    return {
      pages: pages.map((p) => {
        const content = this.readContent(knowledgeId, p.id);
        return {
          id: p.id,
          title: p.title,
          position: p.position,
          summary: p.summary,
          line_count: p.line_count,
          headings: extractHeadings(content),
        };
      }),
    };
  }

  // ─────────── Search (FTS5) ───────────

  search(
    query: string,
    opts: {
      project?: string;
      projects?: string[];
      knowledge_id?: number;
      limit?: number;
    } = {},
  ): SearchHit[] {
    const trimmed = query.trim();
    if (!trimmed) return [];
    // ─── Special case: id lookup ────────────────────────────────────
    // `&N` → list all pages of knowledge N.
    // `#N` → return that single page.
    // `@N` → jump directly to block N (single hit).
    // All bypass the project filter — id queries are explicit and the
    // user expects the exact thing they asked for.
    const idMatch = /^([&#])(\d+)$/.exec(trimmed);
    if (idMatch) {
      return this.lookupById(idMatch[1] as "&" | "#", Number(idMatch[2]));
    }
    const blockMatch = /^@(\d+)$/.exec(trimmed);
    if (blockMatch) {
      return this.lookupByBlockId(Number(blockMatch[1]));
    }
    const ftsQuery = sanitizeFtsQuery(query);
    if (!ftsQuery) return []; // all tokens too short for the trigram tokenizer
    const limit = Math.min(opts.limit ?? 50, 200);
    const filters: string[] = [];
    const params: Record<string, unknown> = { q: ftsQuery, limit };
    if (opts.knowledge_id !== undefined) {
      filters.push("p.knowledge_id = @kid");
      params.kid = opts.knowledge_id;
    }
    // Merge `project` (legacy single) and `projects` (multi) into one IN-clause.
    const projectList = Array.from(
      new Set(
        [opts.project, ...(opts.projects ?? [])]
          .filter((p): p is string => !!p && p.length > 0),
      ),
    );
    if (projectList.length === 1) {
      filters.push("k.project = @project");
      params.project = projectList[0];
    } else if (projectList.length > 1) {
      const placeholders = projectList
        .map((_, i) => `@proj${i}`)
        .join(", ");
      filters.push(`k.project IN (${placeholders})`);
      projectList.forEach((p, i) => {
        params[`proj${i}`] = p;
      });
    }
    const where = filters.length ? `AND ${filters.join(" AND ")}` : "";
    const rows = this.db
      .prepare(
        `SELECT p.id AS page_id, p.knowledge_id, p.position AS page_position,
                p.title AS page_title,
                k.title AS knowledge_title, k.project AS project,
                snippet(pages_fts, 0, '<<<', '>>>', '…', 40) AS snip_content,
                snippet(pages_fts, 1, '<<<', '>>>', '…', 40) AS snip_title,
                snippet(pages_fts, 2, '<<<', '>>>', '…', 40) AS snip_keywords,
                bm25(pages_fts) AS score
         FROM pages_fts
         JOIN pages p ON p.id = pages_fts.rowid
         JOIN knowledge k ON k.id = p.knowledge_id
         WHERE pages_fts MATCH @q ${where}
         ORDER BY score
         LIMIT @limit`,
      )
      .all(params) as Array<{
      page_id: number;
      knowledge_id: number;
      page_position: number;
      page_title: string;
      knowledge_title: string;
      project: string | null;
      snip_content: string | null;
      snip_title: string | null;
      snip_keywords: string | null;
      score: number;
    }>;

    return rows.map((row) => {
      const content = this.readContent(row.knowledge_id, row.page_id);
      const lineNum = findFirstLineWith(content, query);
      const heading = findHeadingForLine(content, lineNum);
      const raw =
        (row.snip_content && row.snip_content.includes("<<<")
          ? row.snip_content
          : null) ??
        (row.snip_title && row.snip_title.includes("<<<")
          ? row.snip_title
          : null) ??
        (row.snip_keywords && row.snip_keywords.includes("<<<")
          ? row.snip_keywords
          : null) ??
        row.snip_content ??
        row.snip_title ??
        row.snip_keywords ??
        "";
      const cleanSnippet = raw.replace(/<<</g, "").replace(/>>>/g, "");
      return {
        knowledge_id: row.knowledge_id,
        knowledge_title: row.knowledge_title,
        project: row.project,
        page_id: row.page_id,
        page_position: row.page_position,
        page_title: row.page_title,
        line: lineNum,
        heading,
        snippet: cleanSnippet,
        score: row.score,
      };
    });
  }

  /** Direct id lookup used by `search()` when the query is `&N` or `#N`. */
  private lookupById(marker: "&" | "#", id: number): SearchHit[] {
    type Row = {
      page_id: number;
      knowledge_id: number;
      position: number;
      page_title: string;
      knowledge_title: string;
      project: string | null;
    };
    const rows =
      marker === "&"
        ? (this.db
            .prepare(
              `SELECT p.id AS page_id, p.knowledge_id, p.position,
                      p.title AS page_title,
                      k.title AS knowledge_title, k.project AS project
               FROM pages p
               JOIN knowledge k ON k.id = p.knowledge_id
               WHERE p.knowledge_id = ?
               ORDER BY p.position ASC`,
            )
            .all(id) as Row[])
        : (this.db
            .prepare(
              `SELECT p.id AS page_id, p.knowledge_id, p.position,
                      p.title AS page_title,
                      k.title AS knowledge_title, k.project AS project
               FROM pages p
               JOIN knowledge k ON k.id = p.knowledge_id
               WHERE p.id = ?`,
            )
            .all(id) as Row[]);
    return rows.map((r) => ({
      knowledge_id: r.knowledge_id,
      knowledge_title: r.knowledge_title,
      project: r.project,
      page_id: r.page_id,
      page_position: r.position,
      page_title: r.page_title,
      line: 1,
      heading: null,
      snippet: `${marker}${marker === "&" ? r.knowledge_id : r.page_id} · ${r.page_title}`,
      score: 0,
    }));
  }

  /** Direct lookup used by `search()` when the query is `@N` (block id). */
  private lookupByBlockId(blockId: number): SearchHit[] {
    const b = this.getBlock(blockId);
    if (!b) return [];
    return [
      {
        knowledge_id: b.knowledge_id,
        knowledge_title: b.knowledge_title,
        project: b.project,
        page_id: b.page_id,
        page_position: b.page_position,
        page_title: b.page_title,
        line: b.line_start,
        heading: null,
        snippet: `@${blockId} · ${b.kind} block · L${b.line_start}–${b.line_end}`,
        score: 0,
        block_id: blockId,
      },
    ];
  }

  // ─────────── Internals ───────────

  private bumpVersion(pageId: number): { version: number } {
    const now = new Date().toISOString();
    const row = this.db
      .prepare(`UPDATE pages SET version = version + 1, updated_at = ? WHERE id = ? RETURNING version`)
      .get(now, pageId) as { version: number } | undefined;
    return { version: row?.version ?? 1 };
  }

  private bumpKnowledge(knowledgeId: number): void {
    const now = new Date().toISOString();
    this.db
      .prepare(`UPDATE knowledge SET updated_at = ?, version = version + 1 WHERE id = ?`)
      .run(now, knowledgeId);
  }

  private syncFts(pageId: number, title: string, keywords: string[] | undefined, content: string): void {
    this.db.prepare(`DELETE FROM pages_fts WHERE rowid = ?`).run(pageId);
    this.db
      .prepare(`INSERT INTO pages_fts(rowid, content, title, keywords) VALUES (?, ?, ?, ?)`)
      .run(pageId, content, title, (keywords ?? []).join(" "));
  }

  /** Maximum number of revision snapshots kept per page. Any older rows are
   *  pruned automatically after each save. */
  static readonly MAX_REVISIONS_PER_PAGE = 5;

  /**
   * Insert a snapshot of the page state at the given version. Idempotent on
   * (page_id, version) — INSERT OR IGNORE so concurrent writers don't fight.
   * After insert, prune anything beyond the latest MAX_REVISIONS_PER_PAGE
   * snapshots so the table never grows unbounded for chatty pages.
   */
  private saveRevision(
    pageId: number,
    version: number,
    title: string,
    content: string,
    summary: string | null,
    keywords: string | null,
    createdAt: string,
  ): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO page_revisions
          (page_id, version, title, content, summary, keywords, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(pageId, version, title, content, summary, keywords, createdAt);
    this.db
      .prepare(
        `DELETE FROM page_revisions
         WHERE page_id = ?
           AND version NOT IN (
             SELECT version FROM page_revisions
             WHERE page_id = ?
             ORDER BY version DESC
             LIMIT ?
           )`,
      )
      .run(pageId, pageId, PageStore.MAX_REVISIONS_PER_PAGE);
  }

  // ─────────── Public revision API ───────────

  listRevisions(pageId: number): {
    version: number;
    title: string;
    summary: string | null;
    created_at: string;
    line_count: number;
    is_current: boolean;
  }[] {
    const meta = this.getMetadata(pageId);
    if (!meta) return [];
    const rows = this.db
      .prepare(
        `SELECT version, title, summary, created_at, content
         FROM page_revisions
         WHERE page_id = ?
         ORDER BY version ASC`,
      )
      .all(pageId) as Array<{
      version: number;
      title: string;
      summary: string | null;
      created_at: string;
      content: string;
    }>;
    return rows.map((r) => ({
      version: r.version,
      title: r.title,
      summary: r.summary,
      created_at: r.created_at,
      line_count: countLines(r.content),
      is_current: r.version === meta.version,
    }));
  }

  getRevision(
    pageId: number,
    version: number,
  ): {
    page_id: number;
    knowledge_id: number;
    version: number;
    title: string;
    summary: string | null;
    keywords: string[];
    content: string;
    total_lines: number;
    created_at: string;
    is_current: boolean;
  } | null {
    const meta = this.getMetadata(pageId);
    if (!meta) return null;
    const row = this.db
      .prepare(
        `SELECT version, title, summary, keywords, content, created_at
         FROM page_revisions
         WHERE page_id = ? AND version = ?`,
      )
      .get(pageId, version) as
      | {
          version: number;
          title: string;
          summary: string | null;
          keywords: string | null;
          content: string;
          created_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      page_id: pageId,
      knowledge_id: meta.knowledge_id,
      version: row.version,
      title: row.title,
      summary: row.summary,
      keywords: parseKeywords(row.keywords),
      content: row.content,
      total_lines: countLines(row.content),
      created_at: row.created_at,
      is_current: row.version === meta.version,
    };
  }

  removeKnowledgeFiles(knowledgeId: number): void {
    const dir = path.resolve(this.itemsDir, String(knowledgeId));
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Find the nearest heading (## / ### …) that contains the given 1-based line.
 *  Returns null when the line is in the preamble before any heading. */
function findHeadingForLine(
  content: string,
  line: number,
): { level: number; text: string; line: number; id: string } | null {
  const headings = extractHeadings(content);
  let best: ReturnType<typeof extractHeadings>[number] | null = null;
  for (const h of headings) {
    if (h.line <= line) best = h;
    else break;
  }
  return best;
}

function extractHeadings(content: string): { level: number; text: string; line: number; id: string }[] {
  const out: { level: number; text: string; line: number; id: string }[] = [];
  const lines = content.split("\n");
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^```/.test(lines[i])) inFence = !inFence;
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[i]);
    if (!m) continue;
    const text = m[2].replace(/\s*#+\s*$/, "");
    out.push({
      level: m[1].length,
      text,
      line: i + 1,
      id: slugify(text),
    });
  }
  return out;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function findFirstLineWith(content: string, query: string): number {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !/^(and|or|not)$/.test(t));
  if (terms.length === 0) return 1;
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (terms.some((t) => lower.includes(t))) return i + 1;
  }
  return 1;
}

// Build a trigram-friendly FTS5 phrase query.
// Each whitespace-separated token is wrapped in double quotes so it is matched
// as an exact substring. Tokens shorter than 3 codepoints are dropped because
// the trigram tokenizer cannot match anything shorter than a trigram.
function sanitizeFtsQuery(q: string): string {
  const tokens = q
    .trim()
    .split(/\s+/)
    .filter((tok) => [...tok].length >= 3);
  if (tokens.length === 0) return "";
  return tokens.map((tok) => `"${tok.replace(/"/g, '""')}"`).join(" ");
}
