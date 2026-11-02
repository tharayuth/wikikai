/**
 * Board logic with no React or store imports, so the server's test run can
 * exercise it (as with calendarGrid.ts). Types are structural for the same
 * reason.
 */

export const BOARD_STATUSES = ["todo", "doing", "review", "done"] as const;
export type BoardStatus = (typeof BOARD_STATUSES)[number];

/** How many Done cards show before "Show more". */
export const DONE_PAGE_SIZE = 20;

interface BoardCard {
  id: number;
  status: BoardStatus;
  module_id: number;
  column_id: number | null;
  position: number;
  archived: boolean;
}

export const LOCKED_COLUMN_TITLES: Record<BoardStatus, string> = {
  todo: "Todo",
  doing: "Doing",
  review: "Review",
  done: "Done",
};

/** One column as a board shows it. Locked columns have no id. */
export interface BoardColumn {
  /** The droppable id and React key. */
  key: string;
  id: number | null;
  name: string;
  status: BoardStatus;
  locked: boolean;
}

interface CustomColumn {
  id: number;
  name: string;
  status: BoardStatus;
  position: number;
}

export function columnKey(status: BoardStatus, columnId: number | null): string {
  return columnId === null ? `column:${status}` : `column:c${columnId}`;
}

/** Status order, and within a status the locked column sits at position 0. */
export function boardColumns(custom: CustomColumn[]): BoardColumn[] {
  return BOARD_STATUSES.flatMap((status) => {
    const own = custom.filter((c) => c.status === status).sort((a, b) => a.position - b.position || a.id - b.id);
    const toColumn = (c: CustomColumn): BoardColumn => ({
      key: columnKey(status, c.id),
      id: c.id,
      name: c.name,
      status,
      locked: false,
    });
    return [
      ...own.filter((c) => c.position < 0).map(toColumn),
      { key: columnKey(status, null), id: null, name: LOCKED_COLUMN_TITLES[status], status, locked: true },
      ...own.filter((c) => c.position > 0).map(toColumn),
    ];
  });
}

/** How the task modal names a column: a custom one says which status it is. */
export function columnLabel(column: BoardColumn): string {
  return column.locked ? column.name : `${column.name} (${LOCKED_COLUMN_TITLES[column.status]})`;
}

const byPosition = (a: BoardCard, b: BoardCard): number => a.position - b.position || a.id - b.id;

/** Cards per column key. A card whose column this client does not know yet shows
 *  in the locked column of its status until the module list refreshes. */
export function cardsByColumn<T extends BoardCard>(tasks: T[], columns: BoardColumn[]): Map<string, T[]> {
  const out = new Map<string, T[]>(columns.map((c) => [c.key, []]));
  for (const task of tasks) {
    if (task.archived) continue;
    const list = out.get(columnKey(task.status, task.column_id)) ?? out.get(columnKey(task.status, null));
    list?.push(task);
  }
  for (const list of out.values()) list.sort(byPosition);
  return out;
}

/** One module's tasks, or all of them for the `All` choice. */
export function tasksInModule<T extends { module_id: number }>(tasks: T[], moduleId: number | null): T[] {
  return moduleId === null ? tasks : tasks.filter((t) => t.module_id === moduleId);
}

/**
 * Which module a project tab shows. A missing or unknown id falls back without
 * an error: the Board shows one module, while the List and Calendar show all
 * (null). A task link names no module, so the Board opens on that task's.
 */
export function selectedModuleId(
  modules: { id: number }[],
  requested: number | null,
  view: string,
  openTaskModuleId: number | null,
): number | null {
  const exists = (id: number | null): boolean => id !== null && modules.some((m) => m.id === id);
  if (exists(requested)) return requested;
  if (view !== "board") return null;
  if (exists(openTaskModuleId)) return openTaskModuleId;
  return modules[0]?.id ?? null;
}

/** The board after a drop, shown at once while the server confirms. Mirrors
 *  TaskStore.move: an absent `beforeId` means the bottom. */
export function applyMove<T extends BoardCard>(
  tasks: T[],
  id: number,
  status: BoardStatus,
  columnId: number | null,
  beforeId: number | null,
): T[] {
  const moved = tasks.find((t) => t.id === id);
  if (!moved) return tasks;
  const target = tasks
    .filter(
      (t) =>
        t.module_id === moved.module_id &&
        t.status === status &&
        t.column_id === columnId &&
        !t.archived &&
        t.id !== id,
    )
    .sort(byPosition);
  const at = beforeId == null ? -1 : target.findIndex((t) => t.id === beforeId);
  target.splice(at < 0 ? target.length : at, 0, { ...moved, status, column_id: columnId });
  const renumbered = new Map(target.map((t, i) => [t.id, { ...t, position: i + 1 }]));
  return tasks.map((t) => renumbered.get(t.id) ?? t);
}

/**
 * Where a drop lands. `over` is a card id, or a column's key for its empty space.
 * Moving down a column means landing after the card under the pointer, which is
 * what the sortable animation shows.
 */
export function resolveDrop<T extends { id: number }>(
  columns: BoardColumn[],
  cards: Map<string, T[]>,
  activeId: number,
  over: number | string,
): { status: BoardStatus; columnId: number | null; beforeId: number | null } | null {
  if (over === activeId) return null;
  if (typeof over === "string") {
    const column = columns.find((c) => c.key === over);
    if (!column) return null;
    // Done goes to the top: recent work stays visible there, and Done is paged,
    // so a card sent to the bottom could land past the cards shown.
    const beforeId =
      column.status === "done" ? (cards.get(column.key) ?? []).find((t) => t.id !== activeId)?.id ?? null : null;
    return { status: column.status, columnId: column.id, beforeId };
  }
  const to = columns.find((c) => cards.get(c.key)?.some((t) => t.id === over));
  if (!to) return null;
  const list = cards.get(to.key) ?? [];
  const overIndex = list.findIndex((t) => t.id === over);
  const activeIndex = list.findIndex((t) => t.id === activeId);
  if (activeIndex >= 0 && activeIndex < overIndex) {
    return { status: to.status, columnId: to.id, beforeId: list[overIndex + 1]?.id ?? null };
  }
  return { status: to.status, columnId: to.id, beforeId: over };
}

export interface TaskFilter {
  /** A user id, "none" for unassigned, or null for everyone. */
  assigneeId: number | "none" | null;
  label: string | null;
}

export const NO_FILTER: TaskFilter = { assigneeId: null, label: null };

interface FilterableTask {
  assignee: { id: number; display_name: string } | null;
  labels: string[];
}

export function filterTasks<T extends FilterableTask>(tasks: T[], filter: TaskFilter): T[] {
  if (filter.assigneeId === null && filter.label === null) return tasks;
  return tasks.filter((t) => {
    if (filter.assigneeId === "none" && t.assignee) return false;
    if (typeof filter.assigneeId === "number" && t.assignee?.id !== filter.assigneeId) return false;
    return filter.label === null || t.labels.includes(filter.label);
  });
}

export function allLabels(tasks: { labels: string[] }[]): string[] {
  return [...new Set(tasks.flatMap((t) => t.labels))].sort((a, b) => a.localeCompare(b));
}

export function allAssignees(tasks: FilterableTask[]): { id: number; display_name: string }[] {
  const byId = new Map<number, { id: number; display_name: string }>();
  for (const t of tasks) if (t.assignee) byId.set(t.assignee.id, t.assignee);
  return [...byId.values()].sort((a, b) => a.display_name.localeCompare(b.display_name));
}

export type TaskSortKey = "id" | "title" | "status" | "assignee" | "due_date" | "updated_at";

interface SortableTask extends FilterableTask {
  id: number;
  title: string;
  status: BoardStatus;
  due_date: string | null;
  updated_at: string;
}

/** A sorted copy. Tasks with no value for the key stay last in both directions. */
export function sortTasks<T extends SortableTask>(tasks: T[], key: TaskSortKey, dir: "asc" | "desc"): T[] {
  const value = (t: T): string | number | null => {
    switch (key) {
      case "id":
        return t.id;
      case "title":
        return t.title.toLocaleLowerCase();
      case "status":
        return BOARD_STATUSES.indexOf(t.status);
      case "assignee":
        return t.assignee?.display_name.toLocaleLowerCase() ?? null;
      case "due_date":
        return t.due_date;
      case "updated_at":
        return t.updated_at;
    }
  };
  const sign = dir === "asc" ? 1 : -1;
  return [...tasks].sort((a, b) => {
    const av = value(a);
    const bv = value(b);
    if (av === null || bv === null) {
      if (av === bv) return a.id - b.id;
      return av === null ? 1 : -1;
    }
    const order =
      typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
    return order === 0 ? a.id - b.id : order * sign;
  });
}

/** The server's `{ error }` message from a failed mutation, or `fallback`. */
export function apiErrorMessage(e: unknown, fallback: string): string {
  if (typeof e === "object" && e && "data" in e) {
    const message = (e as { data?: { error?: unknown } }).data?.error;
    if (typeof message === "string" && message) return message;
  }
  return fallback;
}
