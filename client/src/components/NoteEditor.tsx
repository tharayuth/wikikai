import { useEffect, useRef, useState } from "react";
import { useAppDispatch } from "../store";
import { showToast } from "../store/uiSlice";
import { useGetNoteQuery, useUpdateNoteMutation, type Note, type NoteColor } from "../store/api";
import { apiErrorMessage } from "../lib/taskBoard";
import { adoptsServerCopy, changedElsewhere } from "../lib/taskDraft";
import {
  NOTE_COLORS,
  bodyFromItems,
  checklistSplit,
  isBlankDraft,
  itemsFromBody,
  noteDraftOf,
  notePatch,
  type NoteDraft,
  type NoteItemDraft,
} from "../lib/notes";
import { useBackdropClose } from "../hooks/useBackdropClose";

/** How long typing has to pause before it saves. */
const AUTOSAVE_MS = 800;

const COLOR_NAMES: Record<NoteColor, string> = {
  default: "Default",
  red: "Red",
  amber: "Amber",
  green: "Green",
  cyan: "Cyan",
  blue: "Blue",
  purple: "Purple",
};

const ICONS = {
  pin: "M12 17v5M9 3h6l-1 7 3 3v2H7v-2l3-3-1-7z",
  palette: "M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-1-2 0-3 2-1 4-1 3-1.5 3-3.5C21 6.5 17 3 12 3zM7.5 12h.01M9.5 7.5h.01M14.5 7.5h.01",
  archive: "M3 5h18v4H3zM5 9v10h14V9M10 13h4",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5",
  restore: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5",
  check: "M9 11l3 3 8-8M20 12v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h11",
} as const;

export function NoteIcon({ name }: { name: keyof typeof ICONS }): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICONS[name]} />
    </svg>
  );
}

/** A palette button and its swatches. */
export function NotePalette({ color, onPick }: { color: NoteColor; onPick: (color: NoteColor) => void }): JSX.Element {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="note-palette" ref={root}>
      <button
        type="button"
        className="note-tool"
        title="Colour"
        aria-label="Colour"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <NoteIcon name="palette" />
      </button>
      {open && (
        <div className="note-palette-swatches" onClick={(e) => e.stopPropagation()}>
          {NOTE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`note-swatch color-${c}${c === color ? " selected" : ""}`}
              title={COLOR_NAMES[c]}
              aria-label={COLOR_NAMES[c]}
              aria-pressed={c === color}
              onClick={() => {
                setOpen(false);
                onPick(c);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

let nextRowKey = 1;

/** The rows of a checklist: open items, then the ticked ones under a count. */
export function ChecklistEditor({
  items,
  disabled,
  onChange,
}: {
  items: NoteItemDraft[];
  disabled: boolean;
  onChange: (items: NoteItemDraft[]) => void;
}): JSX.Element {
  const [focusKey, setFocusKey] = useState<number | null>(null);
  const rows = items.map((item, index) => ({ ...item, index }));
  const { open, checked } = checklistSplit(rows);

  const update = (index: number, change: Partial<NoteItemDraft>): void => {
    onChange(items.map((item, i) => (i === index ? { ...item, ...change } : item)));
  };

  const addAfter = (index: number, text = ""): void => {
    const key = nextRowKey++;
    onChange([...items.slice(0, index + 1), { key, text, checked: false }, ...items.slice(index + 1)]);
    setFocusKey(key);
  };

  const renderRow = (row: NoteItemDraft & { index: number }): JSX.Element => {
    const rowKey = row.id ?? row.key ?? row.index;
    return (
      <li key={rowKey} className={row.checked ? "note-item checked" : "note-item"}>
        <input
          type="checkbox"
          checked={row.checked}
          disabled={disabled}
          aria-label={`Tick ${row.text || "this item"}`}
          onChange={(e) => update(row.index, { checked: e.target.checked })}
        />
        <input
          type="text"
          value={row.text}
          maxLength={1000}
          disabled={disabled}
          aria-label="List item"
          autoFocus={row.key !== undefined && row.key === focusKey}
          // Browsers focus at the start. A row made by typing into "+ List item"
          // already holds that letter, and the next one must follow it.
          onFocus={(e) => e.target.setSelectionRange(e.target.value.length, e.target.value.length)}
          onChange={(e) => update(row.index, { text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addAfter(row.index);
            } else if (e.key === "Backspace" && row.text === "") {
              e.preventDefault();
              onChange(items.filter((_, i) => i !== row.index));
            }
          }}
        />
        {!disabled && (
          <button
            type="button"
            className="note-item-remove"
            aria-label={`Remove ${row.text || "this item"}`}
            onClick={() => onChange(items.filter((_, i) => i !== row.index))}
          >
            ×
          </button>
        )}
      </li>
    );
  };

  return (
    <div className="note-checklist">
      <ul>{open.map(renderRow)}</ul>
      {!disabled && (
        <input
          type="text"
          className="note-item-new"
          placeholder="+ List item"
          aria-label="New list item"
          value=""
          onChange={(e) => addAfter(items.length - 1, e.target.value)}
        />
      )}
      {checked.length > 0 && (
        <>
          <p className="note-checked-count">
            {checked.length} ticked item{checked.length === 1 ? "" : "s"}
          </p>
          <ul>{checked.map(renderRow)}</ul>
        </>
      )}
    </div>
  );
}

interface ModalProps {
  noteId: number;
  projectId: number;
  onClose: () => void;
}

/**
 * One note open for editing, by `?note=<id>`. Mount it with `key={noteId}`.
 *
 * Content saves itself shortly after typing stops, and again on closing. `base` is
 * the server copy the draft started from, and the version it holds is sent with each
 * save, so a change made elsewhere stops the autosave and asks instead of being
 * overwritten. Colour, pin and archive apply at once and need no version.
 */
export function NoteModal({ noteId, projectId, onClose }: ModalProps): JSX.Element {
  const dispatch = useAppDispatch();
  const query = useGetNoteQuery(noteId);
  const [updateNote] = useUpdateNoteMutation();
  const [base, setBase] = useState<Note | null>(null);
  const [draft, setDraft] = useState<NoteDraft | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);

  const latest = useRef({ base, draft, conflict });
  latest.current = { base, draft, conflict };
  const inFlight = useRef<Promise<boolean> | null>(null);

  const note = query.data?.note;
  const readOnly = !query.data?.can_edit || note?.trashed === true;
  const pending = base && draft ? notePatch(draft, base) : null;
  const stale = conflict || (base !== null && changedElsewhere(pending !== null, base.version, note?.version));
  const loadStatus = (query.error as { status?: number } | undefined)?.status;

  useEffect(() => {
    if (!note || !adoptsServerCopy(pending !== null, base?.version ?? null, note.version)) return;
    setBase(note);
    setDraft(noteDraftOf(note));
    setConflict(false);
  }, [note, pending, base?.version]);

  const toastError = (fallback: string) => (err: unknown) => {
    dispatch(showToast({ message: apiErrorMessage(err, fallback), kind: "error" }));
  };

  /** Save whatever is unsaved now. One save runs at a time; resolves false when
   *  the content could not be saved. */
  const save = (): Promise<boolean> => {
    if (inFlight.current) return inFlight.current;
    const { base: b, draft: d, conflict: c } = latest.current;
    const patch = b && d ? notePatch(d, b) : null;
    if (!b || !patch) return Promise.resolve(true);
    if (c) return Promise.resolve(false);
    setSaving(true);
    const run = updateNote({ id: noteId, projectId, patch: { expected_version: b.version, ...patch } })
      .unwrap()
      .then((next) => {
        // The base moves on and the draft stays, so what was typed while this
        // was in flight remains unsaved and goes out with the next save. The ref
        // moves now: a close waiting on this save reads it before React renders.
        latest.current = { ...latest.current, base: next };
        setBase(next);
        return true;
      })
      .catch((err: unknown) => {
        if ((err as { status?: number }).status === 409) setConflict(true);
        else toastError("Could not save the note")(err);
        return false;
      })
      .finally(() => {
        inFlight.current = null;
        setSaving(false);
      });
    inFlight.current = run;
    return run;
  };

  useEffect(() => {
    if (!pending || stale || readOnly) return;
    const timer = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(timer);
    // `save` reads the latest state through a ref, so only these restart the wait.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, base, stale, readOnly]);

  useEffect(() => {
    if (!pending) return;
    const warn = (e: BeforeUnloadEvent): void => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);

  const requestClose = async (): Promise<void> => {
    if (readOnly) {
      onClose();
      return;
    }
    if (latest.current.conflict || stale) {
      if (!window.confirm("Discard your unsaved changes to this note?")) return;
      onClose();
      return;
    }
    // A save already running does not carry the last keystrokes, so wait for it
    // and save again.
    if (inFlight.current) await inFlight.current;
    if (!(await save())) return;
    const { draft: d, base: b } = latest.current;
    if (d && b && isBlankDraft(d) && !b.trashed) {
      await updateNote({ id: noteId, projectId, patch: { trashed: true } })
        .unwrap()
        .then(() => dispatch(showToast({ message: "Empty note moved to the trash", kind: "info" })))
        .catch(toastError("Could not remove the empty note"));
    }
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") void requestClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const discard = (): void => {
    if (!note) return;
    setBase(note);
    setDraft(noteDraftOf(note));
    setConflict(false);
  };

  const set = <K extends keyof NoteDraft>(key: K, value: NoteDraft[K]): void => {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  };

  const applyLooks = (patch: { color?: NoteColor; pinned?: boolean; archived?: boolean; trashed?: boolean }): void => {
    void updateNote({ id: noteId, projectId, patch }).unwrap().catch(toastError("Could not change the note"));
  };

  const toggleChecklist = (): void => {
    setDraft((d) => {
      if (!d) return d;
      return d.items === null
        ? { ...d, body: "", items: itemsFromBody(d.body).map((i) => ({ ...i, key: nextRowKey++ })) }
        : { ...d, items: null, body: bodyFromItems(d.items) };
    });
  };

  const color = note?.color ?? "default";

  const backdrop = useBackdropClose(() => void requestClose());

  return (
    <div className="modal-backdrop show" {...backdrop}>
      <div
        className={`modal note-modal color-${color}`}
        role="dialog"
        aria-modal="true"
        aria-label="Note"
        onClick={(e) => e.stopPropagation()}
      >
        {loadStatus === 404 ? (
          <div className="note-modal-body">
            <p>Note not found. It may have been deleted.</p>
            <div className="note-modal-actions">
              <span className="note-modal-spacer" />
              <button type="button" className="note-close" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        ) : query.error && !base ? (
          <div className="note-modal-body">
            <p>Could not load this note.</p>
            <div className="note-modal-actions">
              <span className="note-modal-spacer" />
              <button type="button" className="note-close" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        ) : !draft || !base || !note ? (
          <div className="note-modal-body">
            <p>Loading…</p>
          </div>
        ) : (
          <div className="note-modal-body">
            {stale && (
              <div className="task-modal-stale" role="alert">
                <span>
                  This note changed elsewhere, so saving has stopped. Your text is still here. Copy anything you need,
                  then load the latest version.
                </span>
                <button type="button" onClick={discard}>
                  Load latest
                </button>
              </div>
            )}
            {note.trashed && <p className="note-trashed-hint">In the trash. Restore it to edit.</p>}
            <div className="note-modal-title">
              <input
                type="text"
                value={draft.title}
                maxLength={300}
                placeholder="Title"
                aria-label="Title"
                disabled={readOnly}
                onChange={(e) => set("title", e.target.value)}
              />
              {!readOnly && (
                <button
                  type="button"
                  className={`note-tool${note.pinned ? " active" : ""}`}
                  title={note.pinned ? "Unpin" : "Pin"}
                  aria-label={note.pinned ? "Unpin" : "Pin"}
                  aria-pressed={note.pinned}
                  onClick={() => applyLooks({ pinned: !note.pinned })}
                >
                  <NoteIcon name="pin" />
                </button>
              )}
            </div>
            {draft.items === null ? (
              <textarea
                value={draft.body}
                maxLength={20000}
                rows={8}
                placeholder="Take a note…"
                aria-label="Note text"
                disabled={readOnly}
                onChange={(e) => set("body", e.target.value)}
              />
            ) : (
              <ChecklistEditor items={draft.items} disabled={readOnly} onChange={(items) => set("items", items)} />
            )}
            <label className="note-labels-field">
              Labels
              <input
                type="text"
                value={draft.labels}
                placeholder="Comma-separated"
                disabled={readOnly}
                onChange={(e) => set("labels", e.target.value)}
              />
            </label>
            <div className="note-modal-actions">
              {!readOnly && (
                <>
                  <NotePalette color={color} onPick={(c) => applyLooks({ color: c })} />
                  <button
                    type="button"
                    className="note-tool"
                    title={draft.items === null ? "Show checkboxes" : "Hide checkboxes"}
                    aria-label={draft.items === null ? "Show checkboxes" : "Hide checkboxes"}
                    onClick={toggleChecklist}
                  >
                    <NoteIcon name="check" />
                  </button>
                  <button
                    type="button"
                    className="note-tool"
                    title={note.archived ? "Unarchive" : "Archive"}
                    aria-label={note.archived ? "Unarchive" : "Archive"}
                    onClick={() => applyLooks({ archived: !note.archived })}
                  >
                    <NoteIcon name="archive" />
                  </button>
                  <button
                    type="button"
                    className="note-tool"
                    title="Move to trash"
                    aria-label="Move to trash"
                    onClick={() => {
                      // Saved first: a trashed note refuses edits, and restoring
                      // it should bring back the last thing typed.
                      void save().then(() => {
                        applyLooks({ trashed: true });
                        onClose();
                      });
                    }}
                  >
                    <NoteIcon name="trash" />
                  </button>
                </>
              )}
              <span className="note-modal-spacer" />
              <span className="note-saved" aria-live="polite">
                {saving ? "Saving…" : pending ? "" : `Edited ${note.updated_at.slice(0, 10)}`}
              </span>
              <button type="button" className="note-close" onClick={() => void requestClose()}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
