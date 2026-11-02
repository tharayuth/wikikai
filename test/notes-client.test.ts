import { describe, expect, it } from "vitest";
import {
  allNoteLabels,
  applyNoteMove,
  bodyFromItems,
  checklistSplit,
  filterNotes,
  isBlankDraft,
  itemsFromBody,
  linkParts,
  masonrySpan,
  noteDraftOf,
  noteDropBefore,
  notePatch,
  noteSections,
} from "../client/src/lib/notes.js";

interface N {
  id: number;
  title: string;
  body: string;
  items: { id: number; text: string; checked: boolean }[] | null;
  labels: string[];
  pinned: boolean;
  position: number;
  version: number;
}

const note = (id: number, over: Partial<N> = {}): N => ({
  id,
  title: `Note ${id}`,
  body: "",
  items: null,
  labels: [],
  pinned: false,
  position: id,
  version: 1,
  ...over,
});

const ids = (rows: { id: number }[]): number[] => rows.map((r) => r.id);

describe("noteSections", () => {
  it("splits pinned from the rest, in position order", () => {
    const { pinned, others } = noteSections([
      note(1, { position: 5 }),
      note(2, { pinned: true, position: 2 }),
      note(3, { position: 1 }),
      note(4, { pinned: true, position: 1 }),
    ]);
    expect(ids(pinned)).toEqual([4, 2]);
    expect(ids(others)).toEqual([3, 1]);
  });
});

describe("filterNotes", () => {
  const rows = [
    note(1, { title: "Shopping", items: [{ id: 1, text: "Milk", checked: false }], labels: ["home"] }),
    note(2, { title: "Plan", body: "Ship the BOARD", labels: ["work"] }),
  ];

  it("returns the same list with nothing to filter by", () => {
    expect(filterNotes(rows, "  ", null)).toBe(rows);
  });

  it("matches title, body, list items and labels, ignoring case", () => {
    expect(ids(filterNotes(rows, "shop", null))).toEqual([1]);
    expect(ids(filterNotes(rows, "board", null))).toEqual([2]);
    expect(ids(filterNotes(rows, "milk", null))).toEqual([1]);
    expect(ids(filterNotes(rows, "WORK", null))).toEqual([2]);
  });

  it("narrows by an exact label", () => {
    expect(ids(filterNotes(rows, "", "home"))).toEqual([1]);
    expect(ids(filterNotes(rows, "board", "home"))).toEqual([]);
  });

  it("collects the labels for its chips", () => {
    expect(allNoteLabels(rows)).toEqual(["home", "work"]);
  });
});

describe("checklist conversion", () => {
  it("turns each line of text into an item, dropping blanks", () => {
    expect(itemsFromBody("Milk\n\n  Eggs  \n")).toEqual([
      { text: "Milk", checked: false },
      { text: "Eggs", checked: false },
    ]);
  });

  it("turns items back into lines, open ones first", () => {
    expect(
      bodyFromItems([
        { text: "Done", checked: true },
        { text: "Open", checked: false },
      ]),
    ).toBe("Open\nDone");
  });

  it("splits a list into open and checked, keeping each one's order", () => {
    const { open, checked } = checklistSplit([
      { id: 1, text: "A", checked: true },
      { id: 2, text: "B", checked: false },
      { id: 3, text: "C", checked: true },
    ]);
    expect(ids(open)).toEqual([2]);
    expect(ids(checked)).toEqual([1, 3]);
  });
});

describe("the editor's draft", () => {
  const base = note(1, { title: "T", body: "B", labels: ["a", "b"] });

  it("turns a note into form values", () => {
    expect(noteDraftOf(base)).toEqual({ title: "T", body: "B", items: null, labels: "a, b" });
  });

  it("has nothing to send when nothing changed", () => {
    expect(notePatch(noteDraftOf(base), base)).toBeNull();
  });

  it("sends only the fields that changed", () => {
    expect(notePatch({ ...noteDraftOf(base), body: "New" }, base)).toEqual({ body: "New" });
    expect(notePatch({ ...noteDraftOf(base), labels: "a" }, base)).toEqual({ labels: ["a"] });
  });

  it("trims a title before comparing, so a trailing space is not a change", () => {
    expect(notePatch({ ...noteDraftOf(base), title: "T " }, base)).toBeNull();
  });

  it("compares items by text and tick, so a new row's missing id cannot save forever", () => {
    const list = note(1, { items: [{ id: 5, text: "Milk", checked: false }] });
    expect(notePatch({ ...noteDraftOf(list), items: [{ text: "Milk", checked: false }] }, list)).toBeNull();
    expect(notePatch({ ...noteDraftOf(list), items: [{ text: "Milk", checked: false }, { text: " ", checked: false }] }, list)).toBeNull();
    expect(notePatch({ ...noteDraftOf(list), items: [{ id: 5, text: "Milk", checked: true }] }, list)).toEqual({
      items: [{ id: 5, text: "Milk", checked: true }],
    });
  });

  it("sends null to turn a checklist back into text", () => {
    const list = note(1, { items: [{ id: 5, text: "Milk", checked: false }] });
    expect(notePatch({ ...noteDraftOf(list), items: null, body: "Milk" }, list)).toEqual({ items: null, body: "Milk" });
  });

  it("knows a blank draft", () => {
    expect(isBlankDraft({ title: " ", body: "\n", items: null, labels: "" })).toBe(true);
    expect(isBlankDraft({ title: " ", body: "", items: [{ text: " ", checked: false }], labels: "" })).toBe(true);
    expect(isBlankDraft({ title: "T", body: "", items: null, labels: "" })).toBe(false);
    expect(isBlankDraft({ title: "", body: "", items: [{ text: "x", checked: false }], labels: "" })).toBe(false);
  });
});

describe("linkParts", () => {
  it("links http and https only, leaving the rest as text", () => {
    expect(linkParts("see https://a.test/x, or javascript:alert(1)")).toEqual([
      { text: "see " },
      { text: "https://a.test/x", href: "https://a.test/x" },
      { text: ", or javascript:alert(1)" },
    ]);
  });

  it("returns plain text whole", () => {
    expect(linkParts("no links")).toEqual([{ text: "no links" }]);
  });
});

describe("dragging notes", () => {
  it("lands after the target moving forward, and before it moving back", () => {
    expect(noteDropBefore([1, 2, 3], 1, 2)).toBe(3);
    expect(noteDropBefore([1, 2, 3], 1, 3)).toBeNull();
    expect(noteDropBefore([1, 2, 3], 3, 1)).toBe(1);
  });

  it("does nothing on itself or a target in the other section", () => {
    expect(noteDropBefore([1, 2], 1, 1)).toBeUndefined();
    expect(noteDropBefore([1, 2], 1, 9)).toBeUndefined();
  });

  it("shows the move at once, within the note's own section", () => {
    const rows = [note(1, { position: 1 }), note(2, { position: 2 }), note(3, { pinned: true, position: 1 })];
    const next = noteSections(applyNoteMove(rows, 2, 1));
    expect(ids(next.others)).toEqual([2, 1]);
    expect(ids(next.pinned)).toEqual([3]);
    expect(applyNoteMove(rows, 99, null)).toBe(rows);
  });
});

describe("masonrySpan", () => {
  it("covers the card and the gap in whole grid rows", () => {
    expect(masonrySpan(100, 8, 12)).toBe(14);
    expect(masonrySpan(0, 8, 12)).toBe(2);
  });
});
