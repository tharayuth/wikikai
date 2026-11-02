import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable } from "@dnd-kit/sortable";
import { useAppDispatch } from "../store";
import { showToast } from "../store/uiSlice";
import {
  useAddNoteMutation,
  useDeleteNoteMutation,
  useListProjectNotesQuery,
  useMoveNoteMutation,
  useToggleNoteItemMutation,
  useUpdateNoteMutation,
  type Note,
  type NoteColor,
  type NotePatch,
  type NoteState,
} from "../store/api";
import { apiErrorMessage } from "../lib/taskBoard";
import {
  allNoteLabels,
  checklistSplit,
  filterNotes,
  isBlankDraft,
  linkParts,
  masonrySpan,
  noteDropBefore,
  notePatch,
  noteSections,
  type NoteDraft,
} from "../lib/notes";
import { ChecklistEditor, NoteIcon, NoteModal, NotePalette } from "./NoteEditor";

/** Matches `grid-auto-rows` and the gap in `.note-grid`. */
const GRID_ROW_PX = 8;
const GRID_GAP_PX = 12;
/** How many open items a card shows before "+N more". */
const CARD_ITEMS = 8;

const STATES: { state: NoteState; label: string }[] = [
  { state: "active", label: "Notes" },
  { state: "archived", label: "Archive" },
  { state: "trashed", label: "Trash" },
];

interface Props {
  projectId: number;
  noteId: number | null;
  onOpenNote: (id: number | null) => void;
}

/** A project's notes, laid out like Google Keep. */
export function NotesView({ projectId, noteId, onOpenNote }: Props): JSX.Element {
  const dispatch = useAppDispatch();
  const [state, setState] = useState<NoteState>("active");
  const [query, setQuery] = useState("");
  const [label, setLabel] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const { data, error, isLoading } = useListProjectNotesQuery({ projectId, state });
  const [moveNote] = useMoveNoteMutation();
  // A small distance keeps a click on a card from starting a drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    setQuery("");
    setLabel(null);
    setState("active");
  }, [projectId]);

  const notes = useMemo(() => data?.notes ?? [], [data]);
  const labels = useMemo(() => allNoteLabels(notes), [notes]);
  const shown = useMemo(() => filterNotes(notes, query, label), [notes, query, label]);
  const { pinned, others } = useMemo(() => noteSections(shown), [shown]);
  const canEdit = data?.can_edit ?? false;
  // The grid's order means nothing while it is filtered, and only active notes
  // have an order to change.
  const draggable = canEdit && state === "active" && !query.trim() && label === null;
  const activeNote = activeId === null ? null : notes.find((n) => n.id === activeId) ?? null;

  useEffect(() => {
    if (label !== null && !labels.includes(label)) setLabel(null);
  }, [label, labels]);

  const onDragEnd = (e: DragEndEvent): void => {
    setActiveId(null);
    if (!e.over) return;
    const id = Number(e.active.id);
    const section = pinned.some((n) => n.id === id) ? pinned : others;
    const beforeId = noteDropBefore(
      section.map((n) => n.id),
      id,
      Number(e.over.id),
    );
    if (beforeId === undefined) return;
    moveNote({ id, projectId, beforeId })
      .unwrap()
      .catch((err: unknown) => {
        dispatch(showToast({ message: apiErrorMessage(err, "Could not move the note"), kind: "error" }));
      });
  };

  if (error) {
    const status = (error as { status?: number }).status;
    return (
      <div className="viewer-empty">
        <h2>{status === 403 ? "No access to this project" : "Could not load the notes"}</h2>
      </div>
    );
  }

  const cardProps = { projectId, canEdit, draggable, onOpen: (id: number) => onOpenNote(id) };

  return (
    <div className="notes-view">
      <div className="notes-toolbar">
        <div className="module-bar-tabs" role="tablist" aria-label="Note states">
          {STATES.map((s) => (
            <button
              key={s.state}
              type="button"
              role="tab"
              aria-selected={state === s.state}
              className={state === s.state ? "active" : undefined}
              onClick={() => setState(s.state)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="notes-search"
          placeholder="Search notes"
          aria-label="Search notes"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {labels.length > 0 && (
        <div className="module-bar-tabs notes-labels" role="group" aria-label="Filter by label">
          {labels.map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={label === l}
              className={label === l ? "active" : undefined}
              onClick={() => setLabel(label === l ? null : l)}
            >
              {l}
            </button>
          ))}
        </div>
      )}

      {canEdit && state === "active" && <NoteComposer projectId={projectId} />}

      {isLoading ? (
        <p className="task-loading">Loading notes…</p>
      ) : shown.length === 0 ? (
        <p className="notes-empty">
          {query.trim() || label !== null
            ? "No notes match."
            : state === "active"
              ? "Notes you add appear here."
              : state === "archived"
                ? "Archived notes appear here."
                : "No notes in the trash."}
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={(e) => setActiveId(Number(e.active.id))}
          onDragCancel={() => setActiveId(null)}
          onDragEnd={onDragEnd}
        >
          {pinned.length > 0 && (
            <>
              <h3 className="notes-section">Pinned</h3>
              <NoteGrid notes={pinned} {...cardProps} />
            </>
          )}
          {others.length > 0 && (
            <>
              {pinned.length > 0 && <h3 className="notes-section">Others</h3>}
              <NoteGrid notes={others} {...cardProps} />
            </>
          )}
          <DragOverlay>
            {activeNote ? (
              <div className={`note-card note-card-overlay color-${activeNote.color}`}>
                <NoteCardBody note={activeNote} projectId={projectId} canEdit={false} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {noteId !== null && <NoteModal key={noteId} noteId={noteId} projectId={projectId} onClose={() => onOpenNote(null)} />}
    </div>
  );
}

interface CardProps {
  projectId: number;
  canEdit: boolean;
  draggable: boolean;
  onOpen: (id: number) => void;
}

function NoteGrid({ notes, ...card }: CardProps & { notes: Note[] }): JSX.Element {
  return (
    <SortableContext items={notes.map((n) => n.id)} strategy={() => null}>
      <div className="note-grid">
        {notes.map((note) => (
          <NoteCard key={note.id} note={note} {...card} />
        ))}
      </div>
    </SortableContext>
  );
}

/** One card in the masonry grid. Its height decides how many grid rows it spans,
 *  which is what lets short and tall cards pack together. */
function NoteCard({ note, projectId, canEdit, draggable, onOpen }: CardProps & { note: Note }): JSX.Element {
  const inner = useRef<HTMLElement | null>(null);
  const [span, setSpan] = useState(10);
  const { attributes, listeners, setNodeRef, isDragging, isOver } = useSortable({
    id: note.id,
    disabled: !draggable,
  });

  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const measure = (): void => setSpan(masonrySpan(el.getBoundingClientRect().height, GRID_ROW_PX, GRID_GAP_PX));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const classes = [
    "note-card",
    `color-${note.color}`,
    isDragging ? "dragging" : "",
    isOver && !isDragging ? "drop-target" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="note-cell" style={{ gridRowEnd: `span ${span}` }}>
      <article
        ref={(el) => {
          inner.current = el;
          setNodeRef(el);
        }}
        className={classes}
        {...attributes}
        {...listeners}
        role="button"
        tabIndex={0}
        aria-label={note.title || "Note"}
        onClick={() => onOpen(note.id)}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
            e.preventDefault();
            onOpen(note.id);
          }
        }}
      >
        <NoteCardBody note={note} projectId={projectId} canEdit={canEdit} />
      </article>
    </div>
  );
}

function NoteCardBody({ note, projectId, canEdit }: { note: Note; projectId: number; canEdit: boolean }): JSX.Element {
  const dispatch = useAppDispatch();
  const [updateNote] = useUpdateNoteMutation();
  const [toggleItem] = useToggleNoteItemMutation();
  const [deleteNote] = useDeleteNoteMutation();

  const fail = (fallback: string) => (err: unknown) => {
    dispatch(showToast({ message: apiErrorMessage(err, fallback), kind: "error" }));
  };

  const apply = (patch: NotePatch): void => {
    void updateNote({ id: note.id, projectId, patch }).unwrap().catch(fail("Could not change the note"));
  };

  const removeForever = (): void => {
    if (!window.confirm("Delete this note forever? This cannot be undone.")) return;
    void deleteNote({ id: note.id, projectId }).unwrap().catch(fail("Could not delete the note"));
  };

  const list = note.items ? checklistSplit(note.items) : null;
  const canTick = canEdit && !note.trashed;

  /** Tools sit on top of a card that opens on click and drags on press. */
  const stop = { onClick: (e: React.MouseEvent) => e.stopPropagation(), onPointerDown: (e: React.PointerEvent) => e.stopPropagation() };

  return (
    <>
      {canEdit && !note.trashed && (
        <button
          type="button"
          className={`note-tool note-pin${note.pinned ? " active" : ""}`}
          title={note.pinned ? "Unpin" : "Pin"}
          aria-label={note.pinned ? "Unpin" : "Pin"}
          aria-pressed={note.pinned}
          {...stop}
          onClick={(e) => {
            e.stopPropagation();
            apply({ pinned: !note.pinned });
          }}
        >
          <NoteIcon name="pin" />
        </button>
      )}
      {note.title && <h4 className="note-card-title">{note.title}</h4>}
      {note.body && (
        <p className="note-card-text">
          {linkParts(note.body).map((part, i) =>
            part.href ? (
              <a key={i} href={part.href} target="_blank" rel="noopener noreferrer" {...stop}>
                {part.text}
              </a>
            ) : (
              <span key={i}>{part.text}</span>
            ),
          )}
        </p>
      )}
      {list && (
        <ul className="note-card-items">
          {list.open.slice(0, CARD_ITEMS).map((item) => (
            <li key={item.id}>
              <input
                type="checkbox"
                checked={false}
                disabled={!canTick}
                aria-label={`Tick ${item.text}`}
                {...stop}
                onChange={(e) =>
                  void toggleItem({ id: note.id, projectId, itemId: item.id, checked: e.target.checked })
                    .unwrap()
                    .catch(fail("Could not tick the item"))
                }
              />
              <span>{item.text}</span>
            </li>
          ))}
          {list.open.length > CARD_ITEMS && <li className="note-card-more">+{list.open.length - CARD_ITEMS} more</li>}
          {list.checked.length > 0 && (
            <li className="note-card-more">
              {list.checked.length} ticked item{list.checked.length === 1 ? "" : "s"}
            </li>
          )}
        </ul>
      )}
      {!note.title && !note.body && !note.items?.length && <p className="note-card-empty">Empty note</p>}
      {note.labels.length > 0 && (
        <div className="task-card-labels">
          {note.labels.map((l) => (
            <span key={l}>{l}</span>
          ))}
        </div>
      )}
      {canEdit && (
        <div className="note-card-tools" {...stop}>
          {note.trashed ? (
            <>
              <button
                type="button"
                className="note-tool"
                title="Restore"
                aria-label="Restore"
                onClick={() => apply({ trashed: false })}
              >
                <NoteIcon name="restore" />
              </button>
              <button
                type="button"
                className="note-tool"
                title="Delete forever"
                aria-label="Delete forever"
                onClick={removeForever}
              >
                <NoteIcon name="trash" />
              </button>
            </>
          ) : (
            <>
              <NotePalette color={note.color} onPick={(color) => apply({ color })} />
              <button
                type="button"
                className="note-tool"
                title={note.archived ? "Unarchive" : "Archive"}
                aria-label={note.archived ? "Unarchive" : "Archive"}
                onClick={() => apply({ archived: !note.archived })}
              >
                <NoteIcon name="archive" />
              </button>
              <button
                type="button"
                className="note-tool"
                title="Move to trash"
                aria-label="Move to trash"
                onClick={() => apply({ trashed: true })}
              >
                <NoteIcon name="trash" />
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}

const EMPTY_DRAFT: NoteDraft = { title: "", body: "", items: null, labels: "" };

/** "Take a note…": collapsed until used, and saved on clicking away. */
function NoteComposer({ projectId }: { projectId: number }): JSX.Element {
  const dispatch = useAppDispatch();
  const [addNote] = useAddNoteMutation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<NoteDraft>(EMPTY_DRAFT);
  const [color, setColor] = useState<NoteColor>("default");
  const [pinned, setPinned] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const reset = (): void => {
    setOpen(false);
    setDraft(EMPTY_DRAFT);
    setColor("default");
    setPinned(false);
  };

  const finish = (): void => {
    if (isBlankDraft(draft)) {
      reset();
      return;
    }
    // Against an empty note, the patch is exactly what was typed.
    const content = notePatch(draft, { title: "", body: "", items: null, labels: [] }) ?? {};
    addNote({ projectId, note: { ...content, color, pinned } })
      .unwrap()
      .then(reset)
      .catch((err: unknown) => {
        // Stays open, so what was typed is not lost.
        dispatch(showToast({ message: apiErrorMessage(err, "Could not add the note"), kind: "error" }));
      });
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (!root.current?.contains(e.target as Node)) finish();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  });

  if (!open) {
    return (
      <div className="note-composer collapsed">
        <button type="button" className="note-composer-open" onClick={() => setOpen(true)}>
          Take a note…
        </button>
        <button
          type="button"
          className="note-tool"
          title="New list"
          aria-label="New list"
          onClick={() => {
            setDraft({ ...EMPTY_DRAFT, items: [] });
            setOpen(true);
          }}
        >
          <NoteIcon name="check" />
        </button>
      </div>
    );
  }

  return (
    <div
      ref={root}
      className={`note-composer color-${color}`}
      onKeyDown={(e) => {
        if (e.key === "Escape") finish();
      }}
    >
      <div className="note-modal-title">
        <input
          type="text"
          value={draft.title}
          maxLength={300}
          placeholder="Title"
          aria-label="Title"
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        />
        <button
          type="button"
          className={`note-tool${pinned ? " active" : ""}`}
          title={pinned ? "Unpin" : "Pin"}
          aria-label={pinned ? "Unpin" : "Pin"}
          aria-pressed={pinned}
          onClick={() => setPinned((v) => !v)}
        >
          <NoteIcon name="pin" />
        </button>
      </div>
      {draft.items === null ? (
        <textarea
          value={draft.body}
          maxLength={20000}
          rows={3}
          autoFocus
          placeholder="Take a note…"
          aria-label="Note text"
          onChange={(e) => setDraft({ ...draft, body: e.target.value })}
        />
      ) : (
        <ChecklistEditor items={draft.items} disabled={false} onChange={(items) => setDraft({ ...draft, items })} />
      )}
      <div className="note-modal-actions">
        <NotePalette color={color} onPick={setColor} />
        <span className="note-modal-spacer" />
        <button type="button" className="note-close" onClick={finish}>
          Close
        </button>
      </div>
    </div>
  );
}
