import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, type Db } from "../src/store/db.js";
import { KnowledgeStore } from "../src/store/knowledge.js";
import { PageStore } from "../src/store/pages.js";
import { bucketEvents, projectCalendar, type CalendarEvent } from "../src/store/calendar.js";
import { calendarIconState, filterDays, isOverdue, monthGrid, shiftMonth, tasksByDate } from "../client/src/lib/calendarGrid.js";
import {
  buildCalendarSearch,
  buildProjectViewSearch,
  buildTaskLink,
  buildTaskSearch,
  buildModuleSearch,
  buildNoteSearch,
  parseCalendar,
  withoutCalendar,
} from "../client/src/hooks/useHash.js";

function ev(at: string, over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    at,
    created: false,
    page_id: 1,
    page_title: "P1",
    position: 1,
    archived: false,
    knowledge_id: 10,
    knowledge_title: "K10",
    ...over,
  };
}

describe("bucketEvents", () => {
  it("buckets by the viewer's local day, not the UTC day", () => {
    // 18:30Z on the 14th is 01:30 on the 15th in Bangkok (+07).
    const days = bucketEvents([ev("2026-09-14T18:30:00.000Z")], {
      from: "2026-09-01",
      to: "2026-09-30",
      tz: "Asia/Bangkok",
    });
    expect(days.map((d) => d.date)).toEqual(["2026-09-15"]);
    const utc = bucketEvents([ev("2026-09-14T18:30:00.000Z")], {
      from: "2026-09-01",
      to: "2026-09-30",
      tz: "UTC",
    });
    expect(utc.map((d) => d.date)).toEqual(["2026-09-14"]);
  });

  it("collapses repeated edits of a page into one entry with a count", () => {
    const [day] = bucketEvents(
      [
        ev("2026-09-15T01:00:00.000Z", { created: true }),
        ev("2026-09-15T02:00:00.000Z"),
        ev("2026-09-15T03:00:00.000Z"),
      ],
      { from: "2026-09-15", to: "2026-09-15", tz: "UTC" },
    );
    expect(day.knowledge).toHaveLength(1);
    expect(day.knowledge[0].pages).toEqual([
      expect.objectContaining({ id: 1, created: true, count: 3 }),
    ]);
  });

  it("orders knowledge by latest activity and pages by tab position", () => {
    const [day] = bucketEvents(
      [
        ev("2026-09-15T01:00:00.000Z", { knowledge_id: 1, knowledge_title: "early" }),
        ev("2026-09-15T05:00:00.000Z", { knowledge_id: 2, page_id: 7, position: 3 }),
        ev("2026-09-15T04:00:00.000Z", { knowledge_id: 2, page_id: 6, position: 1 }),
      ],
      { from: "2026-09-15", to: "2026-09-15", tz: "UTC" },
    );
    expect(day.knowledge.map((k) => k.id)).toEqual([2, 1]);
    expect(day.knowledge[0].pages.map((p) => p.id)).toEqual([6, 7]);
  });

  it("drops events outside the requested local range", () => {
    const days = bucketEvents([ev("2026-08-31T12:00:00.000Z")], {
      from: "2026-09-01",
      to: "2026-09-30",
      tz: "UTC",
    });
    expect(days).toEqual([]);
  });

  it("rejects an unknown time zone", () => {
    expect(() =>
      bucketEvents([], { from: "2026-09-01", to: "2026-09-30", tz: "Mars/Olympus" }),
    ).toThrow(/time zone/);
  });
});

describe("projectCalendar", () => {
  let db: Db;
  let knowledge: KnowledgeStore;
  let pages: PageStore;

  function log(at: string, action: string, target: string, pageId: number, kid: number): void {
    db.prepare(
      `INSERT INTO activity_log (created_at, source, action, target, knowledge_id, page_id)
       VALUES (?, 'web', ?, ?, ?, ?)`,
    ).run(at, action, target, kid, pageId);
  }

  beforeEach(() => {
    db = openDb(":memory:");
    knowledge = new KnowledgeStore(db);
    pages = new PageStore(db, fs.mkdtempSync(path.join(os.tmpdir(), "wk-cal-")));
  });

  it("reads creations and content edits of the project's pages", () => {
    const k = knowledge.add({ title: "Doc", project: "alpha" });
    const other = knowledge.add({ title: "Elsewhere", project: "beta" });
    const p = pages.add({ knowledge_id: k.id, title: "Intro", content: "x" });
    const q = pages.add({ knowledge_id: other.id, title: "Other", content: "x" });
    log("2026-09-10T03:00:00.000Z", "add", "page", p.id, k.id);
    log("2026-09-11T03:00:00.000Z", "edit", "block", p.id, k.id);
    log("2026-09-11T04:00:00.000Z", "toggle", "task", p.id, k.id);
    log("2026-09-11T05:00:00.000Z", "reorder", "knowledge", p.id, k.id); // not an edit
    log("2026-09-11T03:00:00.000Z", "edit", "page", q.id, other.id); // other project

    const days = projectCalendar(db, { project: "alpha", from: "2026-09-01", to: "2026-09-30", tz: "UTC" });
    expect(days.map((d) => d.date)).toEqual(["2026-09-10", "2026-09-11"]);
    expect(days[0].knowledge[0].pages[0]).toMatchObject({ title: "Intro", created: true, count: 1 });
    expect(days[1].knowledge[0].pages[0]).toMatchObject({ created: false, count: 2 });
  });

  it("falls back to pages.created_at for pages older than the activity log", () => {
    const k = knowledge.add({ title: "Old doc", project: "alpha" });
    const p = pages.add({ knowledge_id: k.id, title: "Legacy", content: "x" });
    db.prepare(`UPDATE pages SET created_at = ? WHERE id = ?`).run("2026-05-01T08:00:00.000Z", p.id);
    const days = projectCalendar(db, { project: "alpha", from: "2026-04-26", to: "2026-06-06", tz: "UTC" });
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ date: "2026-05-01" });
    expect(days[0].knowledge[0].pages[0]).toMatchObject({ id: p.id, created: true });
  });

  it("leaves out deleted pages", () => {
    const k = knowledge.add({ title: "Doc", project: "alpha" });
    const p = pages.add({ knowledge_id: k.id, title: "Gone", content: "x" });
    log("2026-09-10T03:00:00.000Z", "edit", "page", p.id, k.id);
    pages.remove(p.id);
    expect(projectCalendar(db, { project: "alpha", from: "2026-09-01", to: "2026-09-30", tz: "UTC" })).toEqual([]);
  });

  it("rejects ranges longer than six weeks and malformed dates", () => {
    expect(() => projectCalendar(db, { project: "a", from: "2026-01-01", to: "2026-03-01", tz: "UTC" })).toThrow(/at most/);
    expect(() => projectCalendar(db, { project: "a", from: "2026-02-30", to: "2026-03-01", tz: "UTC" })).toThrow(/valid date/);
  });
});

describe("calendar grid + URL helpers", () => {
  it("builds Sunday-first weeks covering the month", () => {
    const g = monthGrid("2026-09"); // 1 Sep 2026 is a Tuesday
    expect(g.from).toBe("2026-08-30");
    expect(g.weeks).toHaveLength(5);
    expect(g.to).toBe("2026-10-03");
    expect(monthGrid("2026-02").weeks).toHaveLength(4); // Feb 2026 starts on Sunday
  });

  it("shifts months across year boundaries", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });

  it("round-trips the calendar query and keeps other params", () => {
    const q = buildCalendarSearch("?projects=1,2", 7, "2026-09");
    expect(q).toBe("?projects=1,2&calendar=7&month=2026-09");
    expect(parseCalendar(q)).toEqual({ projectId: 7, month: "2026-09", view: "calendar", taskId: null, moduleId: null, noteId: null });
    expect(parseCalendar("?calendar=7&month=2026-13")).toEqual({
      projectId: 7,
      month: null,
      view: "calendar",
      taskId: null,
      moduleId: null,
      noteId: null,
    });
    expect(parseCalendar("?projects=1")).toBeNull();
    expect(withoutCalendar(q)).toBe("?projects=1,2");
  });

  it("reads the project view and open task, ignoring bad values", () => {
    expect(parseCalendar("?calendar=7&view=board&task=12")).toMatchObject({ view: "board", taskId: 12 });
    expect(parseCalendar("?calendar=7&view=list")).toMatchObject({ view: "list", taskId: null });
    expect(parseCalendar("?calendar=7&view=nope&task=abc")).toMatchObject({ view: "calendar", taskId: null });
    expect(parseCalendar("?calendar=7&task=-1")).toMatchObject({ taskId: null });
    expect(parseCalendar("?calendar=7&task=1.5")).toMatchObject({ taskId: null });
  });

  it("reads and builds the module, ignoring bad values", () => {
    expect(parseCalendar("?calendar=7&view=board&module=3")).toMatchObject({ moduleId: 3 });
    expect(parseCalendar("?calendar=7&module=abc")).toMatchObject({ moduleId: null });
    expect(buildModuleSearch("?calendar=7&view=board", 3)).toBe("?calendar=7&view=board&module=3");
    expect(buildModuleSearch("?calendar=7&view=board&module=3", null)).toBe("?calendar=7&view=board");
    expect(buildProjectViewSearch("?calendar=7&view=board&module=3", "list")).toBe("?calendar=7&view=list&module=3");
    expect(withoutCalendar("?calendar=7&view=board&module=3")).toBe("");
  });

  it("reads the notes tab and an open note, ignoring bad values", () => {
    expect(parseCalendar("?calendar=7&view=notes&note=3")).toMatchObject({ view: "notes", noteId: 3 });
    expect(parseCalendar("?calendar=7&view=notes&note=abc")).toMatchObject({ view: "notes", noteId: null });
    expect(buildProjectViewSearch("?calendar=7", "notes")).toBe("?calendar=7&view=notes");
    expect(buildNoteSearch("?calendar=7&view=notes", 3)).toBe("?calendar=7&view=notes&note=3");
    expect(buildNoteSearch("?calendar=7&view=notes&note=3", null)).toBe("?calendar=7&view=notes");
    expect(withoutCalendar("?calendar=7&view=notes&note=3")).toBe("");
    expect(buildProjectViewSearch("?calendar=7&view=notes&note=3", "board")).toBe("?calendar=7&view=board");
  });

  it("builds view and task queries, keeping other params", () => {
    expect(buildProjectViewSearch("?calendar=7&month=2026-09", "board")).toBe("?calendar=7&month=2026-09&view=board");
    expect(buildProjectViewSearch("?calendar=7&view=board", "calendar")).toBe("?calendar=7");
    expect(buildTaskSearch("?calendar=7&view=board", 12)).toBe("?calendar=7&view=board&task=12");
    expect(buildTaskSearch("?calendar=7&view=board&task=12", null)).toBe("?calendar=7&view=board");
  });

  it("keeps the view and task when changing month, and drops them on leaving", () => {
    const q = "?projects=1,2&calendar=7&view=list&task=3";
    expect(buildCalendarSearch(q, 7, "2026-10")).toBe("?projects=1,2&calendar=7&view=list&task=3&month=2026-10");
    expect(withoutCalendar(q)).toBe("?projects=1,2");
  });

  it("builds a deep link to a task from anywhere", () => {
    expect(buildTaskLink("?projects=1,2&calendar=9&month=2026-01&view=list&task=3", 7, 12)).toBe(
      "?projects=1,2&calendar=7&view=board&task=12",
    );
  });
});

describe("filterDays (created / edited toggles)", () => {
  const page = (id: number, created: boolean, count: number) => ({
    id, title: `P${id}`, position: id, created, count, archived: false,
  });
  const days = [
    {
      date: "2026-09-15",
      knowledge: [
        { id: 1, title: "K1", pages: [page(1, true, 1), page(2, true, 4), page(3, false, 2)] },
        { id: 2, title: "K2", pages: [page(4, true, 1)] },
      ],
    },
  ];

  it("returns everything when both are on", () => {
    expect(filterDays(days, { created: true, edited: true })).toBe(days);
  });

  it("created only keeps creations, counted once", () => {
    const [d] = filterDays(days, { created: true, edited: false });
    expect(d.knowledge.map((k) => k.pages.map((p) => [p.id, p.created, p.count]))).toEqual([
      [[1, true, 1], [2, true, 1]],
      [[4, true, 1]],
    ]);
  });

  it("edited only keeps pages with edits, shown as edits, and drops empty knowledge", () => {
    const [d] = filterDays(days, { created: false, edited: true });
    expect(d.knowledge.map((k) => k.id)).toEqual([1]);
    expect(d.knowledge[0].pages.map((p) => [p.id, p.created, p.count])).toEqual([
      [2, false, 3],
      [3, false, 2],
    ]);
  });

  it("both off leaves no days", () => {
    expect(filterDays(days, { created: false, edited: false })).toEqual([]);
  });
});

describe("tasks on the calendar", () => {
  const task = (id: number, over: { start_date?: string | null; due_date?: string | null; status?: string } = {}) => ({
    id,
    start_date: null,
    due_date: null,
    status: "todo",
    ...over,
  });

  it("places a task on its start and due dates", () => {
    const map = tasksByDate([task(1, { start_date: "2026-11-02", due_date: "2026-11-05" })], "2026-11-01", "2026-11-30");
    expect(map.get("2026-11-02")?.map((e) => e.kind)).toEqual(["start"]);
    expect(map.get("2026-11-05")?.map((e) => e.kind)).toEqual(["due"]);
  });

  it("shows matching start and due dates once, as due", () => {
    const map = tasksByDate([task(1, { start_date: "2026-11-02", due_date: "2026-11-02" })], "2026-11-01", "2026-11-30");
    expect(map.get("2026-11-02")?.map((e) => e.kind)).toEqual(["due"]);
  });

  it("leaves out undated tasks and dates outside the range, keeping the padding days", () => {
    const map = tasksByDate(
      [task(1), task(2, { due_date: "2026-12-31" }), task(3, { due_date: "2026-11-01" })],
      "2026-11-01",
      "2026-12-05",
    );
    expect([...map.keys()]).toEqual(["2026-11-01"]);
  });

  it("lists due before start, then by id", () => {
    const map = tasksByDate(
      [task(2, { start_date: "2026-11-02" }), task(3, { due_date: "2026-11-02" }), task(1, { due_date: "2026-11-02" })],
      "2026-11-01",
      "2026-11-30",
    );
    expect(map.get("2026-11-02")?.map((e) => e.task.id)).toEqual([1, 3, 2]);
  });

  it("calls a task overdue only before its due date passes and while not done", () => {
    expect(isOverdue(task(1, { due_date: "2026-11-01" }), "2026-11-02")).toBe(true);
    expect(isOverdue(task(1, { due_date: "2026-11-02" }), "2026-11-02")).toBe(false);
    expect(isOverdue(task(1, { due_date: "2026-11-01", status: "done" }), "2026-11-02")).toBe(false);
    expect(isOverdue(task(1), "2026-11-02")).toBe(false);
  });
});

describe("calendarIconState", () => {
  const today = "2026-11-02";

  it("has no state when no task is open", () => {
    expect(calendarIconState({ open_tasks: 0, earliest_due: null }, today)).toBeNull();
  });

  it("is open for tasks with no due date", () => {
    expect(calendarIconState({ open_tasks: 2, earliest_due: null }, today)).toBe("open");
  });

  it("is upcoming while the earliest due date is today or later", () => {
    expect(calendarIconState({ open_tasks: 1, earliest_due: "2026-11-02" }, today)).toBe("upcoming");
    expect(calendarIconState({ open_tasks: 1, earliest_due: "2026-11-03" }, today)).toBe("upcoming");
  });

  it("is overdue once the earliest due date has passed", () => {
    expect(calendarIconState({ open_tasks: 3, earliest_due: "2026-11-01" }, today)).toBe("overdue");
  });
});
