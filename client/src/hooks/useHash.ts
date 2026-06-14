import { useCallback, useEffect, useState } from "react";

export interface HashLocation {
  kid: number | null;
  pid: number | null;
  line: number | null;
  block: number | null;
  /** Project ids from the `?projects=1,2` query param — restricts the
   *  sidebar menu to those projects. null = param absent (no filter). */
  projectIds: number[] | null;
}

const NAV_EVENT = "wikikai-nav";

/** Parse `?projects=1,2` into a list of positive ids. Returns null when the
 *  param is absent or contains no valid id (= "no filter"). */
export function parseProjectIds(search: string): number[] | null {
  const raw = new URLSearchParams(search).get("projects");
  if (raw == null) return null;
  const ids = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  return ids.length > 0 ? ids : null;
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
    return { kid: null, pid: null, line: null, block: null, projectIds: null };
  const path = window.location.pathname;
  const hash = window.location.hash;
  const projectIds = parseProjectIds(currentQueryString());

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
      projectIds,
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
        projectIds,
      };
    }
  }
  return { kid: null, pid: null, line: null, block: null, projectIds };
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
  const search =
    options?.search !== undefined ? options.search : currentQueryString();
  const full = buildUrl({
    kid: target.kid !== undefined ? target.kid : parseLocation().kid,
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
