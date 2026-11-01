import { useMemo } from "react";
import { useListProjectTasksQuery } from "../store/api";
import { allAssignees, allLabels, type TaskFilter } from "../lib/taskBoard";

interface Props {
  projectId: number;
  filter: TaskFilter;
  onChange: (next: TaskFilter) => void;
}

/** Assignee and label filters shared by the Board and List tabs. */
export function TaskFilters({ projectId, filter, onChange }: Props): JSX.Element {
  const { data } = useListProjectTasksQuery({ projectId });
  const tasks = useMemo(() => data?.tasks ?? [], [data]);
  const assignees = useMemo(() => allAssignees(tasks), [tasks]);
  const labels = useMemo(() => allLabels(tasks), [tasks]);

  return (
    <div className="task-filters">
      <label>
        Assignee
        <select
          value={filter.assigneeId === null ? "" : String(filter.assigneeId)}
          onChange={(e) => {
            const v = e.target.value;
            onChange({
              ...filter,
              assigneeId: v === "" ? null : v === "none" ? "none" : Number(v),
            });
          }}
        >
          <option value="">Everyone</option>
          <option value="none">Unassigned</option>
          {assignees.map((a) => (
            <option key={a.id} value={a.id}>
              {a.display_name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Label
        <select
          value={filter.label ?? ""}
          onChange={(e) => onChange({ ...filter, label: e.target.value || null })}
        >
          <option value="">Any</option>
          {labels.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
