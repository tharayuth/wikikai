import { useCallback, useEffect, useState } from "react";
import { CalendarView } from "./CalendarView";
import { TaskBoard } from "./TaskBoard";
import { TaskFilters } from "./TaskFilters";
import { TaskListView } from "./TaskListView";
import {
  buildProjectViewSearch,
  buildTaskSearch,
  currentQueryString,
  navigateTo,
  type CalendarLocation,
  type ProjectViewKind,
} from "../hooks/useHash";
import { NO_FILTER, type TaskFilter } from "../lib/taskBoard";

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
  const { projectId, month, view } = location;
  const [filter, setFilter] = useState<TaskFilter>(NO_FILTER);

  useEffect(() => setFilter(NO_FILTER), [projectId]);

  const openTask = useCallback((id: number) => {
    navigateTo({ kid: null }, { search: buildTaskSearch(currentQueryString(), id) });
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
      {view === "calendar" && <CalendarView projectId={projectId} month={month} />}
      {view === "board" && <TaskBoard projectId={projectId} filter={filter} onOpenTask={openTask} />}
      {view === "list" && <TaskListView projectId={projectId} filter={filter} onOpenTask={openTask} />}
    </section>
  );
}
