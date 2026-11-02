import { describe, expect, it } from "vitest";
import { openDb } from "../src/store/db.js";
import { ActivityLogStore } from "../src/store/activityLog.js";
import { KnowledgeStore, ProjectHasMilestonesError } from "../src/store/knowledge.js";
import { onEvent, type WikikaiEvent } from "../src/lib/events.js";
import { BoardItemNotFoundError, TaskConflictError, TaskStore } from "../src/store/tasks.js";

function setup() {
  const db = openDb(":memory:");
  const knowledge = new KnowledgeStore(db);
  knowledge.registerProject("alpha");
  knowledge.registerProject("beta");
  const log = new ActivityLogStore(db);
  const tasks = new TaskStore(db, log);
  const alpha = tasks.ensureProject("alpha");
  const beta = tasks.ensureProject("beta");
  return { knowledge, log, tasks, milestones: tasks.milestones, alpha, beta };
}

describe("MilestoneStore", () => {
  it("adds a milestone and lists by date", () => {
    const { milestones, alpha } = setup();
    milestones.add(alpha.id, { name: "  Beta  ", date: "2026-12-01" });
    milestones.add(alpha.id, { name: "Alpha", date: "2026-11-15" });
    expect(milestones.list(alpha.id).map((m) => [m.name, m.date, m.done])).toEqual([
      ["Alpha", "2026-11-15", false],
      ["Beta", "2026-12-01", false],
    ]);
  });

  it("refuses a blank or long name, a bad date, and a duplicate ignoring case", () => {
    const { milestones, alpha, beta } = setup();
    expect(() => milestones.add(alpha.id, { name: " ", date: "2026-11-15" })).toThrow(/name is required/);
    expect(() => milestones.add(alpha.id, { name: "x".repeat(101), date: "2026-11-15" })).toThrow(/≤ 100/);
    expect(() => milestones.add(alpha.id, { name: "M", date: "2026-02-31" })).toThrow(/date/);
    milestones.add(alpha.id, { name: "Launch", date: "2026-11-15" });
    expect(() => milestones.add(alpha.id, { name: "LAUNCH", date: "2026-11-16" })).toThrow(TaskConflictError);
    expect(milestones.add(beta.id, { name: "Launch", date: "2026-11-15" }).name).toBe("Launch");
  });

  it("counts its open tasks, leaving out archived ones", () => {
    const { tasks, milestones, alpha } = setup();
    const m = milestones.add(alpha.id, { name: "M", date: "2026-11-15" });
    tasks.add(alpha.id, { title: "Open", milestone_id: m.id });
    tasks.add(alpha.id, { title: "Done", milestone_id: m.id, status: "done" });
    const archived = tasks.add(alpha.id, { title: "Archived", milestone_id: m.id });
    tasks.edit(archived.id, { expected_version: archived.version, archived: true });
    expect(milestones.list(alpha.id)[0]).toMatchObject({ task_count: 2, done_count: 1 });
  });

  it("updates name, date and done", () => {
    const { milestones, alpha } = setup();
    const m = milestones.add(alpha.id, { name: "M", date: "2026-11-15" });
    expect(milestones.update(m.id, { name: "N", date: "2026-11-20", done: true })).toMatchObject({
      name: "N",
      date: "2026-11-20",
      done: true,
    });
    expect(milestones.update(m.id, { done: false }).done).toBe(false);
    expect(() => milestones.update(m.id, {})).toThrow("nothing to change");
    expect(() => milestones.update(m.id, { date: "nope" })).toThrow(/date/);
  });

  it("allows renaming to itself with another case, not to another milestone", () => {
    const { milestones, alpha } = setup();
    const a = milestones.add(alpha.id, { name: "a", date: "2026-11-15" });
    milestones.add(alpha.id, { name: "b", date: "2026-11-15" });
    expect(milestones.update(a.id, { name: "A" }).name).toBe("A");
    expect(() => milestones.update(a.id, { name: "B" })).toThrow(TaskConflictError);
  });

  it("frees its tasks when deleted, keeping them otherwise unchanged", () => {
    const { tasks, milestones, alpha } = setup();
    const m = milestones.add(alpha.id, { name: "M", date: "2026-11-15" });
    const t = tasks.add(alpha.id, { title: "T", milestone_id: m.id });
    milestones.remove(m.id);
    expect(tasks.get(t.id)).toMatchObject({ milestone_id: null, milestone: null, version: t.version });
    expect(milestones.list(alpha.id)).toEqual([]);
  });

  it("throws not-found for an unknown id", () => {
    const { milestones } = setup();
    expect(() => milestones.update(999, { name: "x" })).toThrow(BoardItemNotFoundError);
    expect(() => milestones.remove(999)).toThrow(BoardItemNotFoundError);
  });

  it("logs changes and emits board-changed", () => {
    const { milestones, log, alpha } = setup();
    const events: WikikaiEvent[] = [];
    const off = onEvent((e) => events.push(e));
    const m = milestones.add(alpha.id, { name: "M", date: "2026-11-15" });
    milestones.update(m.id, { name: "N" });
    milestones.update(m.id, { date: "2026-11-20" });
    milestones.update(m.id, { done: true });
    milestones.remove(m.id);
    off();
    expect(events).toContainEqual({ type: "board-changed", project_id: alpha.id });
    const rows = log.list().entries.filter((e) => e.target === "milestone").reverse();
    expect(rows.map((r) => [r.action, r.task_title])).toEqual([
      ["add", "M (2026-11-15)"],
      ["edit", "M → N"],
      ["edit", "N (2026-11-15 → 2026-11-20)"],
      ["edit", "N (done)"],
      ["delete", "N"],
    ]);
  });

  it("logs nothing for a save that changes nothing", () => {
    const { milestones, log, alpha } = setup();
    const m = milestones.add(alpha.id, { name: "M", date: "2026-11-15" });
    const before = log.list().total;
    milestones.update(m.id, { name: "M", date: "2026-11-15" });
    expect(log.list().total).toBe(before);
  });

  it("refuses to let a project with milestones be unregistered", () => {
    const { knowledge, milestones, alpha } = setup();
    const m = milestones.add(alpha.id, { name: "M", date: "2026-11-15" });
    expect(() => knowledge.unregisterProject("alpha")).toThrow(ProjectHasMilestonesError);
    milestones.remove(m.id);
    expect(knowledge.unregisterProject("alpha").removed).toBe(true);
  });

  it("names the valid milestones when a name is unknown", () => {
    const { milestones, alpha } = setup();
    milestones.add(alpha.id, { name: "Beta", date: "2026-11-15" });
    expect(milestones.resolve(alpha.id, "beta").name).toBe("Beta");
    expect(() => milestones.resolve(alpha.id, "nope")).toThrow(
      "milestone 'nope' not found. Valid milestones: Beta",
    );
  });
});

describe("a task's milestone", () => {
  it("is set on add, and reported by id and name", () => {
    const { tasks, milestones, alpha } = setup();
    const m = milestones.add(alpha.id, { name: "M", date: "2026-11-15" });
    expect(tasks.add(alpha.id, { title: "T", milestone_id: m.id })).toMatchObject({ milestone_id: m.id, milestone: "M" });
    expect(tasks.add(alpha.id, { title: "None" })).toMatchObject({ milestone_id: null, milestone: null });
  });

  it("is a field: changing it checks and bumps the version, and null clears it", () => {
    const { tasks, milestones, alpha } = setup();
    const m = milestones.add(alpha.id, { name: "M", date: "2026-11-15" });
    const t = tasks.add(alpha.id, { title: "T" });
    const set = tasks.edit(t.id, { expected_version: t.version, milestone_id: m.id });
    expect(set).toMatchObject({ milestone: "M", version: t.version + 1 });
    expect(() => tasks.edit(t.id, { expected_version: t.version, milestone_id: null })).toThrow(/STALE/);
    expect(tasks.edit(t.id, { expected_version: set.version, milestone_id: null }).milestone).toBeNull();
  });

  it("must belong to the task's project", () => {
    const { tasks, milestones, alpha, beta } = setup();
    const other = milestones.add(beta.id, { name: "Other", date: "2026-11-15" });
    expect(() => tasks.add(alpha.id, { title: "T", milestone_id: other.id })).toThrow(/not in this project/);
    const t = tasks.add(alpha.id, { title: "T" });
    expect(() => tasks.edit(t.id, { expected_version: t.version, milestone_id: other.id })).toThrow(/not in this project/);
  });
});
