import type { Db } from "./db.js";
import { emitEvent } from "../lib/events.js";

export interface KnowledgeMetadata {
  id: number;
  title: string;
  project: string | null;
  session_id: string | null;
  user_prompt: string | null;
  tokens_used: number | null;
  tags: string[];
  author: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface AddKnowledgeInput {
  title: string;
  project?: string;
  session_id?: string;
  user_prompt?: string;
  tokens_used?: number;
  tags?: string[];
  author?: string;
}

export interface UpdateKnowledgeInput {
  title?: string;
  project?: string;
  session_id?: string;
  user_prompt?: string;
  tokens_used?: number;
  tags?: string[];
}

export interface ListKnowledgeFilter {
  project?: string;
  session_id?: string;
  tag?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

interface Row {
  id: number;
  title: string;
  project: string | null;
  session_id: string | null;
  user_prompt: string | null;
  tokens_used: number | null;
  tags: string | null;
  author: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

function parseTags(tags: string | null): string[] {
  if (!tags) return [];
  return tags.split(",").map((t) => t.trim()).filter(Boolean);
}

function joinTags(tags: string[] | undefined): string | null {
  if (!tags || tags.length === 0) return null;
  return tags.map((t) => t.trim()).filter(Boolean).join(",");
}

function rowToMetadata(row: Row): KnowledgeMetadata {
  return {
    id: row.id,
    title: row.title,
    project: row.project,
    session_id: row.session_id,
    user_prompt: row.user_prompt,
    tokens_used: row.tokens_used,
    tags: parseTags(row.tags),
    author: row.author,
    created_at: row.created_at,
    updated_at: row.updated_at,
    version: row.version,
  };
}

export class KnowledgeStore {
  constructor(private db: Db) {}

  // ─────────── Projects (registry + derived) ───────────

  /** Register an empty project so it appears in the filter / picker
   *  pickers before any knowledge is assigned to it. No-op if already
   *  present. Returns the canonical row. */
  registerProject(name: string): { name: string; created_at: string } {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("project name is required");
    const now = new Date().toISOString();
    this.db
      .prepare(`INSERT OR IGNORE INTO projects (name, created_at) VALUES (?, ?)`)
      .run(trimmed, now);
    const row = this.db
      .prepare(`SELECT name, created_at FROM projects WHERE name = ?`)
      .get(trimmed) as { name: string; created_at: string } | undefined;
    if (!row) {
      // If the row was filtered into existence purely via the union below
      // (knowledge already had this project but the registry didn't), just
      // return a synthetic row.
      return { name: trimmed, created_at: now };
    }
    return row;
  }

  /** Drop a project from the registry. Does NOT delete any knowledge —
   *  the project name simply stops appearing on its own once no knowledge
   *  references it. */
  unregisterProject(name: string): { name: string; removed: boolean } {
    const r = this.db
      .prepare(`DELETE FROM projects WHERE name = ?`)
      .run(name.trim());
    return { name: name.trim(), removed: r.changes > 0 };
  }

  /** List every project in the system — both registered (possibly empty)
   *  and derived from existing knowledge rows. Returns per-project count. */
  listProjects(): { name: string; count: number; registered: boolean }[] {
    const fromKnowledge = this.db
      .prepare(
        `SELECT project AS name, COUNT(*) AS count
         FROM knowledge
         WHERE project IS NOT NULL AND project <> ''
         GROUP BY project`,
      )
      .all() as { name: string; count: number }[];
    const registered = this.db
      .prepare(`SELECT name FROM projects`)
      .all() as { name: string }[];
    const merged = new Map<string, { count: number; registered: boolean }>();
    for (const r of fromKnowledge) {
      merged.set(r.name, { count: r.count, registered: false });
    }
    for (const r of registered) {
      const prev = merged.get(r.name);
      if (prev) prev.registered = true;
      else merged.set(r.name, { count: 0, registered: true });
    }
    return Array.from(merged.entries())
      .map(([name, v]) => ({ name, count: v.count, registered: v.registered }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }

  add(input: AddKnowledgeInput): { id: number; created_at: string } {
    if (!input.title || !input.title.trim()) {
      throw new Error("title is required");
    }
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO knowledge (title, project, session_id, user_prompt, tokens_used, tags, author, created_at, updated_at, version)
      VALUES (@title, @project, @session_id, @user_prompt, @tokens_used, @tags, @author, @now, @now, 1)
    `);
    const result = stmt.run({
      title: input.title.trim(),
      project: input.project ?? null,
      session_id: input.session_id ?? null,
      user_prompt: input.user_prompt ?? null,
      tokens_used: input.tokens_used ?? null,
      tags: joinTags(input.tags),
      author: input.author ?? null,
      now,
    });
    const id = Number(result.lastInsertRowid);
    emitEvent({ type: "knowledge-changed" });
    return { id, created_at: now };
  }

  get(id: number): KnowledgeMetadata | null {
    const row = this.db
      .prepare(`SELECT * FROM knowledge WHERE id = ?`)
      .get(id) as Row | undefined;
    return row ? rowToMetadata(row) : null;
  }

  update(id: number, patch: UpdateKnowledgeInput): { id: number; version: number; updated_at: string } {
    const existing = this.db
      .prepare(`SELECT * FROM knowledge WHERE id = ?`)
      .get(id) as Row | undefined;
    if (!existing) throw new Error(`knowledge #${id} not found`);

    const now = new Date().toISOString();
    const nextVersion = existing.version + 1;
    const tagsValue =
      patch.tags !== undefined ? joinTags(patch.tags) : existing.tags;

    this.db
      .prepare(
        `UPDATE knowledge SET
            title       = @title,
            project     = @project,
            session_id  = @session_id,
            user_prompt = @user_prompt,
            tokens_used = @tokens_used,
            tags        = @tags,
            updated_at  = @now,
            version     = @version
          WHERE id = @id`,
      )
      .run({
        id,
        title: patch.title !== undefined ? patch.title.trim() : existing.title,
        project: patch.project !== undefined ? patch.project : existing.project,
        session_id:
          patch.session_id !== undefined ? patch.session_id : existing.session_id,
        user_prompt:
          patch.user_prompt !== undefined ? patch.user_prompt : existing.user_prompt,
        tokens_used:
          patch.tokens_used !== undefined ? patch.tokens_used : existing.tokens_used,
        tags: tagsValue,
        now,
        version: nextVersion,
      });

    emitEvent({ type: "knowledge-changed", knowledge_id: id });
    return { id, version: nextVersion, updated_at: now };
  }

  list(filter: ListKnowledgeFilter): KnowledgeMetadata[] {
    const where: string[] = [];
    const params: Record<string, unknown> = {};

    if (filter.project) {
      where.push("project = @project");
      params.project = filter.project;
    }
    if (filter.session_id) {
      where.push("session_id = @session_id");
      params.session_id = filter.session_id;
    }
    if (filter.tag) {
      where.push("(',' || COALESCE(tags,'') || ',') LIKE @tagLike");
      params.tagLike = `%,${filter.tag},%`;
    }
    if (filter.search) {
      where.push(
        "(title LIKE @search OR COALESCE(project,'') LIKE @search OR COALESCE(tags,'') LIKE @search OR COALESCE(user_prompt,'') LIKE @search)",
      );
      params.search = `%${filter.search}%`;
    }

    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;
    params.limit = limit;
    params.offset = offset;

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const sql = `
      SELECT * FROM knowledge
      ${whereSql}
      ORDER BY updated_at DESC, id DESC
      LIMIT @limit OFFSET @offset
    `;
    const rows = this.db.prepare(sql).all(params) as Row[];
    return rows.map(rowToMetadata);
  }

  remove(id: number): void {
    this.db.prepare(`DELETE FROM knowledge WHERE id = ?`).run(id);
    emitEvent({ type: "knowledge-changed" });
  }
}
