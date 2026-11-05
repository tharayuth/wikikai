import { useState } from "react";
import { useAppDispatch } from "../store";
import { showToast } from "../store/uiSlice";
import {
  useAddModuleMutation,
  useDeleteModuleMutation,
  useUpdateModuleMutation,
  type TaskModule,
  type TaskRow,
} from "../store/api";
import { CALENDAR_STATE_HINTS, calendarIconState, summarizeTasks, todayLocal } from "../lib/calendarGrid";
import { apiErrorMessage, tasksInModule } from "../lib/taskBoard";
import { BoardMenu, NameForm, type BoardMenuItem } from "./BoardControls";

interface Props {
  projectId: number;
  modules: TaskModule[];
  /** The project's tasks, for each module's colour and count. */
  tasks: TaskRow[];
  canEdit: boolean;
  /** Null is the `All` choice. */
  selectedId: number | null;
  /** The Board shows one module at a time, so it has no `All`. */
  allowAll: boolean;
  onSelect: (id: number | null) => void;
}

/** Chooses which of a project's boards the tabs below show. */
export function ModuleBar({ projectId, modules, tasks, canEdit, selectedId, allowAll, onSelect }: Props): JSX.Element {
  const dispatch = useAppDispatch();
  const [addModule] = useAddModuleMutation();
  const [updateModule] = useUpdateModuleMutation();
  const [deleteModule] = useDeleteModuleMutation();
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);

  const fail = (fallback: string) => (err: unknown) => {
    dispatch(showToast({ message: apiErrorMessage(err, fallback), kind: "error" }));
  };

  const selectedIndex = modules.findIndex((m) => m.id === selectedId);
  const selected = selectedIndex >= 0 ? modules[selectedIndex] : null;

  const add = (name: string): Promise<boolean> =>
    addModule({ projectId, name })
      .unwrap()
      .then((created) => {
        setAdding(false);
        onSelect(created.id);
        return true;
      })
      .catch((err: unknown) => {
        fail("Could not add the module")(err);
        return false;
      });

  const rename = (name: string): Promise<boolean> => {
    if (!selected) return Promise.resolve(false);
    return updateModule({ id: selected.id, projectId, patch: { name } })
      .unwrap()
      .then(() => {
        setRenaming(false);
        return true;
      })
      .catch((err: unknown) => {
        fail("Could not rename the module")(err);
        return false;
      });
  };

  const menuItems = (module: TaskModule): BoardMenuItem[] => {
    const deleteBlock =
      module.task_count > 0
        ? `Still has ${module.task_count} task${module.task_count === 1 ? "" : "s"}, archived included`
        : modules.length === 1
          ? "A project needs at least one module"
          : undefined;
    return [
      { label: "Rename", onSelect: () => setRenaming(true) },
      {
        label: "Move left",
        disabled: selectedIndex === 0,
        onSelect: () =>
          void updateModule({ id: module.id, projectId, patch: { move: "left" } })
            .unwrap()
            .catch(fail("Could not move the module")),
      },
      {
        label: "Move right",
        disabled: selectedIndex === modules.length - 1,
        onSelect: () =>
          void updateModule({ id: module.id, projectId, patch: { move: "right" } })
            .unwrap()
            .catch(fail("Could not move the module")),
      },
      {
        label: "Delete",
        danger: true,
        disabled: deleteBlock !== undefined,
        note: deleteBlock,
        onSelect: () => {
          if (!window.confirm(`Delete module "${module.name}"?`)) return;
          deleteModule({ id: module.id, projectId })
            .unwrap()
            .then(() => onSelect(null))
            .catch(fail("Could not delete the module"));
        },
      },
    ];
  };

  return (
    <div className="module-bar">
      <div className="module-bar-tabs" role="tablist" aria-label="Modules">
        {allowAll && (
          <ModuleTab name="All" tasks={tasks} selected={selectedId === null} onSelect={() => onSelect(null)} />
        )}
        {modules.map((m) => (
          <ModuleTab
            key={m.id}
            name={m.name}
            tasks={tasksInModule(tasks, m.id)}
            selected={m.id === selectedId}
            onSelect={() => onSelect(m.id)}
          />
        ))}
      </div>
      {canEdit && !adding && !renaming && (
        <button type="button" className="module-bar-add" aria-label="Add a module" title="Add a module" onClick={() => setAdding(true)}>
          +
        </button>
      )}
      {canEdit && adding && (
        <NameForm label="New module name" placeholder="Module name" submitLabel="Add" onSubmit={add} onCancel={() => setAdding(false)} />
      )}
      {canEdit && renaming && selected && (
        <NameForm
          key={selected.id}
          label="Module name"
          initial={selected.name}
          onSubmit={rename}
          onCancel={() => setRenaming(false)}
        />
      )}
      {canEdit && selected && !adding && !renaming && (
        <BoardMenu label={`Module ${selected.name} menu`} items={menuItems(selected)} />
      )}
    </div>
  );
}

/** One choice in the bar, in the calendar icon's colours for its own tasks, with
 *  how many are not done. A module with none left shows no number. */
function ModuleTab({
  name,
  tasks,
  selected,
  onSelect,
}: {
  name: string;
  tasks: TaskRow[];
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  const summary = summarizeTasks(tasks);
  const state = calendarIconState(summary, todayLocal());
  const open = summary.open_tasks;
  const cls = ["module-tab"];
  if (selected) cls.push("active");
  if (state) cls.push(`state-${state}`);
  const detail = state ? CALENDAR_STATE_HINTS[state] : "no tasks";
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      className={cls.join(" ")}
      title={`${name}: ${open > 0 ? `${open} not done, ` : ""}${detail}`}
      onClick={onSelect}
    >
      {name}
      {open > 0 && <span className="module-tab-count">{open}</span>}
    </button>
  );
}
