import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import {
  useAddProjectMutation,
  useDeleteKnowledgeMutation,
  useListKnowledgeQuery,
  useListProjectsQuery,
  useRemoveProjectMutation,
} from "../store/api";
import { useAppDispatch, useAppSelector } from "../store";
import {
  closeProjectFilter,
  setSelectedProjects,
  showToast,
} from "../store/uiSlice";

const NO_PROJECT_KEY = "(no project)";

interface ProjectRow {
  name: string;
  count: number;
  registered: boolean;
}

export function ProjectFilterModal() {
  const dispatch = useAppDispatch();
  const open = useAppSelector((s) => s.ui.projectFilterOpen);
  const selected = useAppSelector((s) => s.ui.selectedProjects);
  const { data: items = [] } = useListKnowledgeQuery();
  const { data: projectsData } = useListProjectsQuery();
  const [delKnowledge] = useDeleteKnowledgeMutation();
  const [addProject, { isLoading: adding }] = useAddProjectMutation();
  const [removeProject] = useRemoveProjectMutation();
  const [deletingProject, setDeletingProject] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  // Server-side project list (registered + derived from knowledge.project),
  // plus a synthetic "(no project)" bucket for knowledge with a null project.
  const projects = useMemo<ProjectRow[]>(() => {
    const rows: ProjectRow[] = (projectsData?.projects ?? []).map((p) => ({
      name: p.name,
      count: p.count,
      registered: p.registered,
    }));
    const noProjectCount = items.filter((it) => !it.project).length;
    if (noProjectCount > 0) {
      rows.push({
        name: NO_PROJECT_KEY,
        count: noProjectCount,
        registered: false,
      });
    }
    return rows.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
  }, [projectsData, items]);

  const onAddProject = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    if (trimmed === NO_PROJECT_KEY) {
      dispatch(showToast(`Reserved name "${NO_PROJECT_KEY}"`));
      return;
    }
    if (projects.some((p) => p.name === trimmed)) {
      dispatch(showToast(`Project "${trimmed}" already exists`));
      return;
    }
    try {
      await addProject({ name: trimmed }).unwrap();
      setNewName("");
      dispatch(showToast(`Added project "${trimmed}"`));
    } catch {
      dispatch(showToast(`Failed to add project "${trimmed}"`));
    }
  };

  const onDeleteProject = async (name: string, count: number) => {
    const isNoProjectBucket = name === NO_PROJECT_KEY;
    const targets = items.filter(
      (it) => (it.project || NO_PROJECT_KEY) === name,
    );
    const promptText =
      count > 0
        ? `⚠️ Delete every knowledge in project "${name}" (${count} document(s))?\n\n` +
          `This permanently removes every document and every page inside (including the markdown files on disk).\n\n` +
          `Type the project name "${name}" to confirm:`
        : `Delete empty project "${name}"?\n\nType the project name "${name}" to confirm:`;
    const typed = window.prompt(promptText);
    if (typed == null) return; // cancelled
    if (typed.trim() !== name) {
      dispatch(showToast("Cancelled — project name did not match"));
      return;
    }
    setDeletingProject(name);
    let ok = 0;
    let failed = 0;
    for (const it of targets) {
      try {
        await delKnowledge(it.id).unwrap();
        ok += 1;
      } catch {
        failed += 1;
      }
    }
    // Drop the registry entry too — only for real projects, not the synthetic
    // "(no project)" bucket.
    if (!isNoProjectBucket) {
      try {
        await removeProject({ name }).unwrap();
      } catch {
        /* ignore: not registered or already gone */
      }
    }
    if (selected && selected.includes(name)) {
      const next = selected.filter((p) => p !== name);
      dispatch(setSelectedProjects(next.length > 0 ? next : null));
    }
    setDeletingProject(null);
    dispatch(
      showToast(
        count === 0
          ? `Deleted project "${name}"`
          : failed === 0
            ? `Deleted project "${name}" — ${ok} document(s)`
            : `Deleted ${ok}, failed ${failed}`,
      ),
    );
  };

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") dispatch(closeProjectFilter());
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open, dispatch]);

  // Close only when the press AND the release both happen on the backdrop —
  // prevents the dialog from closing while the user drags to select text
  // inside the modal and the mouseup ends outside the inner card.
  const downOnBackdropRef = useRef(false);

  if (!open) return null;

  // Treat null (no filter) as "everything selected".
  const isChecked = (name: string) =>
    selected == null ? true : selected.includes(name);

  const toggle = (name: string) => {
    if (selected == null) {
      const next = projects.filter((p) => p.name !== name).map((p) => p.name);
      dispatch(setSelectedProjects(next));
      return;
    }
    const has = selected.includes(name);
    const next = has
      ? selected.filter((p) => p !== name)
      : [...selected, name];
    if (next.length === projects.length) {
      dispatch(setSelectedProjects(null));
    } else {
      dispatch(setSelectedProjects(next));
    }
  };

  const selectAll = () => dispatch(setSelectedProjects(null));
  const clearAll = () => dispatch(setSelectedProjects([]));

  const activeCount =
    selected == null ? projects.length : selected.length;

  const onBackdropMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    downOnBackdropRef.current = e.target === e.currentTarget;
  };
  const onBackdropMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (downOnBackdropRef.current && e.target === e.currentTarget) {
      dispatch(closeProjectFilter());
    }
    downOnBackdropRef.current = false;
  };

  return (
    <div
      className="modal-backdrop show"
      onMouseDown={onBackdropMouseDown}
      onMouseUp={onBackdropMouseUp}
    >
      <div
        className="modal project-filter-modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
            Filter projects ({activeCount} / {projects.length})
          </h3>
          <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
            <button className="pf-action" onClick={selectAll}>
              Select all
            </button>
            <button className="pf-action" onClick={clearAll}>
              Clear all
            </button>
            <button
              className="pf-close"
              onClick={() => dispatch(closeProjectFilter())}
              title="Close (Esc)"
            >
              ×
            </button>
          </div>
        </div>

        <div className="pf-add-row">
          <input
            type="text"
            className="pf-add-input"
            placeholder="Add new project…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onAddProject();
              }
            }}
            disabled={adding}
          />
          <button
            type="button"
            className="pf-add-btn"
            onClick={onAddProject}
            disabled={adding || !newName.trim()}
            title="Create a new empty project"
          >
            {adding ? "…" : "+ Add"}
          </button>
        </div>

        <div className="pf-list">
          {projects.length === 0 && (
            <div style={{ padding: 16, color: "var(--text-3)" }}>
              No projects yet — use the "+ Add" button above to create one
            </div>
          )}
          {projects.map((p) => {
            const busy = deletingProject === p.name;
            const isNoBucket = p.name === NO_PROJECT_KEY;
            return (
              <div key={p.name} className="pf-item">
                <label className="pf-row">
                  <input
                    type="checkbox"
                    checked={isChecked(p.name)}
                    onChange={() => toggle(p.name)}
                    disabled={busy}
                  />
                  <span className="pf-name">
                    {p.name}
                    {!isNoBucket && p.count === 0 && (
                      <span className="pf-empty-tag" title="empty project">
                        empty
                      </span>
                    )}
                  </span>
                  <span className="pf-count">{p.count}</span>
                </label>
                {!isNoBucket && (
                  <button
                    type="button"
                    className="pf-del"
                    onClick={() => onDeleteProject(p.name, p.count)}
                    disabled={busy || deletingProject !== null}
                    title={
                      p.count > 0
                        ? `Delete every knowledge in project "${p.name}"`
                        : `Delete empty project "${p.name}"`
                    }
                    aria-label={`Delete project ${p.name}`}
                  >
                    {busy ? "…" : "🗑"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
