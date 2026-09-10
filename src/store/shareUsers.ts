import type { Db } from "./db.js";
import { hashPassword, verifyPassword } from "../lib/auth.js";

/** A share user as shown to the editor — never carries the hash. */
export interface ShareUser {
  id: number;
  knowledge_id: number;
  username: string;
  expires_at: string | null;
  created_at: string;
  /** Derived: `expires_at` is in the past. Kept in the list so the dialog
   *  can grey the row out without re-deriving dates client-side. */
  expired: boolean;
}

interface Row {
  id: number;
  knowledge_id: number;
  username: string;
  password_hash: string;
  expires_at: string | null;
  created_at: string;
}

const DAY_MS = 86_400_000;

function isExpired(expires_at: string | null, now = Date.now()): boolean {
  return expires_at != null && new Date(expires_at).getTime() <= now;
}

function rowToUser(row: Row): ShareUser {
  return {
    id: row.id,
    knowledge_id: row.knowledge_id,
    username: row.username,
    expires_at: row.expires_at,
    created_at: row.created_at,
    expired: isExpired(row.expires_at),
  };
}

/**
 * Per-knowledge throwaway credentials for password-protected share links.
 * Intentionally minimal: add, list, remove, verify. No edit — an editor who
 * wants a new password or expiry deletes the row and adds it again.
 */
export class ShareUserStore {
  constructor(private db: Db) {}

  list(knowledge_id: number): ShareUser[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM share_users WHERE knowledge_id = ? ORDER BY created_at, id`,
      )
      .all(knowledge_id) as Row[];
    return rows.map(rowToUser);
  }

  /** The hash is the HMAC key for the login cookie, so the web layer needs
   *  it — nothing else should. */
  getWithHash(id: number): (ShareUser & { password_hash: string }) | null {
    const row = this.db
      .prepare(`SELECT * FROM share_users WHERE id = ?`)
      .get(id) as Row | undefined;
    return row ? { ...rowToUser(row), password_hash: row.password_hash } : null;
  }

  add(input: {
    knowledge_id: number;
    username: string;
    password: string;
    /** Whole days from now; omit / null for no expiry. No upper bound. */
    expires_in_days?: number | null;
  }): ShareUser {
    const username = input.username.trim();
    if (!username || username.length > 64) {
      throw new Error("username is required (max 64 chars)");
    }
    if (typeof input.password !== "string" || input.password.length === 0) {
      throw new Error("password is required");
    }
    const days = input.expires_in_days ?? null;
    if (days != null && (!Number.isInteger(days) || days < 1)) {
      throw new Error("expires_in_days must be a whole number ≥ 1");
    }
    const now = Date.now();
    const expires_at = days == null ? null : new Date(now + days * DAY_MS).toISOString();
    const dup = this.db
      .prepare(`SELECT 1 FROM share_users WHERE knowledge_id = ? AND username = ?`)
      .get(input.knowledge_id, username);
    if (dup) throw new Error(`share user "${username}" already exists`);
    const r = this.db
      .prepare(
        `INSERT INTO share_users (knowledge_id, username, password_hash, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        input.knowledge_id,
        username,
        hashPassword(input.password),
        expires_at,
        new Date(now).toISOString(),
      );
    return this.getWithHashless(Number(r.lastInsertRowid));
  }

  /** Delete one user. Scoped by knowledge so a stale id from another
   *  document can never remove someone else's reader. */
  remove(knowledge_id: number, id: number): boolean {
    const r = this.db
      .prepare(`DELETE FROM share_users WHERE id = ? AND knowledge_id = ?`)
      .run(id, knowledge_id);
    return r.changes > 0;
  }

  /** Check a username/password against one knowledge's share users.
   *  Returns the user on success, `"expired"` when the password was right
   *  but the account has lapsed, and null otherwise. Expired is reported
   *  separately so the reader is told to ask for a renewal rather than
   *  retyping a password that was never wrong. */
  verify(knowledge_id: number, username: string, password: string): ShareUser | "expired" | null {
    const row = this.db
      .prepare(`SELECT * FROM share_users WHERE knowledge_id = ? AND username = ?`)
      .get(knowledge_id, username.trim()) as Row | undefined;
    if (!row) return null;
    if (!verifyPassword(password, row.password_hash)) return null;
    if (isExpired(row.expires_at)) return "expired";
    return rowToUser(row);
  }

  /** Test seam: backdate an expiry without waiting. */
  setExpiresAtForTest(id: number, expires_at: string | null): void {
    this.db
      .prepare(`UPDATE share_users SET expires_at = ? WHERE id = ?`)
      .run(expires_at, id);
  }

  private getWithHashless(id: number): ShareUser {
    const row = this.db
      .prepare(`SELECT * FROM share_users WHERE id = ?`)
      .get(id) as Row | undefined;
    if (!row) throw new Error(`share user #${id} not found`);
    return rowToUser(row);
  }
}
