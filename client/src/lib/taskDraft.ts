/**
 * The modal's form state, kept free of React and the store so the server's
 * test run can exercise it. `patchFrom` sends only the fields a person changed,
 * so saving a title cannot overwrite an agent's change to another field, and
 * cannot fail on an assignee who has since lost access.
 */

import type { BoardStatus } from "./taskBoard";

interface DraftableTask {
  title: string;
  description: string;
  status: BoardStatus;
  module_id: number;
  column_id: number | null;
  milestone_id: number | null;
  assignee: { id: number } | null;
  start_date: string | null;
  due_date: string | null;
  labels: string[];
  session_id: string | null;
  blocked_reason: string | null;
}

export interface TaskDraft {
  title: string;
  description: string;
  status: BoardStatus;
  module_id: number;
  column_id: number | null;
  milestone_id: number | null;
  assignee_id: number | null;
  start_date: string;
  due_date: string;
  labels: string;
  session_id: string;
  blocked_reason: string;
}

export interface TaskDraftPatch {
  title?: string;
  description?: string;
  status?: BoardStatus;
  module_id?: number;
  column_id?: number | null;
  milestone_id?: number | null;
  assignee_id?: number | null;
  start_date?: string | null;
  due_date?: string | null;
  labels?: string[];
  session_id?: string | null;
  blocked_reason?: string | null;
}

export function draftOf(task: DraftableTask): TaskDraft {
  return {
    title: task.title,
    description: task.description,
    status: task.status,
    module_id: task.module_id,
    column_id: task.column_id,
    milestone_id: task.milestone_id,
    assignee_id: task.assignee?.id ?? null,
    start_date: task.start_date ?? "",
    due_date: task.due_date ?? "",
    labels: task.labels.join(", "),
    session_id: task.session_id ?? "",
    blocked_reason: task.blocked_reason ?? "",
  };
}

const orNull = (value: string): string | null => value.trim() || null;

const parseLabels = (value: string): string[] =>
  value
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean);

/** The fields that differ from `base`, or null when there are none. */
export function patchFrom(draft: TaskDraft, base: DraftableTask): TaskDraftPatch | null {
  const patch: TaskDraftPatch = {};
  const title = draft.title.trim();
  if (title !== base.title) patch.title = title;
  if (draft.description !== base.description) patch.description = draft.description;
  if (draft.status !== base.status) patch.status = draft.status;
  if (draft.module_id !== base.module_id) patch.module_id = draft.module_id;
  if (draft.column_id !== base.column_id) patch.column_id = draft.column_id;
  if (draft.milestone_id !== base.milestone_id) patch.milestone_id = draft.milestone_id;
  if (draft.assignee_id !== (base.assignee?.id ?? null)) patch.assignee_id = draft.assignee_id;
  if (orNull(draft.start_date) !== base.start_date) patch.start_date = orNull(draft.start_date);
  if (orNull(draft.due_date) !== base.due_date) patch.due_date = orNull(draft.due_date);
  const labels = parseLabels(draft.labels);
  if (labels.join(",") !== base.labels.join(",")) patch.labels = labels;
  if (orNull(draft.session_id) !== base.session_id) patch.session_id = orNull(draft.session_id);
  if (orNull(draft.blocked_reason) !== base.blocked_reason) patch.blocked_reason = orNull(draft.blocked_reason);
  return Object.keys(patch).length > 0 ? patch : null;
}

/** True when a newer version of the task exists underneath unsaved edits. The
 *  modal then keeps the typed text on screen and asks, instead of replacing it.
 *  An older cached copy (right after a save) is not a change. */
export function changedElsewhere(dirty: boolean, baseVersion: number, latestVersion: number | undefined): boolean {
  return dirty && latestVersion !== undefined && latestVersion > baseVersion;
}

/** Whether the form should load this server copy. Only a strictly newer one,
 *  and never over unsaved edits. An older copy is the cache right after a save,
 *  and a same-version copy would rewrite text the person is typing: a draft
 *  that has just returned to clean would lose a trailing ", " from the labels. */
export function adoptsServerCopy(dirty: boolean, baseVersion: number | null, latestVersion: number): boolean {
  return !dirty && (baseVersion === null || latestVersion > baseVersion);
}

/** The draft to show once a save has been answered. `current` is what the form
 *  holds now and `submitted` is the object that was sent. When they are the same
 *  object nothing was typed while the request was in flight, so the form takes
 *  the saved copy. Otherwise it keeps `current`: the reply must not overwrite
 *  text typed in the meantime, and `patchFrom` against the new base still sees
 *  those edits as unsaved. */
export function draftAfterSave(current: TaskDraft, submitted: TaskDraft, saved: DraftableTask): TaskDraft {
  return current === submitted ? draftOf(saved) : current;
}
