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
  position: number;
  archived: boolean;
}

const byPosition = (a: BoardCard, b: BoardCard): number => a.position - b.position || a.id - b.id;

export function columnsOf<T extends BoardCard>(tasks: T[]): Record<BoardStatus, T[]> {
  const columns: Record<BoardStatus, T[]> = { todo: [], doing: [], review: [], done: [] };
  for (const task of tasks) {
    if (!task.archived) columns[task.status].push(task);
  }
  for (const status of BOARD_STATUSES) columns[status].sort(byPosition);
  return columns;
}

/** The board after a drop, shown at once while the server confirms. Mirrors
 *  TaskStore.move: an absent `beforeId` means the bottom. */
export function applyMove<T extends BoardCard>(
  tasks: T[],
  id: number,
  status: BoardStatus,
  beforeId: number | null,
): T[] {
  const moved = tasks.find((t) => t.id === id);
  if (!moved) return tasks;
  const target = tasks.filter((t) => t.status === status && !t.archived && t.id !== id).sort(byPosition);
  const at = beforeId == null ? -1 : target.findIndex((t) => t.id === beforeId);
  target.splice(at < 0 ? target.length : at, 0, { ...moved, status });
  const renumbered = new Map(target.map((t, i) => [t.id, { ...t, position: i + 1 }]));
  return tasks.map((t) => renumbered.get(t.id) ?? t);
}

/**
 * Where a drop lands. `over` is a card id, or `column:<status>` for a column's
 * empty space. Moving down a column means landing after the card under the
 * pointer, which is what the sortable animation shows.
 */
export function resolveDrop<T extends { id: number }>(
  columns: Record<BoardStatus, T[]>,
  activeId: number,
  over: number | string,
): { status: BoardStatus; beforeId: number | null } | null {
  if (over === activeId) return null;
  if (typeof over === "string") {
    const status = over.replace(/^column:/, "") as BoardStatus;
    return BOARD_STATUSES.includes(status) ? { status, beforeId: null } : null;
  }
  const to = BOARD_STATUSES.find((s) => columns[s].some((t) => t.id === over));
  if (!to) return null;
  const list = columns[to];
  const overIndex = list.findIndex((t) => t.id === over);
  const activeIndex = list.findIndex((t) => t.id === activeId);
  if (activeIndex >= 0 && activeIndex < overIndex) {
    return { status: to, beforeId: list[overIndex + 1]?.id ?? null };
  }
  return { status: to, beforeId: over };
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
