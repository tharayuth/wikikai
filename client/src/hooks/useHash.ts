import { useCallback, useEffect, useState } from "react";

/** Parsed `?projects=` menu filter. The query param is the single source of
 *  truth for which projects the sidebar/search show.
 *
 *  - param absent          → `null` (no filter — "All projects")
 *  - `?projects=`          → `{ ids: [], noProject: false }` (filter active but
 *                            empty — "Clear all", shows nothing)
 *  - `?projects=1,2,none`  → `{ ids: [1, 2], noProject: true }`
 *
 *  Numeric tokens are project ids (in URL order); the `none` sentinel selects
 *  the synthetic "(no project)" bucket, which has no registry id. */
export interface ProjectFilter {
  ids: number[];
  noProject: boolean;
}

export interface HashLocation {
  kid: number | null;
  pid: number | null;
  line: number | null;
  block: number | null;
  /** Parsed `?projects=` filter, or null when the param is absent. */
  projects: ProjectFilter | null;
  /** `?calendar=<projectId>&month=YYYY-MM&view=board&task=12` — the project
   *  view, shown in place of the viewer when no knowledge is open. */
  calendar: CalendarLocation | null;
}

export type ProjectViewKind = "calendar" | "board" | "list" | "gantt" | "notes";

export interface CalendarLocation {
  projectId: number;
  /** `YYYY-MM`, or null for "the current month". */
  month: string | null;
  /** Which tab of the project view. Old calendar links have no `view`. */
  view: ProjectViewKind;
  /** `task=<id>`: the task modal open over that view. */
  taskId: number | null;
  /** `module=<id>`: which of the project's boards. Null lets the view choose. */
  moduleId: number | null;
  /** `note=<id>`: the note editor open over the Notes tab. */
  noteId: number | null;
}

function toSearch(params: URLSearchParams): string {
  const q = params.toString().replace(/%2C/g, ",");
  return q ? `?${q}` : "";
}

const NAV_EVENT = "wikikai-nav";

/** Parse `?projects=1,2,none` into a {@link ProjectFilter}. Returns null only
 *  when the param is entirely absent — a present-but-empty `?projects=` is an
 *  explicit empty selection (show nothing), distinct from "no filter". */
export function parseProjectFilter(search: string): ProjectFilter | null {
  const raw = new URLSearchParams(search).get("projects");
  if (raw == null) return null;
  let noProject = false;
  const ids: number[] = [];
  for (const tok of raw.split(",")) {
    const t = tok.trim();
    if (!t) continue;
    if (t === "none") {
      noProject = true;
      continue;
    }
    const n = Number(t);
    if (Number.isInteger(n) && n > 0) ids.push(n);
  }
  return { ids, noProject };
}

/** Parse `?calendar=7&month=2026-09&view=board&module=3&task=12`. Null when
 *  `calendar` is absent or malformed; any other bad value falls back alone. */
export function parseCalendar(search: string): CalendarLocation | null {
  const params = new URLSearchParams(search);
  const projectId = Number(params.get("calendar"));
  if (!Number.isInteger(projectId) || projectId <= 0) return null;
  const month = params.get("month");
  const view = params.get("view");
  const taskId = Number(params.get("task"));
  const moduleId = Number(params.get("module"));
  const noteId = Number(params.get("note"));
  return {
    projectId,
    month: month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : null,
    view: view === "board" || view === "list" || view === "gantt" || view === "notes" ? view : "calendar",
    taskId: Number.isInteger(taskId) && taskId > 0 ? taskId : null,
    moduleId: Number.isInteger(moduleId) && moduleId > 0 ? moduleId : null,
    noteId: Number.isInteger(noteId) && noteId > 0 ? noteId : null,
  };
}

/** Query string for the calendar of `projectId` at `month`, keeping any
 *  other params (notably `?projects=`) from `search`. */
export function buildCalendarSearch(
  search: string,
  projectId: number,
  month: string | null,
): string {
  const params = new URLSearchParams(search);
  params.set("calendar", String(projectId));
  if (month) params.set("month", month);
  else params.delete("month");
  return `?${params.toString().replace(/%2C/g, ",")}`;
}

/** `search` minus the project-view params — used when leaving the view. */
export function withoutCalendar(search: string): string {
  const params = new URLSearchParams(search);
  params.delete("calendar");
  params.delete("month");
  params.delete("view");
  params.delete("task");
  params.delete("module");
  params.delete("note");
  return toSearch(params);
}

/** Switch project tab. The calendar is the default, so it needs no param. */
export function buildProjectViewSearch(search: string, view: ProjectViewKind): string {
  const params = new URLSearchParams(search);
  // A note opens over its own tab, so it closes on leaving that tab.
  params.delete("note");
  if (view === "calendar") params.delete("view");
  else params.set("view", view);
  return toSearch(params);
}

/** Open the task modal, or close it with null. */
export function buildTaskSearch(search: string, taskId: number | null): string {
  const params = new URLSearchParams(search);
  if (taskId == null) params.delete("task");
  else params.set("task", String(taskId));
  return toSearch(params);
}

/** Open a note's editor, or close it with null. */
export function buildNoteSearch(search: string, noteId: number | null): string {
  const params = new URLSearchParams(search);
  if (noteId == null) params.delete("note");
  else params.set("note", String(noteId));
  return toSearch(params);
}

/** Show one module, or with null let the view choose. */
export function buildModuleSearch(search: string, moduleId: number | null): string {
  const params = new URLSearchParams(search);
  if (moduleId == null) params.delete("module");
  else params.set("module", String(moduleId));
  return toSearch(params);
}

/** A task on its project's board, from anywhere. Keeps `?projects=`. */
export function buildTaskLink(search: string, projectId: number, taskId: number): string {
  return buildTaskSearch(
    buildProjectViewSearch(buildCalendarSearch(withoutCalendar(search), projectId, null), "board"),
    taskId,
  );
}

/** Build the `?projects=` query string for a set of selected tokens (project
 *  ids and/or the "none" sentinel). An empty list yields `?projects=` (explicit
 *  "show nothing"); pass null to clear the param entirely ("All projects"). */
export function buildProjectsSearch(
  tokens: (number | "none")[] | null,
): string {
  if (tokens == null) return "";
  return `?projects=${tokens.join(",")}`;
}

/**
 * The effective query string for the current location.
 *
 * Our routes keep the page id in the hash (`/&52/#348`), so a pasted
 * `…/#348?projects=9,8` puts the query *inside* the hash fragment, leaving
 * `location.search` empty. Read `location.search` first, then fall back to
 * any `?…` embedded in the hash so both URL shapes filter the menu.
 */
export function currentQueryString(): string {
  if (typeof window === "undefined") return "";
  if (window.location.search) return window.location.search;
  const qi = window.location.hash.indexOf("?");
  return qi >= 0 ? window.location.hash.slice(qi) : "";
}

/**
 * Parse current `window.location` into knowledge / page / line / block.
 *
 * New format (self-documenting URL):
 *   /&2          → kid=2
 *   /&2/#6       → kid=2, pid=6
 *   /&2/#6:42    → kid=2, pid=6, line=42
 *   /&2/#6@7     → kid=2, pid=6, block=7
 *
 * Legacy formats still accepted:
 *   /#&2/6:42    → kid=2, pid=6, line=42  (pre path-split notation)
 *   /#2/6:42     → kid=2, pid=6, line=42  (oldest, pre-symbol notation)
 */
export function parseLocation(): HashLocation {
  if (typeof window === "undefined")
    return { kid: null, pid: null, line: null, block: null, projects: null, calendar: null };
  const path = window.location.pathname;
  const hash = window.location.hash;
  const projects = parseProjectFilter(currentQueryString());
  const calendar = parseCalendar(currentQueryString());

  // New format: path holds knowledge
  const pathMatch = path.match(/^\/&?(\d+)\/?$/);
  if (pathMatch) {
    const kid = Number(pathMatch[1]);
    const hashMatch = hash.match(/^#(\d+)(?::(\d+)|@(\d+))?/);
    return {
      kid,
      pid: hashMatch ? Number(hashMatch[1]) : null,
      line: hashMatch && hashMatch[2] ? Number(hashMatch[2]) : null,
      block: hashMatch && hashMatch[3] ? Number(hashMatch[3]) : null,
      projects,
      calendar,
    };
  }

  // Legacy: everything inside the hash
  if (path === "/" || path === "") {
    const m = hash.match(/^#&?(\d+)(?:\/(\d+)(?::(\d+))?)?/);
    if (m) {
      return {
        kid: Number(m[1]),
        pid: m[2] ? Number(m[2]) : null,
        line: m[3] ? Number(m[3]) : null,
        block: null,
        projects,
        calendar,
      };
    }
  }
  return { kid: null, pid: null, line: null, block: null, projects, calendar };
}

/** Render the URL string for a target location (relative, e.g.
 *  "/&3/?projects=9,8#6:42"). The `query` (e.g. "?projects=9,8") is placed
 *  before the hash so it lands in `location.search`, not the fragment. */
export function buildUrl(loc: {
  kid: number | null;
  pid?: number | null;
  line?: number | null;
  block?: number | null;
  query?: string;
}): string {
  const q = loc.query ?? "";
  if (loc.kid == null) return q ? `/${q}` : "/";
  let url = `/&${loc.kid}`;
  if (loc.pid != null) {
    url += `/${q}#${loc.pid}`;
    if (loc.block != null) url += `@${loc.block}`;
    else if (loc.line != null) url += `:${loc.line}`;
  } else if (q) {
    url += `/${q}`;
  }
  return url;
}

/**
 * Imperatively navigate. Components can import this and call directly without
 * prop-drilling. Triggers a custom event so all `useHash()` consumers re-read.
 */
export function navigateTo(
  target: {
    kid?: number | null;
    pid?: number | null;
    line?: number | null;
    block?: number | null;
  },
  options?: { replace?: boolean; search?: string },
): void {
  if (typeof window === "undefined") return;
  // Preserve the current query string (notably `?projects=…`) so the sidebar
  // menu filter survives navigation, unless an explicit `search` override is
  // given. buildUrl places it before the hash so it stays in location.search.
  // Opening a knowledge leaves the calendar, so its params are dropped.
  const kid = target.kid !== undefined ? target.kid : parseLocation().kid;
  const search =
    options?.search !== undefined
      ? options.search
      : kid != null
        ? withoutCalendar(currentQueryString())
        : currentQueryString();
  const full = buildUrl({
    kid,
    pid: target.pid !== undefined ? target.pid : null,
    line: target.line !== undefined ? target.line : null,
    block: target.block !== undefined ? target.block : null,
    query: search,
  });
  if (options?.replace) {
    window.history.replaceState({}, "", full);
  } else {
    window.history.pushState({}, "", full);
  }
  window.dispatchEvent(new Event(NAV_EVENT));
}

export function useHash(): {
  location: HashLocation;
  navigate: typeof navigateTo;
} {
  const [location, setLocation] = useState<HashLocation>(() => parseLocation());

  useEffect(() => {
    const onChange = () => setLocation(parseLocation());
    window.addEventListener("hashchange", onChange);
    window.addEventListener("popstate", onChange);
    window.addEventListener(NAV_EVENT, onChange);
    return () => {
      window.removeEventListener("hashchange", onChange);
      window.removeEventListener("popstate", onChange);
      window.removeEventListener(NAV_EVENT, onChange);
    };
  }, []);

  const navigate = useCallback(navigateTo, []);
  return { location, navigate };
}
