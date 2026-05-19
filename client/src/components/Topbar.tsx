import { useEffect, useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "../store";
import { openHelp, openProjectFilter, showToast, toggleTheme } from "../store/uiSlice";
import { portalApi, useLazySearchQuery } from "../store/api";
import { SearchResults } from "./SearchResults";
import { KnowledgeInfo } from "./KnowledgeInfo";

interface TopbarProps {
  searchText: string;
  onSearchText: (v: string) => void;
  activeKid: number | null;
  activePid: number | null;
}

export function Topbar({ searchText, onSearchText, activeKid, activePid }: TopbarProps) {
  const dispatch = useAppDispatch();
  const theme = useAppSelector((s) => s.ui.theme);
  const selectedProjects = useAppSelector((s) => s.ui.selectedProjects);
  const [trigger, result] = useLazySearchQuery();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Snapshot of project filter for stable dep in useEffect.
  const projectsKey = selectedProjects?.join("|") ?? "";

  useEffect(() => {
    const q = searchText.trim();
    // `&N` / `#N` / `@N` are id lookups — let them through with as little as
    // 2 chars and skip the project filter (they bypass it server-side too).
    const isIdLookup = /^[&#@]\d+$/.test(q);
    if (!isIdLookup && [...q].length < 3) {
      setOpen(false);
      return;
    }
    const t = setTimeout(() => {
      trigger({
        q,
        limit: 20,
        projects: isIdLookup ? undefined : selectedProjects ?? undefined,
      });
      setOpen(true);
    }, isIdLookup ? 0 : 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText, trigger, projectsKey]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, []);

  return (
    <header className="topbar">
      <div className="topbar-left">
        <h1>
          <span className="dot" />
          WikiKai
        </h1>
        <button
          type="button"
          className={`brand-filter-btn${selectedProjects ? " active" : ""}`}
          onClick={() => dispatch(openProjectFilter())}
          title={
            selectedProjects
              ? `Filtering ${selectedProjects.length} project — click to edit`
              : "Pick projects to show / delete projects"
          }
        >
          <span aria-hidden>⏷</span>
          <span className="brand-filter-label">
            {selectedProjects ? `${selectedProjects.length} project` : "All projects"}
          </span>
        </button>
      </div>
      <div className="topbar-right">
        <KnowledgeInfo kid={activeKid} pid={activePid} />
        <button
          className="icon-btn"
          title="Refresh — reload knowledge list, pages, and revisions"
          onClick={() => {
            dispatch(
              portalApi.util.invalidateTags([
                { type: "KnowledgeList", id: "LIST" },
                "Knowledge",
                "Page",
                "PageRendered",
                "Revisions",
              ]),
            );
            dispatch(showToast("Refreshed"));
          }}
        >
          ↻
        </button>
        <div className="topbar-controls">
          <div ref={wrapRef} className="topbar-search">
            <input
              id="search"
              type="search"
              placeholder="Search · Text / &N / #N / @N"
              value={searchText}
              onChange={(e) => onSearchText(e.target.value)}
              onFocus={() => {
                const t = searchText.trim();
                if (/^[&#@]\d+$/.test(t) || [...t].length >= 3) setOpen(true);
              }}
            />
            {open && result.data && (
              <SearchResults
                hits={result.data.hits}
                total={result.data.total}
                query={searchText}
                onPick={() => setOpen(false)}
              />
            )}
          </div>
          <button
            className="icon-btn"
            title="Help + MCP guide"
            onClick={() => dispatch(openHelp("user"))}
          >
            ?
          </button>
          <button
            className="icon-btn"
            title="Toggle theme"
            onClick={() => dispatch(toggleTheme())}
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>
        </div>
      </div>
    </header>
  );
}
