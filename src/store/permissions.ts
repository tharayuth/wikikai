import type { Db } from "./db.js";

export type AccessLevel = "view" | "edit";
export interface PermissionEntry {
  project: string;
  level: AccessLevel;
}

/**
 * CRUD for `project_permissions`. Missing row ≡ no access — there is no
 * "none" level stored; callers translate absence to none. Admins bypass
 * this store entirely; methods here treat every user the same.
 */
export class PermissionStore {
  constructor(private db: Db) {}

  get(user_id: number, project: string): { level: AccessLevel } | null {
    const row = this.db
      .prepare(
        `SELECT level FROM project_permissions
         WHERE user_id = ? AND project_name = ?`,
      )
      .get(user_id, project) as { level: AccessLevel } | undefined;
    return row ?? null;
  }

  listForUser(user_id: number): PermissionEntry[] {
    return this.db
      .prepare(
        `SELECT project_name AS project, level
         FROM project_permissions
         WHERE user_id = ?
         ORDER BY project_name`,
      )
      .all(user_id) as PermissionEntry[];
  }

  /** Replace the user's entire permission set in one transaction. */
  replaceForUser(
    user_id: number,
    entries: PermissionEntry[],
    granted_by: number | null,
  ): void {
    const now = new Date().toISOString();
    const del = this.db.prepare(
      `DELETE FROM project_permissions WHERE user_id = ?`,
    );
    const ins = this.db.prepare(
      `INSERT INTO project_permissions
         (user_id, project_name, level, granted_at, granted_by)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const tx = this.db.transaction((rows: PermissionEntry[]) => {
      del.run(user_id);
      for (const r of rows) ins.run(user_id, r.project, r.level, now, granted_by);
    });
    tx(entries);
  }

  /**
   * For non-admins: distinct project names the user has any row for.
   * For admins: the UNION of `projects` and distinct `knowledge.project`
   * (same set the existing `/api/projects` lists).
   */
  listVisibleProjects(user_id: number, is_admin: boolean): string[] {
    if (is_admin) {
      const rows = this.db
        .prepare(
          `SELECT name FROM (
             SELECT name FROM projects
             UNION
             SELECT project AS name FROM knowledge WHERE project IS NOT NULL
           ) ORDER BY name`,
        )
        .all() as Array<{ name: string }>;
      return rows.map((r) => r.name);
    }
    const rows = this.db
      .prepare(
        `SELECT project_name AS name FROM project_permissions
         WHERE user_id = ? ORDER BY project_name`,
      )
      .all(user_id) as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }
}
