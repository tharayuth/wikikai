import { useMemo, useState } from "react";
import { useListProjectModulesQuery, useListProjectTasksQuery } from "../store/api";
import { isOverdue, todayLocal } from "../lib/calendarGrid";
import { addTarget, filterTasks, sortTasks, tasksInModule, type TaskFilter, type TaskSortKey } from "../lib/taskBoard";
import { TaskQuickAdd } from "./TaskQuickAdd";

const COLUMNS: { key: TaskSortKey; label: string }[] = [
  { key: "id", label: "ID" },
  { key: "title", label: "Title" },
  { key: "status", label: "Status" },
  { key: "assignee", label: "Assignee" },
  { key: "due_date", label: "Due" },
  { key: "updated_at", label: "Updated" },
];

interface Props {
  projectId: number;
  /** Null shows every module, and adds a Module column. */
  moduleId: number | null;
  filter: TaskFilter;
  onOpenTask: (id: number) => void;
}

export function TaskListView({ projectId, moduleId, filter, onOpenTask }: Props): JSX.Element {
  const [showArchived, setShowArchived] = useState(false);
  const [sortKey, setSortKey] = useState<TaskSortKey>("status");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const { data, error, isLoading } = useListProjectTasksQuery(
    showArchived ? { projectId, includeArchived: true } : { projectId },
  );

  const rows = useMemo(
    () => sortTasks(filterTasks(tasksInModule(data?.tasks ?? [], moduleId), filter), sortKey, sortDir),
    [data, moduleId, filter, sortKey, sortDir],
  );
  const today = todayLocal();
  const modulesQuery = useListProjectModulesQuery(projectId);
  const target = addTarget(modulesQuery.data?.modules ?? [], moduleId);

  const onSort = (key: TaskSortKey): void => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  if (error) {
    const status = (error as { status?: number }).status;
    return (
      <div className="viewer-empty">
        <h2>{status === 403 ? "No access to this project" : "Could not load the tasks"}</h2>
      </div>
    );
  }

  return (
    <div className="task-list">
      <div className="task-list-toolbar">
        {data?.can_edit && (
          <TaskQuickAdd projectId={projectId} moduleId={target?.id} moduleName={target?.name} filter={filter} confirm />
        )}
        <label className="task-list-archived">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Include archived
        </label>
      </div>
      {isLoading ? (
        <p className="task-loading">Loading tasks…</p>
      ) : rows.length === 0 ? (
        <p className="task-loading">No tasks to show.</p>
      ) : (
        <div className="task-list-scroll">
          <table>
            <thead>
              <tr>
                {COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    aria-sort={c.key === sortKey ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                  >
                    <button type="button" onClick={() => onSort(c.key)}>
                      {c.label}
                      {c.key === sortKey ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                    </button>
                  </th>
                ))}
                <th>Column</th>
                <th>Milestone</th>
                {moduleId === null && <th>Module</th>}
                <th>Labels</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className={t.archived ? "archived" : undefined}>
                  <td>T{t.id}</td>
                  <td>
                    <button type="button" className="task-list-title" onClick={() => onOpenTask(t.id)}>
                      {t.title}
                    </button>
                    {t.blocked_reason && (
                      <span className="task-card-blocked" title={t.blocked_reason}>
                        Blocked
                      </span>
                    )}
                    {t.archived && <span className="task-list-archived-tag">Archived</span>}
                  </td>
                  <td>{t.status}</td>
                  <td>{t.assignee?.display_name ?? ""}</td>
                  <td className={isOverdue(t, today) ? "task-overdue" : undefined}>{t.due_date ?? ""}</td>
                  <td title={t.updated_at}>{t.updated_at.slice(0, 10)}</td>
                  <td>{t.column}</td>
                  <td>{t.milestone ?? ""}</td>
                  {moduleId === null && <td>{t.module}</td>}
                  <td>{t.labels.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
