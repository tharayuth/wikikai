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
    // Auth endpoints + login UI are always open
    const p = req.path;
    if (
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
}
