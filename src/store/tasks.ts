import type { Db } from "./db.js";
import type { ActivityAction, ActivityLogStore } from "./activityLog.js";
import { parseDate } from "./calendar.js";
import { getCallContext } from "../lib/callContext.js";
import { emitEvent } from "../lib/events.js";

/**
 * Tasks on a project's board. Every rule lives here, so the MCP tools and the
 * REST routes are thin callers that cannot disagree. See the design in
 * docs/superpowers/specs/2026-11-02-project-tasks-core-design.md.
 *
 * - `version` guards field changes: two callers holding one version cannot
 *   both win, which is what makes claiming a task safe.
 * - `position` orders tasks within one project + status. It is not versioned,
 *   so dragging one card never fails someone else's claim of another.
 */

export const TASK_STATUSES = ["todo", "doing", "review", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPlacement = "top" | "bottom";

const TITLE_MAX = 300;
const DESCRIPTION_MAX = 20_000;
const LABEL_MAX = 50;
const LABELS_MAX = 20;
const SESSION_MAX = 200;
const BLOCKED_MAX = 1_000;
const LINK_URL_MAX = 2_000;
const LINK_LABEL_MAX = 200;
const LINKS_MAX = 50;

export interface TaskProject {
  id: number;
  name: string;
}

export interface TaskMember {
  id: number;
  display_name: string;
}

export interface TaskLink {
  id: number;
  url: string;
  label: string | null;
}

export interface TaskLinkInput {
  url: string;
  label?: string;
}

/** What a board or a list needs: no description or links. */
export interface TaskRow {
  id: number;
  project_id: number;
  title: string;
  status: TaskStatus;
  position: number;
  assignee: TaskMember | null;
  start_date: string | null;
  due_date: string | null;
  labels: string[];
  blocked_reason: string | null;
  version: number;
  updated_at: string;
  archived: boolean;
}

export interface Task extends TaskRow {
  project: string;
  description: string;
  session_id: string | null;
  links: TaskLink[];
  created_by: number | null;
  created_at: string;
}

interface TaskFieldsInput {
  description?: string;
  status?: TaskStatus;
  assignee_id?: number | null;
  start_date?: string | null;
  due_date?: string | null;
  labels?: string[];
  session_id?: string | null;
  blocked_reason?: string | null;
  position?: TaskPlacement;
}

export interface AddTaskInput extends TaskFieldsInput {
  title: string;
  links?: TaskLinkInput[];
}

export interface EditTaskInput extends TaskFieldsInput {
  expected_version: number;
  title?: string;
  add_links?: TaskLinkInput[];
  remove_link_ids?: number[];
  archived?: boolean;
}

export interface MoveTaskInput {
  status: TaskStatus;
  before_id: number | null;
  expected_version: number;
}

export interface ListTasksOptions {
  statuses?: TaskStatus[];
  assigneeId?: number;
  label?: string;
  includeArchived?: boolean;
  limit?: number;
}

export class TaskNotFoundError extends Error {
  constructor(id: number) {
    super(`task T${id} not found`);
    this.name = "TaskNotFoundError";
  }
}

export class TaskConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskConflictError";
  }
}

export class TaskStaleError extends TaskConflictError {
  constructor(
    id: number,
    expected: number,
    public readonly currentVersion: number,
  ) {
    super(`STALE: task T${id} version mismatch: expected v${expected}, current v${currentVersion}`);
    this.name = "TaskStaleError";
  }
}

interface TaskDbRow {
  id: number;
  project_id: number;
  project_name: string;
  title: string;
  description: string;
  status: TaskStatus;
  position: number;
  assignee_id: number | null;
  assignee_name: string | null;
  start_date: string | null;
  due_date: string | null;
  labels: string | null;
  session_id: string | null;
  blocked_reason: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  version: number;
  archived_at: string | null;
}

const SELECT_TASK = `
  SELECT t.*, p.name AS project_name, u.display_name AS assignee_name
  FROM tasks t
  JOIN projects p ON p.id = t.project_id
  LEFT JOIN users u ON u.id = t.assignee_id`;

const STATUS_ORDER = `CASE t.status WHEN 'todo' THEN 1 WHEN 'doing' THEN 2 WHEN 'review' THEN 3 ELSE 4 END`;

function cleanTitle(value: string): string {
  const title = value.trim();
  if (!title) throw new Error("title is required");
  if (title.length > TITLE_MAX) throw new Error(`title must be ≤ ${TITLE_MAX} chars`);
  return title;
}

function cleanDescription(value: string): string {
  if (value.length > DESCRIPTION_MAX) throw new Error(`description must be ≤ ${DESCRIPTION_MAX} chars`);
  return value;
}

/** Blank counts as cleared, so an emptied form field needs no special case. */
function cleanOptionalText(value: string | null | undefined, name: string, max: number): string | null {
  if (value == null) return null;
  const text = value.trim();
  if (!text) return null;
  if (text.length > max) throw new Error(`${name} must be ≤ ${max} chars`);
  return text;
}

function cleanDate(value: string | null | undefined, name: string): string | null {
  if (value == null) return null;
  parseDate(value, name);
  return value;
}

function assertDateOrder(start: string | null, due: string | null): void {
  if (start && due && start > due) throw new Error("start_date must not be after due_date");
}

function cleanLabels(values: string[]): string | null {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const label = raw.trim();
    if (!label) continue;
    if (label.includes(",")) throw new Error(`label '${label}' must not contain a comma`);
    if (label.length > LABEL_MAX) throw new Error(`label must be ≤ ${LABEL_MAX} chars`);
    const key = label.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  if (out.length > LABELS_MAX) throw new Error(`a task can have at most ${LABELS_MAX} labels`);
  return out.length ? out.join(",") : null;
}

function parseLabels(stored: string | null): string[] {
  return stored ? stored.split(",") : [];
}

/**
 * Links land in `<a href>`, so only http(s) and same-origin paths pass.
 * Whitespace and control characters are refused because browsers strip them
 * while parsing a URL: `/<tab>/evil.test` would otherwise become
 * protocol-relative after it passed the check.
 */
function isAllowedLinkUrl(url: string): boolean {
  if (/[\s\u0000-\u001f\u007f]/.test(url)) return false;
  if (/^https?:\/\//i.test(url)) return true;
  return url.startsWith("/") && url[1] !== "/" && url[1] !== "\\";
}

function cleanLink(input: TaskLinkInput): { url: string; label: string | null } {
  const url = input.url.trim();
  if (url.length > LINK_URL_MAX) throw new Error(`link url must be ≤ ${LINK_URL_MAX} chars`);
  if (!isAllowedLinkUrl(url)) throw new Error(`link url must be http(s):// or a relative /path: '${url}'`);
  return { url, label: cleanOptionalText(input.label, "link label", LINK_LABEL_MAX) };
}

function toRow(r: TaskDbRow): TaskRow {
  return {
    id: r.id,
    project_id: r.project_id,
    title: r.title,
    status: r.status,
    position: r.position,
    assignee:
      r.assignee_id != null && r.assignee_name != null
        ? { id: r.assignee_id, display_name: r.assignee_name }
        : null,
    start_date: r.start_date,
    due_date: r.due_date,
    labels: parseLabels(r.labels),
    blocked_reason: r.blocked_reason,
    version: r.version,
    updated_at: r.updated_at,
    archived: r.archived_at !== null,
  };
}

export class TaskStore {
  private readonly aclEnabled: boolean;

  constructor(
    private readonly db: Db,
    private readonly activityLog: ActivityLogStore,
    opts: { aclEnabled?: boolean } = {},
  ) {
    this.aclEnabled = opts.aclEnabled ?? true;
  }

  // ─── Projects ───

  getProject(id: number): TaskProject | null {
    const row = this.db.prepare(`SELECT id, name FROM projects WHERE id = ?`).get(id) as
      | TaskProject
      | undefined;
    return row ?? null;
  }

  /** The named project's registry row, registering one that only documents
   *  mention so far. An unknown name is an error, so a typo cannot create a
   *  project. */
  ensureProject(name: string): TaskProject {
    const trimmed = name.trim();
    const referenced = this.db.prepare(`SELECT 1 FROM knowledge WHERE project = ? LIMIT 1`).get(trimmed);
    if (referenced) {
      this.db
        .prepare(`INSERT OR IGNORE INTO projects (name, created_at) VALUES (?, ?)`)
        .run(trimmed, new Date().toISOString());
    }
    const row = this.db.prepare(`SELECT id, name FROM projects WHERE name = ?`).get(trimmed) as
      | TaskProject
      | undefined;
    if (!row) throw new Error(`project '${trimmed}' not found`);
    return row;
  }

  // ─── Members ───

  /** Who a task can be assigned to: users with edit access, plus admins. */
  listMembers(project: string): TaskMember[] {
    return this.memberRows(project).map(({ id, display_name }) => ({ id, display_name }));
  }

  private memberRows(project: string): (TaskMember & { email: string })[] {
    const rows = this.aclEnabled
      ? this.db
          .prepare(
            `SELECT id, display_name, email FROM users
             WHERE is_admin = 1
                OR id IN (SELECT user_id FROM project_permissions
                          WHERE project_name = ? AND level = 'edit')
             ORDER BY display_name, id`,
          )
          .all(project)
      : this.db.prepare(`SELECT id, display_name, email FROM users ORDER BY display_name, id`).all();
    return rows as (TaskMember & { email: string })[];
  }

  /** Turn `"me"`, a display name or an email into a user id. Errors name
   *  valid members by display name only: emails are accepted, never returned. */
  resolveAssignee(project: string, ref: string, callerId: number | null): number {
    const wanted = ref.trim().toLocaleLowerCase();
    if (wanted === "me") {
      if (callerId == null) throw new Error(`assignee "me" needs a caller, and this call has no user`);
      return callerId;
    }
    const members = this.memberRows(project);
    const matches = members.filter(
      (m) => m.display_name.toLocaleLowerCase() === wanted || m.email.toLocaleLowerCase() === wanted,
    );
    if (matches.length === 1) return matches[0].id;
    const names = members.map((m) => m.display_name).join(", ");
    throw new Error(
      matches.length > 1
        ? `assignee '${ref}' is ambiguous. Valid members: ${names}`
        : `assignee '${ref}' is not a member of this project. Valid members: ${names}`,
    );
  }

  private assertAssignable(project: string, userId: number): void {
    if (!this.memberRows(project).some((m) => m.id === userId)) {
      throw new Error(`user ${userId} cannot be assigned: no edit access to this project`);
    }
  }

  // ─── Reads ───

  get(id: number): Task | null {
    const row = this.dbRow(id);
    return row ? this.toTask(row) : null;
  }

  list(projectId: number, opts: ListTasksOptions = {}): TaskRow[] {
    const conditions = [`t.project_id = ?`];
    const params: unknown[] = [projectId];
    if (!opts.includeArchived) conditions.push(`t.archived_at IS NULL`);
    if (opts.statuses?.length) {
      conditions.push(`t.status IN (${opts.statuses.map(() => "?").join(",")})`);
      params.push(...opts.statuses);
    }
    if (opts.assigneeId != null) {
      conditions.push(`t.assignee_id = ?`);
      params.push(opts.assigneeId);
    }
    const rows = this.db
      .prepare(`${SELECT_TASK} WHERE ${conditions.join(" AND ")} ORDER BY ${STATUS_ORDER}, t.position, t.id`)
      .all(...params) as TaskDbRow[];
    let out = rows.map(toRow);
    if (opts.label) {
      const wanted = opts.label.trim().toLocaleLowerCase();
      out = out.filter((t) => t.labels.some((l) => l.toLocaleLowerCase() === wanted));
    }
    return opts.limit != null ? out.slice(0, opts.limit) : out;
  }

  /** The task an agent should claim next: the board order is the queue. */
  next(projectId: number, callerId: number | null): TaskRow | null {
    const row = this.db
      .prepare(
        `${SELECT_TASK}
         WHERE t.project_id = ?
           AND t.status = 'todo'
           AND t.archived_at IS NULL
           AND t.blocked_reason IS NULL
           AND (t.assignee_id IS NULL OR t.assignee_id = ?)
         ORDER BY t.position, t.id
         LIMIT 1`,
      )
      .get(projectId, callerId) as TaskDbRow | undefined;
    return row ? toRow(row) : null;
  }

  // ─── Writes ───

  add(projectId: number, input: AddTaskInput): Task {
    const project = this.getProject(projectId);
    if (!project) throw new Error(`project ${projectId} not found`);
    const title = cleanTitle(input.title);
    const description = cleanDescription(input.description ?? "");
    const status = input.status ?? "todo";
    const start = cleanDate(input.start_date, "start_date");
    const due = cleanDate(input.due_date, "due_date");
    assertDateOrder(start, due);
    const labels = cleanLabels(input.labels ?? []);
    const session = cleanOptionalText(input.session_id, "session_id", SESSION_MAX);
    const blocked = cleanOptionalText(input.blocked_reason, "blocked_reason", BLOCKED_MAX);
    const links = (input.links ?? []).map(cleanLink);
    if (input.assignee_id != null) this.assertAssignable(project.name, input.assignee_id);
    const now = new Date().toISOString();

    const id = this.db.transaction(() => {
      const info = this.db
        .prepare(
          `INSERT INTO tasks
             (project_id, title, description, status, position, assignee_id, start_date, due_date,
              labels, session_id, blocked_reason, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          projectId,
          title,
          description,
          status,
          input.assignee_id ?? null,
          start,
          due,
          labels,
          session,
          blocked,
          getCallContext().user_id ?? null,
          now,
          now,
        );
      const taskId = Number(info.lastInsertRowid);
      this.insertLinks(taskId, links, now);
      this.place(taskId, projectId, status, input.position ?? "bottom");
      return taskId;
    })();

    this.afterChange("add", projectId, id, title);
    return this.require(id);
  }

  edit(id: number, input: EditTaskInput): Task {
    const outcome = this.db.transaction(() => {
      const cur = this.requireRow(id);
      if (cur.version !== input.expected_version) {
        throw new TaskStaleError(id, input.expected_version, cur.version);
      }
      const now = new Date().toISOString();
      const sets: string[] = [];
      const params: Record<string, unknown> = {};
      const set = (column: string, value: unknown): void => {
        sets.push(`${column} = @${column}`);
        params[column] = value;
      };

      const title = input.title !== undefined ? cleanTitle(input.title) : cur.title;
      if (input.title !== undefined) set("title", title);
      if (input.description !== undefined) set("description", cleanDescription(input.description));
      if (input.status !== undefined) set("status", input.status);
      if (input.assignee_id !== undefined) {
        if (input.assignee_id !== null && input.assignee_id !== cur.assignee_id) {
          this.assertAssignable(cur.project_name, input.assignee_id);
        }
        set("assignee_id", input.assignee_id);
      }
      // The order check uses the merged dates, so moving one date across the
      // other is refused even though that date alone is valid.
      const start = input.start_date !== undefined ? cleanDate(input.start_date, "start_date") : cur.start_date;
      const due = input.due_date !== undefined ? cleanDate(input.due_date, "due_date") : cur.due_date;
      assertDateOrder(start, due);
      if (input.start_date !== undefined) set("start_date", start);
      if (input.due_date !== undefined) set("due_date", due);
      if (input.labels !== undefined) set("labels", cleanLabels(input.labels));
      if (input.session_id !== undefined) {
        set("session_id", cleanOptionalText(input.session_id, "session_id", SESSION_MAX));
      }
      if (input.blocked_reason !== undefined) {
        set("blocked_reason", cleanOptionalText(input.blocked_reason, "blocked_reason", BLOCKED_MAX));
      }
      if (input.archived !== undefined) set("archived_at", input.archived ? (cur.archived_at ?? now) : null);

      const addLinks = (input.add_links ?? []).map(cleanLink);
      const removeLinks = input.remove_link_ids ?? [];
      const fieldsChanged = sets.length > 0 || addLinks.length > 0 || removeLinks.length > 0;
      if (!fieldsChanged && input.position === undefined) throw new Error("nothing to change");

      if (fieldsChanged) {
        const info = this.db
          .prepare(
            `UPDATE tasks SET ${[...sets, "version = version + 1", "updated_at = @updated_at"].join(", ")}
             WHERE id = @id AND version = @expected_version`,
          )
          .run({ ...params, updated_at: now, id, expected_version: input.expected_version });
        if (info.changes !== 1) throw new TaskStaleError(id, input.expected_version, cur.version + 1);
        const removeLink = this.db.prepare(`DELETE FROM task_links WHERE task_id = ? AND id = ?`);
        for (const linkId of removeLinks) removeLink.run(id, linkId);
        this.insertLinks(id, addLinks, now);
      }

      const status = input.status ?? cur.status;
      const archived = input.archived ?? cur.archived_at !== null;
      if (!archived) {
        if (input.position) this.place(id, cur.project_id, status, input.position);
        else if (status !== cur.status) this.place(id, cur.project_id, status, status === "done" ? "top" : "bottom");
        else if (cur.archived_at !== null) this.place(id, cur.project_id, status, "bottom");
      }
      return { projectId: cur.project_id, title, fieldsChanged };
    })();

    this.afterChange(outcome.fieldsChanged ? "edit" : "reorder", outcome.projectId, id, outcome.title);
    return this.require(id);
  }

  /** Drag on the board. A reorder cannot lose anyone's work, so only a status
   *  change checks and bumps the version. A `before_id` no longer in the
   *  target status means the bottom, so a slightly stale board cannot fail. */
  move(id: number, input: MoveTaskInput): Task {
    const outcome = this.db.transaction(() => {
      const cur = this.requireRow(id);
      if (cur.archived_at !== null) throw new TaskConflictError(`task T${id} is archived; unarchive it first`);
      const statusChanged = input.status !== cur.status;
      if (statusChanged) {
        if (cur.version !== input.expected_version) {
          throw new TaskStaleError(id, input.expected_version, cur.version);
        }
        this.db
          .prepare(`UPDATE tasks SET status = ?, version = version + 1, updated_at = ? WHERE id = ?`)
          .run(input.status, new Date().toISOString(), id);
      }
      this.place(id, cur.project_id, input.status, { beforeId: input.before_id });
      return { projectId: cur.project_id, title: cur.title, statusChanged };
    })();

    this.afterChange(outcome.statusChanged ? "edit" : "reorder", outcome.projectId, id, outcome.title);
    return this.require(id);
  }

  /** Permanent. Only an archived task can go, so a delete is always two steps. */
  remove(id: number): void {
    const cur = this.requireRow(id);
    if (cur.archived_at === null) throw new TaskConflictError(`task T${id} must be archived before it is deleted`);
    this.db.prepare(`DELETE FROM tasks WHERE id = ?`).run(id);
    this.afterChange("delete", cur.project_id, id, cur.title);
  }

  // ─── Internals ───

  private dbRow(id: number): TaskDbRow | null {
    const row = this.db.prepare(`${SELECT_TASK} WHERE t.id = ?`).get(id) as TaskDbRow | undefined;
    return row ?? null;
  }

  private requireRow(id: number): TaskDbRow {
    const row = this.dbRow(id);
    if (!row) throw new TaskNotFoundError(id);
    return row;
  }

  private require(id: number): Task {
    return this.toTask(this.requireRow(id));
  }

  private toTask(r: TaskDbRow): Task {
    const links = this.db
      .prepare(`SELECT id, url, label FROM task_links WHERE task_id = ? ORDER BY id`)
      .all(r.id) as TaskLink[];
    return {
      ...toRow(r),
      project: r.project_name,
      description: r.description,
      session_id: r.session_id,
      links,
      created_by: r.created_by,
      created_at: r.created_at,
    };
  }

  private insertLinks(taskId: number, links: { url: string; label: string | null }[], now: string): void {
    const insert = this.db.prepare(`INSERT INTO task_links (task_id, url, label, created_at) VALUES (?, ?, ?, ?)`);
    for (const link of links) insert.run(taskId, link.url, link.label, now);
    const { n } = this.db.prepare(`SELECT COUNT(*) AS n FROM task_links WHERE task_id = ?`).get(taskId) as {
      n: number;
    };
    if (n > LINKS_MAX) throw new Error(`a task can have at most ${LINKS_MAX} links`);
  }

  /** Put one task into its status's order and renumber that status from 1.
   *  Other tasks keep their version and updated_at. */
  private place(
    id: number,
    projectId: number,
    status: TaskStatus,
    where: TaskPlacement | { beforeId: number | null },
  ): void {
    const ids = (
      this.db
        .prepare(
          `SELECT id FROM tasks
           WHERE project_id = ? AND status = ? AND archived_at IS NULL AND id <> ?
           ORDER BY position, id`,
        )
        .all(projectId, status, id) as { id: number }[]
    ).map((r) => r.id);
    let index = ids.length;
    if (where === "top") {
      index = 0;
    } else if (where !== "bottom" && where.beforeId != null) {
      const at = ids.indexOf(where.beforeId);
      if (at >= 0) index = at;
    }
    ids.splice(index, 0, id);
    const update = this.db.prepare(`UPDATE tasks SET position = ? WHERE id = ?`);
    ids.forEach((taskId, i) => update.run(i + 1, taskId));
  }

  private afterChange(action: ActivityAction, projectId: number, taskId: number, title: string): void {
    try {
      this.activityLog.record({
        action,
        target: "board_task",
        project_id: projectId,
        task_id: taskId,
        task_title: title,
      });
    } catch (e) {
      // The change has already committed, so it must not throw. Dropping it
      // silently would hide a broken audit log, so leave a trace instead.
      // eslint-disable-next-line no-console
      console.error(`[wikikai] could not log task change: ${action} T${taskId}`, e);
    }
    emitEvent({ type: "task-changed", project_id: projectId, task_id: taskId });
  }
}
