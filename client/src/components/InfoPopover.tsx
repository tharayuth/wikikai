import { useEffect, useMemo, useRef, useState } from "react";
import type { KnowledgeMeta, PageMeta } from "../store/api";
import {
  useDeleteKnowledgeMutation,
  useGetPromptLogQuery,
  useListKnowledgeQuery,
  useListProjectsQuery,
  useUpdateKnowledgeMutation,
} from "../store/api";
import { navigateTo } from "../hooks/useHash";
import { useAppDispatch } from "../store";
import { showToast } from "../store/uiSlice";
import { KnowledgeTagEditor } from "./KnowledgeTagEditor";

interface Props {
  meta: KnowledgeMeta;
  activePage?: PageMeta | null;
  onClose: () => void;
}

function fmtNumber(n: number): string {
  return n.toLocaleString();
}

function fallbackCopy(value: string, onOk: () => void, onFail: () => void) {
  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    if (ok) onOk();
    else onFail();
  } catch {
    onFail();
  }
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function InfoPopover({ meta, activePage, onClose }: Props) {
  const dispatch = useAppDispatch();
  const ref = useRef<HTMLDivElement>(null);
  const { data: projectsData } = useListProjectsQuery();
  const { data: knowledges = [] } = useListKnowledgeQuery();
  const { data: promptLog } = useGetPromptLogQuery(meta.id);
  const [updateKnowledge, { isLoading: saving }] = useUpdateKnowledgeMutation();
  const [deleteKnowledge, { isLoading: deleting }] = useDeleteKnowledgeMutation();
  const [editingProject, setEditingProject] = useState(false);
  const [creatingNew, setCreatingNew] = useState(false);
  const [projectDraft, setProjectDraft] = useState(meta.project ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  const NEW_SENTINEL = "__new__";

  const knownProjects = useMemo(
    () => (projectsData?.projects ?? []).map((p) => p.name),
    [projectsData],
  );
  const knownTags = useMemo(
    () =>
      Array.from(
        new Map(
          knowledges
            .flatMap((knowledge) => knowledge.tags)
            .map((tag) => [tag.toLocaleLowerCase(), tag]),
        ).values(),
      ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [knowledges],
  );

  useEffect(() => {
    // Track where mousedown started — only treat it as an outside click
    // when BOTH the press and the release happen outside the popover.
    // This prevents the popover from closing when the user drags to
    // select text inside it and accidentally releases the mouse outside.
    let downedOutside = false;
    const onDown = (e: MouseEvent) => {
      if (!ref.current) return;
      downedOutside = !ref.current.contains(e.target as Node);
    };
    const onUp = (e: MouseEvent) => {
      if (!ref.current) return;
      const upOutside = !ref.current.contains(e.target as Node);
      if (downedOutside && upOutside) onClose();
      downedOutside = false;
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (editingProject) {
          setEditingProject(false);
          setProjectDraft(meta.project ?? "");
        } else {
          onClose();
        }
      }
    };
    const t = setTimeout(() => {
      window.addEventListener("mousedown", onDown);
      window.addEventListener("mouseup", onUp);
    }, 0);
    window.addEventListener("keydown", onEsc);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onEsc);
    };
  }, [onClose, editingProject, meta.project]);

  useEffect(() => {
    if (!editingProject) return;
    if (creatingNew) inputRef.current?.focus();
    else selectRef.current?.focus();
  }, [editingProject, creatingNew]);

  // Keep the draft in sync if the meta updates from the server.
  useEffect(() => {
    if (!editingProject) {
      setProjectDraft(meta.project ?? "");
      setCreatingNew(false);
    }
  }, [meta.project, editingProject]);

  const copy = (value: string, label: string) => {
    const onOk = () => dispatch(showToast(`copied ${label}`));
    const onFail = () => dispatch(showToast(`Couldn't copy ${label}`));
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).then(onOk, () => fallbackCopy(value, onOk, onFail));
      return;
    }
    fallbackCopy(value, onOk, onFail);
  };

  const commitProject = async (raw: string) => {
    const trimmed = raw.trim();
    const next = trimmed === "" ? null : trimmed;
    if ((meta.project ?? null) === next) {
      setEditingProject(false);
      setCreatingNew(false);
      return;
    }
    try {
      await updateKnowledge({ id: meta.id, project: next }).unwrap();
      dispatch(
        showToast(
          next == null
            ? `Removed &${meta.id} from project`
            : `Moved &${meta.id} → "${next}"`,
        ),
      );
      setEditingProject(false);
      setCreatingNew(false);
    } catch {
      dispatch(showToast(`Failed to move project`));
    }
  };

  const cancelEdit = () => {
    setEditingProject(false);
    setCreatingNew(false);
    setProjectDraft(meta.project ?? "");
  };

  const onSelectChange = (value: string) => {
    if (value === NEW_SENTINEL) {
      setCreatingNew(true);
      setProjectDraft("");
      return;
    }
    commitProject(value);
  };

  return (
    <div className="info-popover" ref={ref}>
      <dl>
        <dt>knowledge id</dt>
        <dd>
          <code onClick={() => copy(`&${meta.id}`, `&${meta.id}`)} title="Click to copy (& = knowledge marker)">
            &amp;{meta.id}
          </code>{" "}
          <span style={{ color: "var(--text-3)" }}>v{meta.version}</span>
        </dd>

        <dt>project</dt>
        <dd>
          {editingProject ? (
            creatingNew ? (
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <input
                  ref={inputRef}
                  type="text"
                  className="ip-project-input"
                  placeholder="New project name"
                  value={projectDraft}
                  onChange={(e) => setProjectDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitProject(projectDraft);
                    }
                  }}
                  disabled={saving}
                />
                <button
                  type="button"
                  className="ip-project-btn save"
                  onClick={() => commitProject(projectDraft)}
                  disabled={saving || !projectDraft.trim()}
                  title="Create and move (Enter)"
                >
                  {saving ? "…" : "✓"}
                </button>
                <button
                  type="button"
                  className="ip-project-btn cancel"
                  onClick={cancelEdit}
                  disabled={saving}
                  title="Cancel (Esc)"
                >
                  ✕
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <select
                  ref={selectRef}
                  className="ip-project-select"
                  value={meta.project ?? ""}
                  onChange={(e) => onSelectChange(e.target.value)}
                  disabled={saving}
                >
                  {!meta.project && (
                    <option value="" disabled hidden>
                      Pick project…
                    </option>
                  )}
                  {knownProjects.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                  <option value={NEW_SENTINEL}>+ New project…</option>
                </select>
                <button
                  type="button"
                  className="ip-project-btn cancel"
                  onClick={cancelEdit}
                  disabled={saving}
                  title="Cancel (Esc)"
                >
                  ✕
                </button>
              </div>
            )
          ) : (
            <span
              className="ip-project-view"
              onClick={() => setEditingProject(true)}
              title="Click to change project"
            >
              {meta.project ? (
                meta.project
              ) : (
                <span style={{ color: "var(--text-3)", fontStyle: "italic" }}>
                  (no project — click to set)
                </span>
              )}{" "}
              <span style={{ color: "var(--text-3)", fontSize: 10 }}>✎</span>
            </span>
          )}
        </dd>

        {meta.session_id && (
          <>
            <dt>session</dt>
            <dd>
              <code
                onClick={() => copy(meta.session_id!, "session id")}
                title="Click to copy — use with claude --resume <id>"
              >
                {meta.session_id}
              </code>
            </dd>
          </>
        )}

        {meta.tokens_used != null && (
          <>
            <dt>tokens used</dt>
            <dd>{fmtNumber(meta.tokens_used)}</dd>
          </>
        )}

        {meta.author && (
          <>
            <dt>author</dt>
            <dd>{meta.author}</dd>
          </>
        )}

        <dt>tags</dt>
        <dd>
          <KnowledgeTagEditor
            tags={meta.tags ?? []}
            suggestions={knownTags}
            disabled={saving}
            onSave={async (tags) => {
              try {
                await updateKnowledge({ id: meta.id, tags }).unwrap();
                dispatch(
                  showToast({
                    message:
                      tags.length > 0
                        ? `Updated tags for &${meta.id}`
                        : `Removed all tags from &${meta.id}`,
                    kind: "success",
                  }),
                );
              } catch (error) {
                dispatch(
                  showToast({
                    message: `Failed to update tags for &${meta.id}`,
                    kind: "error",
                  }),
                );
                throw error;
              }
            }}
          />
        </dd>

        <dt>created</dt>
        <dd>{new Date(meta.created_at).toLocaleString()}</dd>

        <dt>updated</dt>
        <dd>
          {new Date(meta.updated_at).toLocaleString()}{" "}
          <span style={{ color: "var(--text-3)" }}>({relTime(meta.updated_at)})</span>
        </dd>

        {activePage && (
          <>
            <dt style={{ marginTop: 6 }}>active page</dt>
            <dd>
              <code
                onClick={() => copy(`#${activePage.id}`, `#${activePage.id}`)}
                title="Click to copy page id"
              >
                #{activePage.id}
              </code>{" "}
              <span style={{ color: "var(--text-3)" }}>
                v{activePage.version} · {activePage.line_count} lines · pos {activePage.position}
              </span>
              <div style={{ marginTop: 2, color: "var(--text-2)" }}>{activePage.title}</div>
            </dd>
          </>
        )}
      </dl>

      {(promptLog?.entries.length ?? 0) > 0 || meta.user_prompt ? (
        <>
          <hr />
          <div className="prompt-heading">
            <span aria-hidden>💬</span>
            <span>User prompts / questions</span>
            {promptLog && (
              <span className="prompt-count" title="Number of entries in the log">
                {promptLog.entries.length}
              </span>
            )}
          </div>
          <div className="prompt-log">
            {(promptLog?.entries ?? []).map((e) => (
              <div key={e.id} className="prompt-entry">
                <div className="prompt-entry-meta">
                  <span className="prompt-entry-when" title={new Date(e.created_at).toLocaleString()}>
                    {relTime(e.created_at)}
                  </span>
                  {e.page_id != null && (
                    <button
                      type="button"
                      className="prompt-entry-pid"
                      onClick={() => copy(`#${e.page_id}`, `#${e.page_id}`)}
                      title={`page #${e.page_id}${e.page_version != null ? ` · v${e.page_version}` : ""}`}
                    >
                      #{e.page_id}
                      {e.page_version != null && (
                        <span className="prompt-entry-ver">v{e.page_version}</span>
                      )}
                    </button>
                  )}
                  {e.tool_name && (
                    <span className="prompt-entry-tool">{e.tool_name}</span>
                  )}
                </div>
                <div className="prompt-entry-text">{e.prompt}</div>
              </div>
            ))}
            {promptLog?.entries.length === 0 && meta.user_prompt && (
              <div className="prompt-entry">
                <div className="prompt-entry-meta">
                  <span className="prompt-entry-when">{relTime(meta.created_at)}</span>
                  <span className="prompt-entry-tool">add_knowledge</span>
                </div>
                <div className="prompt-entry-text">{meta.user_prompt}</div>
              </div>
            )}
          </div>
        </>
      ) : null}

      <hr />
      <div className="ip-danger-zone">
        <button
          type="button"
          className="ip-delete-knowledge"
          disabled={deleting}
          onClick={async () => {
            const title = meta.title;
            if (
              !window.confirm(
                `⚠️ Delete knowledge "${title}" (&${meta.id})?\n\nEvery page, revision, and any image used only by this knowledge will be removed permanently. This cannot be undone.`,
              )
            ) {
              return;
            }
            try {
              const r = (await deleteKnowledge(meta.id).unwrap()) as {
                id: number;
                deleted: true;
                removed_images?: number;
              };
              const imgPart =
                r.removed_images && r.removed_images > 0
                  ? ` · cleaned ${r.removed_images} orphan image(s)`
                  : "";
              dispatch(
                showToast({
                  message: `Deleted "${title}"${imgPart}`,
                  kind: "success",
                }),
              );
              onClose();
              navigateTo({ kid: null });
            } catch (e) {
              const err = e as { status?: number; data?: { error?: string } };
              dispatch(
                showToast({
                  message: `Delete failed: ${err.data?.error ?? err.status ?? "error"}`,
                  kind: "error",
                }),
              );
            }
          }}
        >
          {deleting ? "Deleting…" : `🗑 Delete knowledge "${meta.title}"`}
        </button>
      </div>
    </div>
  );
}
