import type { Db } from "./db.js";
import type { ActivityLogStore } from "./activityLog.js";
import { parseDate } from "./calendar.js";
import { getCallContext } from "../lib/callContext.js";
import { emitEvent } from "../lib/events.js";
import { BoardItemNotFoundError, TaskConflictError } from "./taskModules.js";

/**
 * A project's milestones: a named date on the Gantt, which tasks can belong to.
 * Project-wide rather than per module, since a release usually spans modules.
 * A person marks one done. It does not follow its tasks, because finishing the
 * listed work and reaching the goal are not always the same thing.
 */

const NAME_MAX = 100;

export interface Milestone {
  id: number;
  project_id: number;
  name: string;
  date: string;
  done: boolean;
  /** Not counting archived tasks. */
  task_count: number;
  done_count: number;
}

interface MilestoneDbRow {
  id: number;
  project_id: number;
  name: string;
  date: string;
  done_at: string | null;
  task_count: number;
  done_count: number;
}

const SELECT_MILESTONE = `
  SELECT ms.id, ms.project_id, ms.name, ms.date, ms.done_at,
         (SELECT COUNT(*) FROM tasks t WHERE t.milestone_id = ms.id AND t.archived_at IS NULL) AS task_count,
         (SELECT COUNT(*) FROM tasks t WHERE t.milestone_id = ms.id AND t.archived_at IS NULL AND t.status = 'done') AS done_count
  FROM milestones ms`;

function toMilestone(r: MilestoneDbRow): Milestone {
  return {
    id: r.id,
    project_id: r.project_id,
    name: r.name,
    date: r.date,
    done: r.done_at !== null,
    task_count: r.task_count,
    done_count: r.done_count,
  };
}

function cleanName(value: string): string {
  const name = value.trim();
  if (!name) throw new Error("name is required");
  if (name.length > NAME_MAX) throw new Error(`name must be ≤ ${NAME_MAX} chars`);
  return name;
}

function cleanDate(value: string): string {
  parseDate(value, "date");
  return value;
}

const sameName = (a: string, b: string): boolean => a.toLocaleLowerCase() === b.toLocaleLowerCase();

export class MilestoneStore {
  constructor(
    private readonly db: Db,
    private readonly activityLog: ActivityLogStore,
  ) {}

  list(projectId: number): Milestone[] {
    const rows = this.db
      .prepare(`${SELECT_MILESTONE} WHERE ms.project_id = ? ORDER BY ms.date, ms.id`)
      .all(projectId) as MilestoneDbRow[];
    return rows.map(toMilestone);
  }

  get(id: number): Milestone | null {
    const row = this.db.prepare(`${SELECT_MILESTONE} WHERE ms.id = ?`).get(id) as MilestoneDbRow | undefined;
    return row ? toMilestone(row) : null;
  }

  /** A milestone by name, ignoring case. The error lists what is valid. */
  resolve(projectId: number, name: string): Milestone {
    const all = this.list(projectId);
    const found = all.find((m) => sameName(m.name, name.trim()));
    if (!found) {
      throw new Error(`milestone '${name}' not found. Valid milestones: ${all.map((m) => m.name).join(", ")}`);
    }
    return found;
  }

  add(projectId: number, input: { name: string; date: string }): Milestone {
    const name = cleanName(input.name);
    const date = cleanDate(input.date);
    this.assertNameFree(projectId, name, null);
    const info = this.db
      .prepare(`INSERT INTO milestones (project_id, name, date, created_by, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(projectId, name, date, getCallContext().user_id ?? null, new Date().toISOString());
    this.afterChange("add", projectId, `${name} (${date})`);
    return this.require(Number(info.lastInsertRowid));
  }

  update(id: number, input: { name?: string; date?: string; done?: boolean }): Milestone {
    const cur = this.require(id);
    if (input.name === undefined && input.date === undefined && input.done === undefined) {
      throw new Error("nothing to change");
    }
    const name = input.name !== undefined ? cleanName(input.name) : cur.name;
    const date = input.date !== undefined ? cleanDate(input.date) : cur.date;
    const done = input.done ?? cur.done;
    this.assertNameFree(cur.project_id, name, id);
    this.db
      .prepare(`UPDATE milestones SET name = ?, date = ?, done_at = CASE WHEN ? THEN COALESCE(done_at, ?) END WHERE id = ?`)
      .run(name, date, done ? 1 : 0, new Date().toISOString(), id);

    const details: string[] = [];
    if (date !== cur.date) details.push(`${cur.date} → ${date}`);
    if (done !== cur.done) details.push(done ? "done" : "reopened");
    if (details.length === 0 && name === cur.name) return this.require(id);
    const label = name !== cur.name ? `${cur.name} → ${name}` : name;
    this.afterChange("edit", cur.project_id, details.length ? `${label} (${details.join(", ")})` : label);
    return this.require(id);
  }

  /** Its tasks stay, with no milestone. A task's version does not move, because
   *  nothing about that task's own work changed. */
  remove(id: number): void {
    const cur = this.require(id);
    this.db.prepare(`DELETE FROM milestones WHERE id = ?`).run(id);
    this.afterChange("delete", cur.project_id, cur.name);
  }

  private require(id: number): Milestone {
    const found = this.get(id);
    if (!found) throw new BoardItemNotFoundError("milestone", id);
    return found;
  }

  private assertNameFree(projectId: number, name: string, exceptId: number | null): void {
    if (this.list(projectId).some((m) => m.id !== exceptId && sameName(m.name, name))) {
      throw new TaskConflictError(`milestone '${name}' already exists in this project`);
    }
  }

  private afterChange(action: "add" | "edit" | "delete", projectId: number, name: string): void {
    try {
      this.activityLog.record({ action, target: "milestone", project_id: projectId, task_title: name });
    } catch (e) {
      // The change has already committed, so it must not throw.
      // eslint-disable-next-line no-console
      console.error(`[wikikai] could not log milestone change: ${action} ${name}`, e);
    }
    // Same event as modules and columns: tasks show the milestone's name, so the
    // same views need to refresh.
    emitEvent({ type: "board-changed", project_id: projectId });
  }
}
