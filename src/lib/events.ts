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
 */
export type WikikaiEvent =
  | { type: "page-changed"; page_id: number; knowledge_id: number }
  | { type: "page-deleted"; page_id: number; knowledge_id: number }
  | { type: "knowledge-changed"; knowledge_id?: number };

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
