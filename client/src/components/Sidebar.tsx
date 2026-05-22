import { useEffect, useMemo, useState } from "react";
import {
  useGetKnowledgeQuery,
  useListKnowledgeQuery,
  useListPageTitlesQuery,
  useReorderPagesMutation,
  type KnowledgeMeta,
  type PageMeta,
} from "../store/api";
import { useAppDispatch, useAppSelector } from "../store";
import { navigateTo } from "../hooks/useHash";
import { showToast } from "../store/uiSlice";
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
  } = useSortable({ id: page.id, disabled: dragDisabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  return (
    <li ref={setNodeRef} style={style} className="sidebar-page-li">
      {!dragDisabled && (
        <button
          type="button"
          className="sidebar-page-handle"
          aria-label={`Reorder ${page.title}`}
          title="Drag to reorder"
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
}: RowProps) {
  const [open, setOpen] = useState(isActive);
  const dispatch = useAppDispatch();
  const [reorderPages] = useReorderPagesMutation();

  // Auto-expand when this knowledge becomes the active one.
  useEffect(() => {
    if (isActive) setOpen(true);
  }, [isActive]);

  const effectiveOpen = pageFilter != null ? true : open;
  const { data } = useGetKnowledgeQuery(item.id, { skip: !effectiveOpen });
  const allPages = data?.pages ?? [];
  const pages = pageFilter ? allPages.filter((p) => pageFilter.has(p.id)) : allPages;

  // Drag-drop disabled while a page-filter is active — the rendered list
  // isn't the full knowledge order, so dropping would scramble positions.
  const dragDisabled = pageFilter != null || allPages.length < 2;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Require a small drag distance so plain clicks on the handle don't
      // trigger a drag-start (and the page link below still gets clicks).
      activationConstraint: { distance: 4 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = allPages.map((p) => p.id);
    const oldIdx = ids.indexOf(Number(active.id));
    const newIdx = ids.indexOf(Number(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    const next = [...ids];
    next.splice(oldIdx, 1);
    next.splice(newIdx, 0, Number(active.id));
    try {
      await reorderPages({ knowledge_id: item.id, order: next }).unwrap();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to reorder";
      dispatch(showToast(`Reorder failed: ${msg}`));
    }
  }

  return (
    <div className={`sidebar-row has-star-action${isActive ? " active-row" : ""}`}>
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
            <span className="id-badge" title={`knowledge id ${item.id}`}>
              &amp;{item.id}
            </span>
            <span>{relTime(item.updated_at)}</span>
            {item.version > 1 && <span>v{item.version}</span>}
          </div>
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
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
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
        </DndContext>
      )}
    </div>
  );
}

export function Sidebar({ activeKid, activePid, onPick }: Props) {
  const { data: items = [], isLoading } = useListKnowledgeQuery();
  const { data: pageTitles = [] } = useListPageTitlesQuery();
  const selectedProjects = useAppSelector((s) => s.ui.selectedProjects);
  const [filterText, setFilterText] = useState("");
  const [starredOnly, setStarredOnly] = useState(false);
  const [starredIds, setStarredIds] = useState<Set<number>>(() =>
    readStarredKnowledgeIds(),
  );

  useEffect(() => {
    const refresh = () => setStarredIds(readStarredKnowledgeIds());
    window.addEventListener(STARRED_KNOWLEDGE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(STARRED_KNOWLEDGE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const filtered = useMemo(() => {
    const projectFiltered = (() => {
      if (selectedProjects == null) return items;
      if (selectedProjects.length === 0) return [];
      const set = new Set(selectedProjects);
      return items.filter((it) =>
        set.has(it.project || "(no project)"),
      );
    })();
    if (!starredOnly) return projectFiltered;
    return projectFiltered.filter((it) => starredIds.has(it.id));
  }, [items, selectedProjects, starredOnly, starredIds]);

  const q = filterText.trim().toLowerCase();

  // knowledge_id -> set of page ids whose title matches `q`. Null when no filter.
  const matchedPagesByKid = useMemo(() => {
    if (!q) return null;
    const map = new Map<number, Set<number>>();
    for (const p of pageTitles) {
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
  }, [pageTitles, q]);

  const matched = useMemo(() => {
    if (!q) return filtered;
    return filtered.filter(
      (it) =>
        it.title.toLowerCase().includes(q) ||
        (it.project ?? "").toLowerCase().includes(q) ||
        (matchedPagesByKid?.has(it.id) ?? false),
    );
  }, [filtered, q, matchedPagesByKid]);

  const searchBox = (
    <div className="sidebar-search">
      <input
        type="search"
        placeholder="Filter project / topic / page…"
        value={filterText}
        onChange={(e) => setFilterText(e.target.value)}
        aria-label="Filter projects, topics, or pages"
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
          ) : starredOnly ? (
            "No starred topics"
          ) : (
            "No items in the selected projects"
          )}
        </div>
      </aside>
    );
  }

  return (
    <aside className="sidebar" id="sidebar">
      {searchBox}
      {groupByProject(matched).map(([project, list]) => {
        const containsActive =
          activeKid != null && list.some((it) => it.id === activeKid);
        return (
        <ProjectGroup
          key={project}
          project={project}
          containsActive={containsActive}
        >
          {list.map((it) => {
            // Only narrow pages list when the knowledge appeared *because* a
            // page matched (i.e. its title / project did not match `q`).
            const onlyByPageMatch =
              q !== "" &&
              !it.title.toLowerCase().includes(q) &&
              !(it.project ?? "").toLowerCase().includes(q);
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
              />
            );
          })}
        </ProjectGroup>
        );
      })}
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
  containsActive,
  children,
}: {
  project: string;
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

  return (
    <div className={`sidebar-group${open ? "" : " collapsed"}`}>
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
      {/* `hidden` rather than removing children — preserves each
          KnowledgeRow's local expand state across project collapse / re-open. */}
      <div className="sidebar-group-body" hidden={!open}>
        {children}
      </div>
    </div>
  );
}
