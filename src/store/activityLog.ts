import type { Db } from "./db.js";
import { getCallContext } from "../lib/callContext.js";

export type ActivityAction =
  | "add"
  | "edit"
  | "delete"
  | "reorder"
  | "toggle"
  | "caption"
  | "upload"
  | "resize";

export type ActivityTarget =
  | "knowledge"
  | "page"
  | "block"
  | "image"
  | "task";

/** What a single recorded row looks like — what callers pass in (no
 *  `created_at` / `id` / `source` — those are filled in for them). */
export interface RecordInput {
  action: ActivityAction;
  target: ActivityTarget;
  knowledge_id?: number | null;
  knowledge_title?: string | null;
  page_id?: number | null;
  page_title?: string | null;
  block_id?: number | null;
  block_caption?: string | null;
}

export interface ActivityEntry {
  id: number;
  created_at: string;
  source: "mcp" | "web";
  tool_name: string | null;
  action: ActivityAction;
  target: ActivityTarget;
  knowledge_id: number | null;
  knowledge_title: string | null;
  page_id: number | null;
  page_title: string | null;
  block_id: number | null;
  block_caption: string | null;
  /** Acting user id when known. NULL for rows written before auth was
   *  enabled, or for MCP rows when no `mcpDefaultUserId` was set. */
  user_id: number | null;
  /** Joined display name — present when the user_id still resolves to
   *  an existing user. Snapshotted at SELECT time (not insert), so a
   *  rename of the user shows up in old log rows too. */
  user_name: string | null;
}

/**
 * Coarse audit-log store. One row per mutating action — add / edit /
 * delete / toggle / caption / reorder / upload / resize — captured from
 * the centralised handlers. Titles + captions are snapshotted at record
 * time so the log stays readable even after a target is renamed or
 * deleted. Content bodies are deliberately NOT stored; the prompt-log
 * + page-revision tables already cover "what changed" if a caller
 * asks. This table answers "what happened, where, when, by whom".
 */
export class ActivityLogStore {
  constructor(private db: Db) {}

  /** Insert a row tagged with the current call context (source +
   *  optional tool_name) and the current ISO timestamp. */
  record(entry: RecordInput): void {
    const ctx = getCallContext();
    this.db
      .prepare(
        `INSERT INTO activity_log
         (created_at, source, tool_name, action, target,
          knowledge_id, knowledge_title, page_id, page_title,
          block_id, block_caption, user_id)
         VALUES
         (@created_at, @source, @tool_name, @action, @target,
          @knowledge_id, @knowledge_title, @page_id, @page_title,
          @block_id, @block_caption, @user_id)`,
      )
      .run({
        created_at: new Date().toISOString(),
        source: ctx.source,
        tool_name: ctx.tool_name ?? null,
        action: entry.action,
        target: entry.target,
        knowledge_id: entry.knowledge_id ?? null,
        knowledge_title: entry.knowledge_title ?? null,
        page_id: entry.page_id ?? null,
        page_title: entry.page_title ?? null,
        block_id: entry.block_id ?? null,
        block_caption: entry.block_caption ?? null,
        user_id: ctx.user_id ?? null,
      });
  }

  /** List entries newest-first. Optional `knowledge_id` narrows to a
   *  single knowledge; `limit` defaults to 100 (max 500). */
  list(opts: {
    limit?: number;
    offset?: number;
    knowledge_id?: number;
  } = {}): { entries: ActivityEntry[]; total: number } {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    const offset = Math.max(opts.offset ?? 0, 0);
    const wherePart =
      opts.knowledge_id != null ? "WHERE knowledge_id = @kid" : "";
    const rows = this.db
      .prepare(
        `SELECT a.id, a.created_at, a.source, a.tool_name, a.action, a.target,
                a.knowledge_id, a.knowledge_title, a.page_id, a.page_title,
                a.block_id, a.block_caption, a.user_id,
                u.display_name AS user_name
         FROM activity_log a
         LEFT JOIN users u ON u.id = a.user_id
         ${wherePart.replace("knowledge_id =", "a.knowledge_id =")}
         ORDER BY a.id DESC
         LIMIT @limit OFFSET @offset`,
      )
      .all({
        kid: opts.knowledge_id,
        limit,
        offset,
      }) as ActivityEntry[];
    const totalRow = this.db
      .prepare(`SELECT COUNT(*) AS n FROM activity_log ${wherePart}`)
      .get({ kid: opts.knowledge_id }) as { n: number };
    return { entries: rows, total: totalRow.n };
  }
}
