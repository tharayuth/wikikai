import type { Db } from "./db.js";
import {
  generateSessionToken,
  hashPassword,
  verifyPassword,
} from "../lib/auth.js";

export interface User {
  id: number;
  email: string;
  display_name: string;
  is_admin: boolean;
  created_at: string;
  last_login_at: string | null;
  /** Personal MCP API token. Each user has one — AI clients send it as
   *  `Authorization: Bearer <token>` to identify which user the call
   *  belongs to. Null until first issued; regenerate to rotate. */
  mcp_token: string | null;
}

export interface UserWithHash extends User {
  password_hash: string;
}

interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  display_name: string;
  is_admin: number;
  created_at: string;
  last_login_at: string | null;
  mcp_token: string | null;
}

/** Accept either a real email address (with `@` + domain) or a simple
 *  username (letters / digits / `_` `.` `-`). Self-hosted single-tenant
 *  use often has no reason to type a full address — "admin", "kai",
 *  "team-lead" are all fine. Case is normalised to lowercase upstream. */
function isValidEmail(s: string): boolean {
  if (!s) return false;
  if (/^[a-z0-9_.-]{2,64}$/.test(s)) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    is_admin: row.is_admin === 1,
    created_at: row.created_at,
    last_login_at: row.last_login_at,
    mcp_token: row.mcp_token,
  };
}

/** Default session lifetime — 30 days. Sessions get refreshed on use. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export class UserStore {
  constructor(private db: Db) {}

  count(): number {
    const r = this.db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as {
      n: number;
    };
    return r.n;
  }

  get(id: number): User | null {
    const row = this.db
      .prepare(`SELECT * FROM users WHERE id = ?`)
      .get(id) as UserRow | undefined;
    return row ? rowToUser(row) : null;
  }

  getByEmail(email: string): User | null {
    const row = this.db
      .prepare(`SELECT * FROM users WHERE email = ? COLLATE NOCASE`)
      .get(email) as UserRow | undefined;
    return row ? rowToUser(row) : null;
  }

  /** Verify email + password and return the user on success. Constant-time
   *  against per-user salts; timing differences across users (e.g.
   *  "user exists?" vs "wrong password") are deliberately not hidden —
   *  we already disclose user existence via the email-uniqueness error
   *  on signup, so leaking through login timing is no worse. */
  authenticate(email: string, password: string): User | null {
    const row = this.db
      .prepare(`SELECT * FROM users WHERE email = ? COLLATE NOCASE`)
      .get(email) as UserRow | undefined;
    if (!row) return null;
    if (!verifyPassword(password, row.password_hash)) return null;
    this.db
      .prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), row.id);
    return rowToUser(row);
  }

  create(input: {
    email: string;
    password: string;
    display_name: string;
    is_admin?: boolean;
  }): User {
    const email = input.email.trim().toLowerCase();
    if (!isValidEmail(email)) {
      throw new Error("email is required (email address or simple username)");
    }
    const display = input.display_name.trim();
    if (!display) throw new Error("display_name is required");
    const existing = this.getByEmail(email);
    if (existing) throw new Error(`email already in use`);
    const hash = hashPassword(input.password);
    const mcpToken = generateSessionToken(); // 32-byte base64url
    const now = new Date().toISOString();
    const r = this.db
      .prepare(
        `INSERT INTO users (email, password_hash, display_name, is_admin, created_at, mcp_token)
         VALUES (@email, @hash, @display, @is_admin, @created_at, @mcp_token)`,
      )
      .run({
        email,
        hash,
        display,
        is_admin: input.is_admin ? 1 : 0,
        created_at: now,
        mcp_token: mcpToken,
      });
    return this.get(Number(r.lastInsertRowid))!;
  }

  /** Lookup by MCP API token. Returns null when the token is missing
   *  or doesn't match any user. Used by the /mcp route to resolve the
   *  acting user from the Bearer header. */
  getByMcpToken(token: string): User | null {
    if (!token) return null;
    const row = this.db
      .prepare(`SELECT * FROM users WHERE mcp_token = ?`)
      .get(token) as UserRow | undefined;
    return row ? rowToUser(row) : null;
  }

  /** Issue a fresh MCP token for a user, replacing any existing one.
   *  Returns the new token (the only chance the caller has to read it
   *  if they don't immediately also fetch the user). */
  regenerateMcpToken(user_id: number): string {
    const token = generateSessionToken();
    const r = this.db
      .prepare(`UPDATE users SET mcp_token = ? WHERE id = ?`)
      .run(token, user_id);
    if (r.changes === 0) throw new Error(`user #${user_id} not found`);
    return token;
  }

  /** Backfill a token for any user that has none yet — used on startup
   *  so an existing install (where users predate this column) doesn't
   *  silently lose MCP access for those rows. */
  ensureMcpTokens(): number {
    const rows = this.db
      .prepare(`SELECT id FROM users WHERE mcp_token IS NULL`)
      .all() as { id: number }[];
    let issued = 0;
    for (const r of rows) {
      this.regenerateMcpToken(r.id);
      issued++;
    }
    return issued;
  }

  list(): User[] {
    const rows = this.db
      .prepare(`SELECT * FROM users ORDER BY id`)
      .all() as UserRow[];
    return rows.map(rowToUser);
  }

  /** Count of users currently flagged is_admin=1. Used by the
   *  "you can't delete / demote the last admin" guard. */
  adminCount(): number {
    const r = this.db
      .prepare(`SELECT COUNT(*) AS n FROM users WHERE is_admin = 1`)
      .get() as { n: number };
    return r.n;
  }

  /** Update editable user fields. Pass `password` to also rehash and
   *  rotate stored hash (won't invalidate active sessions — call
   *  SessionStore.deleteForUser separately if that's wanted).
   *
   *  Throws when:
   *    - the user doesn't exist
   *    - a unique-constraint email conflict happens
   *    - demoting the last admin would leave the system with zero
   *      admins (would brick admin UI access)
   */
  update(
    id: number,
    patch: {
      email?: string;
      display_name?: string;
      password?: string;
      is_admin?: boolean;
    },
  ): User {
    const current = this.get(id);
    if (!current) throw new Error(`user #${id} not found`);

    // Last-admin guard — refuse a demotion that would leave 0 admins.
    if (
      patch.is_admin === false &&
      current.is_admin &&
      this.adminCount() <= 1
    ) {
      throw new Error("can't demote the last admin");
    }

    const updates: string[] = [];
    const params: Record<string, unknown> = { id };
    if (patch.email !== undefined) {
      const email = patch.email.trim().toLowerCase();
      if (!isValidEmail(email)) throw new Error("invalid email");
      if (email !== current.email) {
        const clash = this.getByEmail(email);
        if (clash && clash.id !== id) throw new Error("email already in use");
      }
      updates.push("email = @email");
      params.email = email;
    }
    if (patch.display_name !== undefined) {
      const display = patch.display_name.trim();
      if (!display) throw new Error("display_name is required");
      updates.push("display_name = @display");
      params.display = display;
    }
    if (patch.password !== undefined) {
      updates.push("password_hash = @hash");
      params.hash = hashPassword(patch.password);
    }
    if (patch.is_admin !== undefined) {
      updates.push("is_admin = @is_admin");
      params.is_admin = patch.is_admin ? 1 : 0;
    }
    if (updates.length === 0) return current;

    this.db
      .prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = @id`)
      .run(params);
    return this.get(id)!;
  }

  /** Delete a user. Refuses to delete the last admin so the system
   *  can't get locked out. Cascading FK on sessions → all that user's
   *  sessions are evicted automatically. */
  delete(id: number): void {
    const u = this.get(id);
    if (!u) throw new Error(`user #${id} not found`);
    if (u.is_admin && this.adminCount() <= 1) {
      throw new Error("can't delete the last admin");
    }
    this.db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
  }
}

export interface SessionInfo {
  token: string;
  user: User;
  expires_at: string;
}

export class SessionStore {
  constructor(private db: Db, private users: UserStore) {}

  /** Issue a new session token for a user. Sessions live 30 days from issue;
   *  caller can call `refresh(token)` to slide that window forward. */
  create(user_id: number, user_agent?: string): SessionInfo {
    const token = generateSessionToken();
    const now = new Date();
    const exp = new Date(now.getTime() + SESSION_TTL_MS);
    this.db
      .prepare(
        `INSERT INTO sessions (token, user_id, created_at, expires_at, user_agent)
         VALUES (@token, @uid, @created, @exp, @ua)`,
      )
      .run({
        token,
        uid: user_id,
        created: now.toISOString(),
        exp: exp.toISOString(),
        ua: user_agent ?? null,
      });
    const user = this.users.get(user_id);
    if (!user) throw new Error(`user #${user_id} not found`);
    return { token, user, expires_at: exp.toISOString() };
  }

  /** Look up a session by token. Returns null when expired / missing.
   *  Side effect: slides `expires_at` forward to keep active sessions
   *  alive — only when at least an hour has passed since last refresh
   *  (avoids hammering the DB on every request). */
  resolve(token: string): SessionInfo | null {
    if (!token) return null;
    const row = this.db
      .prepare(
        `SELECT token, user_id, created_at, expires_at, user_agent
         FROM sessions WHERE token = ?`,
      )
      .get(token) as
      | {
          token: string;
          user_id: number;
          created_at: string;
          expires_at: string;
          user_agent: string | null;
        }
      | undefined;
    if (!row) return null;
    const now = new Date();
    if (new Date(row.expires_at).getTime() <= now.getTime()) {
      // Expired — clean it up
      this.delete(token);
      return null;
    }
    // Slide expiry forward when stale
    const slideAfter = SESSION_TTL_MS - 60 * 60 * 1000; // 1h before expiry, refresh
    if (
      new Date(row.expires_at).getTime() - now.getTime() <
      slideAfter
    ) {
      const newExp = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
      this.db
        .prepare(`UPDATE sessions SET expires_at = ? WHERE token = ?`)
        .run(newExp, token);
      row.expires_at = newExp;
    }
    const user = this.users.get(row.user_id);
    if (!user) return null;
    return { token: row.token, user, expires_at: row.expires_at };
  }

  delete(token: string): void {
    this.db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
  }

  deleteForUser(user_id: number): void {
    this.db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(user_id);
  }

  /** Periodic cleanup of expired sessions. Cheap — runs on startup. */
  purgeExpired(): number {
    const r = this.db
      .prepare(`DELETE FROM sessions WHERE expires_at <= ?`)
      .run(new Date().toISOString());
    return r.changes;
  }
}
