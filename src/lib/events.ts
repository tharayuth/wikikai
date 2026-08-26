import { EventEmitter } from "node:events";

/**
 * Server → client push events. The single `/api/events` SSE endpoint
 * fans these out as JSON to every subscribed browser; the client maps
 * each event to a set of RTK Query tag invalidations.
 *
 * Kinds:
 *   page-changed     — a specific page's content / version moved
 *   page-deleted     — a specific page is gone
 *   knowledge-changed — a knowledge's metadata / pages list changed.
 *                       knowledge_id absent ⇒ the list itself changed
 *                       (a knowledge was added / removed).
 *   activity-logged  — a new row was inserted into activity_log.
 *                       knowledge_id is the row's knowledge_id (null
 *                       for log entries without a knowledge target —
 *                       e.g. image uploads). The open ActivityLogModal
 *                       refreshes its list on this signal.
 *   tool-called      — an MCP tool was invoked. Read-only tools included,
 *                       so this is a liveness signal, not a mutation
 *                       signal — it invalidates no caches. `age_ms` is
 *                       how long ago the call happened: 0 for a live
 *                       broadcast, >0 when replayed to a tab that
 *                       connected after the fact.
 */
export type WikikaiEvent =
  | { type: "page-changed"; page_id: number; knowledge_id: number }
  | { type: "page-deleted"; page_id: number; knowledge_id: number }
  | { type: "knowledge-changed"; knowledge_id?: number }
  | { type: "activity-logged"; knowledge_id: number | null }
  | { type: "tool-called"; tool_name: string; age_ms: number };

const bus = new EventEmitter();
// Each open SSE response registers a listener; remove the default cap
// so a busy install with many tabs doesn't print the MaxListeners warning.
bus.setMaxListeners(0);

export function emitEvent(e: WikikaiEvent): void {
  bus.emit("wikikai", e);
}

/** Subscribe to events. Returns an unsubscribe function. */
export function onEvent(fn: (e: WikikaiEvent) => void): () => void {
  bus.on("wikikai", fn);
  return () => {
    bus.off("wikikai", fn);
  };
}

/**
 * How long a tool name stays "current". The topbar badge holds the name
 * for this long after the call, and a tab connecting inside the window
 * gets the same name replayed so every tab shows the same thing.
 */
export const TOOL_CALL_TTL_MS = 30_000;

/** Newest MCP tool call, or null when none has happened this process. */
let lastToolCall: { tool_name: string; at: number } | null = null;

/** Broadcast an MCP tool invocation and remember it for late joiners. */
export function emitToolCall(tool_name: string): void {
  lastToolCall = { tool_name, at: Date.now() };
  emitEvent({ type: "tool-called", tool_name, age_ms: 0 });
}

/**
 * The last tool call if it is still inside {@link TOOL_CALL_TTL_MS},
 * else null. `/api/events` sends this once on connect so a tab opened
 * mid-window catches up instead of waiting for the next call.
 */
export function getRecentToolCall(): {
  tool_name: string;
  age_ms: number;
} | null {
  if (!lastToolCall) return null;
  const age_ms = Date.now() - lastToolCall.at;
  if (age_ms >= TOOL_CALL_TTL_MS) return null;
  return { tool_name: lastToolCall.tool_name, age_ms };
}
