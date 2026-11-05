import { useState } from "react";
import { useAppDispatch } from "../store";
import { showToast } from "../store/uiSlice";
import { useAddTaskMutation } from "../store/api";
import { apiErrorMessage, filterTasks, type TaskFilter } from "../lib/taskBoard";

interface Props {
  projectId: number;
  /** Left out, the task goes to the project's default board. */
  moduleId?: number;
  columnId?: number | null;
  /** Says where the task lands, for a form that is not inside its column. */
  moduleName?: string;
  /** The day to schedule the task on: start and due, as a click on the Gantt does. */
  date?: string;
  filter?: TaskFilter;
  /** Why this view will not show the new task, apart from `filter`. */
  hiddenNote?: string | null;
  /** Confirm each add, where the new task can land out of sight. */
  confirm?: boolean;
  autoFocus?: boolean;
}

/** A title box that adds a task to a Todo column. The details wait for the task modal. */
export function TaskQuickAdd({
  projectId,
  moduleId,
  columnId,
  moduleName,
  date,
  filter,
  hiddenNote,
  confirm = false,
  autoFocus = false,
}: Props): JSX.Element {
  const dispatch = useAppDispatch();
  const [title, setTitle] = useState("");
  const [addTask, { isLoading }] = useAddTaskMutation();

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    const text = title.trim();
    if (!text || isLoading) return;
    addTask({ projectId, title: text, moduleId, columnId, startDate: date, dueDate: date })
      .unwrap()
      .then((created) => {
        setTitle("");
        // A new task has no assignee or labels, so an assignee or label filter
        // hides it at once. Say so, or the person adds it a second time.
        const filtered = filter && filterTasks([created], filter).length === 0;
        const hidden = hiddenNote ?? (filtered ? "The current filter hides it." : null);
        if (hidden) {
          dispatch(showToast({ message: `Added T${created.id}. ${hidden}`, kind: "info" }));
        } else if (confirm) {
          dispatch(showToast({ message: `Added T${created.id}.`, kind: "success" }));
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
        placeholder={moduleName ? `Add a task to ${moduleName} · Todo` : "Add a task"}
        aria-label="New task title"
        // On a phone the keyboard would cover what the person opened the panel to read.
        autoFocus={autoFocus && !window.matchMedia("(pointer: coarse)").matches}
        onChange={(e) => setTitle(e.target.value)}
      />
      <button type="submit" disabled={isLoading || !title.trim()}>
        Add
      </button>
    </form>
  );
}
