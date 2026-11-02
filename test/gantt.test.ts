import { describe, expect, it } from "vitest";
import {
  barGeometry,
  dateAtX,
  draggedDates,
  ganttGroups,
  ganttHeader,
  ganttRange,
  markerX,
  milestoneState,
  movedMilestoneDate,
} from "../client/src/lib/gantt.js";

interface T {
  id: number;
  title: string;
  status: "todo" | "doing" | "review" | "done";
  start_date: string | null;
  due_date: string | null;
  module_id: number;
  milestone_id: number | null;
}

const task = (id: number, start: string | null, due: string | null, over: Partial<T> = {}): T => ({
  id,
  title: `T${id}`,
  status: "todo",
  start_date: start,
  due_date: due,
  module_id: 1,
  milestone_id: null,
  ...over,
});

describe("ganttRange", () => {
  it("runs from the first of the earliest month to the end of the latest", () => {
    const range = ganttRange([task(1, "2026-11-10", "2027-03-05")], [], "2026-11-20");
    expect(range).toMatchObject({ from: "2026-11-01", to: "2027-03-31" });
    expect(range.days).toBe(151);
  });

  it("includes milestones and today", () => {
    expect(ganttRange([], [{ date: "2026-08-10" }], "2026-11-02").from).toBe("2026-08-01");
    expect(ganttRange([task(1, "2027-06-01", "2027-06-02")], [], "2026-11-02").from).toBe("2026-11-01");
  });

  it("always leaves room ahead of today, even with nothing scheduled", () => {
    const range = ganttRange([task(1, null, null)], [], "2026-11-02");
    expect(range).toMatchObject({ from: "2026-11-01", to: "2027-01-31" });
  });
});

describe("barGeometry", () => {
  const range = ganttRange([], [], "2026-11-02");

  it("places a bar from its start through its due date, inclusive", () => {
    expect(barGeometry(task(1, "2026-11-03", "2026-11-04"), range, 10)).toEqual({ left: 20, width: 20 });
  });

  it("shows one day for a task with only one date", () => {
    expect(barGeometry(task(1, null, "2026-11-03"), range, 10)).toEqual({ left: 20, width: 10 });
    expect(barGeometry(task(1, "2026-11-03", null), range, 10)).toEqual({ left: 20, width: 10 });
  });

  it("has no bar without dates", () => {
    expect(barGeometry(task(1, null, null), range, 10)).toBeNull();
  });

  it("is not fooled by a daylight-saving change", () => {
    const summer = ganttRange([], [{ date: "2026-03-01" }], "2026-04-01");
    expect(barGeometry(task(1, "2026-03-29", "2026-03-30"), summer, 10)).toEqual({ left: 280, width: 20 });
  });
});

describe("positions", () => {
  const range = ganttRange([], [], "2026-11-02");

  it("centres a marker on its day", () => {
    expect(markerX("2026-11-01", range, 10)).toBe(5);
    expect(markerX("2026-11-03", range, 10)).toBe(25);
  });

  it("finds the date under a pointer, staying inside the range", () => {
    expect(dateAtX(0, range, 10)).toBe("2026-11-01");
    expect(dateAtX(29, range, 10)).toBe("2026-11-03");
    expect(dateAtX(-50, range, 10)).toBe("2026-11-01");
    expect(dateAtX(999_999, range, 10)).toBe(range.to);
  });
});

describe("ganttHeader", () => {
  const range = ganttRange([], [], "2026-11-02");

  it("labels each month with its span", () => {
    const { months } = ganttHeader(range, "month", 10);
    expect(months.slice(0, 2)).toEqual([
      { label: "Nov 2026", left: 0, width: 300 },
      { label: "Dec 2026", left: 300, width: 310 },
    ]);
  });

  it("ticks every day at day zoom, with the day number", () => {
    const { ticks } = ganttHeader(range, "day", 10);
    expect(ticks).toHaveLength(range.days);
    expect(ticks[1]).toEqual({ label: "2", left: 10 });
  });

  it("ticks on Mondays at week zoom", () => {
    const { ticks } = ganttHeader(range, "week", 10);
    expect(ticks[0]).toEqual({ label: "2", left: 10 });
    expect(ticks[1]).toEqual({ label: "9", left: 80 });
  });

  it("has no ticks at month zoom", () => {
    expect(ganttHeader(range, "month", 10).ticks).toEqual([]);
  });
});

describe("draggedDates", () => {
  const both = task(1, "2026-11-10", "2026-11-12");

  it("moves both dates together", () => {
    expect(draggedDates(both, "move", 3)).toEqual({ start_date: "2026-11-13", due_date: "2026-11-15" });
    expect(draggedDates(both, "move", -10)).toEqual({ start_date: "2026-10-31", due_date: "2026-11-02" });
  });

  it("moves only the date a task has", () => {
    expect(draggedDates(task(1, null, "2026-11-10"), "move", 1)).toEqual({ due_date: "2026-11-11" });
    expect(draggedDates(task(1, "2026-11-10", null), "move", 1)).toEqual({ start_date: "2026-11-11" });
  });

  it("resizes one end without crossing the other", () => {
    expect(draggedDates(both, "start", -2)).toEqual({ start_date: "2026-11-08" });
    expect(draggedDates(both, "start", 9)).toEqual({ start_date: "2026-11-12" });
    expect(draggedDates(both, "end", 3)).toEqual({ due_date: "2026-11-15" });
    expect(draggedDates(both, "end", -9)).toEqual({ due_date: "2026-11-10" });
  });

  it("creates the missing date when a one-day bar is stretched", () => {
    expect(draggedDates(task(1, null, "2026-11-10"), "start", -2)).toEqual({ start_date: "2026-11-08" });
    expect(draggedDates(task(1, "2026-11-10", null), "end", 2)).toEqual({ due_date: "2026-11-12" });
  });

  it("gives nothing for no movement", () => {
    expect(draggedDates(both, "move", 0)).toEqual({});
  });
});

describe("milestones", () => {
  it("moves a milestone's date by whole days", () => {
    expect(movedMilestoneDate("2026-11-30", 2)).toBe("2026-12-02");
  });

  it("reads as done, late or upcoming", () => {
    expect(milestoneState({ date: "2026-11-01", done: true }, "2026-11-02")).toBe("done");
    expect(milestoneState({ date: "2026-11-01", done: false }, "2026-11-02")).toBe("late");
    expect(milestoneState({ date: "2026-11-02", done: false }, "2026-11-02")).toBe("upcoming");
  });
});

describe("ganttGroups", () => {
  const modules = [{ id: 1, name: "General" }, { id: 2, name: "Backend" }];
  const milestones = [{ id: 7, name: "Beta", date: "2026-12-01" }, { id: 6, name: "Alpha", date: "2026-11-15" }];

  it("groups by module in bar order, leaving out empty ones", () => {
    const groups = ganttGroups([task(1, null, null, { module_id: 2 })], "module", modules, milestones);
    expect(groups.map((g) => g.name)).toEqual(["Backend"]);
  });

  it("sorts by start date inside a group, with undated tasks last", () => {
    const rows = [task(1, null, null), task(2, "2026-11-20", null), task(3, null, "2026-11-10"), task(4, "2026-11-20", null)];
    const [group] = ganttGroups(rows, "module", modules, milestones);
    expect(group.tasks.map((t) => t.id)).toEqual([3, 2, 4, 1]);
  });

  it("groups by milestone in date order, with the rest last", () => {
    const rows = [
      task(1, null, null),
      task(2, null, null, { milestone_id: 7 }),
      task(3, null, null, { milestone_id: 6 }),
    ];
    const groups = ganttGroups(rows, "milestone", modules, milestones);
    expect(groups.map((g) => g.name)).toEqual(["Alpha", "Beta", "No milestone"]);
    expect(groups.map((g) => g.tasks.map((t) => t.id))).toEqual([[3], [2], [1]]);
  });

  it("keeps a task whose module or milestone this client has not loaded yet", () => {
    const groups = ganttGroups([task(1, null, null, { module_id: 99, milestone_id: 99 })], "module", modules, milestones);
    expect(groups.flatMap((g) => g.tasks.map((t) => t.id))).toEqual([1]);
    const byMilestone = ganttGroups([task(2, null, null, { milestone_id: 99 })], "milestone", modules, milestones);
    expect(byMilestone.flatMap((g) => g.tasks.map((t) => t.id))).toEqual([2]);
  });
});
