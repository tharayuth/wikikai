import type { Db } from "./db.js";

export interface PromptLogEntry {
  id: number;
  knowledge_id: number;
  page_id: number | null;
  page_version: number | null;
  tool_name: string | null;
  prompt: string;
  created_at: string;
}

export const PROMPT_MAX_CHARS = 500;

interface AddInput {
  knowledge_id: number;
  page_id?: number | null;
  page_version?: number | null;
  tool_name?: string | null;
  prompt: string;
}

/**
 * Rolling log of the user-facing messages that shaped a knowledge doc.
 * Inserts are best-effort — empty / whitespace-only prompts are dropped,
 * and anything beyond `PROMPT_MAX_CHARS` is truncated so a verbose AI
 * can't fill the DB with the entire transcript of a session.
 */
export class PromptLogStore {
  constructor(private db: Db) {}

  add(input: AddInput): PromptLogEntry | null {
    const trimmed = input.prompt.trim();
    if (!trimmed) return null;
    const capped =
      trimmed.length > PROMPT_MAX_CHARS
        ? trimmed.slice(0, PROMPT_MAX_CHARS - 1).trimEnd() + "…"
        : trimmed;
    const now = new Date().toISOString();
    const r = this.db
      .prepare(
        `INSERT INTO prompt_log
           (knowledge_id, page_id, page_version, tool_name, prompt, created_at)
         VALUES (@knowledge_id, @page_id, @page_version, @tool_name, @prompt, @now)`,
      )
      .run({
        knowledge_id: input.knowledge_id,
        page_id: input.page_id ?? null,
        page_version: input.page_version ?? null,
        tool_name: input.tool_name ?? null,
        prompt: capped,
        now,
      });
    return {
      id: Number(r.lastInsertRowid),
      knowledge_id: input.knowledge_id,
      page_id: input.page_id ?? null,
      page_version: input.page_version ?? null,
      tool_name: input.tool_name ?? null,
      prompt: capped,
      created_at: now,
    };
  }

  listForKnowledge(
    knowledge_id: number,
    opts: { limit?: number; offset?: number } = {},
  ): PromptLogEntry[] {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    const offset = Math.max(opts.offset ?? 0, 0);
    const rows = this.db
      .prepare(
        `SELECT id, knowledge_id, page_id, page_version, tool_name, prompt, created_at
           FROM prompt_log
          WHERE knowledge_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT ? OFFSET ?`,
      )
      .all(knowledge_id, limit, offset) as PromptLogEntry[];
    return rows;
  }
}
