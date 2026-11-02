import { useCallback, useEffect, useState } from "react";
import { CalendarView } from "./CalendarView";
import { ModuleBar } from "./ModuleBar";
import { TaskBoard } from "./TaskBoard";
import { TaskFilters } from "./TaskFilters";
import { TaskListView } from "./TaskListView";
import { TaskModal } from "./TaskModal";
import { useListProjectModulesQuery, useListProjectTasksQuery } from "../store/api";
import {
  buildModuleSearch,
  buildProjectViewSearch,
  buildTaskSearch,
  currentQueryString,
  navigateTo,
  type CalendarLocation,
  type ProjectViewKind,
} from "../hooks/useHash";
import { NO_FILTER, selectedModuleId, type TaskFilter } from "../lib/taskBoard";

const TABS: { view: ProjectViewKind; label: string }[] = [
  { view: "calendar", label: "Calendar" },
  { view: "board", label: "Board" },
  { view: "list", label: "List" },
];

/**
 * Everything behind a project's calendar icon: one tab bar over the Calendar,
 * Board and List. Rendered in place of the viewer for `/?calendar=<id>`.
 */
export function ProjectView({ location }: { location: CalendarLocation }): JSX.Element {
  const { projectId, month, view, taskId, moduleId } = location;
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
            {tab.label}
          </button>
        ))}
        {view !== "calendar" && <TaskFilters projectId={projectId} filter={filter} onChange={setFilter} />}
      </div>
      {modules.length > 0 && (
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
      {taskId != null && <TaskModal key={taskId} projectId={projectId} taskId={taskId} onClose={closeTask} />}
    </section>
  );
}
