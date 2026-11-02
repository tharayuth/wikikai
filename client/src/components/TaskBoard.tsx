import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAppDispatch } from "../store";
import { showToast } from "../store/uiSlice";
import {
  useAddColumnMutation,
  useAddTaskMutation,
  useDeleteColumnMutation,
  useListProjectTasksQuery,
  useMoveTaskMutation,
  useUpdateColumnMutation,
  type TaskModule,
  type TaskRow,
} from "../store/api";
import { isOverdue, todayLocal } from "../lib/calendarGrid";
import {
  BOARD_STATUSES,
  DONE_PAGE_SIZE,
  LOCKED_COLUMN_TITLES,
  apiErrorMessage,
  boardColumns,
  cardsByColumn,
  filterTasks,
  resolveDrop,
  tasksInModule,
  type BoardColumn,
  type BoardStatus,
  type TaskFilter,
} from "../lib/taskBoard";
import { BoardMenu, NameForm } from "./BoardControls";

interface Props {
  projectId: number;
  /** The board to show. Null while the module list loads. */
  module: TaskModule | null;
  modulesFailed: boolean;
  filter: TaskFilter;
  onOpenTask: (id: number) => void;
}

const NO_COLUMNS: TaskModule["columns"] = [];

export function TaskBoard({ projectId, module, modulesFailed, filter, onOpenTask }: Props): JSX.Element {
  const dispatch = useAppDispatch();
  const { data, error, isLoading } = useListProjectTasksQuery({ projectId });
  const [moveTask] = useMoveTaskMutation();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [doneShown, setDoneShown] = useState<Record<string, number>>({});

  const sensors = useSensors(
    // A small distance keeps a click on a card's title from starting a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const moduleId = module?.id ?? null;
  const custom = module?.columns ?? NO_COLUMNS;
  const columns = useMemo(() => boardColumns(custom), [custom]);
  const rows = useMemo(() => (moduleId === null ? [] : tasksInModule(data?.tasks ?? [], moduleId)), [data, moduleId]);
  const allCards = useMemo(() => cardsByColumn(rows, columns), [rows, columns]);
  const cards = useMemo(() => cardsByColumn(filterTasks(rows, filter), columns), [rows, filter, columns]);
  const canEdit = data?.can_edit ?? false;
  const activeTask = activeId == null ? null : rows.find((t) => t.id === activeId) ?? null;

  const onDragEnd = (e: DragEndEvent): void => {
    setActiveId(null);
    if (!e.over || !canEdit) return;
    const id = Number(e.active.id);
    const drop = resolveDrop(columns, cards, id, e.over.id);
    const task = rows.find((t) => t.id === id);
    if (!drop || !task) return;
    moveTask({
      id,
      projectId,
      status: drop.status,
      columnId: drop.columnId,
      beforeId: drop.beforeId,
      expectedVersion: task.version,
    })
      .unwrap()
      .catch((err: unknown) => {
        dispatch(showToast({ message: apiErrorMessage(err, "Could not move the task"), kind: "error" }));
      });
  };

  if (error) {
    const status = (error as { status?: number }).status;
    return (
      <div className="viewer-empty">
        <h2>{status === 403 ? "No access to this project" : "Could not load the tasks"}</h2>
      </div>
    );
  }
  if (modulesFailed) {
    return (
      <div className="viewer-empty">
        <h2>Could not load the modules</h2>
      </div>
    );
  }
  if (isLoading || moduleId === null) return <p className="task-loading">Loading tasks…</p>;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={(e) => setActiveId(Number(e.active.id))}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={onDragEnd}
    >
      <div className="task-board">
        {columns.map((column) => {
          const inColumn = cards.get(column.key) ?? [];
          const shown = doneShown[column.key] ?? DONE_PAGE_SIZE;
          const isDone = column.status === "done";
          return (
            <Column
              key={column.key}
              column={column}
              siblings={columns.filter((c) => c.status === column.status)}
              projectId={projectId}
              moduleId={moduleId}
              tasks={isDone ? inColumn.slice(0, shown) : inColumn}
              total={inColumn.length}
              allCount={allCards.get(column.key)?.length ?? 0}
              canEdit={canEdit}
              filter={filter}
              onOpenTask={onOpenTask}
              onShowMore={
                isDone
                  ? () => setDoneShown((n) => ({ ...n, [column.key]: shown + DONE_PAGE_SIZE }))
                  : undefined
              }
            />
          );
        })}
        {canEdit && <AddColumn projectId={projectId} moduleId={moduleId} />}
      </div>
      <DragOverlay>
        {activeTask ? (
          <div className="task-card task-card-overlay">
            <CardBody task={activeTask} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({
  column,
  siblings,
  projectId,
  moduleId,
  tasks,
  total,
  allCount,
  canEdit,
  filter,
  onOpenTask,
  onShowMore,
}: {
  column: BoardColumn;
  /** The columns of this status, in board order: a move stays among them. */
  siblings: BoardColumn[];
  projectId: number;
  moduleId: number;
  tasks: TaskRow[];
  total: number;
  /** Cards in this column with no filter applied, for the delete question. */
  allCount: number;
  canEdit: boolean;
  filter: TaskFilter;
  onOpenTask: (id: number) => void;
  onShowMore?: () => void;
}): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: column.key });
  return (
    <section className={`task-column${isOver ? " over" : ""}`} aria-label={column.name}>
      <ColumnHeader
        column={column}
        siblings={siblings}
        projectId={projectId}
        total={total}
        allCount={allCount}
        canEdit={canEdit}
      />
      <div ref={setNodeRef} className="task-column-cards">
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} canEdit={canEdit} onOpenTask={onOpenTask} />
          ))}
        </SortableContext>
      </div>
      {onShowMore && total > tasks.length && (
        <button type="button" className="task-show-more" onClick={onShowMore}>
          Show more ({total - tasks.length})
        </button>
      )}
      {column.status === "todo" && canEdit && (
        <QuickAdd projectId={projectId} moduleId={moduleId} columnId={column.id} filter={filter} />
      )}
    </section>
  );
}

function ColumnHeader({
  column,
  siblings,
  projectId,
  total,
  allCount,
  canEdit,
}: {
  column: BoardColumn;
  siblings: BoardColumn[];
  projectId: number;
  total: number;
  allCount: number;
  canEdit: boolean;
}): JSX.Element {
  const dispatch = useAppDispatch();
  const [updateColumn] = useUpdateColumnMutation();
  const [deleteColumn] = useDeleteColumnMutation();
  const [renaming, setRenaming] = useState(false);

  const fail = (fallback: string) => (err: unknown) => {
    dispatch(showToast({ message: apiErrorMessage(err, fallback), kind: "error" }));
  };

  if (column.locked) {
    return (
      <header className="task-column-header">
        <span className={`task-column-name locked status-${column.status}`}>
          <LockIcon />
          {column.name}
        </span>
        <span className="task-column-count">{total}</span>
      </header>
    );
  }

  const id = column.id as number;
  const index = siblings.findIndex((c) => c.key === column.key);
  const statusName = LOCKED_COLUMN_TITLES[column.status];

  if (renaming) {
    return (
      <header className="task-column-header">
        <NameForm
          label="Column name"
          initial={column.name}
          onSubmit={(name) =>
            updateColumn({ id, projectId, patch: { name } })
              .unwrap()
              .then(() => {
                setRenaming(false);
                return true;
              })
              .catch((err: unknown) => {
                fail("Could not rename the column")(err);
                return false;
              })
          }
          onCancel={() => setRenaming(false)}
        />
      </header>
    );
  }

  const move = (direction: "left" | "right"): void => {
    void updateColumn({ id, projectId, patch: { move: direction } })
      .unwrap()
      .catch(fail("Could not move the column"));
  };

  const remove = (): void => {
    const question =
      allCount > 0
        ? `Delete column "${column.name}"? Its ${allCount} card${allCount === 1 ? "" : "s"} will move to ${statusName}.`
        : `Delete column "${column.name}"?`;
    if (!window.confirm(question)) return;
    void deleteColumn({ id, projectId }).unwrap().catch(fail("Could not delete the column"));
  };

  return (
    <header className="task-column-header">
      <span className="task-column-name">
        {column.name}
        <small>{statusName}</small>
      </span>
      <span className="task-column-tools">
        <span className="task-column-count">{total}</span>
        {canEdit && (
          <BoardMenu
            label={`Column ${column.name} menu`}
            items={[
              { label: "Rename", onSelect: () => setRenaming(true) },
              { label: "Move left", disabled: index === 0, onSelect: () => move("left") },
              { label: "Move right", disabled: index === siblings.length - 1, onSelect: () => move("right") },
              { label: "Delete", danger: true, onSelect: remove },
            ]}
          />
        )}
      </span>
    </header>
  );
}

function LockIcon(): JSX.Element {
  return (
    <svg
      className="task-column-lock"
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="Built-in column"
    >
      <title>Built-in column: cannot be renamed or deleted</title>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function AddColumn({ projectId, moduleId }: { projectId: number; moduleId: number }): JSX.Element {
  const dispatch = useAppDispatch();
  const [addColumn] = useAddColumnMutation();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<BoardStatus>("todo");

  if (!open) {
    return (
      <button type="button" className="task-add-column" onClick={() => setOpen(true)}>
        + Add column
      </button>
    );
  }
  return (
    <div className="task-add-column-form">
      <NameForm
        label="New column name"
        placeholder="Column name"
        submitLabel="Add"
        onSubmit={(name) =>
          addColumn({ moduleId, projectId, name, status })
            .unwrap()
            .then(() => {
              setOpen(false);
              return true;
            })
            .catch((err: unknown) => {
              dispatch(showToast({ message: apiErrorMessage(err, "Could not add the column"), kind: "error" }));
              return false;
            })
        }
        onCancel={() => setOpen(false)}
      >
        <select aria-label="Column status" value={status} onChange={(e) => setStatus(e.target.value as BoardStatus)}>
          {BOARD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {LOCKED_COLUMN_TITLES[s]}
            </option>
          ))}
        </select>
      </NameForm>
    </div>
  );
}

function TaskCard({
  task,
  canEdit,
  onOpenTask,
}: {
  task: TaskRow;
  canEdit: boolean;
  onOpenTask: (id: number) => void;
}): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: !canEdit,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  };
  return (
    <article ref={setNodeRef} style={style} className="task-card" {...attributes} {...listeners}>
      <CardBody task={task} onOpen={() => onOpenTask(task.id)} />
    </article>
  );
}

function CardBody({ task, onOpen }: { task: TaskRow; onOpen?: () => void }): JSX.Element {
  const overdue = isOverdue(task, todayLocal());
  return (
    <>
      <div className="task-card-top">
        <span className="task-card-id">T{task.id}</span>
        {task.blocked_reason && (
          <span className="task-card-blocked" title={task.blocked_reason}>
            Blocked
          </span>
        )}
      </div>
      <button
        type="button"
        className="task-card-title"
        onClick={onOpen}
        // Enter here opens the task. Without this, the card's keyboard drag
        // handler would take the key first.
        onKeyDown={(e) => e.stopPropagation()}
      >
        {task.title}
      </button>
      <div className="task-card-meta">
        {task.assignee && <span>{task.assignee.display_name}</span>}
        {task.due_date && <span className={overdue ? "task-overdue" : undefined}>{task.due_date}</span>}
        {task.milestone && <span className="task-card-milestone">◆ {task.milestone}</span>}
      </div>
      {task.labels.length > 0 && (
        <div className="task-card-labels">
          {task.labels.map((l) => (
            <span key={l}>{l}</span>
          ))}
        </div>
      )}
    </>
  );
}

function QuickAdd({
  projectId,
  moduleId,
  columnId,
  filter,
}: {
  projectId: number;
  moduleId: number;
  columnId: number | null;
  filter: TaskFilter;
}): JSX.Element {
  const dispatch = useAppDispatch();
  const [title, setTitle] = useState("");
  const [addTask, { isLoading }] = useAddTaskMutation();

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    const text = title.trim();
    if (!text) return;
    addTask({ projectId, title: text, moduleId, columnId })
      .unwrap()
      .then((created) => {
        setTitle("");
        // A new task has no assignee or labels, so an assignee or label filter
        // hides it at once. Say so, or the person adds it a second time.
        if (filterTasks([created], filter).length === 0) {
          dispatch(showToast({ message: `Added T${created.id}. The current filter hides it.`, kind: "info" }));
        }
      })
      .catch((err: unknown) => {
        dispatch(showToast({ message: apiErrorMessage(err, "Could not add the task"), kind: "error" }));
      });
  };

  return (
    <form className="task-quick-add" onSubmit={submit}>
      <input
        type="text"
        value={title}
        maxLength={300}
        placeholder="Add a task"
        aria-label="New task title"
        onChange={(e) => setTitle(e.target.value)}
      />
      <button type="submit" disabled={isLoading || !title.trim()}>
        Add
      </button>
    </form>
  );
}
