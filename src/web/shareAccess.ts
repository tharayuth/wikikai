import type { Request, Response } from "express";
import type { ShareUser, ShareUserStore } from "../store/shareUsers.js";
import {
  peekShareCookieUserId,
  signShareCookie,
  verifyShareCookie,
} from "../lib/shareCookie.js";

/**
 * Cookie plumbing + brute-force throttle for password-protected share links.
 * Kept out of app.ts so the route file only says *what* is gated.
 *
 * One cookie per link (`wikikai_share_<token>`): a reader who has unlocked
 * two different documents holds two cookies, and rotating a link orphans
 * its cookie by name alone.
 */
const COOKIE_PREFIX = "wikikai_share_";
const MAX_COOKIE_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, or sooner if the user expires

export function shareCookieName(token: string): string {
  return `${COOKIE_PREFIX}${token}`;
}

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

/** Issue the login cookie. Lifetime is capped by the user's own expiry so a
 *  "3 days" reader is not still inside on day 4 via a cached cookie. */
export function setShareCookie(
  res: Response,
  token: string,
  user: ShareUser & { password_hash: string },
): { exp: number } {
  const now = Date.now();
  const userExp = user.expires_at ? new Date(user.expires_at).getTime() : Infinity;
  const exp = Math.min(now + MAX_COOKIE_AGE_MS, userExp);
  const value = signShareCookie(user.id, exp, user.password_hash);
  res.setHeader(
    "Set-Cookie",
    [
      `${shareCookieName(token)}=${encodeURIComponent(value)}`,
      `Max-Age=${Math.max(1, Math.floor((exp - now) / 1000))}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
    ].join("; "),
  );
  return { exp };
}

export function clearShareCookie(res: Response, token: string): void {
  res.setHeader(
    "Set-Cookie",
    `${shareCookieName(token)}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`,
  );
}

/** Who (if anyone) the request's cookie proves to be, for this link.
 *  Null when there is no cookie, it is forged, its user was deleted or
 *  belongs to another knowledge, or the user has since expired. */
export function resolveShareViewer(
  req: Request,
  token: string,
  knowledge_id: number,
  shareUsers: ShareUserStore,
): ShareUser | null {
  const value = readCookie(req, shareCookieName(token));
  if (!value) return null;
  const id = peekShareCookieUserId(value);
  if (id == null) return null;
  const user = shareUsers.getWithHash(id);
  if (!user || user.knowledge_id !== knowledge_id || user.expired) return null;
  if (!verifyShareCookie(value, user.password_hash)) return null;
  const { password_hash: _hash, ...safe } = user;
  return safe;
}

/**
 * In-memory failed-login counter keyed by `<token>|<ip>`. Ten misses inside
 * fifteen minutes block further attempts on that link from that address
 * until the window passes. Resets on a successful login. Deliberately not
 * persisted — a restart forgiving a locked-out reader is fine.
 */
export class ShareLoginLimiter {
  private hits = new Map<string, { count: number; first: number }>();

  constructor(
    private readonly max = 10,
    private readonly windowMs = 15 * 60 * 1000,
  ) {}

  private key(req: Request, token: string): string {
    return `${token}|${req.ip ?? "?"}`;
  }

  /** True when this caller has exhausted its attempts. */
  isBlocked(req: Request, token: string): boolean {
    const k = this.key(req, token);
    const h = this.hits.get(k);
    if (!h) return false;
    if (Date.now() - h.first > this.windowMs) {
      this.hits.delete(k);
      return false;
    }
    return h.count >= this.max;
  }

  fail(req: Request, token: string): void {
    const k = this.key(req, token);
    const now = Date.now();
    const h = this.hits.get(k);
    if (!h || now - h.first > this.windowMs) {
      this.hits.set(k, { count: 1, first: now });
      return;
    }
    this.hits.set(k, { count: h.count + 1, first: h.first });
  }

  reset(req: Request, token: string): void {
    this.hits.delete(this.key(req, token));
  }
}
