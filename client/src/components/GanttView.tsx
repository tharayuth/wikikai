import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAppDispatch } from "../store";
import { showToast } from "../store/uiSlice";
import {
  useAddMilestoneMutation,
  useDeleteMilestoneMutation,
  useListProjectMilestonesQuery,
  useListProjectModulesQuery,
  useListProjectTasksQuery,
  useUpdateMilestoneMutation,
  useUpdateTaskMutation,
  type Milestone,
  type TaskRow,
} from "../store/api";
import { isOverdue, todayLocal } from "../lib/calendarGrid";
import { openDatePicker } from "../lib/datePicker";
import {
  GANTT_ZOOMS,
  barGeometry,
  dateAtX,
  draggedDates,
  ganttGroups,
  ganttHeader,
  ganttRange,
  markerX,
  milestoneState,
  movedMilestoneDate,
  type GanttDragMode,
  type GanttGrouping,
  type GanttRange,
  type GanttZoom,
} from "../lib/gantt";
import { apiErrorMessage, filterTasks, tasksInModule, type TaskFilter } from "../lib/taskBoard";

/** How far a pointer travels before a press counts as a drag, not a click. */
const DRAG_THRESHOLD_PX = 4;
/** Room left of today when the chart scrolls to it. */
const TODAY_MARGIN_PX = 120;

const ZOOM_LABELS: Record<GanttZoom, string> = { day: "Day", week: "Week", month: "Month" };

type DragTarget = { kind: "task"; id: number; mode: GanttDragMode } | { kind: "milestone"; id: number };
type Drag = DragTarget & { startX: number; moved: boolean; delta: number };

interface Props {
  projectId: number;
  /** Only this module's tasks, or all with null. Milestones cover the project. */
  moduleId: number | null;
  filter: TaskFilter;
  onOpenTask: (id: number) => void;
}

/** A project's tasks on a timeline, with its milestones as dated markers. */
export function GanttView({ projectId, moduleId, filter, onOpenTask }: Props): JSX.Element {
  const dispatch = useAppDispatch();
  const tasksQuery = useListProjectTasksQuery({ projectId });
  const modulesQuery = useListProjectModulesQuery(projectId);
  const milestonesQuery = useListProjectMilestonesQuery(projectId);
  const [updateTask] = useUpdateTaskMutation();
  const [updateMilestone] = useUpdateMilestoneMutation();
  const [zoom, setZoom] = useState<GanttZoom>("week");
  const [grouping, setGrouping] = useState<GanttGrouping>("module");
  const [hideDone, setHideDone] = useState(false);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // The click that ends a drag must not also open what was dragged.
  const justDragged = useRef(false);

  const pxPerDay = GANTT_ZOOMS[zoom];
  const today = todayLocal();
  const allTasks = useMemo(() => tasksQuery.data?.tasks ?? [], [tasksQuery.data]);
  const milestones = useMemo(() => milestonesQuery.data?.milestones ?? [], [milestonesQuery.data]);
  const modules = useMemo(() => modulesQuery.data?.modules ?? [], [modulesQuery.data]);
  const canEdit = tasksQuery.data?.can_edit ?? false;

  // From every task, not just the shown ones, so filtering does not shift the chart.
  const range = useMemo(() => ganttRange(allTasks, milestones, today), [allTasks, milestones, today]);
  const header = useMemo(() => ganttHeader(range, zoom, pxPerDay), [range, zoom, pxPerDay]);
  const width = range.days * pxPerDay;

  const groups = useMemo(() => {
    const shown = filterTasks(tasksInModule(allTasks, moduleId), filter).filter(
      (t) => !hideDone || t.status !== "done",
    );
    return ganttGroups(shown, grouping, modules, milestones);
  }, [allTasks, moduleId, filter, hideDone, grouping, modules, milestones]);

  const loaded = tasksQuery.data !== undefined;
  const scrollToToday = useCallback(() => {
    if (scroller.current) scroller.current.scrollLeft = markerX(today, range, pxPerDay) - TODAY_MARGIN_PX;
    // Only a new zoom or the first load should move the view: not every refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, range.from, pxPerDay]);
  useLayoutEffect(() => {
    if (loaded) scrollToToday();
  }, [loaded, scrollToToday]);

  const fail = (fallback: string) => (err: unknown) => {
    dispatch(showToast({ message: apiErrorMessage(err, fallback), kind: "error" }));
  };

  const beginDrag = (e: React.PointerEvent, target: DragTarget): void => {
    // A drag released outside its element fires no click, so this cannot wait for one.
    justDragged.current = false;
    if (e.button !== 0 || !canEdit) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ ...target, startX: e.clientX, moved: false, delta: 0 });
  };

  const moveDrag = (e: React.PointerEvent): void => {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    setDrag({
      ...drag,
      moved: drag.moved || Math.abs(dx) >= DRAG_THRESHOLD_PX,
      delta: Math.round(dx / pxPerDay),
    });
  };

  const endDrag = (): void => {
    if (!drag) return;
    const done = drag;
    setDrag(null);
    justDragged.current = done.moved;
    if (!done.moved || done.delta === 0) return;
    if (done.kind === "task") {
      const task = allTasks.find((t) => t.id === done.id);
      if (!task) return;
      const dates = draggedDates(task, done.mode, done.delta);
      if (Object.keys(dates).length === 0) return;
      void updateTask({ id: task.id, projectId, patch: { expected_version: task.version, ...dates } })
        .unwrap()
        .catch(fail("Could not change the dates"));
    } else {
      const milestone = milestones.find((m) => m.id === done.id);
      if (!milestone) return;
      void updateMilestone({ id: milestone.id, projectId, patch: { date: movedMilestoneDate(milestone.date, done.delta) } })
        .unwrap()
        .catch(fail("Could not move the milestone"));
    }
  };

  const dragProps = { onPointerMove: moveDrag, onPointerUp: endDrag, onPointerCancel: () => setDrag(null) };

  /** Opens something on click, unless that click was the end of a drag. */
  const unlessDragged = (open: () => void) => () => {
    if (justDragged.current) {
      justDragged.current = false;
      return;
    }
    open();
  };

  /** A task as it looks right now, including a drag in progress. */
  const previewOf = (task: TaskRow): TaskRow =>
    drag?.kind === "task" && drag.id === task.id ? { ...task, ...draggedDates(task, drag.mode, drag.delta) } : task;

  const dateOfMilestone = (m: Milestone): string =>
    drag?.kind === "milestone" && drag.id === m.id ? movedMilestoneDate(m.date, drag.delta) : m.date;

  const schedule = (task: TaskRow, e: React.MouseEvent<HTMLDivElement>): void => {
    if (!canEdit) return;
    const date = dateAtX(e.clientX - e.currentTarget.getBoundingClientRect().left, range, pxPerDay);
    void updateTask({
      id: task.id,
      projectId,
      patch: { expected_version: task.version, start_date: date, due_date: date },
    })
      .unwrap()
      .catch(fail("Could not schedule the task"));
  };

  if (tasksQuery.error) {
    const status = (tasksQuery.error as { status?: number }).status;
    return (
      <div className="viewer-empty">
        <h2>{status === 403 ? "No access to this project" : "Could not load the tasks"}</h2>
      </div>
    );
  }
  if (!loaded) return <p className="task-loading">Loading tasks…</p>;

  const editingMilestone = typeof editing === "number" ? milestones.find((m) => m.id === editing) ?? null : null;

  return (
    <div className="gantt-view">
      <div className="gantt-toolbar">
        <div className="module-bar-tabs" role="group" aria-label="Zoom">
          {(Object.keys(GANTT_ZOOMS) as GanttZoom[]).map((z) => (
            <button
              key={z}
              type="button"
              aria-pressed={zoom === z}
              className={zoom === z ? "active" : undefined}
              onClick={() => setZoom(z)}
            >
              {ZOOM_LABELS[z]}
            </button>
          ))}
        </div>
        <button type="button" className="gantt-tool" onClick={scrollToToday}>
          Today
        </button>
        <label className="gantt-option">
          Group by
          <select value={grouping} onChange={(e) => setGrouping(e.target.value as GanttGrouping)}>
            <option value="module">Module</option>
            <option value="milestone">Milestone</option>
          </select>
        </label>
        <label className="gantt-option">
          <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
          Hide done
        </label>
        {milestonesQuery.isError && <span className="gantt-warning">Could not load the milestones</span>}
      </div>

      {(editing === "new" || editingMilestone) && (
        <MilestonePanel
          key={editing}
          projectId={projectId}
          milestone={editingMilestone}
          today={today}
          canEdit={canEdit}
          onClose={() => setEditing(null)}
        />
      )}

      <div className="gantt-scroll" ref={scroller}>
        <div className="gantt-canvas">
          <div className="gantt-head">
            <div className="gantt-label gantt-corner">Task</div>
            <div className="gantt-timescale" style={{ width }}>
              <div className="gantt-months">
                {header.months.map((m) => (
                  <span key={m.label} style={{ left: m.left, width: m.width }}>
                    {m.label}
                  </span>
                ))}
              </div>
              <div className="gantt-ticks">
                {header.ticks.map((t) => (
                  <span key={t.left} style={{ left: t.left, width: zoom === "day" ? pxPerDay : pxPerDay * 7 }}>
                    {t.label}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="gantt-body">
            <GanttLines range={range} pxPerDay={pxPerDay} header={header} today={today} width={width}>
              {milestones.map((m) => (
                <i
                  key={m.id}
                  className={`gantt-line-milestone state-${milestoneState(m, today)}`}
                  style={{ left: markerX(dateOfMilestone(m), range, pxPerDay) }}
                />
              ))}
            </GanttLines>

            <div className="gantt-row gantt-milestones">
              <div className="gantt-label">
                <span>Milestones</span>
                {canEdit && (
                  <button
                    type="button"
                    className="gantt-add-milestone"
                    aria-label="Add a milestone"
                    title="Add a milestone"
                    onClick={() => setEditing("new")}
                  >
                    +
                  </button>
                )}
              </div>
              <div className="gantt-track" style={{ width }}>
                {milestones.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={`gantt-diamond state-${milestoneState(m, today)}`}
                    style={{ left: markerX(dateOfMilestone(m), range, pxPerDay) }}
                    title={`${m.name}, ${dateOfMilestone(m)}${m.task_count ? `, ${m.done_count}/${m.task_count} tasks done` : ""}`}
                    onPointerDown={(e) => beginDrag(e, { kind: "milestone", id: m.id })}
                    {...dragProps}
                    onClick={unlessDragged(() => setEditing(m.id))}
                  >
                    <i aria-hidden="true" />
                    <span>{m.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {groups.length === 0 && <p className="gantt-empty">No tasks to show.</p>}

            {groups.map((group) => (
              <div key={group.key} role="group" aria-label={group.name}>
                <div className="gantt-row gantt-group">
                  <div className="gantt-label">
                    {group.name}
                    <span className="gantt-group-count">{group.tasks.length}</span>
                  </div>
                  <div className="gantt-track" style={{ width }} />
                </div>
                {group.tasks.map((task) => {
                  const shown = previewOf(task);
                  const bar = barGeometry(shown, range, pxPerDay);
                  return (
                    <div key={task.id} className="gantt-row">
                      <div className="gantt-label">
                        <button
                          type="button"
                          className="gantt-task-name"
                          title={task.title}
                          onClick={() => onOpenTask(task.id)}
                        >
                          <span className={`gantt-dot status-${task.status}`} aria-label={task.status} />
                          <span className="gantt-task-id">T{task.id}</span>
                          <span className="gantt-task-title">{task.title}</span>
                        </button>
                      </div>
                      {bar ? (
                        <div className="gantt-track" style={{ width }}>
                          <div
                            role="button"
                            tabIndex={0}
                            className={[
                              "gantt-bar",
                              `status-${task.status}`,
                              isOverdue(shown, today) ? "overdue" : "",
                              canEdit ? "editable" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            style={{ left: bar.left, width: bar.width }}
                            title={`${task.title}: ${shown.start_date ?? "no start"} to ${shown.due_date ?? "no due date"}`}
                            onPointerDown={(e) => beginDrag(e, { kind: "task", id: task.id, mode: "move" })}
                            {...dragProps}
                            onClick={unlessDragged(() => onOpenTask(task.id))}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") onOpenTask(task.id);
                            }}
                          >
                            {canEdit && (
                              <span
                                className="gantt-handle start"
                                aria-hidden="true"
                                onPointerDown={(e) => beginDrag(e, { kind: "task", id: task.id, mode: "start" })}
                              />
                            )}
                            <span className="gantt-bar-title">{task.title}</span>
                            {canEdit && (
                              <span
                                className="gantt-handle end"
                                aria-hidden="true"
                                onPointerDown={(e) => beginDrag(e, { kind: "task", id: task.id, mode: "end" })}
                              />
                            )}
                          </div>
                        </div>
                      ) : (
                        <div
                          className={`gantt-track${canEdit ? " schedulable" : ""}`}
                          style={{ width }}
                          title={canEdit ? "No dates yet. Click a day to schedule this task." : "No dates yet"}
                          onClick={(e) => schedule(task, e)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function GanttLines({
  range,
  pxPerDay,
  header,
  today,
  width,
  children,
}: {
  range: GanttRange;
  pxPerDay: number;
  header: ReturnType<typeof ganttHeader>;
  today: string;
  width: number;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="gantt-lines" style={{ width }} aria-hidden="true">
      {header.ticks.map((t) => (
        <i key={`t${t.left}`} className="gantt-line-tick" style={{ left: t.left }} />
      ))}
      {header.months.map((m) => (
        <i key={m.label} className="gantt-line-month" style={{ left: m.left }} />
      ))}
      <i className="gantt-line-today" style={{ left: markerX(today, range, pxPerDay) }} />
      {children}
    </div>
  );
}

/** Add or edit one milestone, in a strip above the chart so nothing clips it. */
function MilestonePanel({
  projectId,
  milestone,
  today,
  canEdit,
  onClose,
}: {
  projectId: number;
  milestone: Milestone | null;
  today: string;
  canEdit: boolean;
  onClose: () => void;
}): JSX.Element {
  const dispatch = useAppDispatch();
  const [addMilestone] = useAddMilestoneMutation();
  const [updateMilestone] = useUpdateMilestoneMutation();
  const [deleteMilestone] = useDeleteMilestoneMutation();
  const [name, setName] = useState(milestone?.name ?? "");
  const [date, setDate] = useState(milestone?.date ?? today);

  const fail = (fallback: string) => (err: unknown) => {
    dispatch(showToast({ message: apiErrorMessage(err, fallback), kind: "error" }));
  };

  const save = (e: React.FormEvent): void => {
    e.preventDefault();
    const text = name.trim();
    if (!text || !date) return;
    const saving = milestone
      ? updateMilestone({ id: milestone.id, projectId, patch: { name: text, date } })
      : addMilestone({ projectId, name: text, date });
    void saving.unwrap().then(onClose).catch(fail("Could not save the milestone"));
  };

  const remove = (): void => {
    if (!milestone) return;
    const tasks = milestone.task_count;
    const detail = tasks > 0 ? ` Its ${tasks} task${tasks === 1 ? "" : "s"} will stay, with no milestone.` : "";
    if (!window.confirm(`Delete milestone "${milestone.name}"?${detail}`)) return;
    void deleteMilestone({ id: milestone.id, projectId }).unwrap().then(onClose).catch(fail("Could not delete the milestone"));
  };

  return (
    <form
      className="gantt-panel"
      onSubmit={save}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <input
        type="text"
        value={name}
        maxLength={100}
        placeholder="Milestone name"
        aria-label="Milestone name"
        autoFocus={canEdit}
        disabled={!canEdit}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        type="date"
        value={date}
        aria-label="Milestone date"
        disabled={!canEdit}
        onClick={(e) => openDatePicker(e.currentTarget)}
        onChange={(e) => setDate(e.target.value)}
      />
      {milestone && (
        <>
          <span className="gantt-panel-progress">
            {milestone.done_count}/{milestone.task_count} tasks done
          </span>
          {canEdit && (
            <label className="gantt-option">
              <input
                type="checkbox"
                checked={milestone.done}
                onChange={(e) =>
                  void updateMilestone({ id: milestone.id, projectId, patch: { done: e.target.checked } })
                    .unwrap()
                    .catch(fail("Could not change the milestone"))
                }
              />
              Reached
            </label>
          )}
        </>
      )}
      <span className="note-modal-spacer" />
      {canEdit && milestone && (
        <button type="button" className="gantt-tool danger" onClick={remove}>
          Delete
        </button>
      )}
      <button type="button" className="gantt-tool" onClick={onClose}>
        {canEdit ? "Cancel" : "Close"}
      </button>
      {canEdit && (
        <button type="submit" className="gantt-tool primary" disabled={!name.trim() || !date}>
          {milestone ? "Save" : "Add"}
        </button>
      )}
    </form>
  );
}
