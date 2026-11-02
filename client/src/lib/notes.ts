/**
 * Note logic with no React or store imports, so the server's test run can
 * exercise it (as with taskBoard.ts). Types are structural for the same reason.
 */

export const NOTE_COLORS = ["default", "red", "amber", "green", "cyan", "blue", "purple"] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

export interface NoteItemDraft {
  id?: number;
  /** Stands in for the id as a React key until the server assigns one. */
  key?: number;
  text: string;
  checked: boolean;
}

export interface NoteDraft {
  title: string;
  body: string;
  items: NoteItemDraft[] | null;
  labels: string;
}

export interface NoteDraftPatch {
  title?: string;
  body?: string;
  items?: { id?: number; text: string; checked: boolean }[] | null;
  labels?: string[];
}

interface DraftableNote {
  title: string;
  body: string;
  items: { id: number; text: string; checked: boolean }[] | null;
  labels: string[];
}

const byPosition = <T extends { id: number; position: number }>(a: T, b: T): number =>
  a.position - b.position || a.id - b.id;

export function noteSections<T extends { id: number; pinned: boolean; position: number }>(
  notes: T[],
): { pinned: T[]; others: T[] } {
  const sorted = [...notes].sort(byPosition);
  return { pinned: sorted.filter((n) => n.pinned), others: sorted.filter((n) => !n.pinned) };
}

export function filterNotes<T extends DraftableNote>(notes: T[], query: string, label: string | null): T[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q && label === null) return notes;
  return notes.filter((n) => {
    if (label !== null && !n.labels.includes(label)) return false;
    if (!q) return true;
    const haystack = [n.title, n.body, ...(n.items ?? []).map((i) => i.text), ...n.labels];
    return haystack.some((text) => text.toLocaleLowerCase().includes(q));
  });
}

export function allNoteLabels(notes: { labels: string[] }[]): string[] {
  return [...new Set(notes.flatMap((n) => n.labels))].sort((a, b) => a.localeCompare(b));
}

/** "Show checkboxes": each line becomes an item. */
export function itemsFromBody(body: string): { text: string; checked: boolean }[] {
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text) => ({ text, checked: false }));
}

/** "Hide checkboxes": open items first, as the list shows them. */
export function bodyFromItems(items: { text: string; checked: boolean }[]): string {
  return [...items.filter((i) => !i.checked), ...items.filter((i) => i.checked)].map((i) => i.text).join("\n");
}

export function checklistSplit<T extends { checked: boolean }>(items: T[]): { open: T[]; checked: T[] } {
  return { open: items.filter((i) => !i.checked), checked: items.filter((i) => i.checked) };
}

export function noteDraftOf(note: DraftableNote): NoteDraft {
  return {
    title: note.title,
    body: note.body,
    items: note.items ? note.items.map((i) => ({ ...i })) : null,
    labels: note.labels.join(", "),
  };
}

const parseLabels = (value: string): string[] =>
  value
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean);

const filledItems = (items: NoteItemDraft[]): { id?: number; text: string; checked: boolean }[] =>
  items
    .map((i) => ({ ...(i.id !== undefined ? { id: i.id } : {}), text: i.text.trim(), checked: i.checked }))
    .filter((i) => i.text);

/** Text and tick only: a row added here has no id until the server gives it one,
 *  and comparing ids would make that row look unsaved forever. */
const itemsKey = (items: { text: string; checked: boolean }[] | null): string | null =>
  items === null ? null : JSON.stringify(items.map((i) => [i.text.trim(), i.checked]));

/** The content that differs from `base`, or null when there is nothing to save. */
export function notePatch(draft: NoteDraft, base: DraftableNote): NoteDraftPatch | null {
  const patch: NoteDraftPatch = {};
  const title = draft.title.trim();
  if (title !== base.title) patch.title = title;
  if (draft.body !== base.body) patch.body = draft.body;
  const items = draft.items === null ? null : filledItems(draft.items);
  if (itemsKey(items) !== itemsKey(base.items)) patch.items = items;
  const labels = parseLabels(draft.labels);
  if (labels.join(",") !== base.labels.join(",")) patch.labels = labels;
  return Object.keys(patch).length > 0 ? patch : null;
}

export function isBlankDraft(draft: NoteDraft): boolean {
  return !draft.title.trim() && !draft.body.trim() && !(draft.items ?? []).some((i) => i.text.trim());
}

/** Text with its http(s) links marked. Nothing else becomes a link, so a
 *  `javascript:` in a note stays text. */
export function linkParts(text: string): { text: string; href?: string }[] {
  const parts: { text: string; href?: string }[] = [];
  let at = 0;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/g)) {
    const href = match[0].replace(/[.,;:!?)]+$/, "");
    const start = match.index;
    if (start > at) parts.push({ text: text.slice(at, start) });
    parts.push({ text: href, href });
    at = start + href.length;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}

/** The note to land before, null for the end, or undefined for no move. Moving
 *  forward lands after the note under the pointer. */
export function noteDropBefore(ids: number[], activeId: number, overId: number): number | null | undefined {
  if (activeId === overId) return undefined;
  const activeIndex = ids.indexOf(activeId);
  const overIndex = ids.indexOf(overId);
  if (activeIndex < 0 || overIndex < 0) return undefined;
  return activeIndex < overIndex ? ids[overIndex + 1] ?? null : overId;
}

/** The grid after a drop, shown at once while the server confirms. */
export function applyNoteMove<T extends { id: number; pinned: boolean; position: number }>(
  notes: T[],
  id: number,
  beforeId: number | null,
): T[] {
  const moved = notes.find((n) => n.id === id);
  if (!moved) return notes;
  const section = notes.filter((n) => n.pinned === moved.pinned && n.id !== id).sort(byPosition);
  const at = beforeId === null ? -1 : section.findIndex((n) => n.id === beforeId);
  section.splice(at < 0 ? section.length : at, 0, moved);
  const renumbered = new Map(section.map((n, i) => [n.id, { ...n, position: i + 1 }]));
  return notes.map((n) => renumbered.get(n.id) ?? n);
}

/** Grid rows a card needs, for the masonry layout: fixed small rows, with each
 *  card spanning as many as its real height plus the gap. */
export function masonrySpan(height: number, rowHeight: number, gap: number): number {
  return Math.ceil((height + gap) / rowHeight);
}
