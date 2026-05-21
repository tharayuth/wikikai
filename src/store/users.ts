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
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    is_admin: row.is_admin === 1,
    created_at: row.created_at,
    last_login_at: row.last_login_at,
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
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("invalid email");
    }
    const display = input.display_name.trim();
    if (!display) throw new Error("display_name is required");
    const existing = this.getByEmail(email);
    if (existing) throw new Error(`email already in use`);
    const hash = hashPassword(input.password);
    const now = new Date().toISOString();
    const r = this.db
      .prepare(
        `INSERT INTO users (email, password_hash, display_name, is_admin, created_at)
         VALUES (@email, @hash, @display, @is_admin, @created_at)`,
      )
      .run({
        email,
        hash,
        display,
        is_admin: input.is_admin ? 1 : 0,
        created_at: now,
      });
    return this.get(Number(r.lastInsertRowid))!;
  }

  list(): User[] {
    const rows = this.db
      .prepare(`SELECT * FROM users ORDER BY id`)
      .all() as UserRow[];
    return rows.map(rowToUser);
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
