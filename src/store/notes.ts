import type { Db } from "./db.js";
import type { ActivityAction, ActivityLogStore } from "./activityLog.js";
import { getCallContext } from "../lib/callContext.js";
import { emitEvent } from "../lib/events.js";
import { buildExcerpt } from "./search/snippet.js";
import { rankRecords } from "./search/records.js";
import { cleanLabels, parseLabels } from "./tasks.js";

/**
 * Keep-style notes on a project: quick text or checklists, with a colour, labels,
 * a pin, an archive and a trash. Every rule lives here, so routes stay thin.
 *
 * - `version` guards content (title, body, items, labels), so two people typing
 *   cannot silently overwrite each other. Colour, pin, archive and trash are not
 *   versioned, so they cannot fail someone in the middle of typing.
 * - A note goes through the trash before it can be deleted for good, so one
 *   member's slip in a shared project cannot destroy another's note.
 * - Typing is not logged: autosave would bury everything else. Bodies never are.
 */

export const NOTE_COLORS = ["default", "red", "amber", "green", "cyan", "blue", "purple"] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];
export const NOTE_STATES = ["active", "archived", "trashed"] as const;
export type NoteState = (typeof NOTE_STATES)[number];

const TITLE_MAX = 300;
const BODY_MAX = 20_000;
const ITEM_MAX = 1_000;
const ITEMS_MAX = 500;

export interface NoteItem {
  id: number;
  text: string;
  checked: boolean;
}

export interface NoteItemInput {
  id?: number;
  text: string;
  /** Default: what the item with this id already has, or unticked. */
  checked?: boolean;
}

export interface Note {
  id: number;
  project_id: number;
  title: string;
  body: string;
  /** Non-null makes it a checklist. */
  items: NoteItem[] | null;
  color: NoteColor;
  labels: string[];
  pinned: boolean;
  position: number;
  version: number;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  archived: boolean;
  trashed: boolean;
}

export interface AddNoteInput {
  title?: string;
  body?: string;
  items?: NoteItemInput[] | null;
  color?: string;
  labels?: string[];
  pinned?: boolean;
}

export interface EditNoteInput extends AddNoteInput {
  /** Required when title, body, items or labels change. */
  expected_version?: number;
  archived?: boolean;
  trashed?: boolean;
}

export interface NoteSearch {
  /** Only these projects. Default: every project. */
  projectIds?: number[];
  /** Text in the title, body, list items or labels. */
  query?: string;
  state?: NoteState;
  limit: number;
}

export interface NoteSearchResult {
  note: Note;
  snippet: string;
  matched: string[];
  matchRatio: number;
}

export class NoteNotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = "NoteNotFoundError";
  }
}

export class NoteConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoteConflictError";
  }
}

export class NoteStaleError extends NoteConflictError {
  constructor(
    id: number,
    expected: number,
    public readonly currentVersion: number,
  ) {
    super(`STALE: note ${id} version mismatch: expected v${expected}, current v${currentVersion}`);
    this.name = "NoteStaleError";
  }
}

interface NoteDbRow {
  id: number;
  project_id: number;
  title: string;
  body: string;
  items: string | null;
  color: NoteColor;
  labels: string | null;
  pinned: number;
  position: number;
  version: number;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  trashed_at: string | null;
}

function cleanTitle(value: string): string {
  const title = value.trim();
  if (title.length > TITLE_MAX) throw new Error(`title must be ≤ ${TITLE_MAX} chars`);
  return title;
}

function cleanBody(value: string): string {
  if (value.length > BODY_MAX) throw new Error(`body must be ≤ ${BODY_MAX} chars`);
  return value;
}

function cleanColor(value: string): NoteColor {
  if (!(NOTE_COLORS as readonly string[]).includes(value)) {
    throw new Error(`color must be one of: ${NOTE_COLORS.join(", ")}`);
  }
  return value as NoteColor;
}

/** Blank lines drop out. An item keeps its id so a box toggled elsewhere still
 *  means the same line; new ones number past every id the note has used. */
function cleanItems(values: NoteItemInput[], prior: NoteItem[]): NoteItem[] {
  const kept = values
    .map((v) => ({ ...v, text: v.text.trim() }))
    .filter((v) => v.text);
  if (kept.length > ITEMS_MAX) throw new Error(`a note can have at most ${ITEMS_MAX} items`);
  let next = Math.max(0, ...prior.map((i) => i.id), ...kept.map((i) => i.id ?? 0));
  const seen = new Set<number>();
  return kept.map((v) => {
    if (v.text.length > ITEM_MAX) throw new Error(`item must be ≤ ${ITEM_MAX} chars`);
    const id = v.id != null && !seen.has(v.id) ? v.id : ++next;
    seen.add(id);
    return { id, text: v.text, checked: v.checked ?? prior.find((p) => p.id === id)?.checked ?? false };
  });
}

function parseItems(stored: string | null): NoteItem[] | null {
  return stored === null ? null : (JSON.parse(stored) as NoteItem[]);
}

function toNote(r: NoteDbRow): Note {
  return {
    id: r.id,
    project_id: r.project_id,
    title: r.title,
    body: r.body,
    items: parseItems(r.items),
    color: r.color,
    labels: parseLabels(r.labels),
    pinned: r.pinned === 1,
    position: r.position,
    version: r.version,
    created_by: r.created_by,
    created_at: r.created_at,
    updated_at: r.updated_at,
    archived: r.archived_at !== null,
    trashed: r.trashed_at !== null,
  };
}

/** Parsed fields, not the stored row, so a search for "checked" cannot match
 *  every checklist through its JSON. */
function noteMatches(note: Note, query: string | undefined): boolean {
  const q = query?.trim().toLocaleLowerCase();
  if (!q) return true;
  const haystack = [note.title, note.body, ...(note.items ?? []).map((i) => i.text), ...note.labels];
  return haystack.some((text) => text.toLocaleLowerCase().includes(q));
}

/** The text a search looks through and quotes. */
function searchableBody(note: Note): string {
  return [note.body, ...(note.items ?? []).map((i) => i.text)].filter(Boolean).join("\n");
}

const STATE_FILTER: Record<NoteState, string> = {
  active: `archived_at IS NULL AND trashed_at IS NULL ORDER BY pinned DESC, position, id`,
  archived: `archived_at IS NOT NULL AND trashed_at IS NULL ORDER BY position, id`,
  trashed: `trashed_at IS NOT NULL ORDER BY trashed_at DESC, id DESC`,
};

export class NoteStore {
  constructor(
    private readonly db: Db,
    private readonly activityLog: ActivityLogStore,
  ) {}

  getProject(id: number): { id: number; name: string } | null {
    const row = this.db.prepare(`SELECT id, name FROM projects WHERE id = ?`).get(id) as
      | { id: number; name: string }
      | undefined;
    return row ?? null;
  }

  get(id: number): Note | null {
    const row = this.db.prepare(`SELECT * FROM notes WHERE id = ?`).get(id) as NoteDbRow | undefined;
    return row ? toNote(row) : null;
  }

  list(projectId: number, state: NoteState = "active"): Note[] {
    const rows = this.db
      .prepare(`SELECT * FROM notes WHERE project_id = ? AND ${STATE_FILTER[state]}`)
      .all(projectId) as NoteDbRow[];
    return rows.map(toNote);
  }

  /** `total` counts every match, so a caller can tell the limit cut the list. */
  search(filter: NoteSearch): { notes: Note[]; total: number } {
    const scope = filter.projectIds ? `project_id IN (SELECT value FROM json_each(?)) AND ` : "";
    const rows = this.db
      .prepare(`SELECT * FROM notes WHERE ${scope}${STATE_FILTER[filter.state ?? "active"]}`)
      .all(...(filter.projectIds ? [JSON.stringify(filter.projectIds)] : [])) as NoteDbRow[];
    const found = rows.map(toNote).filter((n) => noteMatches(n, filter.query));
    return { notes: found.slice(0, filter.limit), total: found.length };
  }

  /** Ranked text search for the main search box. A trashed note never appears:
   *  it is on its way out, and `list_notes` can still reach it. */
  searchRanked(query: string, scope: { projectIds?: number[]; includeArchived?: boolean }): NoteSearchResult[] {
    const conditions = [`trashed_at IS NULL`];
    const params: string[] = [];
    if (!scope.includeArchived) conditions.push(`archived_at IS NULL`);
    if (scope.projectIds) {
      conditions.push(`project_id IN (SELECT value FROM json_each(?))`);
      params.push(JSON.stringify(scope.projectIds));
    }
    const rows = this.db.prepare(`SELECT * FROM notes WHERE ${conditions.join(" AND ")}`).all(...params) as NoteDbRow[];
    const notes = new Map(rows.map((r) => [r.id, toNote(r)]));
    const hits = rankRecords(
      [...notes.values()].map((n) => ({ id: n.id, title: n.title, body: searchableBody(n), keywords: n.labels })),
      query,
    );
    return hits.flatMap((hit) => {
      const note = notes.get(hit.id);
      return note ? [{ note, snippet: hit.snippet, matched: hit.matched, matchRatio: hit.matchRatio }] : [];
    });
  }

  /** One note as a search result, for `N12`. Null when it is missing or trashed. */
  searchResultById(id: number): NoteSearchResult | null {
    const note = this.get(id);
    if (!note || note.trashed) return null;
    return { note, snippet: buildExcerpt(searchableBody(note), []).text, matched: [], matchRatio: 1 };
  }

  projectIdsNamed(names: string[]): number[] {
    return this.db
      .prepare(`SELECT id FROM projects WHERE name IN (SELECT value FROM json_each(?))`)
      .pluck()
      .all(JSON.stringify(names)) as number[];
  }

  add(projectId: number, input: AddNoteInput): Note {
    if (!this.getProject(projectId)) throw new Error(`project ${projectId} not found`);
    const title = cleanTitle(input.title ?? "");
    const body = cleanBody(input.body ?? "");
    const items = input.items ? cleanItems(input.items, []) : null;
    if (!title && !body.trim() && !items?.length) throw new Error("a note needs a title, text or a list item");
    const color = cleanColor(input.color ?? "default");
    const labels = cleanLabels(input.labels ?? []);
    const now = new Date().toISOString();
    const { first } = this.db
      .prepare(`SELECT COALESCE(MIN(position), 1) AS first FROM notes WHERE project_id = ?`)
      .get(projectId) as { first: number };
    const info = this.db
      .prepare(
        `INSERT INTO notes
           (project_id, title, body, items, color, labels, pinned, position, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        projectId,
        title,
        body,
        items ? JSON.stringify(items) : null,
        color,
        labels,
        input.pinned ? 1 : 0,
        first - 1,
        getCallContext().user_id ?? null,
        now,
        now,
      );
    const note = this.require(Number(info.lastInsertRowid));
    this.afterChange(note, "add", note.title || `N${note.id}`);
    return note;
  }

  edit(id: number, input: EditNoteInput): Note {
    const outcome = this.db.transaction(() => {
      const cur = this.requireRow(id);
      const sets: string[] = [];
      const params: Record<string, unknown> = { id };
      const set = (column: string, value: unknown): void => {
        sets.push(`${column} = @${column}`);
        params[column] = value;
      };

      const contentGiven =
        input.title !== undefined ||
        input.body !== undefined ||
        input.items !== undefined ||
        input.labels !== undefined;
      const looksGiven =
        input.color !== undefined ||
        input.pinned !== undefined ||
        input.archived !== undefined ||
        input.trashed !== undefined;
      if (!contentGiven && !looksGiven) throw new Error("nothing to change");
      if (cur.trashed_at !== null && input.trashed !== false) {
        throw new NoteConflictError(`note ${id} is in the trash; restore it first`);
      }

      const now = new Date().toISOString();
      if (contentGiven) {
        if (input.expected_version === undefined) throw new Error("expected_version is required to change content");
        if (cur.version !== input.expected_version) {
          throw new NoteStaleError(id, input.expected_version, cur.version);
        }
        if (input.title !== undefined) set("title", cleanTitle(input.title));
        if (input.body !== undefined) set("body", cleanBody(input.body));
        if (input.items !== undefined) {
          set("items", input.items === null ? null : JSON.stringify(cleanItems(input.items, parseItems(cur.items) ?? [])));
        }
        if (input.labels !== undefined) set("labels", cleanLabels(input.labels));
        set("version", cur.version + 1);
        set("updated_at", now);
      }
      if (input.color !== undefined) set("color", cleanColor(input.color));
      // Pinning brings an archived note back, and archiving or trashing unpins:
      // a note cannot be pinned somewhere that does not show pins.
      const leaving = input.archived === true || input.trashed === true;
      if (input.pinned !== undefined || leaving) set("pinned", input.pinned && !leaving ? 1 : 0);
      if (input.archived !== undefined) set("archived_at", input.archived ? (cur.archived_at ?? now) : null);
      else if (input.pinned === true) set("archived_at", null);
      let logged: string | null = null;
      if (input.trashed !== undefined && input.trashed !== (cur.trashed_at !== null)) {
        set("trashed_at", input.trashed ? now : null);
        logged = input.trashed ? "moved to trash" : "restored";
      }

      if (sets.length > 0) this.db.prepare(`UPDATE notes SET ${sets.join(", ")} WHERE id = @id`).run(params);
      return logged;
    })();

    const note = this.require(id);
    if (outcome) this.afterChange(note, "edit", `${note.title || `N${note.id}`} (${outcome})`);
    else emitEvent({ type: "note-changed", project_id: note.project_id, note_id: note.id });
    return note;
  }

  /** One box, with no version check: ticking must work while the list is open
   *  elsewhere. It still bumps the version, so an editor holding the old list
   *  is told rather than overwriting the tick. */
  toggleItem(id: number, itemId: number, checked: boolean): Note {
    this.db.transaction(() => {
      const cur = this.requireRow(id);
      if (cur.trashed_at !== null) throw new NoteConflictError(`note ${id} is in the trash; restore it first`);
      const items = parseItems(cur.items);
      if (!items?.some((i) => i.id === itemId)) throw new NoteNotFoundError(`item ${itemId} of note ${id}`);
      const next = items.map((i) => (i.id === itemId ? { ...i, checked } : i));
      this.db
        .prepare(`UPDATE notes SET items = ?, version = version + 1, updated_at = ? WHERE id = ?`)
        .run(JSON.stringify(next), new Date().toISOString(), id);
    })();
    const note = this.require(id);
    emitEvent({ type: "note-changed", project_id: note.project_id, note_id: note.id });
    return note;
  }

  /** Drag in the grid. Pinned and other notes keep separate orders, and a target
   *  outside this note's own section means the bottom. */
  move(id: number, beforeId: number | null): Note {
    this.db.transaction(() => {
      const cur = this.requireRow(id);
      if (cur.archived_at !== null || cur.trashed_at !== null) {
        throw new NoteConflictError(`note ${id} is not active, so it has no place to move to`);
      }
      const ids = (
        this.db
          .prepare(
            `SELECT id FROM notes
             WHERE project_id = ? AND pinned = ? AND archived_at IS NULL AND trashed_at IS NULL AND id <> ?
             ORDER BY position, id`,
          )
          .all(cur.project_id, cur.pinned, id) as { id: number }[]
      ).map((r) => r.id);
      const at = beforeId === null ? -1 : ids.indexOf(beforeId);
      ids.splice(at < 0 ? ids.length : at, 0, id);
      const update = this.db.prepare(`UPDATE notes SET position = ? WHERE id = ?`);
      ids.forEach((noteId, i) => update.run(i + 1, noteId));
    })();
    const note = this.require(id);
    emitEvent({ type: "note-changed", project_id: note.project_id, note_id: note.id });
    return note;
  }

  /** Permanent, and only from the trash. */
  remove(id: number): void {
    const cur = this.requireRow(id);
    if (cur.trashed_at === null) throw new NoteConflictError(`note ${id} must be in the trash before it is deleted`);
    const note = toNote(cur);
    this.db.prepare(`DELETE FROM notes WHERE id = ?`).run(id);
    this.afterChange(note, "delete", note.title || `N${note.id}`);
  }

  private requireRow(id: number): NoteDbRow {
    const row = this.db.prepare(`SELECT * FROM notes WHERE id = ?`).get(id) as NoteDbRow | undefined;
    if (!row) throw new NoteNotFoundError(`note ${id}`);
    return row;
  }

  private require(id: number): Note {
    return toNote(this.requireRow(id));
  }

  private afterChange(note: Note, action: ActivityAction, name: string): void {
    try {
      this.activityLog.record({ action, target: "note", project_id: note.project_id, task_title: name });
    } catch (e) {
      // The change has already committed, so it must not throw.
      // eslint-disable-next-line no-console
      console.error(`[wikikai] could not log note change: ${action} ${note.id}`, e);
    }
    emitEvent({ type: "note-changed", project_id: note.project_id, note_id: note.id });
  }
}
