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
  useAddTaskMutation,
  useListProjectTasksQuery,
  useMoveTaskMutation,
  type TaskRow,
} from "../store/api";
import { isOverdue, todayLocal } from "../lib/calendarGrid";
import {
  BOARD_STATUSES,
  DONE_PAGE_SIZE,
  apiErrorMessage,
  columnsOf,
  filterTasks,
  resolveDrop,
  type BoardStatus,
  type TaskFilter,
} from "../lib/taskBoard";

const COLUMN_TITLES: Record<BoardStatus, string> = {
  todo: "Todo",
  doing: "Doing",
  review: "Review",
  done: "Done",
};

interface Props {
  projectId: number;
  filter: TaskFilter;
  onOpenTask: (id: number) => void;
}

export function TaskBoard({ projectId, filter, onOpenTask }: Props): JSX.Element {
  const dispatch = useAppDispatch();
  const { data, error, isLoading } = useListProjectTasksQuery({ projectId });
  const [moveTask] = useMoveTaskMutation();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [doneShown, setDoneShown] = useState(DONE_PAGE_SIZE);

  const sensors = useSensors(
    // A small distance keeps a click on a card's title from starting a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const rows = useMemo(() => data?.tasks ?? [], [data]);
  const columns = useMemo(() => columnsOf(filterTasks(rows, filter)), [rows, filter]);
  const canEdit = data?.can_edit ?? false;
  const activeTask = activeId == null ? null : rows.find((t) => t.id === activeId) ?? null;

  const onDragEnd = (e: DragEndEvent): void => {
    setActiveId(null);
    if (!e.over || !canEdit) return;
    const id = Number(e.active.id);
    const drop = resolveDrop(columns, id, e.over.id);
    const task = rows.find((t) => t.id === id);
    if (!drop || !task) return;
    moveTask({
      id,
      projectId,
      status: drop.status,
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
  if (isLoading) return <p className="task-loading">Loading tasks…</p>;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={(e) => setActiveId(Number(e.active.id))}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={onDragEnd}
    >
      <div className="task-board">
        {BOARD_STATUSES.map((status) => (
          <Column
            key={status}
            status={status}
            projectId={projectId}
            tasks={status === "done" ? columns.done.slice(0, doneShown) : columns[status]}
            total={columns[status].length}
            canEdit={canEdit}
            filter={filter}
            onOpenTask={onOpenTask}
            onShowMore={status === "done" ? () => setDoneShown((n) => n + DONE_PAGE_SIZE) : undefined}
          />
        ))}
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
  status,
  projectId,
  tasks,
  total,
  canEdit,
  filter,
  onOpenTask,
  onShowMore,
}: {
  status: BoardStatus;
  projectId: number;
  tasks: TaskRow[];
  total: number;
  canEdit: boolean;
  filter: TaskFilter;
  onOpenTask: (id: number) => void;
  onShowMore?: () => void;
}): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: `column:${status}` });
  return (
    <section className={`task-column${isOver ? " over" : ""}`} aria-label={COLUMN_TITLES[status]}>
      <header className="task-column-header">
        <span>{COLUMN_TITLES[status]}</span>
        <span className="task-column-count">{total}</span>
      </header>
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
      {status === "todo" && canEdit && <QuickAdd projectId={projectId} filter={filter} />}
    </section>
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

function QuickAdd({ projectId, filter }: { projectId: number; filter: TaskFilter }): JSX.Element {
  const dispatch = useAppDispatch();
  const [title, setTitle] = useState("");
  const [addTask, { isLoading }] = useAddTaskMutation();

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    const text = title.trim();
    if (!text) return;
    addTask({ projectId, title: text })
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
