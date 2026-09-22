import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, type Db } from "../src/store/db.js";
import { KnowledgeStore } from "../src/store/knowledge.js";
import { PageStore } from "../src/store/pages.js";
import { bucketEvents, projectCalendar, type CalendarEvent } from "../src/store/calendar.js";
import { monthGrid, shiftMonth } from "../client/src/lib/calendarGrid.js";
import { buildCalendarSearch, parseCalendar, withoutCalendar } from "../client/src/hooks/useHash.js";

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
    expect(parseCalendar(q)).toEqual({ projectId: 7, month: "2026-09" });
    expect(parseCalendar("?calendar=7&month=2026-13")).toEqual({ projectId: 7, month: null });
    expect(parseCalendar("?projects=1")).toBeNull();
    expect(withoutCalendar(q)).toBe("?projects=1,2");
  });
});
