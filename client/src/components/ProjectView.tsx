import { useCallback, useEffect, useState } from "react";
import { CalendarView } from "./CalendarView";
import { GanttView } from "./GanttView";
import { ModuleBar } from "./ModuleBar";
import { NotesView } from "./NotesView";
import { TaskBoard } from "./TaskBoard";
import { TaskFilters } from "./TaskFilters";
import { TaskListView } from "./TaskListView";
import { TaskModal } from "./TaskModal";
import { useListProjectModulesQuery, useListProjectTasksQuery } from "../store/api";
import {
  buildModuleSearch,
  buildNoteSearch,
  buildProjectViewSearch,
  buildTaskSearch,
  currentQueryString,
  navigateTo,
  type CalendarLocation,
  type ProjectViewKind,
} from "../hooks/useHash";
import { NO_FILTER, selectedModuleId, type TaskFilter } from "../lib/taskBoard";

/** The Tasks tab keeps `view=list` in its URL, so links to it still open. */
const TABS: { view: ProjectViewKind; label: string; icon: JSX.Element }[] = [
  {
    view: "calendar",
    label: "Calendar",
    icon: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M8 3v4M16 3v4M3 10h18" />
      </>
    ),
  },
  {
    view: "board",
    label: "Board",
    icon: (
      <>
        <rect x="3" y="4" width="5" height="16" rx="1" />
        <rect x="9.5" y="4" width="5" height="10" rx="1" />
        <rect x="16" y="4" width="5" height="13" rx="1" />
      </>
    ),
  },
  {
    view: "list",
    label: "Tasks",
    icon: <path d="M4 6l1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17M12 6h8M12 12h8M12 18h8" />,
  },
  {
    view: "gantt",
    label: "Gantt",
    icon: (
      <>
        <rect x="3" y="4" width="10" height="4" rx="1" />
        <rect x="7" y="10" width="11" height="4" rx="1" />
        <rect x="12" y="16" width="9" height="4" rx="1" />
      </>
    ),
  },
  {
    view: "notes",
    label: "Notes",
    icon: (
      <>
        <path d="M5 4h14a1 1 0 0 1 1 1v10l-5 5H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
        <path d="M15 20v-5h5" />
      </>
    ),
  },
];

/**
 * Everything behind a project's calendar icon: one tab bar over the Calendar,
 * Board, Tasks, Gantt and Notes. Rendered in place of the viewer for `/?calendar=<id>`.
 */
export function ProjectView({ location }: { location: CalendarLocation }): JSX.Element {
  const { projectId, month, view, taskId, moduleId, noteId } = location;
  const [filter, setFilter] = useState<TaskFilter>(NO_FILTER);
  const modulesQuery = useListProjectModulesQuery(projectId);
  const tasksQuery = useListProjectTasksQuery({ projectId });
  const modules = modulesQuery.data?.modules ?? [];
  const openTaskModuleId = tasksQuery.data?.tasks.find((t) => t.id === taskId)?.module_id ?? null;
  const selectedId = selectedModuleId(modules, moduleId, view, openTaskModuleId);
  const selectedModule = modules.find((m) => m.id === selectedId) ?? null;

  useEffect(() => setFilter(NO_FILTER), [projectId]);

  const openTask = useCallback((id: number) => {
    navigateTo({ kid: null }, { search: buildTaskSearch(currentQueryString(), id) });
  }, []);

  // A task link names no module, so the Board opened on the task's. Write that
  // module into the URL on closing, or the Board would jump to the first one.
  const closeTask = useCallback(() => {
    const closed = buildTaskSearch(currentQueryString(), null);
    const search = view === "board" && moduleId === null ? buildModuleSearch(closed, selectedId) : closed;
    navigateTo({ kid: null }, { search });
  }, [view, moduleId, selectedId]);

  const openNote = useCallback((id: number | null) => {
    navigateTo({ kid: null }, { search: buildNoteSearch(currentQueryString(), id) });
  }, []);

  const selectModule = useCallback((id: number | null) => {
    navigateTo({ kid: null }, { search: buildModuleSearch(currentQueryString(), id) });
  }, []);

  return (
    <section className="viewer project-view">
      <div className="project-tabs" role="tablist" aria-label="Project views">
        {TABS.map((tab) => (
          <button
            key={tab.view}
            type="button"
            role="tab"
            aria-selected={view === tab.view}
            className={view === tab.view ? "active" : undefined}
            onClick={() =>
              navigateTo({ kid: null }, { search: buildProjectViewSearch(currentQueryString(), tab.view) })
            }
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {tab.icon}
            </svg>
            {tab.label}
          </button>
        ))}
        {(view === "board" || view === "list" || view === "gantt") && <TaskFilters projectId={projectId} filter={filter} onChange={setFilter} />}
      </div>
      {modules.length > 0 && view !== "notes" && (
        <ModuleBar
          projectId={projectId}
          modules={modules}
          canEdit={modulesQuery.data?.can_edit ?? false}
          selectedId={selectedId}
          allowAll={view !== "board"}
          onSelect={selectModule}
        />
      )}
      {view === "calendar" && (
        <CalendarView projectId={projectId} month={month} moduleId={selectedId} onOpenTask={openTask} />
      )}
      {view === "board" && (
        <TaskBoard
          projectId={projectId}
          module={selectedModule}
          modulesFailed={modulesQuery.isError}
          filter={filter}
          onOpenTask={openTask}
        />
      )}
      {view === "list" && (
        <TaskListView projectId={projectId} moduleId={selectedId} filter={filter} onOpenTask={openTask} />
      )}
      {view === "gantt" && (
        <GanttView projectId={projectId} moduleId={selectedId} filter={filter} onOpenTask={openTask} />
      )}
      {view === "notes" && <NotesView projectId={projectId} noteId={noteId} onOpenNote={openNote} />}
      {taskId != null && <TaskModal key={taskId} projectId={projectId} taskId={taskId} onClose={closeTask} />}
    </section>
  );
}
