import { useEffect, useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "../store";
import { showToast } from "../store/uiSlice";
import {
  useDeleteTaskMutation,
  useGetAuthMeQuery,
  useGetTaskQuery,
  useGetTaskRenderedQuery,
  useListProjectMembersQuery,
  useListProjectMilestonesQuery,
  useListProjectModulesQuery,
  useListProjectTasksQuery,
  useUpdateTaskMutation,
  type TaskDetail,
  type TaskPatch,
} from "../store/api";
import { useMermaidCharts } from "../hooks/useMermaidCharts";
import { writeClipboard } from "../lib/badgeMenu";
import { apiErrorMessage, boardColumns, columnKey, columnLabel } from "../lib/taskBoard";
import { adoptsServerCopy, changedElsewhere, draftAfterSave, draftOf, patchFrom, type TaskDraft } from "../lib/taskDraft";
import { useBackdropClose } from "../hooks/useBackdropClose";

interface Props {
  projectId: number;
  taskId: number;
  onClose: () => void;
}

/**
 * One task's detail, opened over any project tab by `?task=<id>`. Mount it with
 * `key={taskId}`, so each task starts from a clean draft.
 *
 * `base` is the server copy the draft started from. While there are unsaved
 * edits, newer server copies do not replace the draft: the typed text stays on
 * screen, and a banner offers to discard it. Saving against the old version is
 * refused by the server, so another person's or an agent's change is never
 * overwritten silently.
 */
export function TaskModal({ projectId, taskId, onClose }: Props): JSX.Element {
  const dispatch = useAppDispatch();
  const theme = useAppSelector((s) => s.ui.theme);
  const taskQuery = useGetTaskQuery(taskId);
  const rendered = useGetTaskRenderedQuery(taskId);
  const board = useListProjectTasksQuery({ projectId });
  const members = useListProjectMembersQuery(projectId, { refetchOnMountOrArgChange: true });
  const modulesQuery = useListProjectModulesQuery(projectId);
  const milestonesQuery = useListProjectMilestonesQuery(projectId);
  const me = useGetAuthMeQuery();
  const [updateTask, { isLoading: saving }] = useUpdateTaskMutation();
  const [deleteTask] = useDeleteTaskMutation();

  const [base, setBase] = useState<TaskDetail | null>(null);
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  // The draft as of the latest render, for a save reply to compare against.
  const draftRef = useRef<TaskDraft | null>(null);
  draftRef.current = draft;
  const [editingDescription, setEditingDescription] = useState(false);
  const [bodyEl, setBodyEl] = useState<HTMLElement | null>(null);
  const [newLinkUrl, setNewLinkUrl] = useState("");
  const [newLinkLabel, setNewLinkLabel] = useState("");

  const task = taskQuery.data;
  const canEdit = board.data?.can_edit ?? false;
  const isAdmin = me.data?.user?.is_admin === true || me.data?.auth_enabled === false;
  const dirty = base !== null && draft !== null && patchFrom(draft, base) !== null;
  const loadStatus = (taskQuery.error as { status?: number } | undefined)?.status;
  // A 404 only replaces the form when there is nothing typed to keep.
  const gone = loadStatus === 404 && !dirty;
  const stale = base !== null && changedElsewhere(dirty, base.version, task?.version);

  useEffect(() => {
    if (!task || !adoptsServerCopy(dirty, base?.version ?? null, task.version)) return;
    setBase(task);
    setDraft(draftOf(task));
  }, [task, dirty, base?.version]);

  // Toggling a task list box is keyed by page, so a box here could never save.
  useEffect(() => {
    if (!bodyEl) return;
    bodyEl.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((box) => {
      box.disabled = true;
    });
  }, [bodyEl, rendered.data]);

  useMermaidCharts(editingDescription ? null : bodyEl, [rendered.data ?? "", theme], theme, undefined, {
    readOnly: true,
  });

  // A relative link in a description does a full page load and bypasses
  // requestClose(), as does closing the tab. Ask the browser to confirm both.
  // Back is not intercepted.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent): void => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const requestClose = (): void => {
    if (dirty && !window.confirm("Discard your unsaved changes to this task?")) return;
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") requestClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const toastError = (fallback: string) => (err: unknown) => {
    dispatch(showToast({ message: apiErrorMessage(err, fallback), kind: "error" }));
  };

  const save = (): void => {
    if (!draft || !base) return;
    const changes = patchFrom(draft, base);
    if (!changes) return;
    updateTask({ id: taskId, projectId, patch: { expected_version: base.version, ...changes } })
      .unwrap()
      .then((next) => {
        // The reply must not overwrite what was typed while it was in flight:
        // the base moves on either way, so those edits stay dirty and savable.
        const untouched = draftRef.current === draft;
        setBase(next);
        setDraft((current) => (current ? draftAfterSave(current, draft, next) : current));
        if (untouched) setEditingDescription(false);
      })
      .catch(toastError("Could not save the task"));
  };

  /** Links and archiving apply at once. Unsaved field edits stay in the draft,
   *  because `patchFrom` compares them against the fields these do not touch. */
  const applyNow = (patch: Omit<TaskPatch, "expected_version">, fallback: string): Promise<boolean> => {
    if (!base) return Promise.resolve(false);
    return updateTask({ id: taskId, projectId, patch: { expected_version: base.version, ...patch } })
      .unwrap()
      .then((next) => {
        setBase(next);
        return true;
      })
      .catch((err: unknown) => {
        toastError(fallback)(err);
        return false;
      });
  };

  const discard = (): void => {
    if (!task) return;
    setBase(task);
    setDraft(draftOf(task));
    setEditingDescription(false);
  };

  const addLink = (e: React.FormEvent): void => {
    e.preventDefault();
    const url = newLinkUrl.trim();
    if (!url) return;
    const label = newLinkLabel.trim();
    void applyNow({ add_links: [{ url, ...(label ? { label } : {}) }] }, "Could not add the link").then((ok) => {
      // A refused link stays in the form, so it can be corrected.
      if (!ok) return;
      setNewLinkUrl("");
      setNewLinkLabel("");
    });
  };

  const remove = (): void => {
    if (!window.confirm(`Delete T${taskId} permanently? This cannot be undone.`)) return;
    deleteTask({ id: taskId, projectId }).unwrap().then(onClose).catch(toastError("Could not delete the task"));
  };

  const copyResume = (): void => {
    if (!base?.session_id) return;
    writeClipboard(
      `claude --resume ${base.session_id}`,
      () => dispatch(showToast({ message: "Copied", kind: "success" })),
      () => dispatch(showToast({ message: "Could not copy", kind: "error" })),
    );
  };

  const set = <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]): void => {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  };

  const memberList = members.data?.members ?? [];
  // A current assignee who has lost access must still show as selected.
  const assigneeOptions =
    base?.assignee && !memberList.some((m) => m.id === base.assignee?.id)
      ? [...memberList, base.assignee]
      : memberList;

  const modules = modulesQuery.data?.modules ?? [];
  const columnOptions = boardColumns(modules.find((m) => m.id === draft?.module_id)?.columns ?? []);
  // A column deleted while this is open is no longer an option: show where its
  // cards went.
  const columnValue = draft
    ? columnOptions.some((c) => c.key === columnKey(draft.status, draft.column_id))
      ? columnKey(draft.status, draft.column_id)
      : columnKey(draft.status, null)
    : "";

  const backdrop = useBackdropClose(requestClose);

  return (
    <div className="modal-backdrop show" {...backdrop}>
      <div
        className="modal task-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Task T${taskId}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header cal-panel-header">
          <span>T{taskId}</span>
          <button type="button" className="cal-panel-close" aria-label="Close" onClick={requestClose}>
            ×
          </button>
        </div>

        {gone ? (
          <div className="task-modal-body">
            <p>Task not found. It may have been deleted.</p>
          </div>
        ) : taskQuery.error && !base ? (
          <div className="task-modal-body">
            <p>Could not load this task.</p>
          </div>
        ) : !base || !draft ? (
          <div className="task-modal-body">
            <p>Loading…</p>
          </div>
        ) : (
          <div className="task-modal-body">
            {stale && (
              <div className="task-modal-stale" role="alert">
                <span>
                  This task changed while you were editing. Your text is still here. Copy anything you need, then load
                  the latest version.
                </span>
                <button type="button" onClick={discard}>
                  Discard my edits
                </button>
              </div>
            )}

            <label className="task-field task-field-wide">
              Title
              <input
                type="text"
                value={draft.title}
                maxLength={300}
                disabled={!canEdit}
                onChange={(e) => set("title", e.target.value)}
              />
            </label>

            <div className="task-field-grid">
              <label className="task-field">
                Module
                <select
                  value={draft.module_id}
                  disabled={!canEdit}
                  onChange={(e) => {
                    const moduleId = Number(e.target.value);
                    setDraft((d) => (d ? { ...d, module_id: moduleId, column_id: null } : d));
                  }}
                >
                  {modules.length === 0 && <option value={draft.module_id}>{base.module}</option>}
                  {modules.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="task-field">
                Column
                <select
                  value={columnValue}
                  disabled={!canEdit}
                  onChange={(e) => {
                    const column = columnOptions.find((c) => c.key === e.target.value);
                    if (!column) return;
                    setDraft((d) => (d ? { ...d, status: column.status, column_id: column.id } : d));
                  }}
                >
                  {columnOptions.map((c) => (
                    <option key={c.key} value={c.key}>
                      {columnLabel(c)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="task-field">
                Milestone
                <select
                  value={draft.milestone_id ?? ""}
                  disabled={!canEdit}
                  onChange={(e) => set("milestone_id", e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">No milestone</option>
                  {/* Shows the current one until the list arrives. */}
                  {!milestonesQuery.data && base.milestone_id !== null && (
                    <option value={base.milestone_id}>{base.milestone}</option>
                  )}
                  {(milestonesQuery.data?.milestones ?? []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.date})
                    </option>
                  ))}
                </select>
              </label>
              <label className="task-field">
                Assignee
                <select
                  value={draft.assignee_id ?? ""}
                  disabled={!canEdit}
                  onChange={(e) => set("assignee_id", e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Unassigned</option>
                  {assigneeOptions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.display_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="task-field">
                Start
                <input
                  type="date"
                  value={draft.start_date}
                  disabled={!canEdit}
                  onChange={(e) => set("start_date", e.target.value)}
                />
              </label>
              <label className="task-field">
                Due
                <input
                  type="date"
                  value={draft.due_date}
                  disabled={!canEdit}
                  onChange={(e) => set("due_date", e.target.value)}
                />
              </label>
            </div>

            <label className="task-field task-field-wide">
              Labels (comma-separated)
              <input
                type="text"
                value={draft.labels}
                disabled={!canEdit}
                onChange={(e) => set("labels", e.target.value)}
              />
            </label>

            <label className="task-field task-field-wide">
              Blocked because
              <input
                type="text"
                value={draft.blocked_reason}
                maxLength={1000}
                disabled={!canEdit}
                onChange={(e) => set("blocked_reason", e.target.value)}
              />
            </label>

            <div className="task-field task-field-wide">
              <div className="task-description-header">
                <span>Description</span>
                {canEdit && (
                  <button type="button" onClick={() => setEditingDescription((v) => !v)}>
                    {editingDescription ? "Preview saved" : "Edit"}
                  </button>
                )}
              </div>
              {editingDescription ? (
                <textarea
                  value={draft.description}
                  maxLength={20000}
                  rows={10}
                  onChange={(e) => set("description", e.target.value)}
                />
              ) : (
                <article
                  ref={setBodyEl}
                  className="markdown-body task-description"
                  dangerouslySetInnerHTML={{ __html: rendered.data ?? "" }}
                />
              )}
            </div>

            <div className="task-field task-field-wide">
              <span>Links</span>
              {base.links.length > 0 && (
                <ul className="task-links">
                  {base.links.map((link) => (
                    <li key={link.id}>
                      <a
                        href={link.url}
                        {...(link.url.startsWith("/") ? {} : { target: "_blank", rel: "noopener noreferrer" })}
                      >
                        {link.label ?? link.url}
                      </a>
                      {canEdit && (
                        <button
                          type="button"
                          aria-label={`Remove link ${link.label ?? link.url}`}
                          onClick={() => void applyNow({ remove_link_ids: [link.id] }, "Could not remove the link")}
                        >
                          ×
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {canEdit && (
                <form className="task-link-form" onSubmit={addLink}>
                  <input
                    type="text"
                    placeholder="https://… or /&3/#12"
                    aria-label="Link URL"
                    value={newLinkUrl}
                    onChange={(e) => setNewLinkUrl(e.target.value)}
                  />
                  <input
                    type="text"
                    placeholder="Label"
                    aria-label="Link label"
                    value={newLinkLabel}
                    onChange={(e) => setNewLinkLabel(e.target.value)}
                  />
                  <button type="submit" disabled={!newLinkUrl.trim()}>
                    Add
                  </button>
                </form>
              )}
            </div>

            <div className="task-field task-field-wide">
              <span>Agent session</span>
              <div className="task-session">
                <input
                  type="text"
                  value={draft.session_id}
                  maxLength={200}
                  disabled={!canEdit}
                  aria-label="Agent session id"
                  onChange={(e) => set("session_id", e.target.value)}
                />
                <button type="button" disabled={!base.session_id} onClick={copyResume}>
                  Copy resume command
                </button>
              </div>
            </div>

            <div className="task-modal-actions">
              {canEdit && (
                <button
                  type="button"
                  onClick={() =>
                    void applyNow({ archived: !base.archived }, "Could not change the archive state")
                  }
                >
                  {base.archived ? "Unarchive" : "Archive"}
                </button>
              )}
              {isAdmin && base.archived && (
                <button type="button" className="task-danger" onClick={remove}>
                  Delete permanently
                </button>
              )}
              <span className="task-modal-spacer" />
              <button type="button" onClick={requestClose}>
                Close
              </button>
              {canEdit && (
                <button type="button" className="primary" disabled={!dirty || saving} onClick={save}>
                  {saving ? "Saving…" : "Save"}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
