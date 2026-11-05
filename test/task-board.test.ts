import { describe, expect, it } from "vitest";
import {
  allAssignees,
  allLabels,
  apiErrorMessage,
  applyMove,
  boardColumns,
  cardsByColumn,
  columnKey,
  columnLabel,
  filterTasks,
  NO_FILTER,
  resolveDrop,
  selectedModuleId,
  sortTasks,
  tasksInModule,
  type BoardStatus,
} from "../client/src/lib/taskBoard.js";

interface Card {
  id: number;
  title: string;
  status: BoardStatus;
  module_id: number;
  column_id: number | null;
  position: number;
  archived: boolean;
  assignee: { id: number; display_name: string } | null;
  labels: string[];
  due_date: string | null;
  updated_at: string;
}

const card = (id: number, status: BoardStatus, position: number, over: Partial<Card> = {}): Card => ({
  id,
  title: `T${id}`,
  status,
  module_id: 1,
  column_id: null,
  position,
  archived: false,
  assignee: null,
  labels: [],
  due_date: null,
  updated_at: "2026-01-01T00:00:00.000Z",
  ...over,
});

const ids = (cards: { id: number }[]): number[] => cards.map((c) => c.id);

const LOCKED = boardColumns([]);
const grouped = (cards: Card[], columns = LOCKED): Map<string, Card[]> => cardsByColumn(cards, columns);
const idsIn = (cards: Card[], key: string, columns = LOCKED): number[] => ids(grouped(cards, columns).get(key) ?? []);

const custom = (id: number, name: string, status: BoardStatus, position: number) => ({ id, name, status, position });

describe("boardColumns", () => {
  it("gives the four locked columns with no custom ones", () => {
    expect(LOCKED.map((c) => [c.key, c.name, c.locked, c.id])).toEqual([
      ["column:todo", "Todo", true, null],
      ["column:doing", "Doing", true, null],
      ["column:review", "Review", true, null],
      ["column:done", "Done", true, null],
    ]);
  });

  it("sorts custom columns around the locked column of their status", () => {
    const columns = boardColumns([
      custom(3, "After", "doing", 1),
      custom(1, "Backlog", "todo", -1),
      custom(2, "Before", "doing", -1),
      custom(4, "Further", "doing", 2),
    ]);
    expect(columns.map((c) => c.name)).toEqual(["Backlog", "Todo", "Before", "Doing", "After", "Further", "Review", "Done"]);
    expect(columns[0]).toMatchObject({ key: "column:c1", id: 1, locked: false, status: "todo" });
  });

  it("labels a custom column with its status for the modal", () => {
    const [backlog, todo] = boardColumns([custom(1, "Backlog", "todo", -1)]);
    expect(columnLabel(backlog)).toBe("Backlog (Todo)");
    expect(columnLabel(todo)).toBe("Todo");
  });

  it("keys a column from a task's status and column id", () => {
    expect(columnKey("review", null)).toBe("column:review");
    expect(columnKey("review", 7)).toBe("column:c7");
  });
});

describe("cardsByColumn", () => {
  it("groups in position order and leaves out archived cards", () => {
    const cards = [card(1, "todo", 2), card(2, "todo", 1), card(3, "done", 1), card(4, "todo", 3, { archived: true })];
    expect(idsIn(cards, "column:todo")).toEqual([2, 1]);
    expect(idsIn(cards, "column:done")).toEqual([3]);
    expect(idsIn(cards, "column:doing")).toEqual([]);
  });

  it("separates a custom column from the locked column of its status", () => {
    const columns = boardColumns([custom(7, "QA", "review", 1)]);
    const cards = [card(1, "review", 1), card(2, "review", 1, { column_id: 7 })];
    expect(idsIn(cards, "column:review", columns)).toEqual([1]);
    expect(idsIn(cards, "column:c7", columns)).toEqual([2]);
  });

  it("shows a card with an unknown column in the locked column, so no card disappears", () => {
    const cards = [card(1, "review", 1, { column_id: 99 })];
    expect(idsIn(cards, "column:review")).toEqual([1]);
  });
});

describe("tasksInModule", () => {
  const cards = [card(1, "todo", 1), card(2, "todo", 1, { module_id: 2 })];

  it("keeps one module's tasks, or all with no module", () => {
    expect(ids(tasksInModule(cards, 2))).toEqual([2]);
    expect(tasksInModule(cards, null)).toBe(cards);
  });
});

describe("selectedModuleId", () => {
  const modules = [{ id: 1 }, { id: 2 }];

  it("uses the requested module when it exists", () => {
    expect(selectedModuleId(modules, 2, "board", null)).toBe(2);
    expect(selectedModuleId(modules, 2, "list", null)).toBe(2);
  });

  it("falls back to the first module on the Board, without an error", () => {
    expect(selectedModuleId(modules, null, "board", null)).toBe(1);
    expect(selectedModuleId(modules, 99, "board", null)).toBe(1);
  });

  it("falls back to All on Tasks and the Calendar", () => {
    expect(selectedModuleId(modules, null, "list", null)).toBeNull();
    expect(selectedModuleId(modules, 99, "calendar", null)).toBeNull();
  });

  it("opens the Board on the module of the open task when the URL names none", () => {
    expect(selectedModuleId(modules, null, "board", 2)).toBe(2);
    expect(selectedModuleId(modules, null, "board", 99)).toBe(1);
    expect(selectedModuleId(modules, 1, "board", 2)).toBe(1);
    expect(selectedModuleId(modules, null, "list", 2)).toBeNull();
  });

  it("has nothing to select before modules load", () => {
    expect(selectedModuleId([], 2, "board", null)).toBeNull();
  });
});

describe("applyMove", () => {
  const board = [card(1, "todo", 1), card(2, "todo", 2), card(3, "doing", 1)];

  it("moves across columns before a card", () => {
    const next = applyMove(board, 1, "doing", null, 3);
    expect(idsIn(next, "column:doing")).toEqual([1, 3]);
    expect(idsIn(next, "column:todo")).toEqual([2]);
    const doing = grouped(next).get("column:doing") ?? [];
    expect(doing.map((c) => c.position)).toEqual([1, 2]);
    expect(doing[0].status).toBe("doing");
  });

  it("moves to the bottom with no target or a target that has left", () => {
    expect(idsIn(applyMove(board, 1, "doing", null, null), "column:doing")).toEqual([3, 1]);
    expect(idsIn(applyMove(board, 1, "doing", null, 2), "column:doing")).toEqual([3, 1]);
  });

  it("reorders within a column", () => {
    expect(idsIn(applyMove(board, 2, "todo", null, 1), "column:todo")).toEqual([2, 1]);
  });

  it("ignores an unknown card", () => {
    expect(applyMove(board, 99, "doing", null, null)).toBe(board);
  });

  it("orders per column: a custom column's cards are not renumbered with the locked column", () => {
    const columns = boardColumns([custom(7, "QA", "review", 1)]);
    const cards = [card(1, "review", 1), card(2, "review", 1, { column_id: 7 }), card(3, "todo", 1)];
    const next = applyMove(cards, 3, "review", 7, 2);
    expect(idsIn(next, "column:c7", columns)).toEqual([3, 2]);
    expect(idsIn(next, "column:review", columns)).toEqual([1]);
    expect(next.find((c) => c.id === 1)?.position).toBe(1);
    expect(next.find((c) => c.id === 3)).toMatchObject({ status: "review", column_id: 7, position: 1 });
  });

  it("leaves another module's cards alone", () => {
    const cards = [card(1, "doing", 1), card(2, "doing", 1, { module_id: 2 }), card(3, "todo", 1)];
    const next = applyMove(cards, 3, "doing", null, null);
    expect(next.find((c) => c.id === 2)?.position).toBe(1);
    expect(next.find((c) => c.id === 3)?.position).toBe(2);
  });
});

describe("resolveDrop", () => {
  const columns = grouped([card(1, "todo", 1), card(2, "todo", 2), card(3, "todo", 3), card(4, "doing", 1)]);

  it("does nothing when dropped on itself", () => {
    expect(resolveDrop(LOCKED, columns, 1, 1)).toBeNull();
  });

  it("goes after the target when moving down a column", () => {
    expect(resolveDrop(LOCKED, columns, 1, 2)).toEqual({ status: "todo", columnId: null, beforeId: 3 });
    expect(resolveDrop(LOCKED, columns, 1, 3)).toEqual({ status: "todo", columnId: null, beforeId: null });
  });

  it("goes before the target when moving up a column", () => {
    expect(resolveDrop(LOCKED, columns, 3, 1)).toEqual({ status: "todo", columnId: null, beforeId: 1 });
  });

  it("goes before the target in another column", () => {
    expect(resolveDrop(LOCKED, columns, 1, 4)).toEqual({ status: "doing", columnId: null, beforeId: 4 });
  });

  it("goes to the bottom when dropped on a column", () => {
    expect(resolveDrop(LOCKED, columns, 1, "column:review")).toEqual({ status: "review", columnId: null, beforeId: null });
  });

  it("names the custom column on a drop into one", () => {
    const withQa = boardColumns([custom(7, "QA", "review", 1)]);
    const cards = grouped([card(1, "todo", 1), card(2, "review", 1, { column_id: 7 })], withQa);
    expect(resolveDrop(withQa, cards, 1, "column:c7")).toEqual({ status: "review", columnId: 7, beforeId: null });
    expect(resolveDrop(withQa, cards, 1, 2)).toEqual({ status: "review", columnId: 7, beforeId: 2 });
  });

  describe("onto a done column", () => {
    const withDone = grouped([card(1, "todo", 1), card(5, "done", 1), card(6, "done", 2), card(7, "done", 3)]);

    it("lands at the top, before the first Done card", () => {
      expect(resolveDrop(LOCKED, withDone, 1, "column:done")).toEqual({ status: "done", columnId: null, beforeId: 5 });
    });

    it("lands with no card to go before when Done is empty", () => {
      expect(resolveDrop(LOCKED, columns, 1, "column:done")).toEqual({ status: "done", columnId: null, beforeId: null });
    });

    it("skips the dragged card when it is itself the first Done card", () => {
      expect(resolveDrop(LOCKED, withDone, 5, "column:done")).toEqual({ status: "done", columnId: null, beforeId: 6 });
    });

    it("treats a custom column of status done the same way", () => {
      const withShipped = boardColumns([custom(8, "Shipped", "done", 1)]);
      const cards = grouped([card(1, "todo", 1), card(2, "done", 1, { column_id: 8 })], withShipped);
      expect(resolveDrop(withShipped, cards, 1, "column:c8")).toEqual({ status: "done", columnId: 8, beforeId: 2 });
    });
  });

  it("does nothing for an unknown target", () => {
    expect(resolveDrop(LOCKED, columns, 1, 99)).toBeNull();
    expect(resolveDrop(LOCKED, columns, 1, "column:nope")).toBeNull();
  });
});

describe("filterTasks", () => {
  const ann = { id: 7, display_name: "Ann" };
  const cards = [card(1, "todo", 1, { assignee: ann, labels: ["api"] }), card(2, "todo", 2, { labels: ["ui"] })];

  it("returns everything with no filter", () => {
    expect(filterTasks(cards, NO_FILTER)).toBe(cards);
  });

  it("filters by assignee, unassigned and label", () => {
    expect(ids(filterTasks(cards, { ...NO_FILTER, assigneeId: 7 }))).toEqual([1]);
    expect(ids(filterTasks(cards, { ...NO_FILTER, assigneeId: "none" }))).toEqual([2]);
    expect(ids(filterTasks(cards, { ...NO_FILTER, label: "ui" }))).toEqual([2]);
  });

  it("collects the choices for its controls", () => {
    expect(allLabels(cards)).toEqual(["api", "ui"]);
    expect(allAssignees(cards)).toEqual([ann]);
  });
});

describe("sortTasks", () => {
  const cards = [
    card(1, "done", 1, { title: "b", due_date: null }),
    card(2, "todo", 1, { title: "a", due_date: "2026-02-01" }),
    card(3, "doing", 1, { title: "c", due_date: "2026-01-01" }),
  ];

  it("sorts by status in board order", () => {
    expect(ids(sortTasks(cards, "status", "asc"))).toEqual([2, 3, 1]);
  });

  it("sorts by title, and reverses", () => {
    expect(ids(sortTasks(cards, "title", "asc"))).toEqual([2, 1, 3]);
    expect(ids(sortTasks(cards, "title", "desc"))).toEqual([3, 1, 2]);
  });

  it("keeps tasks without a due date last in both directions", () => {
    expect(ids(sortTasks(cards, "due_date", "asc"))).toEqual([3, 2, 1]);
    expect(ids(sortTasks(cards, "due_date", "desc"))).toEqual([2, 3, 1]);
  });

  it("does not change its input", () => {
    const copy = [...cards];
    sortTasks(cards, "title", "asc");
    expect(cards).toEqual(copy);
  });
});

describe("apiErrorMessage", () => {
  it("prefers the server's message", () => {
    expect(apiErrorMessage({ status: 409, data: { error: "STALE: changed" } }, "Failed")).toBe("STALE: changed");
    expect(apiErrorMessage(new Error("boom"), "Failed")).toBe("Failed");
  });
});
