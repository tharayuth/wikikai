import { useEffect, useMemo, useState } from "react";
import {
  useGetKnowledgeQuery,
  useListKnowledgeQuery,
  useListPageTitlesQuery,
  type KnowledgeMeta,
} from "../store/api";
import { useAppSelector } from "../store";
import { navigateTo } from "../hooks/useHash";

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
}

function KnowledgeRow({
  item,
  isActive,
  activePid,
  onPickKnowledge,
  pageFilter,
}: RowProps) {
  const [open, setOpen] = useState(isActive);

  // Auto-expand when this knowledge becomes the active one.
  useEffect(() => {
    if (isActive) setOpen(true);
  }, [isActive]);

  const effectiveOpen = pageFilter != null ? true : open;
  const { data } = useGetKnowledgeQuery(item.id, { skip: !effectiveOpen });
  const allPages = data?.pages ?? [];
  const pages = pageFilter ? allPages.filter((p) => pageFilter.has(p.id)) : allPages;

  return (
    <div className={`sidebar-row${isActive ? " active-row" : ""}`}>
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
      {effectiveOpen && pages.length > 0 && (
        <ul className="sidebar-pages">
          {pages.map((p) => {
            const pageActive = isActive && p.id === activePid;
            return (
              <li key={p.id}>
                <a
                  className={`sidebar-page${pageActive ? " active" : ""}`}
                  href={`/&${item.id}/#${p.id}`}
                  title={p.summary ?? p.title}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0)
                      return;
                    e.preventDefault();
                    navigateTo({ kid: item.id, pid: p.id });
                  }}
                >
                  <span className="page-title">{p.title}</span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function Sidebar({ activeKid, activePid, onPick }: Props) {
  const { data: items = [], isLoading } = useListKnowledgeQuery();
  const { data: pageTitles = [] } = useListPageTitlesQuery();
  const selectedProjects = useAppSelector((s) => s.ui.selectedProjects);
  const [filterText, setFilterText] = useState("");

  const filtered = useMemo(() => {
    if (selectedProjects == null) return items;
    if (selectedProjects.length === 0) return [];
    const set = new Set(selectedProjects);
    return items.filter((it) =>
      set.has(it.project || "(no project)"),
    );
  }, [items, selectedProjects]);

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
   *  Forces the group open so the user can see where they are even when
   *  the group's manual preference is collapsed. */
  containsActive: boolean;
  children: React.ReactNode;
}) {
  // Default is COLLAPSED. localStorage remembers user toggle per project.
  // Active project auto-expands on first render even when no preference
  // is stored, so a brand-new visitor still sees their current location.
  const [open, setOpen] = useState<boolean>(() => {
    const stored = readStoredOpen(project);
    if (stored != null) return stored;
    return containsActive;
  });

  // When user navigates into a project that was manually collapsed, force
  // it open so the active row is visible — but DON'T persist that, so the
  // user's stored preference is restored next session.
  const effectiveOpen = open || containsActive;

  return (
    <div className={`sidebar-group${effectiveOpen ? "" : " collapsed"}`}>
      <button
        type="button"
        className={`sidebar-group-title${effectiveOpen ? " open" : ""}`}
        aria-expanded={effectiveOpen}
        onClick={() => {
          setOpen((o) => {
            const next = !o;
            writeStoredOpen(project, next);
            return next;
          });
        }}
      >
        <span className="group-chevron" aria-hidden>
          {effectiveOpen ? "📖" : "📕"}
        </span>
        <span className="group-name">{project}</span>
      </button>
      {/* `hidden` rather than removing children — preserves each
          KnowledgeRow's local expand state across project collapse / re-open. */}
      <div className="sidebar-group-body" hidden={!effectiveOpen}>
        {children}
      </div>
    </div>
  );
}
