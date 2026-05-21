import type { Express, Request, Response, NextFunction } from "express";
import type { UserStore, SessionStore, User } from "../store/users.js";
import { withCallContext } from "../lib/callContext.js";

const SESSION_COOKIE = "wikikai_session";
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

declare module "express-serve-static-core" {
  interface Request {
    user?: User;
    sessionToken?: string;
  }
}

export interface AuthOptions {
  users: UserStore;
  sessions: SessionStore;
  /** When true, every web route below is auth-gated. Otherwise the
   *  auth endpoints still work (so a user can log in voluntarily) but
   *  nothing is blocked. */
  enabled: boolean;
}

/** Parse the wikikai session cookie out of a Cookie header. No external
 *  cookie-parser dep — we need exactly one cookie. */
function readSessionCookie(req: Request): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  const parts = raw.split(/;\s*/);
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq <= 0) continue;
    const k = p.slice(0, eq).trim();
    if (k !== SESSION_COOKIE) continue;
    return decodeURIComponent(p.slice(eq + 1).trim());
  }
  return null;
}

function setSessionCookie(res: Response, token: string): void {
  // SameSite=Lax so cross-origin cookie attacks are blocked but
  // normal same-site navigations still carry the cookie. Not setting
  // `Secure` so the dev server on http://192.168.x.x still works;
  // production deployments should sit behind HTTPS anyway.
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    `Max-Age=${Math.floor(COOKIE_MAX_AGE_MS / 1000)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(res: Response): void {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`,
  );
}

/** Attach `req.user` (if any) to every request AND wrap downstream
 *  handlers in a `withCallContext({ source: "web", user_id })` so the
 *  activity-log recorder stamps every mutation with the acting user.
 *  When no session is present, user_id is null. */
export function sessionMiddleware(opts: AuthOptions) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const token = readSessionCookie(req);
    if (token) {
      const info = opts.sessions.resolve(token);
      if (info) {
        req.user = info.user;
        req.sessionToken = info.token;
      }
    }
    withCallContext(
      { source: "web", user_id: req.user?.id ?? null },
      () => next(),
    );
  };
}

/** Gate guard — when auth is enabled, require a session for everything
 *  except the auth endpoints and the static login page itself. */
export function requireAuth(opts: AuthOptions) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!opts.enabled) return next();
    if (req.user) return next();
    // Auth endpoints + login UI are always open. `/mcp` is also open
    // here because it does its own Bearer-token auth in the route
    // handler (per-user mcp_token, or legacy WIKIKAI_TOKEN); session
    // cookies don't apply to MCP clients.
    const p = req.path;
    if (
      p === "/mcp" ||
      p === "/login" ||
      p === "/api/auth/login" ||
      p === "/api/auth/logout" ||
      p === "/api/auth/me" ||
      p.startsWith("/assets/") ||
      p.startsWith("/img/") ||
      p === "/favicon-32.png" ||
      p === "/favicon-192.png" ||
      p === "/favicon-512.png" ||
      p === "/apple-touch-icon.png" ||
      p === "/wikikai-logo.png"
    ) {
      return next();
    }
    if (p.startsWith("/api/")) {
      res.status(401).json({ error: "auth required" });
      return;
    }
    // SPA + viewers: bounce to /login with a `next` hint
    const next_hint = encodeURIComponent(req.originalUrl || "/");
    res.redirect(302, `/login?next=${next_hint}`);
  };
}

/** Wire `/api/auth/*` endpoints. */
export function attachAuthRoutes(app: Express, opts: AuthOptions): void {
  app.post("/api/auth/login", (req, res) => {
    const { email, password } = (req.body ?? {}) as {
      email?: string;
      password?: string;
    };
    if (typeof email !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "email and password are required" });
      return;
    }
    const user = opts.users.authenticate(email, password);
    if (!user) {
      res.status(401).json({ error: "invalid credentials" });
      return;
    }
    const info = opts.sessions.create(
      user.id,
      typeof req.headers["user-agent"] === "string"
        ? req.headers["user-agent"]
        : undefined,
    );
    setSessionCookie(res, info.token);
    res.json({ user });
  });

  app.post("/api/auth/logout", (req, res) => {
    if (req.sessionToken) opts.sessions.delete(req.sessionToken);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.get("/api/auth/me", (req, res) => {
    if (req.user) {
      res.json({ user: req.user, auth_enabled: opts.enabled });
      return;
    }
    res.json({ user: null, auth_enabled: opts.enabled });
  });

  // Regenerate the current user's personal MCP token. Returns the
  // freshly issued token in the response body — there's no later
  // "show me my token" call needed since /api/auth/me already includes
  // it. Old token is invalidated immediately; any AI client using it
  // will start receiving 401s from /mcp.
  app.post("/api/auth/regenerate-mcp-token", (req, res) => {
    if (!req.user) {
      res.status(401).json({ error: "auth required" });
      return;
    }
    const token = opts.users.regenerateMcpToken(req.user.id);
    res.json({ mcp_token: token });
  });

  // ───── Admin user management ─────
  // Gated to req.user.is_admin. Simple CRUD: list / create / update /
  // delete + regen-token for any user. The last-admin guard inside
  // UserStore prevents bricking the system (can't delete or demote
  // the only remaining admin).
  const requireAdmin = (req: Request, res: Response): boolean => {
    if (!req.user) {
      res.status(401).json({ error: "auth required" });
      return false;
    }
    if (!req.user.is_admin) {
      res.status(403).json({ error: "admin only" });
      return false;
    }
    return true;
  };

  app.get("/api/admin/users", (req, res) => {
    if (!requireAdmin(req, res)) return;
    res.json({ users: opts.users.list() });
  });

  app.post("/api/admin/users", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = (req.body ?? {}) as {
      email?: string;
      password?: string;
      display_name?: string;
      is_admin?: boolean;
    };
    if (
      typeof body.email !== "string" ||
      typeof body.password !== "string" ||
      typeof body.display_name !== "string"
    ) {
      res
        .status(400)
        .json({ error: "email, password, display_name are required" });
      return;
    }
    try {
      const user = opts.users.create({
        email: body.email,
        password: body.password,
        display_name: body.display_name,
        is_admin: !!body.is_admin,
      });
      res.json({ user });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.patch("/api/admin/users/:id", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    const body = (req.body ?? {}) as {
      email?: string;
      display_name?: string;
      password?: string;
      is_admin?: boolean;
    };
    try {
      const user = opts.users.update(id, body);
      res.json({ user });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.delete("/api/admin/users/:id", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    // Self-delete guard — also blocked by last-admin check but UI
    // shouldn't even offer it; safety net here.
    if (req.user!.id === id) {
      res.status(400).json({ error: "can't delete yourself" });
      return;
    }
    try {
      opts.users.delete(id);
      // Drop any active sessions for the removed user
      opts.sessions.deleteForUser(id);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.post("/api/admin/users/:id/regenerate-mcp-token", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    try {
      const token = opts.users.regenerateMcpToken(id);
      res.json({ mcp_token: token });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });
}
