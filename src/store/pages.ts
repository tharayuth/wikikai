import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Db } from "./db.js";
import { emitEvent } from "../lib/events.js";
import { formatImageTitle, parseImageSize } from "../lib/imageSize.js";
import {
  formatAnnotation,
  parseAllAnnotations,
  parseAnnotation,
} from "../lib/blockAnnotation.js";

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

/** Render a single-line placeholder used by `summarizePageContent`.
 *  Format: `[@N kind: caption]` or `[@N kind — extra: caption]` when
 *  extra hint info is available (e.g. table dimensions). Stays on one
 *  line so an AI counting "blocks on this page" can do so by simple
 *  line scanning. */
function formatPlaceholder(
  kind: string,
  id: number,
  caption: string | null,
  extra: string | null,
): string {
  const head = extra ? `@${id} ${kind} ${extra}` : `@${id} ${kind}`;
  return caption ? `[${head}: ${caption}]` : `[${head}]`;
}

function unescapeCap(s: string): string {
  return s.replace(/\\(["\\])/g, "$1");
}

/** Split one markdown-table row into trimmed cells. Strips the outer
 *  `|` delimiters, splits on the rest, trims whitespace per cell. Does
 *  not handle escaped `\|` in cell content — rare in our use case. */
function parseTableRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return inner.split("|").map((c) => c.trim());
}

/**
 * Rewrite the `style` attribute of an `<img>` tag's attribute string
 * to express the given max-width / max-height — preserving every
 * unrelated style property (border, padding, opacity, …) the author
 * wrote. Pass `undefined` for an axis to drop that constraint.
 * Returns the new attribute string (no leading space, ready to splice
 * back into `<img${result}>`).
 */
function updateImgStyleAttr(
  attrs: string,
  width?: number,
  height?: number,
): string {
  const styleRe = /\bstyle\s*=\s*"([^"]*)"/i;
  const m = styleRe.exec(attrs);
  const existing = m ? m[1] : "";
  const props = existing
    .split(";")
    .map((s) => s.trim())
    .filter(
      (s) =>
        s.length > 0 &&
        !/^max-width\s*:/i.test(s) &&
        !/^max-height\s*:/i.test(s),
    );
  if (width != null) props.push(`max-width:${width}px`);
  if (height != null) props.push(`max-height:${height}px`);
  const newStyle = props.join(";");
  if (m) {
    if (newStyle) {
      return attrs.replace(styleRe, `style="${newStyle}"`);
    }
    // Both axes removed and no other style props left — drop the attr
    return attrs.replace(/\s*\bstyle\s*=\s*"[^"]*"/i, "");
  }
  if (newStyle) {
    return `${attrs.replace(/\s+$/, "")} style="${newStyle}"`;
  }
  return attrs;
}

export class PageStore {
  constructor(private db: Db, private itemsDir: string) {
    fs.mkdirSync(itemsDir, { recursive: true });
    this.migrateFtsTokenizer("trigram");
    this.backfillRevisions();
    this.backfillBlockIds();
  }

  /**
   * Produce a "skeleton" version of the page content where every rich
   * fenced block (mermaid / chart / chart-grid / stats / steps /
   * html-embed / images) and every `{@N}`-annotated markdown table is
   * replaced by a SINGLE placeholder line of the form:
   *
   *   [@123 mermaid: Architecture: API → DB]
   *   [@456 chart: Monthly revenue 2024 by region]
   *   [@789 table 12r × 3c: Q1 inventory by SKU]
   *
   * The placeholder is intentionally distinctive (square brackets +
   * `@N`) so a downstream model can't confuse it for normal prose.
   * When a block carries no caption, the descriptor falls back to
   * generic kind info (`[@123 mermaid]`, `[@789 table 12r × 3c]`).
   *
   * Returns the skeleton string + a side-channel `blocks` index so
   * callers don't have to re-parse placeholders to enumerate ids.
   * The skeleton's line numbers DO NOT match the source — pair with
   * `get_block({ id })` / `read_page({ mode: "full" })` for editing.
   */
  summarizePageContent(content: string): {
    skeleton: string;
    blocks: Array<{
      id: number;
      kind: string;
      caption: string | null;
      source_line_start: number;
      source_line_end: number;
    }>;
  } {
    const TABLE_ROW = /^\s*\|.*\|\s*$/;
    const TABLE_SEP = /^\s*\|[-:|\s]+\|\s*$/;
    const TABLE_ANN = /^\s*\{@(\d+)(?:\s+"((?:[^"\\]|\\.)*)")?\}\s*$/;
    const lines = content.split("\n");
    const out: string[] = [];
    const blocks: Array<{
      id: number;
      kind: string;
      caption: string | null;
      source_line_start: number;
      source_line_end: number;
    }> = [];

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      // Fenced rich block?
      const fenceOpen = /^(\s*)(```+)\s*([A-Za-z0-9_-]+)(.*)$/.exec(line);
      if (fenceOpen) {
        const lang = fenceOpen[3].toLowerCase();
        const ann = parseAnnotation(fenceOpen[4]);
        // Only ANNOTATED fences get collapsed — plain code blocks
        // (typescript / json / md / etc.) are kept verbatim so prose
        // examples remain readable.
        if (ann) {
          const marker = fenceOpen[2];
          // Find matching close
          const closeRe = new RegExp(`^\\s*${marker.replace(/`/g, "`")}+\\s*$`);
          let end = i;
          for (let j = i + 1; j < lines.length; j++) {
            if (closeRe.test(lines[j])) {
              end = j;
              break;
            }
          }
          const sourceStart = i + 1;
          const sourceEnd = end + 1;
          // Line count includes the two fence markers — gives the AI a
          // fair sense of "how much text is hiding here?". Singular
          // when it's exactly 1 (rare for fenced blocks).
          const lineCount = sourceEnd - sourceStart + 1;
          const extra = `${lineCount} line${lineCount === 1 ? "" : "s"}`;
          const placeholder = formatPlaceholder(lang, ann.id, ann.caption, extra);
          out.push(placeholder);
          blocks.push({
            id: ann.id,
            kind: lang,
            caption: ann.caption,
            source_line_start: sourceStart,
            source_line_end: sourceEnd,
          });
          i = end + 1;
          continue;
        }
        // Unannotated fence — walk to close but keep content verbatim
        const closeRe = new RegExp(
          `^\\s*${fenceOpen[2].replace(/`/g, "`")}+\\s*$`,
        );
        out.push(line);
        let j = i + 1;
        while (j < lines.length) {
          out.push(lines[j]);
          if (closeRe.test(lines[j])) break;
          j++;
        }
        i = j + 1;
        continue;
      }

      // Markdown table with trailing {@N "caption"?} annotation?
      if (
        TABLE_ROW.test(line) &&
        i + 1 < lines.length &&
        TABLE_SEP.test(lines[i + 1])
      ) {
        // Walk to last row
        let end = i + 1;
        for (let j = i + 2; j < lines.length; j++) {
          if (TABLE_ROW.test(lines[j])) end = j;
          else break;
        }
        // Look for trailing annotation (optional blank between)
        const peek1 = lines[end + 1] ?? "";
        const peek2 = lines[end + 2] ?? "";
        let annLineIdx = -1;
        if (TABLE_ANN.test(peek1)) annLineIdx = end + 1;
        else if (peek1.trim() === "" && TABLE_ANN.test(peek2))
          annLineIdx = end + 2;
        if (annLineIdx !== -1) {
          const m = TABLE_ANN.exec(lines[annLineIdx])!;
          const id = Number(m[1]);
          const caption = m[2] != null ? unescapeCap(m[2]) : null;
          const headers = parseTableRow(line);
          const dataRows = end - (i + 1); // count rows AFTER separator
          const dims = `${dataRows}r × ${headers.length}c`;
          out.push(formatPlaceholder("table", id, caption, dims));
          blocks.push({
            id,
            kind: "table",
            caption,
            source_line_start: i + 1,
            source_line_end: end + 1,
          });
          i = annLineIdx + 1;
          continue;
        }
        // Unannotated table — keep verbatim
        out.push(line);
        i++;
        continue;
      }

      out.push(line);
      i++;
    }
    return { skeleton: out.join("\n"), blocks };
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
    /** Optional caption from the `{@N "caption"}` annotation. */
    caption: string | null;
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
    const annotation = `{@${blockId}`; // trigram FTS treats `{` / `@` as
    // continuation, so the bare `{@N` prefix matches both `{@N}` and
    // `{@N "..."}`. Subsequent in-page scan re-parses precisely.
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
    const knowledge = this.db
      .prepare(`SELECT title, project FROM knowledge WHERE id = ?`)
      .get(meta.knowledge_id) as { title: string; project: string | null } | undefined;
    const ctx = {
      block_id: blockId,
      page_id: row.page_id,
      page_position: meta.position,
      page_title: meta.title,
      knowledge_id: meta.knowledge_id,
      knowledge_title: knowledge?.title ?? "",
      project: knowledge?.project ?? null,
    };

    // ─── Path A: `{@N "caption"?}` inline on a fence-open line ───
    let startIdx = -1;
    let kind = "";
    let fenceMarker = "";
    let caption: string | null = null;
    for (let i = 0; i < lines.length; i++) {
      const m = /^(\s*)(```+)\s*([A-Za-z0-9_-]+)([^\n]*)$/.exec(lines[i]);
      if (!m) continue;
      const ann = parseAnnotation(m[4]);
      if (!ann || ann.id !== blockId) continue;
      startIdx = i;
      kind = m[3].toLowerCase();
      fenceMarker = m[2];
      caption = ann.caption;
      break;
    }
    if (startIdx !== -1) {
      let endIdx = -1;
      const closeRe = new RegExp(`^\\s*${fenceMarker.replace(/`/g, "`")}+\\s*$`);
      for (let i = startIdx + 1; i < lines.length; i++) {
        if (closeRe.test(lines[i])) {
          endIdx = i;
          break;
        }
      }
      if (endIdx === -1) return null;
      return {
        ...ctx,
        kind,
        caption,
        source: lines.slice(startIdx, endIdx + 1).join("\n"),
        inner: lines.slice(startIdx + 1, endIdx).join("\n"),
        line_start: startIdx + 1,
        line_end: endIdx + 1,
      };
    }

    // ─── Path B: `{@N "caption"?}` on its own line, attached to a
    // markdown table sitting immediately above. Walk back over
    // contiguous table-pipe lines and require at least header +
    // separator. ───
    const TABLE_ROW = /^\s*\|.*\|\s*$/;
    const TABLE_SEP = /^\s*\|[-:|\s]+\|\s*$/;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      const ann = parseAnnotation(trimmed);
      if (!ann || ann.start !== 0 || ann.end !== trimmed.length) continue;
      if (ann.id !== blockId) continue;
      // Optional single blank line between the table and the annotation.
      let cursor = i - 1;
      if (cursor >= 0 && lines[cursor].trim() === "") cursor--;
      const lastRow = cursor; // inclusive index of last table row (if any)
      let start = cursor;
      while (start >= 0 && TABLE_ROW.test(lines[start])) start--;
      start++;
      // Need at least header + separator (2 lines).
      if (lastRow - start + 1 < 2) continue;
      if (!TABLE_SEP.test(lines[start + 1])) continue;
      return {
        ...ctx,
        kind: "table",
        caption: ann.caption,
        source: lines.slice(start, lastRow + 1).join("\n"),
        // inner = data rows only (skip header + separator)
        inner: lines.slice(start + 2, lastRow + 1).join("\n"),
        line_start: start + 1,
        line_end: lastRow + 1, // last table row (1-based), not the annotation line
      };
    }

    return null;
  }

  /**
   * Return a single data row of a markdown-table block as a
   * `{ columnName: cellText }` object. `index` is 0-based; negative
   * wraps from the end (`-1` = last row). Throws when the block isn't
   * a table or the index is out of range.
   */
  getTableRow(
    blockId: number,
    index: number,
  ): {
    block_id: number;
    knowledge_id: number;
    page_id: number;
    row_index: number;
    columns: Record<string, string>;
    source_line: number;
  } {
    const b = this.getBlock(blockId);
    if (!b) throw new Error(`block @${blockId} not found`);
    if (b.kind !== "table") {
      throw new Error(`@${blockId} is a ${b.kind} block, not a table`);
    }
    const dataRows = b.inner.split("\n").filter((l) => /\S/.test(l));
    const N = dataRows.length;
    const idx = index < 0 ? N + index : index;
    if (idx < 0 || idx >= N) {
      throw new Error(
        `row ${index} out of range (table @${blockId} has ${N} data row${
          N === 1 ? "" : "s"
        })`,
      );
    }
    const headerLine = b.source.split("\n")[0];
    const headers = parseTableRow(headerLine);
    const cells = parseTableRow(dataRows[idx]);
    const columns: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      columns[headers[j]] = cells[j] ?? "";
    }
    return {
      block_id: blockId,
      knowledge_id: b.knowledge_id,
      page_id: b.page_id,
      row_index: idx,
      columns,
      // header (line_start) + separator (+1) + idx
      source_line: b.line_start + 2 + idx,
    };
  }

  /**
   * Search inside a markdown-table block. Returns matching rows as
   * `{ row_index, columns, source_line }` objects.
   *
   *  - `q`       — substring search (case-insensitive, Unicode-aware via
   *                `String.prototype.toLowerCase`); matched against every
   *                cell unless `columns` narrows the candidate set.
   *  - `where`   — exact column=value match. Multiple keys = AND.
   *  - `columns` — restrict `q` to these columns only. Does not affect
   *                `where`.
   *  - `limit`   — cap returned rows (default 50, max 500). `total_matched`
   *                always reflects the unrestricted match count so callers
   *                know when results were truncated.
   *
   * Throws when the block isn't a table. `q`/`where`/`columns` are all
   * optional — calling with none returns every row up to `limit` (useful
   * for "give me the first N rows" probes).
   */
  findTableRows(
    blockId: number,
    opts: {
      q?: string;
      where?: Record<string, string>;
      columns?: string[];
      limit?: number;
    } = {},
  ): {
    block_id: number;
    knowledge_id: number;
    page_id: number;
    columns: string[];
    matches: Array<{
      row_index: number;
      columns: Record<string, string>;
      source_line: number;
    }>;
    total_matched: number;
    truncated: boolean;
  } {
    const b = this.getBlock(blockId);
    if (!b) throw new Error(`block @${blockId} not found`);
    if (b.kind !== "table") {
      throw new Error(`@${blockId} is a ${b.kind} block, not a table`);
    }
    const limit = Math.min(Math.max(Math.floor(opts.limit ?? 50), 1), 500);
    const headers = parseTableRow(b.source.split("\n")[0]);
    const dataLines = b.inner.split("\n").filter((l) => /\S/.test(l));
    const qLower = opts.q ? opts.q.toLowerCase() : null;
    const where = opts.where ?? null;
    const colFilter =
      opts.columns && opts.columns.length > 0
        ? new Set(opts.columns)
        : null;

    const matches: Array<{
      row_index: number;
      columns: Record<string, string>;
      source_line: number;
    }> = [];
    let totalMatched = 0;

    for (let i = 0; i < dataLines.length; i++) {
      const cells = parseTableRow(dataLines[i]);
      const rowCols: Record<string, string> = {};
      for (let j = 0; j < headers.length; j++) {
        rowCols[headers[j]] = cells[j] ?? "";
      }

      // where (exact column match, AND across keys)
      if (where) {
        let ok = true;
        for (const k of Object.keys(where)) {
          if (rowCols[k] !== where[k]) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
      }

      // q (substring, case-insensitive, optionally restricted by columns)
      if (qLower != null) {
        let ok = false;
        for (const name of headers) {
          if (colFilter && !colFilter.has(name)) continue;
          if (rowCols[name].toLowerCase().includes(qLower)) {
            ok = true;
            break;
          }
        }
        if (!ok) continue;
      }

      totalMatched++;
      if (matches.length < limit) {
        matches.push({
          row_index: i,
          columns: rowCols,
          source_line: b.line_start + 2 + i,
        });
      }
    }

    return {
      block_id: blockId,
      knowledge_id: b.knowledge_id,
      page_id: b.page_id,
      columns: headers,
      matches,
      total_matched: totalMatched,
      truncated: totalMatched > matches.length,
    };
  }

  /**
   * Lightweight metadata for a block — used by `get_block({ summary: true })`.
   * Returns the same context block as `getBlock` but without `source`/`inner`,
   * and for tables also reports `columns` + `row_count` so callers can decide
   * whether to fetch the full body or slice.
   */
  getBlockSummary(blockId: number): {
    block_id: number;
    kind: string;
    caption: string | null;
    line_start: number;
    line_end: number;
    page_id: number;
    page_position: number;
    page_title: string;
    knowledge_id: number;
    knowledge_title: string;
    project: string | null;
    columns?: string[];
    row_count?: number;
  } | null {
    const b = this.getBlock(blockId);
    if (!b) return null;
    const base = {
      block_id: b.block_id,
      kind: b.kind,
      caption: b.caption,
      line_start: b.line_start,
      line_end: b.line_end,
      page_id: b.page_id,
      page_position: b.page_position,
      page_title: b.page_title,
      knowledge_id: b.knowledge_id,
      knowledge_title: b.knowledge_title,
      project: b.project,
    };
    if (b.kind === "table") {
      const headers = parseTableRow(b.source.split("\n")[0]);
      const row_count = b.inner.split("\n").filter((l) => /\S/.test(l)).length;
      return { ...base, columns: headers, row_count };
    }
    return base;
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
   * steps/html-embed/images) AND plain markdown tables, and ensure each
   * has a `{@N}` annotation:
   *   • Rich fences get the annotation appended to the info string.
   *   • Tables get a standalone `{@N}` line inserted immediately below
   *     the last data row.
   * Blocks that already have one are left as-is.
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
      "md",
      "markdown",
    ]);
    const TABLE_ROW = /^\s*\|.*\|\s*$/;
    const TABLE_SEP = /^\s*\|[-:|\s]+\|\s*$/;
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
          if (RICH.has(lang.toLowerCase()) && !/\{@\d+/.test(rest)) {
            const newId = this.allocBlockId();
            // Preserve any other trailing tokens by appending the annotation
            lines[i] = `${indent}${marker}${lang}${rest.replace(/\s*$/, "")} {@${newId}}`;
          }
          continue;
        }
        // Table detection: header row immediately followed by separator.
        if (
          TABLE_ROW.test(line) &&
          i + 1 < lines.length &&
          TABLE_SEP.test(lines[i + 1])
        ) {
          let end = i + 1; // separator
          for (let j = i + 2; j < lines.length; j++) {
            if (TABLE_ROW.test(lines[j])) end = j;
            else break;
          }
          // Markdown-it requires a blank line between a GFM table and a
          // following paragraph — otherwise `{@N}` is parsed as another
          // row. The canonical form is therefore: <table> + blank + {@N}.
          const peek1 = end + 1 < lines.length ? lines[end + 1] : null;
          const peek2 = end + 2 < lines.length ? lines[end + 2] : null;
          const annRe = /^\s*\{@\d+(?:\s+"(?:[^"\\]|\\.)*")?\}\s*$/;
          const hasAnnotation =
            (peek1 != null && annRe.test(peek1)) ||
            (peek1 != null &&
              peek1.trim() === "" &&
              peek2 != null &&
              annRe.test(peek2));
          if (!hasAnnotation) {
            const newId = this.allocBlockId();
            // Insert blank line + annotation, so the canonical form is
            // always present even if the author wrote `{@N}` directly
            // under the last row.
            lines.splice(end + 1, 0, "", `{@${newId}}`);
            i = end + 2;
          } else {
            // Skip past the table + (optional blank +) annotation
            i = peek1 != null && peek1.trim() === "" ? end + 2 : end + 1;
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

  /**
   * Resize an inline markdown image (`![alt](src "WxH")`) by updating
   * its title slot in the page source. `src` + `occurrence` (the
   * 0-based count of this same src on the page, top-down) identifies
   * which image to change. Both `width` and `height` are optional —
   * pass `undefined` for either axis to remove that constraint (image
   * becomes fluid on that side). Passing neither removes the title
   * sizing entirely.
   *
   * Drives the drag-resize handles in the web client. The persistence
   * lives in the markdown title slot, not in `alt` — keeping `alt` for
   * its real purpose (screen-reader / FTS text).
   */
  setInlineImageSize(
    pageId: number,
    src: string,
    occurrence: number,
    opts: { width?: number; height?: number },
  ): { id: number; version: number; updated_at: string } {
    const meta = this.getMetadata(pageId);
    if (!meta) throw new Error(`page #${pageId} not found`);
    const content = this.readContent(meta.knowledge_id, pageId);

    // Standard inline image syntax — alt may contain anything except `]`;
    // title is the quoted slot after the URL (whitespace-separated). We
    // don't try to handle escaped brackets in the alt; rare in practice.
    const IMAGE_RE =
      /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"((?:[^"\\]|\\.)*)")?\)/g;
    let count = 0;
    let found = false;
    const next = content.replace(IMAGE_RE, (match, alt, matchSrc, title) => {
      if (matchSrc !== src) return match;
      if (count !== occurrence) {
        count++;
        return match;
      }
      count++;
      found = true;
      let caption = "";
      if (title) {
        const parsed = parseImageSize(title);
        caption = parsed ? parsed.rest : title;
      }
      const newTitle = formatImageTitle(caption, opts.width, opts.height);
      return newTitle
        ? `![${alt}](${matchSrc} "${newTitle}")`
        : `![${alt}](${matchSrc})`;
    });

    if (!found) {
      throw new Error(
        `image src=${src} occurrence=${occurrence} not found on page #${pageId}`,
      );
    }

    const finalContent = this.writeContent(meta.knowledge_id, pageId, next);
    const r = this.bumpVersion(pageId);
    const now = new Date().toISOString();
    this.syncFts(pageId, meta.title, meta.keywords, finalContent);
    this.saveRevision(
      pageId,
      r.version,
      meta.title,
      finalContent,
      meta.summary,
      joinKeywords(meta.keywords),
      now,
    );
    this.bumpKnowledge(meta.knowledge_id, pageId);
    return { id: pageId, version: r.version, updated_at: now };
  }

  /**
   * Set or clear the caption on a block annotated with `{@N}`. Rewrites
   * the annotation in place to `{@N "new caption"}` (or back to `{@N}`
   * when `caption` is null/empty). Works for both fence-info annotations
   * (rich blocks) and trailing-line annotations (markdown tables).
   * Bumps page version + snapshots revision like any other edit.
   */
  setBlockCaption(
    blockId: number,
    caption: string | null,
  ): {
    block_id: number;
    page_id: number;
    knowledge_id: number;
    caption: string | null;
    version: number;
  } {
    const b = this.getBlock(blockId);
    if (!b) throw new Error(`block @${blockId} not found`);
    const content = this.readContent(b.knowledge_id, b.page_id);
    const lines = content.split("\n");
    const trimmedCaption =
      caption == null ? null : caption.trim() === "" ? null : caption.trim();
    const targetText = formatAnnotation(blockId, trimmedCaption);

    let changed = false;
    for (let i = 0; i < lines.length; i++) {
      const matches = parseAllAnnotations(lines[i]);
      for (const m of matches) {
        if (m.id !== blockId) continue;
        lines[i] =
          lines[i].slice(0, m.start) + targetText + lines[i].slice(m.end);
        changed = true;
        break;
      }
      if (changed) break;
    }
    if (!changed) {
      throw new Error(
        `annotation {@${blockId}} not found in page source — out of sync`,
      );
    }

    const meta = this.getMetadata(b.page_id);
    if (!meta) throw new Error(`page #${b.page_id} not found`);
    const finalContent = this.writeContent(
      b.knowledge_id,
      b.page_id,
      lines.join("\n"),
    );
    const r = this.bumpVersion(b.page_id);
    const now = new Date().toISOString();
    this.syncFts(b.page_id, meta.title, meta.keywords, finalContent);
    this.saveRevision(
      b.page_id,
      r.version,
      meta.title,
      finalContent,
      meta.summary,
      joinKeywords(meta.keywords),
      now,
    );
    this.bumpKnowledge(b.knowledge_id, b.page_id);
    return {
      block_id: blockId,
      page_id: b.page_id,
      knowledge_id: b.knowledge_id,
      caption: trimmedCaption,
      version: r.version,
    };
  }

  /**
   * Resize an `<img>` that lives inside an `html-embed` fence by
   * rewriting its inline `style` attribute. `blockId` identifies the
   * fence (its `{@N}`), `imgIndex` is the 0-based position of the
   * `<img>` tag inside that fence (mirrors what the renderer stamps
   * as `data-html-img-index`). Sizing is encoded as
   * `max-width:Npx; max-height:Mpx` in the existing `style` attr —
   * any pre-existing `max-width`/`max-height` tokens are removed
   * before the new ones are written, while every other style
   * property the author wrote (border, padding, …) is preserved.
   * Pass `undefined` for an axis to remove that constraint.
   */
  setHtmlEmbedImageSize(
    pageId: number,
    blockId: number,
    imgIndex: number,
    opts: { width?: number; height?: number },
  ): { id: number; version: number; updated_at: string } {
    const meta = this.getMetadata(pageId);
    if (!meta) throw new Error(`page #${pageId} not found`);
    const block = this.getBlock(blockId);
    if (!block) throw new Error(`block @${blockId} not found`);
    if (block.kind !== "html-embed") {
      throw new Error(
        `@${blockId} is a ${block.kind} block, not html-embed`,
      );
    }

    let count = 0;
    let found = false;
    const newInner = block.inner.replace(
      /<img\b([^>]*?)(\/?)>/gi,
      (match, attrs, slash) => {
        if (count !== imgIndex) {
          count++;
          return match;
        }
        count++;
        found = true;
        const newAttrs = updateImgStyleAttr(
          attrs,
          opts.width,
          opts.height,
        );
        return `<img${newAttrs}${slash}>`;
      },
    );
    if (!found) {
      throw new Error(
        `<img> index ${imgIndex} not found inside @${blockId}`,
      );
    }

    // The fence body sits on lines [line_start+1 .. line_end-1] —
    // line_start is the ```html-embed line and line_end is the
    // closing ``` line.
    const bodyStart = block.line_start + 1;
    const bodyEnd = block.line_end - 1;
    if (bodyEnd < bodyStart) {
      // Defensive: an empty fence shouldn't have hit our regex anyway,
      // but bail rather than corrupt the closing marker.
      throw new Error(`@${blockId} body is empty`);
    }
    const r = this.editLines(pageId, bodyStart, bodyEnd, newInner);
    return {
      id: r.id,
      version: r.version,
      updated_at: new Date().toISOString(),
    };
  }

  /**
   * Preserve `{@N}` annotations when an edit replaces a region that had
   * block ids. When AI converts a block from one type to another (e.g.
   * markdown table → html-embed, stats card → mermaid) it often forgets
   * to keep the `{@N}` annotation in the new source — without this guard
   * the server would allocate a fresh id and silently break every
   * `@N` reference the user had to the old block.
   *
   * Strategy: extract every `{@N}` from `oldRegion`; any id NOT already
   * present in `newRegion` is injected into the first eligible "id slot"
   * in `newRegion` (a fence-open line, or a markdown table) that doesn't
   * already carry an annotation. Missing ids are consumed in source
   * order, so an N-block region maps to an N-block replacement 1:1. If
   * `newRegion` has fewer eligible slots than missing ids (N:1 merge) or
   * none at all (replaced with prose), the extras are dropped — no
   * better answer in that case.
   *
   * Safe to call on any region; returns `newRegion` unchanged when there
   * are no ids to preserve or the new region already covers them.
   */
  private preserveBlockIds(oldRegion: string, newRegion: string): string {
    // Pull every {@N "caption"?} from the OLD region — captions follow
    // their id through the conversion so a markdown table → html-embed
    // (or stats → mermaid, etc.) doesn't silently lose either the id
    // OR the caption.
    const oldAnnotations = new Map<number, string | null>();
    for (const a of parseAllAnnotations(oldRegion)) {
      if (!oldAnnotations.has(a.id)) oldAnnotations.set(a.id, a.caption);
    }
    if (oldAnnotations.size === 0) return newRegion;
    const newIds = new Set<number>();
    for (const a of parseAllAnnotations(newRegion)) newIds.add(a.id);
    const missing: { id: number; caption: string | null }[] = [];
    for (const [id, caption] of oldAnnotations) {
      if (!newIds.has(id)) missing.push({ id, caption });
    }
    if (missing.length === 0) return newRegion;

    const TABLE_ROW = /^\s*\|.*\|\s*$/;
    const TABLE_SEP = /^\s*\|[-:|\s]+\|\s*$/;
    const lines = newRegion.split("\n");
    let inFence = false;
    let fenceMarker = "";
    let i = 0;
    while (i < lines.length && missing.length > 0) {
      const line = lines[i];
      if (!inFence) {
        // Fence-open with room for an id annotation in the info string.
        const open = /^(\s*)(```+)\s*([A-Za-z0-9_-]+)(.*)$/.exec(line);
        if (open) {
          const [, indent, marker, lang, rest] = open;
          inFence = true;
          fenceMarker = marker;
          if (!/\{@\d+/.test(rest)) {
            const { id, caption } = missing.shift()!;
            lines[i] = `${indent}${marker}${lang}${rest.replace(/\s*$/, "")} ${formatAnnotation(id, caption)}`;
          }
          i++;
          continue;
        }
        // Markdown table — header + separator + 0+ rows, with `{@N}`
        // sitting on its own line (preceded by a blank line) right after.
        if (
          TABLE_ROW.test(line) &&
          i + 1 < lines.length &&
          TABLE_SEP.test(lines[i + 1])
        ) {
          let end = i + 1;
          for (let j = i + 2; j < lines.length; j++) {
            if (TABLE_ROW.test(lines[j])) end = j;
            else break;
          }
          const peek1 = lines[end + 1] ?? "";
          const peek2 = lines[end + 2] ?? "";
          const annRe = /^\s*\{@\d+/;
          const alreadyAnnotated =
            annRe.test(peek1) || (peek1.trim() === "" && annRe.test(peek2));
          if (!alreadyAnnotated) {
            const { id, caption } = missing.shift()!;
            lines.splice(end + 1, 0, "", formatAnnotation(id, caption));
            i = end + 3;
          } else {
            i = peek1.trim() === "" ? end + 3 : end + 2;
          }
          continue;
        }
        i++;
      } else {
        const close = new RegExp(`^\\s*${fenceMarker}+\\s*$`);
        if (close.test(line)) {
          inFence = false;
          fenceMarker = "";
        }
        i++;
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
      this.bumpKnowledge(input.knowledge_id, id);
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
    this.bumpKnowledge(meta.knowledge_id, pageId);
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
    this.bumpKnowledge(meta.knowledge_id, pageId);
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
    opts: { expectedVersion?: number } = {},
  ): { index: number; done: boolean; version: number; updated_at: string } {
    const meta = this.getMetadata(pageId);
    if (!meta) throw new Error(`page #${pageId} not found`);
    if (
      opts.expectedVersion !== undefined &&
      opts.expectedVersion !== meta.version
    ) {
      throw new Error(
        `page #${pageId} version mismatch: expected v${opts.expectedVersion}, current v${meta.version} — re-read the page and try again`,
      );
    }
    const content = this.readContent(meta.knowledge_id, pageId);
    const lines = content.split("\n");
    const taskRe = /^(\s*[-*+]\s+)\[([ xX])\]/;
    const tableRowRe = /^\s*\|.*\|\s*$/;
    // Match `[ ]` / `[x]` / `[X]` anywhere inside a table-row cell.
    // The boundary lookahead `(?=\s|\|)` keeps us from matching
    // `[xyz]` and ensures the cell ends after the bracket (a pipe `|`
    // is the cell separator). The renderer uses the equivalent
    // `(?=\s|$)` check against parsed cell text — same set of matches,
    // same order, so the global index counter stays consistent.
    const cellTaskRe = /\[([ xX])\](?=\s|\|)/g;
    const htmlCheckboxRe = /<input\b([^>]*)>/gi;
    type GfmTarget = { kind: "gfm"; line: number; match: RegExpExecArray };
    type HtmlTarget = {
      kind: "html";
      line: number;
      offset: number;
      raw: string;
      attrs: string;
    };
    type CellTarget = {
      kind: "cell";
      line: number;
      /** Offset of the `[` character in the line. */
      offset: number;
      char: string;
    };
    let inFence = false;
    let fenceLang = "";
    let fenceMarker = "";
    let count = 0;
    let target: GfmTarget | HtmlTarget | CellTarget | null = null;
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
        if (m) {
          if (count === index) {
            target = { kind: "gfm", line: i, match: m };
            break;
          }
          count++;
          continue;
        }
        // Markdown-table row — pick up every `[ ]` / `[x]` cell checkbox.
        if (tableRowRe.test(lines[i])) {
          cellTaskRe.lastIndex = 0;
          let cm: RegExpExecArray | null;
          while ((cm = cellTaskRe.exec(lines[i])) !== null) {
            // `cm.index` is the offset of `[` directly (the regex no
            // longer consumes a leading `|`).
            if (count === index) {
              target = {
                kind: "cell",
                line: i,
                offset: cm.index,
                char: cm[1],
              };
              break;
            }
            count++;
          }
        }
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
    } else if (target.kind === "cell") {
      const wasChecked = target.char.toLowerCase() === "x";
      done = !wasChecked;
      const newMark = wasChecked ? " " : "x";
      const line = lines[target.line];
      lines[target.line] =
        line.substring(0, target.offset) +
        `[${newMark}]` +
        line.substring(target.offset + 3);
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
    this.bumpKnowledge(meta.knowledge_id, pageId);
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
      emitEvent({
        type: "page-deleted",
        page_id: pageId,
        knowledge_id: meta.knowledge_id,
      });
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
    // Preserve any `{@N}` annotations from the replaced region so AI
    // can convert a block from one type to another (e.g. markdown table
    // ↔ html-embed) without the id silently regenerating.
    const newTextWithIds = this.preserveBlockIds(oldSlice, newText);
    const newLines = newTextWithIds.split("\n");
    const draft = [
      ...lines.slice(0, lineStart - 1),
      ...newLines,
      ...lines.slice(safeEnd),
    ].join("\n");
    const next = this.writeContent(meta.knowledge_id, pageId, draft);
    const r = this.bumpVersion(pageId);
    this.syncFts(pageId, meta.title, meta.keywords, next);
    this.saveRevision(pageId, r.version, meta.title, next, meta.summary, joinKeywords(meta.keywords), new Date().toISOString());
    this.bumpKnowledge(meta.knowledge_id, pageId);
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
    // Auto-strip the duplicate-heading footgun: callers (especially LLMs)
    // often paste back a section verbatim, heading included. Without this
    // guard the naive `heading + "\n" + body` concat below would emit the
    // heading twice. If the first non-blank line of `newContent` matches
    // the heading we keep, silently drop it (plus one optional blank
    // line right after it, which is the canonical authoring style).
    const bodyLines = newContent.split("\n");
    let cursor = 0;
    while (cursor < bodyLines.length && bodyLines[cursor].trim() === "") {
      cursor++;
    }
    if (
      cursor < bodyLines.length &&
      bodyLines[cursor].trim() === targetHeadingText
    ) {
      bodyLines.splice(0, cursor + 1);
      if (bodyLines.length > 0 && bodyLines[0].trim() === "") {
        bodyLines.shift();
      }
    }
    const body = bodyLines.join("\n").replace(/^\n+|\n+$/g, "");
    // Preserve any `{@N}` annotations carried by the section being
    // replaced — covers the common "convert block type" workflow.
    const oldSection = lines.slice(startIdx, endIdx).join("\n");
    const preservedBody = this.preserveBlockIds(oldSection, body);
    const newSlice = (heading.trim() + (preservedBody ? "\n" + preservedBody : "")).split("\n");
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
    this.bumpKnowledge(meta.knowledge_id, pageId);
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
        // Per-page event so each affected page invalidates client-side.
        emitEvent({
          type: "page-changed",
          page_id: meta.id,
          knowledge_id: knowledgeId,
        });
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

  private bumpKnowledge(knowledgeId: number, pageId?: number): void {
    const now = new Date().toISOString();
    this.db
      .prepare(`UPDATE knowledge SET updated_at = ?, version = version + 1 WHERE id = ?`)
      .run(now, knowledgeId);
    emitEvent(
      pageId != null
        ? { type: "page-changed", page_id: pageId, knowledge_id: knowledgeId }
        : { type: "knowledge-changed", knowledge_id: knowledgeId },
    );
  }

  private syncFts(pageId: number, title: string, keywords: string[] | undefined, content: string): void {
    this.db.prepare(`DELETE FROM pages_fts WHERE rowid = ?`).run(pageId);
    this.db
      .prepare(`INSERT INTO pages_fts(rowid, content, title, keywords) VALUES (?, ?, ?, ?)`)
      .run(pageId, content, title, (keywords ?? []).join(" "));
  }

  /** Maximum number of revision snapshots kept per page. Any older rows are
   *  pruned automatically after each save. */
  static readonly MAX_REVISIONS_PER_PAGE = 10;

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

  /** Walk every remaining page on disk and collect every internal image
   *  hash (`/img/<hash>.<ext>`) referenced anywhere in source. Used by
   *  orphan-image cleanup after delete_knowledge / delete_page so a
   *  removed page's exclusive images don't leak forever. */
  allReferencedImageHashes(): Set<string> {
    const set = new Set<string>();
    const re = /\/img\/([a-f0-9]{64})\.[a-z0-9]{2,5}/gi;
    const rows = this.db
      .prepare(`SELECT id, knowledge_id FROM pages`)
      .all() as { id: number; knowledge_id: number }[];
    for (const r of rows) {
      let content: string;
      try {
        content = this.readContent(r.knowledge_id, r.id);
      } catch {
        continue;
      }
      let m: RegExpExecArray | null;
      re.lastIndex = 0;
      while ((m = re.exec(content)) !== null) set.add(m[1]);
    }
    return set;
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
