import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useAddKnowledgeMutation,
  useAddPageMutation,
  useDeleteKnowledgeMutation,
  useGetKnowledgeQuery,
  useListKnowledgeQuery,
  useListPageTitlesQuery,
  useListProjectsQuery,
  useMovePageToKnowledgeMutation,
  useRenameProjectMutation,
  useReorderPagesMutation,
  useUpdateKnowledgeMutation,
  type KnowledgeMeta,
  type PageMeta,
} from "../store/api";
import { useAppDispatch } from "../store";
import { navigateTo, useHash } from "../hooks/useHash";
import { openActionMenu, openKnowledgeBadgeMenu } from "../lib/badgeMenu";
import { openShareModal, showToast } from "../store/uiSlice";
import {
  readStarredKnowledgeIds,
  STARRED_KNOWLEDGE_EVENT,
  toggleKnowledgeStar,
} from "../lib/starredKnowledge";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface Props {
  activeKid: number | null;
  activePid: number | null;
  onPick: (kid: number) => void;
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

function groupByProject(items: KnowledgeMeta[]): [string, KnowledgeMeta[]][] {
  const map = new Map<string, KnowledgeMeta[]>();
  for (const it of items) {
    const key = it.project || "(no project)";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(it);
  }
  return Array.from(map.entries());
}

interface RowProps {
  item: KnowledgeMeta;
  isActive: boolean;
  activePid: number | null;
  onPickKnowledge: (kid: number) => void;
  /** When set, force this row open + only show pages whose id is in the set. */
  pageFilter: Set<number> | null;
  starred: boolean;
  /** Show only archived pages (true) vs hide archived pages (false). */
  archivedOnly: boolean;
  /** Publish this knowledge's full page-id order up to the sidebar drag
   *  handler (so cross-/within-knowledge drops can compute positions). */
  registerOrder: (kid: number, order: number[]) => void;
  unregisterOrder: (kid: number) => void;
}

function SortablePageItem({
  kid,
  page,
  isActive,
  dragDisabled,
}: {
  kid: number;
  page: PageMeta;
  isActive: boolean;
  dragDisabled: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: page.id,
    disabled: dragDisabled,
    data: { type: "page", kid, pageId: page.id },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`sidebar-page-li${page.archived ? " archived" : ""}`}
    >
      {!dragDisabled && (
        <button
          type="button"
          className="sidebar-page-handle"
          aria-label={`Reorder or move ${page.title}`}
          title="Drag to reorder, or drop onto another topic to move it there"
          {...attributes}
          {...listeners}
          onClick={(e) => e.preventDefault()}
        >
          <svg
            viewBox="0 0 24 24"
            width="10"
            height="14"
            fill="currentColor"
            aria-hidden="true"
          >
            <circle cx="9" cy="6" r="1.5" />
            <circle cx="15" cy="6" r="1.5" />
            <circle cx="9" cy="12" r="1.5" />
            <circle cx="15" cy="12" r="1.5" />
            <circle cx="9" cy="18" r="1.5" />
            <circle cx="15" cy="18" r="1.5" />
          </svg>
        </button>
      )}
      <a
        className={`sidebar-page${isActive ? " active" : ""}`}
        href={`/&${kid}/#${page.id}`}
        title={page.summary ?? page.title}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          navigateTo({ kid, pid: page.id });
        }}
      >
        <span className="page-title">{page.title}</span>
      </a>
    </li>
  );
}

function KnowledgeRow({
  item,
  isActive,
  activePid,
  onPickKnowledge,
  pageFilter,
  starred,
  archivedOnly,
  registerOrder,
  unregisterOrder,
}: RowProps) {
  const [open, setOpen] = useState(isActive);
  const dispatch = useAppDispatch();
  const [addPage] = useAddPageMutation();
  const [deleteKnowledge] = useDeleteKnowledgeMutation();
  const [updateKnowledge] = useUpdateKnowledgeMutation();

  // Each row is a drop zone — dropping a page onto it moves the page into this
  // knowledge (appended to the end). Namespaced id avoids clashing with the
  // numeric page sortable ids.
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `k:${item.id}`,
    data: { type: "knowledge", kid: item.id },
  });

  const onIdBadgeClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    // The badge sits inside the row's <a>; stop the click from also
    // navigating / toggling the row.
    e.preventDefault();
    e.stopPropagation();
    openKnowledgeBadgeMenu({
      badge: e.currentTarget,
      id: item.id,
      title: item.title,
      renameKnowledge: (id, title) => updateKnowledge({ id, title }).unwrap(),
      deleteKnowledge: (id) => deleteKnowledge(id).unwrap(),
      addPage: (id, title) =>
        addPage({ knowledge_id: id, title, content: "" }).unwrap(),
      notify: (message, kind) =>
        dispatch(showToast(kind ? { message, kind } : message)),
      // Expand the row + jump to the freshly-created page.
      onPageAdded: (pid) => {
        setOpen(true);
        navigateTo({ kid: item.id, pid });
      },
      // Only navigate away when the row that was deleted is the one
      // currently open — deleting some other topic shouldn't yank you out.
      onDeleted: () => {
        if (isActive) navigateTo({ kid: null });
      },
      onShare: () => dispatch(openShareModal(item.id)),
    });
  };

  // Auto-expand when this knowledge becomes the active one.
  useEffect(() => {
    if (isActive) setOpen(true);
  }, [isActive]);

  // A search page-filter or the archived-only view both force the row open.
  const effectiveOpen = pageFilter != null || archivedOnly ? true : open;
  const { data } = useGetKnowledgeQuery(item.id, { skip: !effectiveOpen });
  const allPages = data?.pages ?? [];
  const pages = (pageFilter ? allPages.filter((p) => pageFilter.has(p.id)) : allPages)
    // archived-only mode shows just the archived pages; normal mode hides them.
    .filter((p) => (archivedOnly ? p.archived : !p.archived));

  // Publish the full page order so the sidebar-level drag handler can compute
  // reorder permutations and cross-knowledge drop positions. Re-runs only when
  // the actual id sequence changes (orderKey), not on every render.
  const orderKey = allPages.map((p) => p.id).join(",");
  useEffect(() => {
    if (!effectiveOpen) return;
    const ids = orderKey ? orderKey.split(",").map(Number) : [];
    registerOrder(item.id, ids);
    return () => unregisterOrder(item.id);
  }, [item.id, orderKey, effectiveOpen, registerOrder, unregisterOrder]);

  // Page drag is disabled while a page-filter / archived view is active — the
  // rendered list isn't the full knowledge order, so a reorder drop would
  // scramble positions. A single-page knowledge stays draggable so the page
  // can be moved OUT to another topic.
  const dragDisabled = pageFilter != null || archivedOnly;

  return (
    <div
      ref={setDropRef}
      className={`sidebar-row has-star-action${isActive ? " active-row" : ""}${
        isOver ? " drop-target" : ""
      }`}
    >
      <a
        className={`sidebar-item${isActive ? " active" : ""}`}
        href={`/&${item.id}`}
        aria-expanded={effectiveOpen}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          if (isActive) {
            // Already navigated here — click acts as expand/collapse toggle.
            // (Skipped when a page-filter is forcing the row open.)
            if (pageFilter == null) setOpen((o) => !o);
          } else {
            onPickKnowledge(item.id);
            setOpen(true);
          }
        }}
      >
        <span
          className={`sidebar-chevron${effectiveOpen ? " open" : ""}`}
          aria-hidden
        >
          <svg
            viewBox="0 0 24 24"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="9 6 15 12 9 18" />
          </svg>
        </span>
        <div className="ki-body">
          <div className="title">{item.title}</div>
          <div className="meta">
            <button
              type="button"
              className="id-badge"
              onClick={onIdBadgeClick}
              title={`&${item.id} actions: copy / edit / delete`}
              aria-label={`Knowledge ${item.id} actions`}
            >
              &amp;{item.id}
            </button>
            <span>{relTime(item.updated_at)}</span>
            {item.version > 1 && <span>v{item.version}</span>}
          </div>
          {item.tags.length > 0 && (
            <div className="sidebar-tags" title={item.tags.join(", ")}>
              {item.tags.slice(0, 3).map((tag) => (
                <span key={tag.toLocaleLowerCase()}>{tag}</span>
              ))}
              {item.tags.length > 3 && <span>+{item.tags.length - 3}</span>}
            </div>
          )}
        </div>
      </a>
      <button
        type="button"
        className={`sidebar-star-btn${starred ? " active" : ""}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const next = toggleKnowledgeStar(item.id);
          dispatch(showToast(next ? "Starred topic" : "Unstarred topic"));
        }}
        title={starred ? "Unstar this topic" : "Star this topic"}
        aria-label={starred ? `Unstar ${item.title}` : `Star ${item.title}`}
        aria-pressed={starred}
      >
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill={starred ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      </button>
      {effectiveOpen && pages.length > 0 && (
        <SortableContext
          items={pages.map((p) => p.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="sidebar-pages">
            {pages.map((p) => (
              <SortablePageItem
                key={p.id}
                kid={item.id}
                page={p}
                isActive={isActive && p.id === activePid}
                dragDisabled={dragDisabled}
              />
            ))}
          </ul>
        </SortableContext>
      )}
    </div>
  );
}

export function Sidebar({ activeKid, activePid, onPick }: Props) {
  const { data: items = [], isLoading } = useListKnowledgeQuery();
  const { data: pageTitles = [] } = useListPageTitlesQuery();
  const { data: projectList } = useListProjectsQuery();
  const { location } = useHash();
  const urlFilter = location.projects;
  const [filterText, setFilterText] = useState("");

  // name <-> id maps from the project registry (ids power the sidebar badge
  // and the `?projects=` menu filter).
  const { nameToId, idToName } = useMemo(() => {
    const nameToId = new Map<string, number>();
    const idToName = new Map<number, string>();
    for (const p of projectList?.projects ?? []) {
      if (p.id != null) {
        nameToId.set(p.name, p.id);
        idToName.set(p.id, p.name);
      }
    }
    return { nameToId, idToName };
  }, [projectList]);
  const [starredOnly, setStarredOnly] = useState(false);
  const [archivedOnly, setArchivedOnly] = useState(false);
  const [starredIds, setStarredIds] = useState<Set<number>>(() =>
    readStarredKnowledgeIds(),
  );

  // Knowledge ids owning ≥1 archived page — drives the archived-only filter.
  const archivedKids = useMemo(() => {
    const s = new Set<number>();
    for (const p of pageTitles) if (p.archived) s.add(p.knowledge_id);
    return s;
  }, [pageTitles]);

  useEffect(() => {
    const refresh = () => setStarredIds(readStarredKnowledgeIds());
    window.addEventListener(STARRED_KNOWLEDGE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(STARRED_KNOWLEDGE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  // ─── Drag-and-drop (sidebar-wide) ───
  // One DndContext wraps every row so a page can be dragged within its
  // knowledge (reorder) OR onto another knowledge (move). Each expanded row
  // publishes its page-id order into this map; the drop handler reads it to
  // build reorder permutations and resolve drop positions.
  const dispatch = useAppDispatch();
  const [reorderPages] = useReorderPagesMutation();
  const [movePageToKnowledge] = useMovePageToKnowledgeMutation();
  const ordersRef = useRef<Map<number, number[]>>(new Map());
  const registerOrder = useCallback((kid: number, order: number[]) => {
    ordersRef.current.set(kid, order);
  }, []);
  const unregisterOrder = useCallback((kid: number) => {
    ordersRef.current.delete(kid);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Small drag distance so plain clicks on the handle don't start a drag
      // (and the page link below still receives clicks).
      activationConstraint: { distance: 4 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over) return;
      const activeData = active.data.current as
        | { type: "page"; kid: number; pageId: number }
        | undefined;
      if (!activeData || activeData.type !== "page") return;
      const pageId = activeData.pageId;
      const sourceKid = activeData.kid;
      const overData = over.data.current as
        | { type: "page"; kid: number; pageId: number }
        | { type: "knowledge"; kid: number }
        | undefined;
      if (!overData) return;

      // Same-knowledge reorder: dropped on a sibling page.
      if (overData.type === "page" && overData.kid === sourceKid) {
        if (active.id === over.id) return;
        const ids = ordersRef.current.get(sourceKid) ?? [];
        const oldIdx = ids.indexOf(pageId);
        const newIdx = ids.indexOf(Number(over.id));
        if (oldIdx < 0 || newIdx < 0) return;
        const next = [...ids];
        next.splice(oldIdx, 1);
        next.splice(newIdx, 0, pageId);
        try {
          await reorderPages({ knowledge_id: sourceKid, order: next }).unwrap();
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Failed to reorder";
          dispatch(showToast(`Reorder failed: ${msg}`));
        }
        return;
      }

      // Cross-knowledge move. Target is either the hovered page's knowledge
      // (insert at that page's slot) or a knowledge row (append to the end).
      const targetKid = overData.kid;
      if (targetKid === sourceKid) return;
      let position: number | undefined;
      if (overData.type === "page") {
        const targetIds = ordersRef.current.get(targetKid) ?? [];
        const overIdx = targetIds.indexOf(Number(over.id));
        if (overIdx >= 0) position = overIdx + 1;
      }
      try {
        await movePageToKnowledge({
          page_id: pageId,
          from_knowledge_id: sourceKid,
          to_knowledge_id: targetKid,
          position,
        }).unwrap();
        dispatch(showToast({ message: "Page moved", kind: "success" }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to move page";
        dispatch(showToast({ message: `Move failed: ${msg}`, kind: "error" }));
      }
    },
    [dispatch, reorderPages, movePageToKnowledge],
  );

  const filtered = useMemo(() => {
    const projectFiltered = (() => {
      // `?projects=` in the URL is the single source of truth. Absent → no
      // filter (show all). Present → keep only the selected ids + the
      // "(no project)" bucket (sentinel `none`); a present-but-empty param is
      // an explicit empty selection (show nothing).
      if (urlFilter == null) return items;
      // Wait until the registry has loaded before resolving ids → names, to
      // avoid an empty flash when ids are present but the map is still empty.
      if (urlFilter.ids.length > 0 && idToName.size === 0) return items;
      const allowed = new Set(
        urlFilter.ids
          .map((id) => idToName.get(id))
          .filter((n): n is string => n != null),
      );
      if (urlFilter.noProject) allowed.add("(no project)");
      return items.filter((it) => allowed.has(it.project || "(no project)"));
    })();
    const afterStar = starredOnly
      ? projectFiltered.filter((it) => starredIds.has(it.id))
      : projectFiltered;
    // Archived-only view: keep just the topics that own an archived page.
    if (archivedOnly) return afterStar.filter((it) => archivedKids.has(it.id));
    return afterStar;
  }, [
    items,
    urlFilter,
    idToName,
    starredOnly,
    starredIds,
    archivedOnly,
    archivedKids,
  ]);

  const q = filterText.trim().toLowerCase();

  // knowledge_id -> set of page ids whose title matches `q`. Null when no filter.
  const matchedPagesByKid = useMemo(() => {
    if (!q) return null;
    const map = new Map<number, Set<number>>();
    for (const p of pageTitles) {
      // Match only pages in the active archive state (don't surface archived
      // pages in a normal filter, and vice-versa).
      if (archivedOnly ? !p.archived : p.archived) continue;
      if (p.title.toLowerCase().includes(q)) {
        let set = map.get(p.knowledge_id);
        if (!set) {
          set = new Set();
          map.set(p.knowledge_id, set);
        }
        set.add(p.id);
      }
    }
    return map;
  }, [pageTitles, q, archivedOnly]);

  const matched = useMemo(() => {
    if (!q) return filtered;
    return filtered.filter(
      (it) =>
        it.title.toLowerCase().includes(q) ||
        (it.project ?? "").toLowerCase().includes(q) ||
        it.tags.some((tag) => tag.toLowerCase().includes(q)) ||
        (matchedPagesByKid?.has(it.id) ?? false),
    );
  }, [filtered, q, matchedPagesByKid]);

  const searchBox = (
    <div className="sidebar-search">
      <input
        type="search"
        placeholder="Filter project / topic / tag / page…"
        value={filterText}
        onChange={(e) => setFilterText(e.target.value)}
        aria-label="Filter projects, topics, tags, or pages"
      />
      {filterText && (
        <button
          type="button"
          className="sidebar-search-clear"
          aria-label="Clear filter"
          onClick={() => setFilterText("")}
        >
          ×
        </button>
      )}
      <button
        type="button"
        className={`sidebar-archive-filter${archivedOnly ? " active" : ""}`}
        aria-label={archivedOnly ? "Show active topics" : "Show archived only"}
        aria-pressed={archivedOnly}
        title={archivedOnly ? "Showing archived only" : "Show archived only"}
        onClick={() => setArchivedOnly((v) => !v)}
      >
        <svg
          viewBox="0 0 24 24"
          width="15"
          height="15"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 8v13H3V8" />
          <path d="M1 3h22v5H1z" />
          <path d="M10 12h4" />
        </svg>
      </button>
      <button
        type="button"
        className={`sidebar-star-filter${starredOnly ? " active" : ""}`}
        aria-label={starredOnly ? "Show all topics" : "Show starred topics only"}
        aria-pressed={starredOnly}
        title={starredOnly ? "Showing starred topics only" : "Show starred topics only"}
        onClick={() => setStarredOnly((v) => !v)}
      >
        <svg
          viewBox="0 0 24 24"
          width="15"
          height="15"
          fill={starredOnly ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      </button>
    </div>
  );

  if (isLoading) {
    return (
      <aside className="sidebar" id="sidebar">
        {searchBox}
        <div className="sidebar-empty">Loading…</div>
      </aside>
    );
  }
  if (matched.length === 0) {
    return (
      <aside className="sidebar" id="sidebar">
        {searchBox}
        <div className="sidebar-empty">
          {items.length === 0 ? (
            <>
              No knowledge yet
              <br />
              <br />
              Use the MCP tool <code>add_knowledge</code> to create one
            </>
          ) : filterText ? (
            `No matches for "${filterText}"`
          ) : archivedOnly ? (
            "No archived pages"
          ) : starredOnly ? (
            "No starred topics"
          ) : (
            "No items in the selected projects"
          )}
        </div>
      </aside>
    );
  }

  // When `?projects=` is active, order the groups to match the id sequence
  // in the URL (e.g. `?projects=7,9,8` → 7, then 9, then 8). Otherwise keep
  // the natural order in which knowledge appears.
  const projectGroups = (() => {
    const groups = groupByProject(matched);
    const orderIds = urlFilter?.ids;
    if (orderIds == null || orderIds.length === 0) return groups;
    const rank = (name: string) => {
      const id = nameToId.get(name);
      const i = id != null ? orderIds.indexOf(id) : -1;
      return i < 0 ? Number.MAX_SAFE_INTEGER : i;
    };
    return [...groups].sort((a, b) => rank(a[0]) - rank(b[0]));
  })();

  return (
    <aside className="sidebar" id="sidebar">
      {searchBox}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        {projectGroups.map(([project, list]) => {
          const containsActive =
            activeKid != null && list.some((it) => it.id === activeKid);
          return (
          <ProjectGroup
            key={project}
            project={project}
            projectId={nameToId.get(project) ?? null}
            containsActive={containsActive}
          >
            {list.map((it) => {
              // Only narrow pages list when the knowledge appeared *because* a
              // page matched (i.e. its title / project did not match `q`).
              const onlyByPageMatch =
                q !== "" &&
                !it.title.toLowerCase().includes(q) &&
                !(it.project ?? "").toLowerCase().includes(q) &&
                !it.tags.some((tag) => tag.toLowerCase().includes(q));
              const pageFilter =
                onlyByPageMatch ? matchedPagesByKid?.get(it.id) ?? null : null;
              return (
                <KnowledgeRow
                  key={it.id}
                  item={it}
                  isActive={it.id === activeKid}
                  activePid={activePid}
                  onPickKnowledge={onPick}
                  pageFilter={pageFilter}
                  starred={starredIds.has(it.id)}
                  archivedOnly={archivedOnly}
                  registerOrder={registerOrder}
                  unregisterOrder={unregisterOrder}
                />
              );
            })}
          </ProjectGroup>
          );
        })}
      </DndContext>
    </aside>
  );
}

const PROJECT_OPEN_KEY = (project: string) =>
  `wikikai.sidebar.project.${project}`;

/** Read the stored open/closed preference for a project, or null if unset. */
function readStoredOpen(project: string): boolean | null {
  try {
    const v = localStorage.getItem(PROJECT_OPEN_KEY(project));
    if (v === "1") return true;
    if (v === "0") return false;
  } catch {
    /* localStorage may be unavailable (private mode, SSR) */
  }
  return null;
}

function writeStoredOpen(project: string, open: boolean): void {
  try {
    localStorage.setItem(PROJECT_OPEN_KEY(project), open ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function ProjectGroup({
  project,
  projectId,
  containsActive,
  children,
}: {
  project: string;
  /** Registry id, or null for unregistered names like "(no project)". */
  projectId: number | null;
  /** True when the currently-active knowledge belongs to this project.
   *  Used as the default initial state and to auto-open when the user
   *  navigates into the group — but NEVER as a hard force-open, so the
   *  toggle button always works. */
  containsActive: boolean;
  children: React.ReactNode;
}) {
  // Default is COLLAPSED unless this group contains the active knowledge.
  // localStorage remembers the user's explicit toggle per project and
  // always wins over the default.
  const [open, setOpen] = useState<boolean>(() => {
    const stored = readStoredOpen(project);
    if (stored != null) return stored;
    return containsActive;
  });

  // When `containsActive` flips false → true (user navigates into this
  // project), auto-open the group so the active row is visible — but
  // only when the user hasn't explicitly stored a preference, so a
  // manually-collapsed group stays collapsed on navigation.
  useEffect(() => {
    if (containsActive && readStoredOpen(project) == null) {
      setOpen(true);
    }
  }, [containsActive, project]);

  const toggle = () => {
    setOpen((o) => {
      const next = !o;
      writeStoredOpen(project, next);
      return next;
    });
  };

  const dispatch = useAppDispatch();
  const [addKnowledge, { isLoading: adding }] = useAddKnowledgeMutation();
  const [renameProject] = useRenameProjectMutation();

  const copyId = async () => {
    if (projectId == null) return;
    try {
      await navigator.clipboard.writeText(String(projectId));
      dispatch(showToast(`Copied project id ${projectId}`));
    } catch {
      dispatch(showToast(`Project id ${projectId}`));
    }
  };

  const openOnlyThisProject = () => {
    if (projectId == null) return;
    // Fresh tab showing just this project (the `?projects=` menu filter).
    window.open(`${window.location.origin}/?projects=${projectId}`, "_blank", "noopener");
  };

  const onRenameProject = async () => {
    const next = window.prompt("Project name:", project);
    if (next == null) return; // cancelled
    const trimmed = next.trim();
    if (!trimmed || trimmed === project) return;
    try {
      await renameProject({ oldName: project, name: trimmed }).unwrap();
      dispatch(showToast({ message: `Renamed to "${trimmed}"`, kind: "success" }));
    } catch (err) {
      const e = err as { data?: { error?: string }; status?: number };
      dispatch(
        showToast({
          message: `Rename failed: ${e.data?.error ?? e.status ?? "error"}`,
          kind: "error",
        }),
      );
    }
  };

  const onBadgeClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (projectId == null) return;
    openActionMenu({
      kind: "project",
      badge: e.currentTarget,
      items: [
        { label: `Copy id ${projectId}`, icon: "copy", onSelect: copyId },
        { label: "Open only this project (new tab)", icon: "open", onSelect: openOnlyThisProject },
        { label: "Edit project name", icon: "edit", onSelect: onRenameProject },
      ],
    });
  };

  const onAddKnowledge = async () => {
    const title = window.prompt(`New knowledge in "${project}" — title?`, "");
    if (!title || !title.trim()) return;
    try {
      const created = await addKnowledge({
        title: title.trim(),
        project,
      }).unwrap();
      // Make sure the group is expanded so the user sees the new entry
      if (!open) {
        writeStoredOpen(project, true);
        setOpen(true);
      }
      navigateTo({ kid: created.id });
      dispatch(showToast(`Created "${created.title}"`));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create";
      dispatch(showToast(`Create failed: ${msg}`));
    }
  };

  return (
    <div className={`sidebar-group${open ? "" : " collapsed"}`}>
      <div className="sidebar-group-header">
        <button
          type="button"
          className={`sidebar-group-title${open ? " open" : ""}`}
          aria-expanded={open}
          onClick={toggle}
        >
          <span className="group-chevron" aria-hidden>
            {open ? "📖" : "📕"}
          </span>
          <span className="group-name">{project}</span>
        </button>
        <button
          type="button"
          className="sidebar-group-add-btn"
          onClick={onAddKnowledge}
          disabled={adding}
          title={`Add knowledge to ${project}`}
          aria-label={`Add knowledge to ${project}`}
        >
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        {projectId != null && (
          <button
            type="button"
            className="sidebar-group-id-badge"
            onClick={onBadgeClick}
            title={`Project id ${projectId} — click for menu`}
            aria-label={`Project id ${projectId} menu`}
          >
            {projectId}
          </button>
        )}
      </div>
      {/* `hidden` rather than removing children — preserves each
          KnowledgeRow's local expand state across project collapse / re-open. */}
      <div className="sidebar-group-body" hidden={!open}>
        {children}
      </div>
    </div>
  );
}
