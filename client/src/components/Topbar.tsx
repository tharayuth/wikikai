import { useEffect, useMemo, useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "../store";
import {
  openAccount,
  openActivityLog,
  openHelp,
  openProjectFilter,
  showToast,
  toggleTheme,
} from "../store/uiSlice";
import {
  portalApi,
  useGetAuthMeQuery,
  useLazySearchQuery,
  useListProjectsQuery,
  useLogoutMutation,
} from "../store/api";
import { useHash } from "../hooks/useHash";
import { SearchResults } from "./SearchResults";
import { KnowledgeInfo } from "./KnowledgeInfo";
import { SseStatus } from "./SseStatus";

interface TopbarProps {
  searchText: string;
  onSearchText: (v: string) => void;
  activeKid: number | null;
  activePid: number | null;
}

export function Topbar({ searchText, onSearchText, activeKid, activePid }: TopbarProps) {
  const dispatch = useAppDispatch();
  const theme = useAppSelector((s) => s.ui.theme);
  const { location } = useHash();
  const urlFilter = location.projects;
  const { data: projectList } = useListProjectsQuery();
  const [trigger, result] = useLazySearchQuery();
  const [open, setOpen] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(() => {
    try {
      return localStorage.getItem("wikikai-search-archived") === "1";
    } catch {
      return false;
    }
  });
  const wrapRef = useRef<HTMLDivElement>(null);

  // Resolve the URL `?projects=` filter (ids + "(no project)") into the project
  // names the search endpoint expects. undefined = no filter (search all).
  const filterNames = useMemo<string[] | undefined>(() => {
    if (urlFilter == null) return undefined;
    const idToName = new Map<number, string>();
    for (const p of projectList?.projects ?? []) {
      if (p.id != null) idToName.set(p.id, p.name);
    }
    const names: string[] = [];
    for (const id of urlFilter.ids) {
      const n = idToName.get(id);
      if (n) names.push(n);
    }
    if (urlFilter.noProject) names.push("(no project)");
    return names;
  }, [urlFilter, projectList]);

  // Count of selected projects for the badge label. null filter = "All".
  const filterCount =
    urlFilter == null ? null : urlFilter.ids.length + (urlFilter.noProject ? 1 : 0);

  // Snapshot of project filter for stable dep in useEffect.
  const projectsKey = (filterNames ?? []).join("|");

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
        projects: isIdLookup ? undefined : filterNames,
        includeArchived,
      });
      setOpen(true);
    }, isIdLookup ? 0 : 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText, trigger, projectsKey, includeArchived]);

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
          <a href="/" aria-label="WikiKai — home">
            <img
              src="/wikikai-logo.png"
              alt="WikiKai"
              className="brand-logo"
              width="853"
              height="278"
            />
          </a>
        </h1>
        <button
          type="button"
          className={`brand-filter-btn${filterCount != null ? " active" : ""}`}
          onClick={() => dispatch(openProjectFilter())}
          title={
            filterCount != null
              ? `Filtering ${filterCount} project — click to edit`
              : "Pick projects to show / delete projects"
          }
        >
          <span aria-hidden>⏷</span>
          <span className="brand-filter-label">
            {filterCount != null ? `${filterCount} project` : "All projects"}
          </span>
        </button>
      </div>
      <div className="topbar-right">
        <KnowledgeInfo
          kid={activeKid}
          pid={activePid}
          titleSuffix={
            <>
              <SseStatus />
              <button
              className="icon-btn ki-refresh"
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
            </>
          }
        />
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
              <div className="search-dropdown">
                <label className="search-archived-toggle">
                  <input
                    type="checkbox"
                    checked={includeArchived}
                    onChange={(e) => {
                      const v = e.target.checked;
                      setIncludeArchived(v);
                      try {
                        localStorage.setItem(
                          "wikikai-search-archived",
                          v ? "1" : "0",
                        );
                      } catch {
                        /* private mode */
                      }
                    }}
                  />
                  Include archived pages
                </label>
                <SearchResults
                  hits={result.data.hits}
                  total={result.data.total}
                  query={searchText}
                  onPick={() => setOpen(false)}
                />
              </div>
            )}
          </div>
          <button
            className="icon-btn"
            title="Activity log — recent add / edit / delete actions"
            onClick={() => dispatch(openActivityLog())}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <circle cx="12" cy="12" r="9" />
              <polyline points="12 7 12 12 15 14" />
            </svg>
          </button>
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
          <UserWidget />
        </div>
      </div>
    </header>
  );
}

/**
 * Tiny user-status chip in the topbar. Shows "Sign in" link when auth
 * is enabled but the user is anonymous, "Hi, <name>" + logout button
 * when signed in, and nothing at all when auth is off (single-user
 * deployment). Keeps the topbar layout consistent across modes.
 */
function UserWidget(): JSX.Element | null {
  const dispatch = useAppDispatch();
  const { data } = useGetAuthMeQuery();
  const [logout] = useLogoutMutation();
  if (!data) return null;
  if (!data.auth_enabled) return null;
  if (!data.user) {
    return (
      <a className="topbar-user signed-out" href="/login">
        Sign in
      </a>
    );
  }
  return (
    <div className="topbar-user signed-in">
      <button
        type="button"
        className="topbar-user-name"
        title={`${data.user.email} — click to open account / MCP token`}
        onClick={() => dispatch(openAccount())}
      >
        {data.user.display_name}
      </button>
      <button
        type="button"
        className="topbar-user-logout"
        aria-label="Sign out"
        title="Sign out"
        onClick={() => {
          logout()
            .unwrap()
            .then(() => {
              // Force a full reload so RTK caches and any in-flight
              // queries reset cleanly to the anonymous state.
              window.location.assign("/");
            })
            .catch(() => undefined);
        }}
      >
        ⎋
      </button>
    </div>
  );
}
