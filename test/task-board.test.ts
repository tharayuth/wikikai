import { describe, expect, it } from "vitest";
import {
  allAssignees,
  allLabels,
  apiErrorMessage,
  applyMove,
  columnsOf,
  filterTasks,
  NO_FILTER,
  resolveDrop,
  sortTasks,
  type BoardStatus,
} from "../client/src/lib/taskBoard.js";

interface Card {
  id: number;
  title: string;
  status: BoardStatus;
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
  position,
  archived: false,
  assignee: null,
  labels: [],
  due_date: null,
  updated_at: "2026-01-01T00:00:00.000Z",
  ...over,
});

const ids = (cards: { id: number }[]): number[] => cards.map((c) => c.id);

describe("columnsOf", () => {
  it("groups by status in position order and leaves out archived cards", () => {
    const columns = columnsOf([
      card(1, "todo", 2),
      card(2, "todo", 1),
      card(3, "done", 1),
      card(4, "todo", 3, { archived: true }),
    ]);
    expect(ids(columns.todo)).toEqual([2, 1]);
    expect(ids(columns.done)).toEqual([3]);
    expect(columns.doing).toEqual([]);
  });
});

describe("applyMove", () => {
  const board = [card(1, "todo", 1), card(2, "todo", 2), card(3, "doing", 1)];

  it("moves across columns before a card", () => {
    const next = columnsOf(applyMove(board, 1, "doing", 3));
    expect(ids(next.doing)).toEqual([1, 3]);
    expect(ids(next.todo)).toEqual([2]);
    expect(next.doing.map((c) => c.position)).toEqual([1, 2]);
    expect(next.doing[0].status).toBe("doing");
  });

  it("moves to the bottom with no target or a target that has left", () => {
    expect(ids(columnsOf(applyMove(board, 1, "doing", null)).doing)).toEqual([3, 1]);
    expect(ids(columnsOf(applyMove(board, 1, "doing", 2)).doing)).toEqual([3, 1]);
  });

  it("reorders within a column", () => {
    expect(ids(columnsOf(applyMove(board, 2, "todo", 1)).todo)).toEqual([2, 1]);
  });

  it("ignores an unknown card", () => {
    expect(applyMove(board, 99, "doing", null)).toBe(board);
  });
});

describe("resolveDrop", () => {
  const columns = columnsOf([card(1, "todo", 1), card(2, "todo", 2), card(3, "todo", 3), card(4, "doing", 1)]);

  it("does nothing when dropped on itself", () => {
    expect(resolveDrop(columns, 1, 1)).toBeNull();
  });

  it("goes after the target when moving down a column", () => {
    expect(resolveDrop(columns, 1, 2)).toEqual({ status: "todo", beforeId: 3 });
    expect(resolveDrop(columns, 1, 3)).toEqual({ status: "todo", beforeId: null });
  });

  it("goes before the target when moving up a column", () => {
    expect(resolveDrop(columns, 3, 1)).toEqual({ status: "todo", beforeId: 1 });
  });

  it("goes before the target in another column", () => {
    expect(resolveDrop(columns, 1, 4)).toEqual({ status: "doing", beforeId: 4 });
  });

  it("goes to the bottom when dropped on a column", () => {
    expect(resolveDrop(columns, 1, "column:review")).toEqual({ status: "review", beforeId: null });
  });

  it("does nothing for an unknown target", () => {
    expect(resolveDrop(columns, 1, 99)).toBeNull();
    expect(resolveDrop(columns, 1, "column:nope")).toBeNull();
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
