import crypto from "node:crypto";

/**
 * Short-lived upload links for MCP clients.
 *
 * An agent must never push file bytes through the model as base64 — that
 * costs output tokens by the hundred thousand. Instead `get_upload_url`
 * issues a ticket and the agent sends the file with curl to
 * `/api/upload/<ticket>/{image|file}`, so the bytes go from disk to server
 * without touching the conversation.
 *
 * The agent cannot see its MCP bearer token (it lives in the client's
 * config), which is why the credential is the unguessable ticket in the
 * URL. A ticket can carry several uploads until it expires, so one call
 * covers a batch of screenshots. Tickets live in memory: a restart simply
 * expires them, which is harmless at this lifetime.
 */

export const UPLOAD_TICKET_TTL_MS = 15 * 60 * 1000;

export interface UploadTicket {
  token: string;
  /** User the uploads are attributed to in the activity log. */
  user_id: number | null;
  expires_at: number;
}

export class UploadTicketStore {
  private tickets = new Map<string, UploadTicket>();

  constructor(
    private ttlMs: number = UPLOAD_TICKET_TTL_MS,
    private now: () => number = Date.now,
  ) {}

  issue(userId: number | null): UploadTicket {
    this.sweep();
    const ticket: UploadTicket = {
      token: crypto.randomBytes(24).toString("base64url"),
      user_id: userId,
      expires_at: this.now() + this.ttlMs,
    };
    this.tickets.set(ticket.token, ticket);
    return ticket;
  }

  /** The live ticket for `token`, or null when unknown or expired. */
  resolve(token: string): UploadTicket | null {
    const t = this.tickets.get(token);
    if (!t) return null;
    if (t.expires_at <= this.now()) {
      this.tickets.delete(token);
      return null;
    }
    return t;
  }

  private sweep(): void {
    const now = this.now();
    for (const [k, t] of this.tickets) if (t.expires_at <= now) this.tickets.delete(k);
  }
}
