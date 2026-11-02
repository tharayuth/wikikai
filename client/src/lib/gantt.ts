/**
 * Gantt geometry with no React or store imports, so the server's test run can
 * exercise it (as with taskBoard.ts). Dates are plain `YYYY-MM-DD` strings counted
 * as whole UTC days, so no local DST shift can stretch or skip a day.
 */

const DAY_MS = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** How far ahead of today the chart always reaches, so there is room to plan. */
const MIN_DAYS_AHEAD = 60;

export const GANTT_ZOOMS = { day: 36, week: 16, month: 5 } as const;
export type GanttZoom = keyof typeof GANTT_ZOOMS;
export type GanttGrouping = "module" | "milestone";
export type GanttDragMode = "move" | "start" | "end";

export interface GanttRange {
  from: string;
  to: string;
  days: number;
}

interface DatedTask {
  start_date: string | null;
  due_date: string | null;
}

const toDay = (date: string): number => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
};

const fromDay = (day: number): string => new Date(day * DAY_MS).toISOString().slice(0, 10);

const addDays = (date: string, days: number): string => fromDay(toDay(date) + days);

const lastOfMonth = (date: string): string => {
  const [y, m] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/** Whole months covering every task, every milestone and today. */
export function ganttRange(tasks: DatedTask[], milestones: { date: string }[], today: string): GanttRange {
  const dates = [
    today,
    addDays(today, MIN_DAYS_AHEAD),
    ...milestones.map((m) => m.date),
    ...tasks.flatMap((t) => [t.start_date, t.due_date].filter((d): d is string => d !== null)),
  ].sort();
  const from = `${dates[0].slice(0, 7)}-01`;
  const to = lastOfMonth(dates[dates.length - 1]);
  return { from, to, days: toDay(to) - toDay(from) + 1 };
}

/** Where a task's bar sits, through its due date inclusive. A task with one date
 *  shows one day; with none, it has no bar. */
export function barGeometry(task: DatedTask, range: GanttRange, pxPerDay: number): { left: number; width: number } | null {
  const start = task.start_date ?? task.due_date;
  const end = task.due_date ?? task.start_date;
  if (!start || !end) return null;
  const from = toDay(range.from);
  return { left: (toDay(start) - from) * pxPerDay, width: (toDay(end) - toDay(start) + 1) * pxPerDay };
}

/** The middle of a date's column, for a milestone or the today line. */
export function markerX(date: string, range: GanttRange, pxPerDay: number): number {
  return (toDay(date) - toDay(range.from) + 0.5) * pxPerDay;
}

export function dateAtX(x: number, range: GanttRange, pxPerDay: number): string {
  const day = Math.floor(x / pxPerDay);
  return addDays(range.from, Math.min(Math.max(day, 0), range.days - 1));
}

export function ganttHeader(
  range: GanttRange,
  zoom: GanttZoom,
  pxPerDay: number,
): { months: { label: string; left: number; width: number }[]; ticks: { label: string; left: number }[] } {
  const start = toDay(range.from);
  const months: { label: string; left: number; width: number }[] = [];
  let cursor = range.from;
  while (cursor <= range.to) {
    const end = lastOfMonth(cursor);
    const [y, m] = cursor.split("-").map(Number);
    months.push({
      label: `${MONTHS[m - 1]} ${y}`,
      left: (toDay(cursor) - start) * pxPerDay,
      width: (toDay(end) - toDay(cursor) + 1) * pxPerDay,
    });
    cursor = addDays(end, 1);
  }
  const ticks: { label: string; left: number }[] = [];
  if (zoom !== "month") {
    for (let i = 0; i < range.days; i++) {
      const date = new Date((start + i) * DAY_MS);
      if (zoom === "day" || date.getUTCDay() === 1) {
        ticks.push({ label: String(date.getUTCDate()), left: i * pxPerDay });
      }
    }
  }
  return { months, ticks };
}

/** The dates a drag asks for, naming only what changes. An end cannot cross the
 *  other end, and stretching a one-day bar creates the date it was missing. */
export function draggedDates(
  task: DatedTask,
  mode: GanttDragMode,
  deltaDays: number,
): { start_date?: string; due_date?: string } {
  if (deltaDays === 0) return {};
  if (mode === "move") {
    return {
      ...(task.start_date ? { start_date: addDays(task.start_date, deltaDays) } : {}),
      ...(task.due_date ? { due_date: addDays(task.due_date, deltaDays) } : {}),
    };
  }
  const start = task.start_date ?? task.due_date;
  const end = task.due_date ?? task.start_date;
  if (!start || !end) return {};
  if (mode === "start") {
    const next = addDays(start, deltaDays);
    return { start_date: next > end ? end : next };
  }
  const next = addDays(end, deltaDays);
  return { due_date: next < start ? start : next };
}

export function movedMilestoneDate(date: string, deltaDays: number): string {
  return addDays(date, deltaDays);
}

export function milestoneState(
  milestone: { date: string; done: boolean },
  today: string,
): "done" | "late" | "upcoming" {
  if (milestone.done) return "done";
  return milestone.date < today ? "late" : "upcoming";
}

export interface GanttGroup<T> {
  key: string;
  name: string;
  tasks: T[];
}

const startOf = (t: DatedTask): string => t.start_date ?? t.due_date ?? "￿";

const byStart = <T extends DatedTask & { id: number }>(a: T, b: T): number => {
  const [x, y] = [startOf(a), startOf(b)];
  return x === y ? a.id - b.id : x < y ? -1 : 1;
};

/** Rows grouped for the chart, with no group left empty. A task whose module or
 *  milestone this client has not loaded yet still shows, under a catch-all. */
export function ganttGroups<T extends DatedTask & { id: number; module_id: number; milestone_id: number | null }>(
  tasks: T[],
  by: GanttGrouping,
  modules: { id: number; name: string }[],
  milestones: { id: number; name: string; date: string }[],
): GanttGroup<T>[] {
  const sources =
    by === "module"
      ? modules.map((m) => ({ key: `module:${m.id}`, name: m.name, id: m.id }))
      : [...milestones]
          .sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1))
          .map((m) => ({ key: `milestone:${m.id}`, name: m.name, id: m.id }));
  const idOf = (t: T): number | null => (by === "module" ? t.module_id : t.milestone_id);
  const known = new Set(sources.map((s) => s.id));
  const groups: GanttGroup<T>[] = sources.map((s) => ({
    key: s.key,
    name: s.name,
    tasks: tasks.filter((t) => idOf(t) === s.id).sort(byStart),
  }));
  const rest = tasks.filter((t) => {
    const id = idOf(t);
    return id === null || !known.has(id);
  });
  groups.push({
    key: "rest",
    name: by === "module" ? "Other" : "No milestone",
    tasks: rest.sort(byStart),
  });
  return groups.filter((g) => g.tasks.length > 0);
}
