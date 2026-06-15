import { useEffect, useRef, useState } from "react";
import {
  portalApi,
  useDeletePageMutation,
  useGetPageQuery,
  useGetPageRenderedQuery,
  useListRevisionsQuery,
  usePruneRevisionsMutation,
  useSetPageArchivedMutation,
  useUpdatePageMutation,
} from "../store/api";
import { useAppDispatch, useAppSelector } from "../store";
import { showToast } from "../store/uiSlice";
import { useMermaidCharts } from "../hooks/useMermaidCharts";
import { useChecklistToggles } from "../hooks/useChecklistToggles";
import { useImageResize } from "../hooks/useImageResize";
import { navigateTo } from "../hooks/useHash";
import { openBadgeMenu } from "../lib/badgeMenu";
import { PageEditor, type PageEditorHandle } from "./PageEditor";
import { PageDiffModal } from "./PageDiffModal";
import { ImageUploadModal } from "./ImageUploadModal";

/**
 * Find `{@N}` annotations that appear more than once on a fence-open line in
 * the same content. Each block id is supposed to be unique within a page
 * (and globally), so duplicates usually mean the author copy-pasted a fenced
 * block and forgot to strip the id so the server can re-allocate.
 *
 * Returns a Map of duplicated id → occurrence count, or null when there are
 * no duplicates.
 */
function findDuplicateBlockIds(content: string): Map<number, number> | null {
  const lines = content.split("\n");
  const counts = new Map<number, number>();
  let inFence = false;
  let fenceMarker = "";
  for (const line of lines) {
    if (!inFence) {
      const open = /^\s*(```+)\s*([A-Za-z0-9_-]+)([^\n]*)$/.exec(line);
      if (open) {
        inFence = true;
        fenceMarker = open[1];
        const idMatch = /\{@(\d+)\}/.exec(open[3]);
        if (idMatch) {
          const id = Number(idMatch[1]);
          counts.set(id, (counts.get(id) ?? 0) + 1);
        }
      }
    } else {
      const close = new RegExp(`^\\s*${fenceMarker}\\s*$`);
      if (close.test(line)) {
        inFence = false;
        fenceMarker = "";
      }
    }
  }
  const dups = new Map<number, number>();
  for (const [id, c] of counts) if (c > 1) dups.set(id, c);
  return dups.size > 0 ? dups : null;
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.max(0, Math.floor(diff / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

interface Props {
  pageId: number;
  line: number | null;
  block: number | null;
}

export function PageContent({ pageId, line, block }: Props) {
  // refetchOnMountOrArgChange: re-check the page's version from the server
  // whenever the user navigates to a (possibly cached) page. If the server's
  // version moved on (another session / AI edited it), the version-watcher
  // effect below invalidates the rendered + revisions cache so the article
  // and pill row catch up.
  const meta = useGetPageQuery(pageId, { refetchOnMountOrArgChange: true });
  const revisions = useListRevisionsQuery(pageId);
  const [viewVersion, setViewVersion] = useState<number | null>(null);
  const rendered = useGetPageRenderedQuery({
    pageId,
    version: viewVersion ?? undefined,
  });
  const [delPage] = useDeletePageMutation();
  const [pruneRevisions, pruneState] = usePruneRevisionsMutation();
  const [updatePage, updateState] = useUpdatePageMutation();
  const [setPageArchived] = useSetPageArchivedMutation();
  const dispatch = useAppDispatch();
  const theme = useAppSelector((s) => s.ui.theme);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>("");
  const [diffOpen, setDiffOpen] = useState(false);
  const [jumpLine, setJumpLine] = useState<number | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const editorRef = useRef<PageEditorHandle | null>(null);

  useMermaidCharts(
    bodyRef,
    // `editing` must be in the dep list: toggling Edit raw → Cancel
    // unmounts + remounts the article element without changing any of
    // the other deps, so without this the badge/click handlers would
    // stay bound to the destroyed DOM and the @N menu would never
    // open again until a full reload.
    [rendered.data ?? "", theme, pageId, viewVersion, editing],
    theme,
    pageId,
  );
  useChecklistToggles();
  useImageResize(
    bodyRef,
    viewVersion == null && !editing ? pageId : null,
    rendered.data ?? "",
  );

  // Reset to latest + exit edit mode whenever the current page changes.
  useEffect(() => {
    setViewVersion(null);
    setEditing(false);
  }, [pageId]);

  // Per-page snapshot of the version we've seen so far. If a navigation
  // brings up a page whose server version is now newer than what we had
  // cached, invalidate the rendered HTML + revisions list for that pid so
  // the article and the version pills both catch up.
  const lastSeenVersionRef = useRef<Map<number, number>>(new Map());
  useEffect(() => {
    if (!meta.data) return;
    const v = meta.data.version;
    const prev = lastSeenVersionRef.current.get(pageId);
    lastSeenVersionRef.current.set(pageId, v);
    if (prev != null && prev !== v) {
      dispatch(
        portalApi.util.invalidateTags([
          { type: "PageRendered", id: pageId },
          { type: "Revisions", id: pageId },
        ]),
      );
    }
  }, [pageId, meta.data?.version, dispatch]);

  // Block-badge "Edit this block" → enter edit mode + scroll editor to
  // the first CONTENT line of the block (not the fence-opening or the
  // standalone {@N} annotation line itself).
  //
  // Fence block:                Table block:
  //   ```mermaid {@N "..."}       | Col1 | Col2 |   ← target (table header)
  //   graph TD                    |------|------|
  //     ...           ← target    | a    | b    |
  //   ```                         {@N "caption"}
  useEffect(() => {
    const onEditBlock = (e: Event) => {
      const detail = (e as CustomEvent).detail as { blockId: number };
      if (!meta.data) return;
      const lines = meta.data.content.split("\n");
      let target = 1;
      const annRe = new RegExp(`\\{@${detail.blockId}(?:\\s|\\})`);
      for (let i = 0; i < lines.length; i++) {
        if (!annRe.test(lines[i])) continue;
        const isFenceOpen = /^\s*```/.test(lines[i]);
        if (isFenceOpen) {
          // First content line of the fence body — skip the opening
          // fence marker. (Empty block? Falls to the closing fence,
          // which is still inside the block geometry.)
          target = i + 2;
        } else {
          // Standalone {@N} sits BELOW the table. Walk back past an
          // optional blank line + every table row to find the header.
          let k = i - 1;
          if (k >= 0 && lines[k].trim() === "") k--;
          const tableRow = /^\s*\|.*\|\s*$/;
          while (k > 0 && tableRow.test(lines[k])) k--;
          target = k + 2; // first row (1-based)
        }
        break;
      }
      setDraft(meta.data.content);
      setEditing(true);
      setJumpLine(target);
    };
    window.addEventListener("wikikai-edit-block", onEditBlock);
    return () => window.removeEventListener("wikikai-edit-block", onEditBlock);
  }, [meta.data]);

  // Invalidate page caches when a block was just deleted via the
  // shared badge menu — the lines are gone server-side and we want the
  // rendered article + revisions list to catch up.
  useEffect(() => {
    const onBlockDeleted = () => {
      dispatch(
        portalApi.util.invalidateTags([
          { type: "Page", id: pageId },
          { type: "PageRendered", id: pageId },
          { type: "Revisions", id: pageId },
        ]),
      );
      dispatch(showToast("deleted block"));
    };
    window.addEventListener("wikikai-block-deleted", onBlockDeleted);
    return () =>
      window.removeEventListener("wikikai-block-deleted", onBlockDeleted);
  }, [pageId, dispatch]);

  useEffect(() => {
    if (!rendered.data) return;
    if (block == null && !line) return;
    const t = setTimeout(() => {
      const root = bodyRef.current;
      if (!root) return;
      if (block != null) {
        const el = root.querySelector<HTMLElement>(
          `[data-block-id="${block}"]`,
        );
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.classList.add("block-flash");
          window.setTimeout(() => el.classList.remove("block-flash"), 1600);
          return;
        }
        dispatch(showToast(`block @${block} not found on this page`));
        return;
      }
      const headings = root.querySelectorAll<HTMLElement>("h1, h2, h3");
      if (headings.length > 0) {
        headings[0].scrollIntoView({ behavior: "smooth", block: "start" });
      }
      dispatch(showToast(`jumped near line ${line}`));
    }, 200);
    return () => clearTimeout(t);
  }, [line, block, rendered.data, dispatch]);

  if (meta.isLoading || rendered.isLoading) {
    return (
      <article className="markdown-body" ref={bodyRef}>
        <p style={{ color: "var(--text-3)", padding: 24 }}>
          Loading page #{pageId}…
        </p>
      </article>
    );
  }
  if (meta.error || rendered.error || !meta.data) {
    return (
      <article className="markdown-body">
        <p style={{ padding: 24 }}>page #{pageId} not found</p>
      </article>
    );
  }

  const kid = meta.data.knowledge_id;
  const isArchived = meta.data.archived === true;
  const onToggleArchive = async () => {
    const next = !isArchived;
    if (
      next &&
      !window.confirm(
        `Archive page "${meta.data!.title}"?\n\nIt will be hidden from the sidebar and search (but not deleted). You can restore it from the "Show archived only" view.`,
      )
    ) {
      return;
    }
    try {
      await setPageArchived({
        page_id: pageId,
        knowledge_id: kid,
        archived: next,
      }).unwrap();
      dispatch(
        showToast({
          message: next ? "Page archived" : "Page restored",
          kind: "success",
        }),
      );
    } catch (err) {
      const e = err as { data?: { error?: string }; status?: number };
      dispatch(
        showToast({
          message: `${next ? "Archive" : "Restore"} failed: ${e.data?.error ?? e.status ?? "error"}`,
          kind: "error",
        }),
      );
    }
  };
  const currentVersion = meta.data.version;
  const activeVersion = viewVersion ?? currentVersion;
  const revList = revisions.data?.revisions ?? [];

  // Timestamp shown in the header — matches whichever version the user is
  // looking at (falls back to the page's updated_at for the live version).
  const activeRevision = revList.find((r) => r.version === activeVersion);
  const activeTimestamp = activeRevision?.created_at ?? meta.data.updated_at;

  const onPruneRevisions = async () => {
    const oldCount = Math.max(0, revList.length - 2);
    if (oldCount === 0) {
      dispatch(showToast("≤ 2 revisions already — nothing to prune"));
      return;
    }
    if (!confirm(`Delete ${oldCount} old revision(s) — keep only the latest 2 versions?`)) {
      return;
    }
    try {
      const r = await pruneRevisions(pageId).unwrap();
      const kept = r.kept_versions.map((v) => `v${v}`).join(", ");
      dispatch(showToast(`Pruned ${r.removed} revision(s) · kept ${kept}`));
      setViewVersion(null);
    } catch (e) {
      const err = e as { status?: number };
      dispatch(showToast(`prune failed: ${err.status ?? "error"}`));
    }
  };

  const onStartEdit = async () => {
    // Pull fresh raw + rendered HTML before opening the editor. Checkbox
    // toggles and other optimistic mutations skip the Page tag invalidation
    // (so the rendered article doesn't get yanked + scroll-jumped). Without
    // refetching here, opening the editor right after toggling a `- [x]`
    // would show the pre-toggle source, and Cancel would visually
    // "revert" the box because the cached rendered HTML is also stale.
    try {
      const fresh = await meta.refetch().unwrap();
      setDraft(fresh.content);
    } catch {
      setDraft(meta.data!.content);
    }
    rendered.refetch();
    setEditing(true);
  };
  const onCancelEdit = () => {
    setEditing(false);
    setDraft("");
  };
  const onSaveEdit = async () => {
    const dups = findDuplicateBlockIds(draft);
    if (dups) {
      const list = Array.from(dups.entries())
        .map(([id, c]) => `@${id} (×${c})`)
        .join(", ");
      alert(
        `Duplicate block ids on this page: ${list}\n\n` +
          `Block ids must be unique. This usually happens when a fenced block is copy-pasted and the {@N} annotation gets duplicated — delete {@N} from every duplicate so the server can allocate fresh ids on save.`,
      );
      return;
    }
    try {
      const r = await updatePage({ page_id: pageId, content: draft }).unwrap();
      dispatch(
        showToast({ message: `Saved · v${r.version}`, kind: "success" }),
      );
      setEditing(false);
      setDraft("");
    } catch (e) {
      const err = e as { status?: number; data?: { error?: string } };
      const detail = err.data?.error ?? err.status ?? "error";
      dispatch(
        showToast({ message: `Save failed: ${detail}`, kind: "error" }),
      );
    }
  };

  return (
    <>
      <div className="article-frame">
      <div className="page-id-header">
        <button
          className="page-id-badge"
          onClick={(e) => {
            const btn = e.currentTarget;
            openBadgeMenu({
              kind: "page",
              id: pageId,
              badge: btn,
              copyText: `#${pageId}`,
              contentUrl: `/api/pages/${pageId}/raw`,
              editLabel: "Edit page name",
              onEdit: () => {
                // Page-name rename. The big "Edit" button in the
                // header still opens the full content editor; this
                // menu item is specifically for the title that shows
                // up in the sidebar / tab list.
                const current = meta.data?.title ?? "";
                const next = window.prompt("Page name:", current);
                if (next == null) return; // cancelled
                const trimmed = next.trim();
                if (!trimmed || trimmed === current) return;
                updatePage({ page_id: pageId, title: trimmed })
                  .unwrap()
                  .then(() => {
                    dispatch(showToast(`renamed to "${trimmed}"`));
                  })
                  .catch((err: unknown) => {
                    const e2 = err as {
                      status?: number;
                      data?: { error?: string };
                    };
                    dispatch(
                      showToast({
                        message: `Rename failed: ${e2.data?.error ?? e2.status ?? "error"}`,
                        kind: "error",
                      }),
                    );
                  });
              },
              deleteLabel: "Delete this page",
              confirmDelete: () =>
                window.confirm(
                  `Delete page "${meta.data?.title ?? `#${pageId}`}" (#${pageId})?\n\nThis is permanent — the page and all its revisions are removed.`,
                ),
              onDelete: async () => {
                await delPage({ page_id: pageId, knowledge_id: kid }).unwrap();
              },
              onDeleteSuccess: () => {
                dispatch(showToast(`deleted page #${pageId}`));
                navigateTo({ kid });
              },
              onDeleteError: (err) => {
                const e2 = err as { status?: number; data?: { error?: string } };
                dispatch(
                  showToast({
                    message: `Delete failed: ${e2.data?.error ?? e2.status ?? "error"}`,
                    kind: "error",
                  }),
                );
              },
              onCopied: (what) =>
                dispatch(
                  showToast(
                    what === "id"
                      ? `copied #${pageId}`
                      : `copied page #${pageId} content`,
                  ),
                ),
              onCopyError: () =>
                dispatch(showToast({ message: "Copy failed", kind: "error" })),
            });
          }}
          title="page actions: copy / edit / delete"
        >
          #{pageId}
        </button>
        {editing ? (
          <>
            <span className="page-edit-actions">
              <button onClick={onCancelEdit} disabled={updateState.isLoading}>
                Cancel
              </button>
              <button
                className="primary"
                onClick={onSaveEdit}
                disabled={updateState.isLoading}
                title="Save raw markdown"
              >
                {updateState.isLoading ? "Saving…" : "Save"}
              </button>
            </span>
            <span className="page-edit-sep" aria-hidden />
            <button
              className="add-images-btn"
              onClick={() => setUploadOpen(true)}
              disabled={updateState.isLoading}
              title="Upload images and insert markdown at the cursor"
            >
              <span aria-hidden style={{ fontSize: 13 }}>🖼</span>
              <span>Add Images</span>
            </button>
          </>
        ) : (
          <>
            <button
              className="page-edit-btn"
              onClick={onStartEdit}
              title={`Edit the raw markdown of page #${pageId} in place`}
              disabled={viewVersion != null && viewVersion !== currentVersion}
            >
              ✎ Edit raw
            </button>
            <button
              className={`page-archive-btn${isArchived ? " archived" : ""}`}
              onClick={onToggleArchive}
              title={
                isArchived
                  ? "Restore this page (unarchive)"
                  : "Archive this page — hides it from sidebar + search without deleting"
              }
            >
              {isArchived ? "⊡ Unarchive" : "⊟ Archive"}
            </button>
            {viewVersion != null && viewVersion !== currentVersion && (
              <button
                type="button"
                className="page-version-latest"
                onClick={() => setViewVersion(null)}
                title={`Back to latest version (v${currentVersion})`}
              >
                → latest
              </button>
            )}
          </>
        )}

        <div className="page-actions">
          <span
            className="page-updated"
            title={`v${activeVersion} · ${new Date(activeTimestamp).toLocaleString()}`}
          >
            {relTime(activeTimestamp)}
          </span>
          {!editing && revList.length > 0 && (
            <div
              className="page-versions"
              title={
                revList.length > 1
                  ? "Click a number to view an older version. Click the latest to return."
                  : `Only one version (v${currentVersion}) — no older snapshots`
              }
            >
              <span className="page-versions-label">v</span>
              {revList.map((r) => (
                <button
                  key={r.version}
                  type="button"
                  className={`page-version${activeVersion === r.version ? " active" : ""}${r.is_current ? " is-current" : ""}`}
                  onClick={() =>
                    setViewVersion(r.is_current ? null : r.version)
                  }
                  title={`v${r.version}${r.is_current ? " (latest)" : ""} · ${r.line_count}L · ${new Date(r.created_at).toLocaleString()}`}
                >
                  {r.version}
                </button>
              ))}
            </div>
          )}
          {!editing && (
            <>
              <button
                className="page-prune-btn"
                onClick={onPruneRevisions}
                disabled={pruneState.isLoading || revList.length <= 2}
                title={
                  revList.length <= 2
                    ? "≤ 2 revisions already — nothing to prune"
                    : `Delete old revisions, keep the latest 2 versions`
                }
              >
                {pruneState.isLoading ? "Pruning…" : "Delete revisions"}
              </button>
            </>
          )}
        </div>
      </div>

      {viewVersion != null && viewVersion !== currentVersion && (
        <div className="page-revision-banner">
          <span>
            Viewing <strong>v{viewVersion}</strong> (older) — the latest is v{currentVersion}
          </span>
          <span
            className="page-revision-when"
            title={new Date(activeTimestamp).toLocaleString()}
          >
            saved {new Date(activeTimestamp).toLocaleString()}
          </span>
          <button
            type="button"
            className="page-revision-diff-btn"
            onClick={() => setDiffOpen(true)}
            title={`Compare v${viewVersion} with v${currentVersion}`}
          >
            🔍 Diff vs v{currentVersion}
          </button>
        </div>
      )}

      {diffOpen && viewVersion != null && viewVersion !== currentVersion && (
        <PageDiffModal
          pageId={pageId}
          oldVersion={viewVersion}
          newVersion={currentVersion}
          newIsLatest
          onClose={() => setDiffOpen(false)}
        />
      )}

      <ImageUploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onInsert={(images) => {
          if (!editorRef.current || images.length === 0) return;
          const ctx = editorRef.current.getCursorContext();
          // Inside another fenced block we can't drop a nested ```images
          // fence — it would close the host. Pick the right inline form
          // based on the host's language:
          //   - html-embed  → raw <img width=… height=… />
          //   - everything else → markdown `![alt](src "WxH")` (the size
          //     slot is consumed by the image renderer; steps
          //     text run through renderInline so this works inside their
          //     JSON string values too).
          if (ctx.inFence) {
            const isHtml = ctx.fenceLang === "html-embed";
            const out = images
              .map((img) => {
                if (isHtml) {
                  const alt = img.alt.replace(/"/g, "&quot;");
                  return `<img src="${img.src}" alt="${alt}" width="${img.width}" height="${img.height}" />`;
                }
                const alt = img.alt.replace(/[\]\\]/g, "");
                return `![${alt}](${img.src} "${img.width}x${img.height}")`;
              })
              .join("\n");
            editorRef.current.insertAtCursor(out);
            return;
          }
          // Top-level → drop an `images` fence so the gallery gets its
          // own @N (server backfills `{@N}` on save).
          const entries = images
            .map((img) => {
              const alt = img.alt.replace(/"/g, '\\"');
              return `  { "src": "${img.src}", "alt": "${alt}", "width": ${img.width}, "height": ${img.height} }`;
            })
            .join(",\n");
          const block = `\n\`\`\`images\n[\n${entries}\n]\n\`\`\`\n`;
          editorRef.current.insertAtCursor(block);
        }}
      />

      {editing ? (
        <div className="page-editor-wrap">
          <PageEditor
            ref={editorRef}
            initial={draft}
            onChange={setDraft}
            theme={theme}
            jumpToLine={jumpLine}
            onJumped={() => setJumpLine(null)}
          />
        </div>
      ) : (
        <article
          className="markdown-body"
          ref={bodyRef}
          // Rendered HTML comes from server-side markdown-it (html: false) with
          // fenced JSON blocks HTML-attr-escaped — safe to inject.
          dangerouslySetInnerHTML={{ __html: rendered.data ?? "" }}
        />
      )}
      <ArticleResizeHandle />
      </div>
    </>
  );
}

/**
 * Drag handle pinned to the right edge of `.article-frame`. Updates a
 * --article-w custom property on <html> (so the page-editor-wrap and the
 * rendered article stay in lockstep). Persists to localStorage; restored
 * once on first mount of any handle in the session.
 */
const STORAGE_KEY = "wikikai-article-w";
let restoredFromStorage = false;
function ArticleResizeHandle() {
  const [dragging, setDragging] = useState(false);
  // Captured on mousedown so each mousemove computes a delta from the
  // pointer's start position, not a re-derivation from frame.left
  // (which itself shifts as the frame grows because the frame is
  // margin:auto centered).
  const startRef = useRef<{ x: number; width: number } | null>(null);

  useEffect(() => {
    if (restoredFromStorage) return;
    restoredFromStorage = true;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const n = raw == null ? NaN : Number(raw);
      if (Number.isFinite(n) && n >= 480 && n <= 2000) {
        document.documentElement.style.setProperty("--article-w", `${n}px`);
      }
    } catch {
      /* private mode / no storage */
    }
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const start = startRef.current;
      if (!start) return;
      // Frame is left-aligned: dragging the right edge by N px grows
      // (or shrinks) the width by N px — no 2× scaling.
      const delta = e.clientX - start.x;
      const next = Math.max(480, Math.min(2000, start.width + delta));
      document.documentElement.style.setProperty(
        "--article-w",
        `${Math.round(next)}px`,
      );
    };
    const onUp = () => {
      setDragging(false);
      startRef.current = null;
      const cur = document.documentElement.style.getPropertyValue("--article-w");
      const n = parseInt(cur.replace("px", ""), 10);
      if (Number.isFinite(n)) {
        try {
          localStorage.setItem(STORAGE_KEY, String(n));
        } catch {
          /* ignore */
        }
      }
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [dragging]);

  return (
    <div
      className={`article-resize-handle${dragging ? " dragging" : ""}`}
      onMouseDown={(e) => {
        e.preventDefault();
        const frame = e.currentTarget.parentElement;
        if (!frame) return;
        startRef.current = {
          x: e.clientX,
          width: frame.getBoundingClientRect().width,
        };
        setDragging(true);
      }}
      onDoubleClick={() => {
        // Reset to default
        document.documentElement.style.removeProperty("--article-w");
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          /* ignore */
        }
      }}
      title="Drag to resize article width · double-click to reset"
      aria-label="Resize article width"
    />
  );
}
