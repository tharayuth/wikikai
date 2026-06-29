import crypto from "node:crypto";
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
  project: string;
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

  /** Rename a project, keeping its id. Updates the registry row (the
   *  `project_permissions` FK cascades on update) and re-points every
   *  knowledge row that referenced the old name. Atomic. */
  renameProject(oldName: string, newName: string): { name: string } {
    const from = oldName.trim();
    const to = newName.trim();
    if (!to) throw new Error("project name is required");
    if (to.length > 100) throw new Error("project name must be ≤ 100 chars");
    if (from === to) return { name: to };
    // Reject a collision with any existing project (registered or derived).
    const clashRegistered = this.db
      .prepare(`SELECT 1 FROM projects WHERE name = ?`)
      .get(to);
    const clashKnowledge = this.db
      .prepare(`SELECT 1 FROM knowledge WHERE project = ? LIMIT 1`)
      .get(to);
    if (clashRegistered || clashKnowledge) {
      throw new Error(`project "${to}" already exists`);
    }
    const now = new Date().toISOString();
    const tx = this.db.transaction(() => {
      // Make sure a registry row exists so the rename (and its id) survives
      // even for a project that only existed implicitly via knowledge.
      this.ensureProjectRegistered(from, now);
      this.db
        .prepare(`UPDATE projects SET name = ? WHERE name = ?`)
        .run(to, from); // FK ON UPDATE CASCADE fixes project_permissions
      this.db
        .prepare(`UPDATE knowledge SET project = ? WHERE project = ?`)
        .run(to, from);
    });
    tx();
    emitEvent({ type: "knowledge-changed" });
    return { name: to };
  }

  /** List every project in the system — both registered (possibly empty)
   *  and derived from existing knowledge rows. Returns per-project count. */
  listProjects(): {
    id: number | null;
    name: string;
    count: number;
    registered: boolean;
  }[] {
    const fromKnowledge = this.db
      .prepare(
        `SELECT project AS name, COUNT(*) AS count
         FROM knowledge
         WHERE project IS NOT NULL AND project <> ''
         GROUP BY project`,
      )
      .all() as { name: string; count: number }[];
    const registered = this.db
      .prepare(`SELECT id, name FROM projects`)
      .all() as { id: number; name: string }[];
    const merged = new Map<
      string,
      { id: number | null; count: number; registered: boolean }
    >();
    for (const r of fromKnowledge) {
      merged.set(r.name, { id: null, count: r.count, registered: false });
    }
    for (const r of registered) {
      const prev = merged.get(r.name);
      if (prev) {
        prev.registered = true;
        prev.id = r.id;
      } else {
        merged.set(r.name, { id: r.id, count: 0, registered: true });
      }
    }
    return Array.from(merged.entries())
      .map(([name, v]) => ({
        id: v.id,
        name,
        count: v.count,
        registered: v.registered,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }

  add(input: AddKnowledgeInput): { id: number; created_at: string } {
    if (!input.title || !input.title.trim()) {
      throw new Error("title is required");
    }
    if (!input.project || !input.project.trim()) {
      throw new Error("project is required");
    }
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO knowledge (title, project, session_id, user_prompt, tokens_used, tags, author, created_at, updated_at, version)
      VALUES (@title, @project, @session_id, @user_prompt, @tokens_used, @tags, @author, @now, @now, 1)
    `);
    const result = stmt.run({
      title: input.title.trim(),
      project: input.project.trim(),
      session_id: input.session_id ?? null,
      user_prompt: input.user_prompt ?? null,
      tokens_used: input.tokens_used ?? null,
      tags: joinTags(input.tags),
      author: input.author ?? null,
      now,
    });
    // Ensure the project owns a registry row (and therefore a stable id)
    // the moment any knowledge references it.
    this.ensureProjectRegistered(input.project.trim(), now);
    const id = Number(result.lastInsertRowid);
    emitEvent({ type: "knowledge-changed" });
    return { id, created_at: now };
  }

  /** Insert a registry row for `name` if absent (no-op otherwise), so the
   *  project gets an auto-increment id as soon as it is referenced. */
  private ensureProjectRegistered(name: string, now: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.db
      .prepare(`INSERT OR IGNORE INTO projects (name, created_at) VALUES (?, ?)`)
      .run(trimmed, now);
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

    if (patch.project !== undefined && !patch.project.trim()) {
      throw new Error("project is required");
    }

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
        project: patch.project !== undefined ? patch.project.trim() : existing.project,
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

    // Moving a knowledge into a new project should give that project an id
    // immediately too.
    if (patch.project !== undefined) {
      this.ensureProjectRegistered(patch.project.trim(), now);
    }
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

  /** Subset of `list()` for non-admin users: only rows in projects the
   *  caller has any permission row for. Empty input → empty result
   *  (a user with no permissions sees nothing). No filters; sorted by
   *  updated_at DESC like `list()`. */
  listVisibleForUser(visibleProjects: string[]): KnowledgeMetadata[] {
    if (visibleProjects.length === 0) return [];
    const placeholders = visibleProjects.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT * FROM knowledge WHERE project IN (${placeholders})
         ORDER BY updated_at DESC, id DESC`,
      )
      .all(...visibleProjects) as Row[];
    return rows.map(rowToMetadata);
  }

  remove(id: number): void {
    this.db.prepare(`DELETE FROM knowledge WHERE id = ?`).run(id);
    emitEvent({ type: "knowledge-changed" });
  }

  // ─────────── Public share link ───────────

  /** Current share token for a knowledge, or null when not shared. */
  getShareToken(id: number): string | null {
    const row = this.db
      .prepare(`SELECT share_token FROM knowledge WHERE id = ?`)
      .get(id) as { share_token: string | null } | undefined;
    return row?.share_token ?? null;
  }

  /** Resolve a knowledge by its public share token. Returns null for an
   *  unknown / disabled token. The single entry point the public,
   *  unauthenticated /share endpoints use to scope access to one document. */
  findByShareToken(token: string): KnowledgeMetadata | null {
    if (!token) return null;
    const row = this.db
      .prepare(`SELECT * FROM knowledge WHERE share_token = ?`)
      .get(token) as Row | undefined;
    return row ? rowToMetadata(row) : null;
  }

  /** Enable sharing — generate a token if none exists, else return the
   *  existing one (idempotent). Returns the active token. */
  enableShare(id: number): string {
    const existing = this.getShareToken(id);
    if (existing) return existing;
    return this.rotateShare(id);
  }

  /** Issue a fresh share token, invalidating any previous link. */
  rotateShare(id: number): string {
    const token = crypto.randomBytes(24).toString("hex");
    const r = this.db
      .prepare(`UPDATE knowledge SET share_token = ? WHERE id = ?`)
      .run(token, id);
    if (r.changes === 0) throw new Error(`knowledge #${id} not found`);
    emitEvent({ type: "knowledge-changed" });
    return token;
  }

  /** Disable sharing — clears the token so the public link 404s. */
  disableShare(id: number): void {
    this.db
      .prepare(`UPDATE knowledge SET share_token = NULL WHERE id = ?`)
      .run(id);
    emitEvent({ type: "knowledge-changed" });
  }
}
