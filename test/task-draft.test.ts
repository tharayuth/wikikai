import { describe, expect, it } from "vitest";
import { adoptsServerCopy, changedElsewhere, draftAfterSave, draftOf, patchFrom } from "../client/src/lib/taskDraft.js";

const task = {
  title: "T",
  description: "Body",
  status: "todo" as const,
  module_id: 1,
  column_id: null,
  assignee: { id: 7, display_name: "Ann" },
  start_date: "2026-11-01",
  due_date: null,
  labels: ["api", "ui"],
  session_id: null,
  blocked_reason: "waiting",
};

describe("placement in the draft", () => {
  it("sends only the module and column that changed", () => {
    expect(patchFrom({ ...draftOf(task), module_id: 2 }, task)).toEqual({ module_id: 2 });
    expect(patchFrom({ ...draftOf(task), column_id: 7, status: "review" }, task)).toEqual({
      column_id: 7,
      status: "review",
    });
  });

  it("sends an explicit null to leave a custom column", () => {
    const inColumn = { ...task, column_id: 7 };
    expect(patchFrom({ ...draftOf(inColumn), column_id: null }, inColumn)).toEqual({ column_id: null });
  });
});

describe("draftOf", () => {
  it("turns nulls and lists into form values", () => {
    expect(draftOf(task)).toEqual({
      title: "T",
      description: "Body",
      status: "todo",
      module_id: 1,
      column_id: null,
      assignee_id: 7,
      start_date: "2026-11-01",
      due_date: "",
      labels: "api, ui",
      session_id: "",
      blocked_reason: "waiting",
    });
  });
});

describe("patchFrom", () => {
  it("returns null when nothing changed", () => {
    expect(patchFrom(draftOf(task), task)).toBeNull();
  });

  it("sends only what changed", () => {
    expect(patchFrom({ ...draftOf(task), title: "New" }, task)).toEqual({ title: "New" });
  });

  it("does not resend an assignee who was left alone", () => {
    expect(patchFrom({ ...draftOf(task), description: "New" }, task)).not.toHaveProperty("assignee_id");
  });

  it("turns emptied fields into null", () => {
    expect(
      patchFrom({ ...draftOf(task), start_date: "", blocked_reason: "  ", assignee_id: null }, task),
    ).toEqual({ start_date: null, blocked_reason: null, assignee_id: null });
  });

  it("compares labels as a list, ignoring spacing", () => {
    expect(patchFrom({ ...draftOf(task), labels: "api,ui" }, task)).toBeNull();
    expect(patchFrom({ ...draftOf(task), labels: "api" }, task)).toEqual({ labels: ["api"] });
    expect(patchFrom({ ...draftOf(task), labels: " " }, task)).toEqual({ labels: [] });
  });

  it("ignores whitespace around the title", () => {
    expect(patchFrom({ ...draftOf(task), title: "  T " }, task)).toBeNull();
  });
});

describe("changedElsewhere", () => {
  it("flags new versions only when there are unsaved edits to protect", () => {
    expect(changedElsewhere(true, 2, 3)).toBe(true);
    expect(changedElsewhere(false, 2, 3)).toBe(false);
    expect(changedElsewhere(true, 3, 3)).toBe(false);
    expect(changedElsewhere(true, 3, undefined)).toBe(false);
  });

  it("ignores an older cached copy, as seen right after a save", () => {
    expect(changedElsewhere(true, 3, 2)).toBe(false);
  });
});

describe("adoptsServerCopy", () => {
  it("loads the first copy", () => {
    expect(adoptsServerCopy(false, null, 1)).toBe(true);
  });

  it("loads a newer copy when there are no unsaved edits", () => {
    expect(adoptsServerCopy(false, 2, 3)).toBe(true);
  });

  it("does not rewrite a draft that has returned to clean on a same-version copy", () => {
    expect(adoptsServerCopy(false, 3, 3)).toBe(false);
  });

  it("refuses the older cached copy right after a save", () => {
    expect(adoptsServerCopy(false, 3, 2)).toBe(false);
  });

  it("refuses any copy over unsaved edits", () => {
    expect(adoptsServerCopy(true, 2, 3)).toBe(false);
  });
});

describe("draftAfterSave", () => {
  const saved = { ...task, title: "Saved", description: "Saved body" };

  it("takes the saved copy when nothing was typed during the request", () => {
    const submitted = { ...draftOf(task), title: " Saved " };
    expect(draftAfterSave(submitted, submitted, saved)).toEqual(draftOf(saved));
  });

  it("keeps what is on screen when the person kept typing", () => {
    const submitted = { ...draftOf(task), title: "Saved" };
    const typed = { ...submitted, description: "More words, typed while saving" };
    expect(draftAfterSave(typed, submitted, saved)).toBe(typed);
  });

  it("keeps a lookalike draft too: only the same object counts as untouched", () => {
    const submitted = draftOf(task);
    const copy = { ...submitted };
    expect(draftAfterSave(copy, submitted, saved)).toBe(copy);
  });

  it("leaves the typed edits unsaved against the new base", () => {
    const submitted = { ...draftOf(task), title: "Saved" };
    const typed = { ...submitted, description: "More words" };
    const kept = draftAfterSave(typed, submitted, saved);
    expect(patchFrom(kept, saved)).toEqual({ description: "More words" });
  });
});
