import { describe, expect, it } from "vitest";
import { openDb } from "../src/store/db.js";
import { ActivityLogStore } from "../src/store/activityLog.js";
import { KnowledgeStore } from "../src/store/knowledge.js";
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
  return { db, knowledge, log, tasks, modules: tasks.modules, alpha, beta };
}

const names = (items: { name: string }[]): string[] => items.map((i) => i.name);

describe("TaskModuleStore", () => {
  describe("the default module", () => {
    it("creates General the first time modules are read, once", () => {
      const { modules, alpha } = setup();
      expect(names(modules.list(alpha.id))).toEqual(["General"]);
      expect(names(modules.list(alpha.id))).toEqual(["General"]);
    });

    it("emits no event and logs nothing for the default module", () => {
      const { modules, log, alpha } = setup();
      const events: WikikaiEvent[] = [];
      const off = onEvent((e) => events.push(e));
      modules.list(alpha.id);
      off();
      expect(events).toEqual([]);
      expect(log.list().total).toBe(0);
    });
  });

  describe("modules", () => {
    it("adds a module last and reports its task count, archived included", () => {
      const { tasks, modules, alpha } = setup();
      const backend = modules.addModule(alpha.id, "  Backend  ");
      expect(backend.name).toBe("Backend");
      expect(names(modules.list(alpha.id))).toEqual(["General", "Backend"]);
      const task = tasks.add(alpha.id, { title: "T", module_id: backend.id });
      tasks.edit(task.id, { expected_version: task.version, archived: true });
      expect(modules.list(alpha.id).find((m) => m.id === backend.id)?.task_count).toBe(1);
    });

    it("refuses a blank, overlong or duplicate name, ignoring case", () => {
      const { modules, alpha } = setup();
      modules.list(alpha.id);
      expect(() => modules.addModule(alpha.id, "   ")).toThrow(/name is required/);
      expect(() => modules.addModule(alpha.id, "x".repeat(51))).toThrow(/≤ 50/);
      expect(() => modules.addModule(alpha.id, "general")).toThrow(TaskConflictError);
    });

    it("treats non-Latin case variants as duplicates", () => {
      const { modules, alpha } = setup();
      modules.addModule(alpha.id, "ПРОЕКТ");
      expect(() => modules.addModule(alpha.id, "проект")).toThrow(TaskConflictError);
    });

    it("allows the same module name in another project", () => {
      const { modules, alpha, beta } = setup();
      modules.addModule(alpha.id, "Backend");
      expect(modules.addModule(beta.id, "Backend").name).toBe("Backend");
    });

    it("renames, including a change of case to itself", () => {
      const { modules, alpha } = setup();
      const m = modules.addModule(alpha.id, "backend");
      expect(modules.updateModule(m.id, { name: "Backend" }).name).toBe("Backend");
    });

    it("moves left and right, and past an edge changes nothing", () => {
      const { modules, alpha } = setup();
      modules.list(alpha.id);
      const b = modules.addModule(alpha.id, "B");
      const c = modules.addModule(alpha.id, "C");
      modules.updateModule(c.id, { move: "left" });
      expect(names(modules.list(alpha.id))).toEqual(["General", "C", "B"]);
      modules.updateModule(b.id, { move: "right" });
      expect(names(modules.list(alpha.id))).toEqual(["General", "C", "B"]);
    });

    it("refuses to delete a module with tasks, naming how many, or the last one", () => {
      const { tasks, modules, alpha } = setup();
      const [general] = modules.list(alpha.id);
      const b = modules.addModule(alpha.id, "B");
      const task = tasks.add(alpha.id, { title: "T", module_id: b.id });
      tasks.edit(task.id, { expected_version: task.version, archived: true });
      expect(() => modules.deleteModule(b.id)).toThrow(/1 task/);
      tasks.remove(task.id);
      modules.deleteModule(b.id);
      expect(() => modules.deleteModule(general.id)).toThrow(/last module/);
    });

    it("throws a not-found error for an unknown module id", () => {
      const { modules } = setup();
      expect(() => modules.updateModule(999, { name: "x" })).toThrow(BoardItemNotFoundError);
      expect(() => modules.deleteModule(999)).toThrow(BoardItemNotFoundError);
    });
  });

  describe("columns", () => {
    it("refuses reserved names ignoring case, and duplicates within a module", () => {
      const { modules, alpha } = setup();
      const [m] = modules.list(alpha.id);
      for (const name of ["Todo", "DOING", "review", "dOnE"]) {
        expect(() => modules.addColumn(m.id, { name, status: "todo" })).toThrow(/reserved/);
      }
      modules.addColumn(m.id, { name: "QA", status: "review" });
      expect(() => modules.addColumn(m.id, { name: "qa", status: "doing" })).toThrow(TaskConflictError);
    });

    it("places a new column last in its status, after the locked column", () => {
      const { modules, alpha } = setup();
      const [m] = modules.list(alpha.id);
      expect(modules.addColumn(m.id, { name: "A", status: "doing" }).position).toBe(1);
      expect(modules.addColumn(m.id, { name: "B", status: "doing" }).position).toBe(2);
      expect(modules.addColumn(m.id, { name: "C", status: "review" }).position).toBe(1);
    });

    it("moves across the locked column and keeps the locked column at 0", () => {
      const { modules, alpha } = setup();
      const [m] = modules.list(alpha.id);
      const a = modules.addColumn(m.id, { name: "A", status: "todo" });
      const b = modules.addColumn(m.id, { name: "B", status: "todo" });
      // Todo, A, B → A, Todo, B
      modules.updateColumn(a.id, { move: "left" });
      const positions = (): Record<string, number> =>
        Object.fromEntries(modules.list(alpha.id)[0].columns.map((c) => [c.name, c.position]));
      expect(positions()).toEqual({ A: -1, B: 1 });
      // A, Todo, B → A, B, Todo
      modules.updateColumn(b.id, { move: "left" });
      expect(positions()).toEqual({ A: -2, B: -1 });
      // Past the left edge of the status: nothing changes.
      modules.updateColumn(a.id, { move: "left" });
      expect(positions()).toEqual({ A: -2, B: -1 });
    });

    it("does not let a move leave the column's status", () => {
      const { modules, alpha } = setup();
      const [m] = modules.list(alpha.id);
      const a = modules.addColumn(m.id, { name: "A", status: "todo" });
      modules.addColumn(m.id, { name: "B", status: "doing" });
      modules.updateColumn(a.id, { move: "right" });
      const [column] = modules.list(alpha.id)[0].columns.filter((c) => c.name === "A");
      expect(column).toMatchObject({ status: "todo", position: 1 });
    });

    it("sends a deleted column's cards to the bottom of the locked column, in order, with no version bump", () => {
      const { tasks, modules, alpha } = setup();
      const [m] = modules.list(alpha.id);
      const qa = modules.addColumn(m.id, { name: "QA", status: "review" });
      const stays = tasks.add(alpha.id, { title: "Stays", status: "review" });
      const first = tasks.add(alpha.id, { title: "First", column_id: qa.id });
      const second = tasks.add(alpha.id, { title: "Second", column_id: qa.id });
      const archived = tasks.add(alpha.id, { title: "Archived", column_id: qa.id });
      tasks.edit(archived.id, { expected_version: archived.version, archived: true });

      modules.deleteColumn(qa.id);

      expect(tasks.list(alpha.id).map((t) => t.title)).toEqual([stays.title, first.title, second.title]);
      expect(tasks.get(first.id)).toMatchObject({ column_id: null, column: "Review", version: first.version });
      expect(tasks.get(archived.id)?.column_id).toBeNull();
    });

    it("logs one row for a deleted column, naming the cards it moved", () => {
      const { tasks, modules, log, alpha } = setup();
      const [m] = modules.list(alpha.id);
      const qa = modules.addColumn(m.id, { name: "QA", status: "review" });
      tasks.add(alpha.id, { title: "One", column_id: qa.id });
      tasks.add(alpha.id, { title: "Two", column_id: qa.id });
      modules.deleteColumn(qa.id);
      const rows = log.list().entries.filter((e) => e.target === "board_column");
      expect(rows.map((r) => [r.action, r.task_title])).toEqual([
        ["delete", "QA (2 cards moved to Review)"],
        ["add", "QA"],
      ]);
    });

    it("stores a rename as old and new", () => {
      const { modules, log, alpha } = setup();
      const m = modules.addModule(alpha.id, "Old");
      modules.updateModule(m.id, { name: "New" });
      expect(log.list().entries[0]).toMatchObject({
        action: "edit",
        target: "board_module",
        project_id: alpha.id,
        task_title: "Old → New",
      });
    });

    it("emits board-changed for a structural change, including a move, but logs no move", () => {
      const { modules, log, alpha } = setup();
      modules.list(alpha.id);
      const b = modules.addModule(alpha.id, "B");
      const before = log.list().total;
      const events: WikikaiEvent[] = [];
      const off = onEvent((e) => events.push(e));
      modules.updateModule(b.id, { move: "left" });
      off();
      expect(events).toContainEqual({ type: "board-changed", project_id: alpha.id });
      expect(log.list().total).toBe(before);
    });
  });

  describe("project lifecycle", () => {
    it("lets a project with only empty modules be unregistered", () => {
      const { knowledge, modules, alpha } = setup();
      const [m] = modules.list(alpha.id);
      modules.addColumn(m.id, { name: "QA", status: "review" });
      expect(knowledge.unregisterProject("alpha").removed).toBe(true);
    });
  });

  describe("resolving names", () => {
    it("lists valid modules when a name is unknown", () => {
      const { modules, alpha } = setup();
      modules.addModule(alpha.id, "Backend");
      expect(() => modules.resolveModule(alpha.id, "nope")).toThrow(
        "module 'nope' not found. Valid modules: General, Backend",
      );
      expect(modules.resolveModule(alpha.id, "BACKEND").name).toBe("Backend");
    });

    it("resolves locked and custom columns, listing valid ones in board order", () => {
      const { modules, alpha } = setup();
      const [m] = modules.list(alpha.id);
      modules.addColumn(m.id, { name: "QA", status: "review" });
      expect(modules.resolveColumn(m.id, "done")).toEqual({ column_id: null, status: "done" });
      expect(modules.resolveColumn(m.id, "qa")).toMatchObject({ status: "review" });
      expect(() => modules.resolveColumn(m.id, "nope")).toThrow(
        "column 'nope' not found in module 'General'. Valid columns: Todo, Doing, Review, QA, Done",
      );
    });
  });
});

describe("where a task lands", () => {
  function board() {
    const s = setup();
    const [general] = s.modules.list(s.alpha.id);
    const backend = s.modules.addModule(s.alpha.id, "Backend");
    const backlog = s.modules.addColumn(general.id, { name: "Backlog", status: "todo" });
    const qa = s.modules.addColumn(general.id, { name: "QA", status: "review" });
    const backendQa = s.modules.addColumn(backend.id, { name: "QA", status: "review" });
    return { ...s, general, backend, backlog, qa, backendQa };
  }

  it("puts a new task in the first module's locked Todo", () => {
    const { tasks, alpha, general } = board();
    expect(tasks.add(alpha.id, { title: "T" })).toMatchObject({
      module_id: general.id,
      module: "General",
      column_id: null,
      column: "Todo",
      status: "todo",
    });
  });

  it("takes its status from a custom column", () => {
    const { tasks, alpha, qa } = board();
    expect(tasks.add(alpha.id, { title: "T", column_id: qa.id })).toMatchObject({
      status: "review",
      column_id: qa.id,
      column: "QA",
    });
  });

  it("refuses a status that disagrees with the column", () => {
    const { tasks, alpha, qa } = board();
    expect(() => tasks.add(alpha.id, { title: "T", column_id: qa.id, status: "doing" })).toThrow(
      "column 'QA' has status review, not doing",
    );
  });

  it("refuses a column from another module", () => {
    const { tasks, alpha, backend, qa } = board();
    expect(() => tasks.add(alpha.id, { title: "T", module_id: backend.id, column_id: qa.id })).toThrow(
      /not in module 'Backend'/,
    );
  });

  it("refuses a module from another project", () => {
    const { tasks, modules, alpha, beta } = board();
    const [other] = modules.list(beta.id);
    expect(() => tasks.add(alpha.id, { title: "T", module_id: other.id })).toThrow(/not in this project/);
  });

  it("refuses a column id that does not exist", () => {
    const { tasks, alpha } = board();
    expect(() => tasks.add(alpha.id, { title: "T", column_id: 999 })).toThrow(/column 999 not found/);
  });

  it("goes to the locked column of the new status when the status changes", () => {
    const { tasks, alpha, backlog } = board();
    const t = tasks.add(alpha.id, { title: "T", column_id: backlog.id });
    expect(tasks.edit(t.id, { expected_version: t.version, status: "doing" })).toMatchObject({
      status: "doing",
      column_id: null,
      column: "Doing",
    });
  });

  it("goes to the locked column of its status when the module changes", () => {
    const { tasks, alpha, backend, qa } = board();
    const t = tasks.add(alpha.id, { title: "T", column_id: qa.id });
    expect(tasks.edit(t.id, { expected_version: t.version, module_id: backend.id })).toMatchObject({
      module: "Backend",
      status: "review",
      column_id: null,
    });
  });

  it("moves to a named column in the new module", () => {
    const { tasks, alpha, backend, backendQa } = board();
    const t = tasks.add(alpha.id, { title: "T" });
    expect(
      tasks.edit(t.id, { expected_version: t.version, module_id: backend.id, column_id: backendQa.id }),
    ).toMatchObject({ module: "Backend", status: "review", column_id: backendQa.id });
  });

  it("returns to the locked column with a null column", () => {
    const { tasks, alpha, qa } = board();
    const t = tasks.add(alpha.id, { title: "T", column_id: qa.id });
    expect(tasks.edit(t.id, { expected_version: t.version, column_id: null })).toMatchObject({
      status: "review",
      column_id: null,
      column: "Review",
    });
  });

  it("stays put when an edit touches neither module nor status", () => {
    const { tasks, alpha, qa } = board();
    const t = tasks.add(alpha.id, { title: "T", column_id: qa.id });
    expect(tasks.edit(t.id, { expected_version: t.version, title: "Renamed" }).column_id).toBe(qa.id);
  });

  it("does not bump the version for a placement-only edit, and logs it as reorder", () => {
    const { tasks, log, alpha, backend, backlog } = board();
    const t = tasks.add(alpha.id, { title: "T" });
    const moved = tasks.edit(t.id, { expected_version: t.version, column_id: backlog.id });
    expect(moved.version).toBe(t.version);
    expect(moved.updated_at).toBe(t.updated_at);
    expect(log.list().entries[0]).toMatchObject({ action: "reorder", target: "board_task" });
    const again = tasks.edit(t.id, { expected_version: t.version, module_id: backend.id });
    expect(again.version).toBe(t.version);
  });

  it("bumps the version when moving to a column changes the status", () => {
    const { tasks, alpha, qa } = board();
    const t = tasks.add(alpha.id, { title: "T" });
    expect(tasks.edit(t.id, { expected_version: t.version, column_id: qa.id }).version).toBe(t.version + 1);
  });

  it("still refuses an edit naming nothing to change", () => {
    const { tasks, alpha } = board();
    const t = tasks.add(alpha.id, { title: "T" });
    expect(() => tasks.edit(t.id, { expected_version: t.version })).toThrow("nothing to change");
  });

  it("orders cards per column, not per status", () => {
    const { tasks, alpha, backlog, backend } = board();
    const locked = tasks.add(alpha.id, { title: "Locked" });
    const custom = tasks.add(alpha.id, { title: "Custom", column_id: backlog.id });
    const other = tasks.add(alpha.id, { title: "Other", module_id: backend.id });
    expect([locked.position, custom.position, other.position]).toEqual([1, 1, 1]);
  });

  it("places on top when a move lands in a done-status column", () => {
    const { tasks, modules, alpha, general } = board();
    const shipped = modules.addColumn(general.id, { name: "Shipped", status: "done" });
    const a = tasks.add(alpha.id, { title: "A", column_id: shipped.id });
    const b = tasks.add(alpha.id, { title: "B" });
    const moved = tasks.edit(b.id, { expected_version: b.version, column_id: shipped.id });
    expect(moved.position).toBe(1);
    expect(tasks.get(a.id)?.position).toBe(2);
  });

  it("keeps an archived task's placement and returns it to the bottom of its column", () => {
    const { tasks, alpha, qa } = board();
    const a = tasks.add(alpha.id, { title: "A", column_id: qa.id });
    const b = tasks.add(alpha.id, { title: "B", column_id: qa.id });
    const archived = tasks.edit(a.id, { expected_version: a.version, archived: true });
    expect(archived.column_id).toBe(qa.id);
    const back = tasks.edit(a.id, { expected_version: archived.version, archived: false });
    expect(back.column_id).toBe(qa.id);
    expect(back.position).toBeGreaterThan(tasks.get(b.id)?.position ?? 0);
  });

  describe("move", () => {
    it("moves within a status without a version check", () => {
      const { tasks, alpha, qa } = board();
      const t = tasks.add(alpha.id, { title: "T", status: "review" });
      const moved = tasks.move(t.id, { status: "review", column_id: qa.id, before_id: null, expected_version: 99 });
      expect(moved).toMatchObject({ column_id: qa.id, version: t.version });
    });

    it("checks the version when the status changes", () => {
      const { tasks, alpha, qa } = board();
      const t = tasks.add(alpha.id, { title: "T" });
      expect(() =>
        tasks.move(t.id, { status: "review", column_id: qa.id, before_id: null, expected_version: 99 }),
      ).toThrow(/STALE/);
    });

    it("needs an explicit null to leave a custom column of the same status", () => {
      const { tasks, alpha, qa } = board();
      const t = tasks.add(alpha.id, { title: "T", column_id: qa.id });
      const stays = tasks.move(t.id, { status: "review", before_id: null, expected_version: t.version });
      expect(stays.column_id).toBe(qa.id);
      const leaves = tasks.move(t.id, {
        status: "review",
        column_id: null,
        before_id: null,
        expected_version: t.version,
      });
      expect(leaves.column_id).toBeNull();
    });

    it("treats a before_id outside the target column as the bottom", () => {
      const { tasks, alpha, backlog } = board();
      const inColumn = tasks.add(alpha.id, { title: "In", column_id: backlog.id });
      const elsewhere = tasks.add(alpha.id, { title: "Elsewhere" });
      const moving = tasks.add(alpha.id, { title: "Moving" });
      const moved = tasks.move(moving.id, {
        status: "todo",
        column_id: backlog.id,
        before_id: elsewhere.id,
        expected_version: moving.version,
      });
      expect(moved.position).toBeGreaterThan(tasks.get(inColumn.id)?.position ?? 0);
    });
  });

  describe("next", () => {
    it("skips custom Todo columns", () => {
      const { tasks, alpha, backlog } = board();
      tasks.add(alpha.id, { title: "Not ready", column_id: backlog.id });
      expect(tasks.next(alpha.id, null)).toBeNull();
      const ready = tasks.add(alpha.id, { title: "Ready" });
      expect(tasks.next(alpha.id, null)?.id).toBe(ready.id);
    });

    it("follows module order, then card order, without a module", () => {
      const { tasks, modules, alpha, backend } = board();
      const second = tasks.add(alpha.id, { title: "In General" });
      const first = tasks.add(alpha.id, { title: "In Backend", module_id: backend.id });
      expect(tasks.next(alpha.id, null)?.id).toBe(second.id);
      modules.updateModule(backend.id, { move: "left" });
      expect(tasks.next(alpha.id, null)?.id).toBe(first.id);
    });

    it("takes only the given module", () => {
      const { tasks, alpha, backend } = board();
      tasks.add(alpha.id, { title: "In General" });
      expect(tasks.next(alpha.id, null, backend.id)).toBeNull();
      const t = tasks.add(alpha.id, { title: "In Backend", module_id: backend.id });
      expect(tasks.next(alpha.id, null, backend.id)?.id).toBe(t.id);
    });
  });

  describe("list", () => {
    it("orders by module, status, column, then card", () => {
      const { tasks, modules, alpha, general, backend, backlog } = board();
      const before = modules.addColumn(general.id, { name: "Before", status: "todo" });
      modules.updateColumn(before.id, { move: "left" });
      modules.updateColumn(before.id, { move: "left" });
      tasks.add(alpha.id, { title: "backend", module_id: backend.id });
      tasks.add(alpha.id, { title: "doing", status: "doing" });
      tasks.add(alpha.id, { title: "backlog", column_id: backlog.id });
      tasks.add(alpha.id, { title: "locked" });
      tasks.add(alpha.id, { title: "before", column_id: before.id });
      expect(tasks.list(alpha.id).map((t) => t.title)).toEqual(["before", "locked", "backlog", "doing", "backend"]);
    });

    it("filters by module", () => {
      const { tasks, alpha, backend } = board();
      tasks.add(alpha.id, { title: "general" });
      tasks.add(alpha.id, { title: "backend", module_id: backend.id });
      expect(tasks.list(alpha.id, { moduleId: backend.id }).map((t) => t.title)).toEqual(["backend"]);
    });
  });

  describe("placementByName", () => {
    it("resolves a locked column to a status and clears the column", () => {
      const { tasks, alpha, general } = board();
      expect(tasks.placementByName(alpha.id, general.id, { column: "done" })).toEqual({
        column_id: null,
        status: "done",
      });
    });

    it("refuses a locked column that disagrees with the status", () => {
      const { tasks, alpha, general } = board();
      expect(() => tasks.placementByName(alpha.id, general.id, { column: "Done", status: "doing" })).toThrow(
        "column 'Done' has status done, not doing",
      );
    });

    it("finds a column in the named module, not the current one", () => {
      const { tasks, alpha, general, backendQa } = board();
      expect(tasks.placementByName(alpha.id, general.id, { module: "Backend", column: "QA" })).toEqual({
        module_id: expect.any(Number),
        column_id: backendQa.id,
      });
    });
  });
});
