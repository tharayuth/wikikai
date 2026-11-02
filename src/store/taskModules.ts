import { DEFAULT_MODULE_NAME, type Db } from "./db.js";
import type { ActivityAction, ActivityLogStore, ActivityTarget } from "./activityLog.js";
import { emitEvent } from "../lib/events.js";

/**
 * The structure of a project's boards: modules, and the columns people add to
 * them. See docs/superpowers/specs/2026-11-02-task-modules-and-columns-design.md.
 *
 * - A module is a separate board. Every task belongs to exactly one.
 * - Each module has four locked columns with no row of their own, so nothing
 *   stored can rename or delete one. A custom column is a place within one
 *   status, which keeps the four statuses meaning the same thing to an agent.
 */

export const TASK_STATUSES = ["todo", "doing", "review", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type BoardMove = "left" | "right";

export const LOCKED_COLUMN_NAMES: Record<TaskStatus, string> = {
  todo: "Todo",
  doing: "Doing",
  review: "Review",
  done: "Done",
};

const NAME_MAX = 50;
const STATUS_ORDER = `CASE status WHEN 'todo' THEN 1 WHEN 'doing' THEN 2 WHEN 'review' THEN 3 ELSE 4 END`;

export interface TaskColumn {
  id: number;
  module_id: number;
  name: string;
  status: TaskStatus;
  /** Within its status. The locked column counts as 0. */
  position: number;
}

export interface TaskModuleRow {
  id: number;
  project_id: number;
  name: string;
  position: number;
}

export interface TaskModule extends TaskModuleRow {
  /** Archived tasks included, because it drives the delete guard. */
  task_count: number;
  columns: TaskColumn[];
}

export class TaskConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskConflictError";
  }
}

export class BoardItemNotFoundError extends Error {
  constructor(kind: "module" | "column", id: number) {
    super(`${kind} ${id} not found`);
    this.name = "BoardItemNotFoundError";
  }
}

function cleanName(value: string): string {
  const name = value.trim();
  if (!name) throw new Error("name is required");
  if (name.length > NAME_MAX) throw new Error(`name must be ≤ ${NAME_MAX} chars`);
  return name;
}

const sameName = (a: string, b: string): boolean => a.toLocaleLowerCase() === b.toLocaleLowerCase();

/** Locked and custom columns of one module, as the board shows them. */
function boardOrder(columns: TaskColumn[]): { name: string; status: TaskStatus; column_id: number | null }[] {
  return TASK_STATUSES.flatMap((status) => {
    const own = columns.filter((c) => c.status === status).sort((a, b) => a.position - b.position || a.id - b.id);
    const toEntry = (c: TaskColumn) => ({ name: c.name, status, column_id: c.id });
    return [
      ...own.filter((c) => c.position < 0).map(toEntry),
      { name: LOCKED_COLUMN_NAMES[status], status, column_id: null },
      ...own.filter((c) => c.position > 0).map(toEntry),
    ];
  });
}

export class TaskModuleStore {
  constructor(
    private readonly db: Db,
    private readonly activityLog: ActivityLogStore,
  ) {}

  // ─── Reads ───

  list(projectId: number): TaskModule[] {
    this.firstModule(projectId);
    const modules = this.db
      .prepare(
        `SELECT m.id, m.project_id, m.name, m.position,
                (SELECT COUNT(*) FROM tasks t WHERE t.module_id = m.id) AS task_count
         FROM task_modules m WHERE m.project_id = ?
         ORDER BY m.position, m.id`,
      )
      .all(projectId) as Omit<TaskModule, "columns">[];
    const columns = this.db
      .prepare(
        `SELECT id, module_id, name, status, position FROM task_columns
         WHERE module_id IN (SELECT id FROM task_modules WHERE project_id = ?)
         ORDER BY ${STATUS_ORDER}, position, id`,
      )
      .all(projectId) as TaskColumn[];
    return modules.map((m) => ({ ...m, columns: columns.filter((c) => c.module_id === m.id) }));
  }

  /** The project's first module, creating `General` when it has none. Silent:
   *  not logged and no event, because any reader gets the same row. */
  firstModule(projectId: number): TaskModuleRow {
    const find = (): TaskModuleRow | undefined =>
      this.db
        .prepare(`SELECT id, project_id, name, position FROM task_modules WHERE project_id = ? ORDER BY position, id LIMIT 1`)
        .get(projectId) as TaskModuleRow | undefined;
    const first = find();
    if (first) return first;
    this.db
      .prepare(`INSERT INTO task_modules (project_id, name, position, created_at) VALUES (?, ?, 1, ?)`)
      .run(projectId, DEFAULT_MODULE_NAME, new Date().toISOString());
    return find() as TaskModuleRow;
  }

  getModule(id: number): TaskModuleRow | null {
    const row = this.db.prepare(`SELECT id, project_id, name, position FROM task_modules WHERE id = ?`).get(id) as
      | TaskModuleRow
      | undefined;
    return row ?? null;
  }

  getColumn(id: number): TaskColumn | null {
    const row = this.db.prepare(`SELECT id, module_id, name, status, position FROM task_columns WHERE id = ?`).get(id) as
      | TaskColumn
      | undefined;
    return row ?? null;
  }

  /** A module by name, ignoring case. The error lists what is valid. */
  resolveModule(projectId: number, name: string): TaskModuleRow {
    const modules = this.list(projectId);
    const found = modules.find((m) => sameName(m.name, name.trim()));
    if (!found) {
      throw new Error(`module '${name}' not found. Valid modules: ${modules.map((m) => m.name).join(", ")}`);
    }
    return this.requireModule(found.id);
  }

  /** A column by name, ignoring case. A locked column has no id. */
  resolveColumn(moduleId: number, name: string): { column_id: number | null; status: TaskStatus } {
    const module = this.requireModule(moduleId);
    const columns = boardOrder(this.columnsOf(moduleId));
    const found = columns.find((c) => sameName(c.name, name.trim()));
    if (!found) {
      const valid = columns.map((c) => c.name).join(", ");
      throw new Error(`column '${name}' not found in module '${module.name}'. Valid columns: ${valid}`);
    }
    return { column_id: found.column_id, status: found.status };
  }

  // ─── Modules ───

  addModule(projectId: number, rawName: string): TaskModuleRow {
    this.firstModule(projectId);
    const name = cleanName(rawName);
    this.assertModuleNameFree(projectId, name, null);
    const { max } = this.db
      .prepare(`SELECT COALESCE(MAX(position), 0) AS max FROM task_modules WHERE project_id = ?`)
      .get(projectId) as { max: number };
    const info = this.db
      .prepare(`INSERT INTO task_modules (project_id, name, position, created_at) VALUES (?, ?, ?, ?)`)
      .run(projectId, name, max + 1, new Date().toISOString());
    this.afterChange("add", "board_module", projectId, name);
    return this.requireModule(Number(info.lastInsertRowid));
  }

  updateModule(id: number, input: { name?: string; move?: BoardMove }): TaskModuleRow {
    const cur = this.requireModule(id);
    if (input.name === undefined && input.move === undefined) throw new Error("nothing to change");
    this.db.transaction(() => {
      if (input.name !== undefined) {
        const name = cleanName(input.name);
        this.assertModuleNameFree(cur.project_id, name, id);
        this.db.prepare(`UPDATE task_modules SET name = ? WHERE id = ?`).run(name, id);
      }
      if (input.move !== undefined) this.moveModule(cur, input.move);
    })();
    const next = this.requireModule(id);
    if (next.name !== cur.name) {
      this.afterChange("edit", "board_module", cur.project_id, `${cur.name} → ${next.name}`);
    } else {
      emitEvent({ type: "board-changed", project_id: cur.project_id });
    }
    return next;
  }

  /** Only an empty module can go, and never the project's last. */
  deleteModule(id: number): void {
    const cur = this.requireModule(id);
    const { n } = this.db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE module_id = ?`).get(id) as { n: number };
    if (n > 0) {
      throw new TaskConflictError(
        `module '${cur.name}' still has ${n} task${n === 1 ? "" : "s"}, archived ones included`,
      );
    }
    const { total } = this.db
      .prepare(`SELECT COUNT(*) AS total FROM task_modules WHERE project_id = ?`)
      .get(cur.project_id) as { total: number };
    if (total <= 1) throw new TaskConflictError(`cannot delete the last module of a project`);
    this.db.prepare(`DELETE FROM task_modules WHERE id = ?`).run(id);
    this.afterChange("delete", "board_module", cur.project_id, cur.name);
  }

  // ─── Columns ───

  addColumn(moduleId: number, input: { name: string; status: TaskStatus }): TaskColumn {
    const module = this.requireModule(moduleId);
    const name = cleanName(input.name);
    this.assertColumnNameFree(moduleId, name, null);
    const { max } = this.db
      .prepare(`SELECT COALESCE(MAX(position), 0) AS max FROM task_columns WHERE module_id = ? AND status = ?`)
      .get(moduleId, input.status) as { max: number };
    const info = this.db
      .prepare(`INSERT INTO task_columns (module_id, name, status, position, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(moduleId, name, input.status, Math.max(max, 0) + 1, new Date().toISOString());
    this.afterChange("add", "board_column", module.project_id, name);
    return this.requireColumn(Number(info.lastInsertRowid));
  }

  updateColumn(id: number, input: { name?: string; move?: BoardMove }): TaskColumn {
    const cur = this.requireColumn(id);
    const module = this.requireModule(cur.module_id);
    if (input.name === undefined && input.move === undefined) throw new Error("nothing to change");
    this.db.transaction(() => {
      if (input.name !== undefined) {
        const name = cleanName(input.name);
        this.assertColumnNameFree(cur.module_id, name, id);
        this.db.prepare(`UPDATE task_columns SET name = ? WHERE id = ?`).run(name, id);
      }
      if (input.move !== undefined) this.moveColumn(cur, input.move);
    })();
    const next = this.requireColumn(id);
    if (next.name !== cur.name) {
      this.afterChange("edit", "board_column", module.project_id, `${cur.name} → ${next.name}`);
    } else {
      emitEvent({ type: "board-changed", project_id: module.project_id });
    }
    return next;
  }

  /** Cards go to the bottom of the locked column of the same status, in their
   *  order and with no version bump, because nobody's work changed. */
  deleteColumn(id: number): void {
    const cur = this.requireColumn(id);
    const module = this.requireModule(cur.module_id);
    const moved = this.db.transaction(() => {
      const cards = this.db
        .prepare(`SELECT id FROM tasks WHERE column_id = ? AND archived_at IS NULL ORDER BY position, id`)
        .all(id) as { id: number }[];
      const { bottom } = this.db
        .prepare(
          `SELECT COALESCE(MAX(position), 0) AS bottom FROM tasks
           WHERE module_id = ? AND status = ? AND column_id IS NULL AND archived_at IS NULL`,
        )
        .get(cur.module_id, cur.status) as { bottom: number };
      const place = this.db.prepare(`UPDATE tasks SET column_id = NULL, position = ? WHERE id = ?`);
      cards.forEach((card, i) => place.run(bottom + i + 1, card.id));
      this.db.prepare(`UPDATE tasks SET column_id = NULL WHERE column_id = ?`).run(id);
      this.db.prepare(`DELETE FROM task_columns WHERE id = ?`).run(id);
      return cards.length;
    })();
    const detail = moved
      ? ` (${moved} card${moved === 1 ? "" : "s"} moved to ${LOCKED_COLUMN_NAMES[cur.status]})`
      : "";
    this.afterChange("delete", "board_column", module.project_id, `${cur.name}${detail}`);
  }

  // ─── Internals ───

  private requireModule(id: number): TaskModuleRow {
    const row = this.getModule(id);
    if (!row) throw new BoardItemNotFoundError("module", id);
    return row;
  }

  private requireColumn(id: number): TaskColumn {
    const row = this.getColumn(id);
    if (!row) throw new BoardItemNotFoundError("column", id);
    return row;
  }

  private columnsOf(moduleId: number): TaskColumn[] {
    return this.db
      .prepare(`SELECT id, module_id, name, status, position FROM task_columns WHERE module_id = ?`)
      .all(moduleId) as TaskColumn[];
  }

  /** Compared here with `toLocaleLowerCase`, so non-Latin case variants collide
   *  too. The NOCASE unique index only folds ASCII: it is the backstop. */
  private assertModuleNameFree(projectId: number, name: string, exceptId: number | null): void {
    const rows = this.db.prepare(`SELECT id, name FROM task_modules WHERE project_id = ?`).all(projectId) as {
      id: number;
      name: string;
    }[];
    if (rows.some((r) => r.id !== exceptId && sameName(r.name, name))) {
      throw new TaskConflictError(`module '${name}' already exists in this project`);
    }
  }

  private assertColumnNameFree(moduleId: number, name: string, exceptId: number | null): void {
    if (TASK_STATUSES.some((s) => sameName(LOCKED_COLUMN_NAMES[s], name))) {
      throw new Error(`column name '${name}' is reserved for a built-in column`);
    }
    if (this.columnsOf(moduleId).some((c) => c.id !== exceptId && sameName(c.name, name))) {
      throw new TaskConflictError(`column '${name}' already exists in this module`);
    }
  }

  private moveModule(cur: TaskModuleRow, move: BoardMove): void {
    const ids = (
      this.db.prepare(`SELECT id FROM task_modules WHERE project_id = ? ORDER BY position, id`).all(cur.project_id) as {
        id: number;
      }[]
    ).map((r) => r.id);
    if (!swapWithNeighbour(ids, cur.id, move)) return;
    const update = this.db.prepare(`UPDATE task_modules SET position = ? WHERE id = ?`);
    ids.forEach((id, i) => update.run(i + 1, id));
  }

  /** Swap within the status, the locked column included, then renumber so the
   *  locked column stays at 0. A column cannot leave its status. */
  private moveColumn(cur: TaskColumn, move: BoardMove): void {
    const own = this.columnsOf(cur.module_id)
      .filter((c) => c.status === cur.status)
      .sort((a, b) => a.position - b.position || a.id - b.id);
    const order: (number | null)[] = [
      ...own.filter((c) => c.position < 0).map((c) => c.id),
      null,
      ...own.filter((c) => c.position > 0).map((c) => c.id),
    ];
    if (!swapWithNeighbour(order, cur.id, move)) return;
    const locked = order.indexOf(null);
    const update = this.db.prepare(`UPDATE task_columns SET position = ? WHERE id = ?`);
    order.forEach((id, i) => {
      if (id !== null) update.run(i - locked, id);
    });
  }

  private afterChange(action: ActivityAction, target: ActivityTarget, projectId: number, name: string): void {
    try {
      this.activityLog.record({ action, target, project_id: projectId, task_title: name });
    } catch (e) {
      // The change has already committed, so it must not throw.
      // eslint-disable-next-line no-console
      console.error(`[wikikai] could not log board change: ${action} ${target} ${name}`, e);
    }
    emitEvent({ type: "board-changed", project_id: projectId });
  }
}

/** Past the edge changes nothing and reports false, so a slightly stale screen
 *  does not fail. */
function swapWithNeighbour<T>(list: T[], item: T, move: BoardMove): boolean {
  const from = list.indexOf(item);
  const to = move === "left" ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= list.length) return false;
  [list[from], list[to]] = [list[to], list[from]];
  return true;
}
