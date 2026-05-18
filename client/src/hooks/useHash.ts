import { useCallback, useEffect, useState } from "react";

export interface HashLocation {
  kid: number | null;
  pid: number | null;
  line: number | null;
  block: number | null;
}

const NAV_EVENT = "wikikai-nav";

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
    return { kid: null, pid: null, line: null, block: null };
  const path = window.location.pathname;
  const hash = window.location.hash;

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
      };
    }
  }
  return { kid: null, pid: null, line: null, block: null };
}

/** Render the URL string for a target location (relative, e.g. "/&3/#6:42"). */
export function buildUrl(loc: {
  kid: number | null;
  pid?: number | null;
  line?: number | null;
  block?: number | null;
}): string {
  if (loc.kid == null) return "/";
  let url = `/&${loc.kid}`;
  if (loc.pid != null) {
    url += `/#${loc.pid}`;
    if (loc.block != null) url += `@${loc.block}`;
    else if (loc.line != null) url += `:${loc.line}`;
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
  options?: { replace?: boolean },
): void {
  if (typeof window === "undefined") return;
  const url = buildUrl({
    kid: target.kid !== undefined ? target.kid : parseLocation().kid,
    pid: target.pid !== undefined ? target.pid : null,
    line: target.line !== undefined ? target.line : null,
    block: target.block !== undefined ? target.block : null,
  });
  if (options?.replace) {
    window.history.replaceState({}, "", url);
  } else {
    window.history.pushState({}, "", url);
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
