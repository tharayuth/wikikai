import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-call context propagated through async work so the activity-log
 * recorder can tag each row with the entry point that triggered it
 * (MCP tool call vs. web UI mutation) without threading an extra arg
 * through every handler signature.
 *
 * MCP transport sets `{ source: "mcp", tool_name }` around each tool
 * dispatch. Web routes set `{ source: "web" }` around each mutation.
 * Handlers and store methods read the current value via `getCallContext`
 * when they record an audit-log entry.
 *
 * Falls back to `{ source: "mcp" }` when no context has been pushed —
 * primarily useful for tests or startup-time mutations.
 */
export interface CallContext {
  source: "mcp" | "web";
  /** Set only when source === "mcp". */
  tool_name?: string;
  /** Set when the request belongs to a known user. For web routes this
   *  comes from the session cookie; for MCP it comes from the
   *  configured `mcpDefaultUserId`. Null when neither applies. */
  user_id?: number | null;
}

const storage = new AsyncLocalStorage<CallContext>();

/** Run `fn` with the given context attached to all async work it spawns. */
export function withCallContext<T>(ctx: CallContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** Read the current call context. Returns a default when none has been pushed. */
export function getCallContext(): CallContext {
  return storage.getStore() ?? { source: "mcp" };
}
