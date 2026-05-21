import { useEffect, useRef } from "react";
import { useAppDispatch } from "../store";
import { portalApi } from "../store/api";
import { setSseStatus } from "../store/uiSlice";

/**
 * Subscribe to the server's `/api/events` SSE stream.
 *
 * Two roles:
 *   1. Forward each event to the matching RTK Query tag invalidation
 *      so every open tab sees fresh data within a roundtrip of a
 *      mutation made anywhere (web UI, AI / MCP, another session).
 *   2. Track the connection's liveness in Redux (`ui.sseStatus`) so a
 *      status dot can surface it. After a reconnect, invalidate every
 *      cached tag — EventSource auto-reconnects but doesn't replay
 *      events missed during the gap, so we cannot trust the cache.
 *
 * Browser `EventSource` handles backoff + reconnect itself; we just
 * watch `open` / `error` to drive the status field.
 */
type ServerEvent =
  | { type: "page-changed"; page_id: number; knowledge_id: number }
  | { type: "page-deleted"; page_id: number; knowledge_id: number }
  | { type: "knowledge-changed"; knowledge_id?: number };

const REFRESH_TAGS = [
  { type: "KnowledgeList", id: "LIST" },
  { type: "Page", id: "TITLES" },
  { type: "Projects", id: "LIST" },
  { type: "ActivityLog", id: "LIST" },
  "Knowledge",
  "Page",
  "PageRendered",
  "Revisions",
] as const;

export function useServerEvents(): void {
  const dispatch = useAppDispatch();
  const hadOpenRef = useRef(false);
  const lostRef = useRef(false);

  useEffect(() => {
    const es = new EventSource("/api/events");

    es.onopen = () => {
      if (lostRef.current) {
        // Recovered after a drop — replay-equivalent: invalidate every
        // tag the SSE stream is supposed to keep fresh.
        dispatch(portalApi.util.invalidateTags([...REFRESH_TAGS]));
        lostRef.current = false;
      }
      hadOpenRef.current = true;
      dispatch(setSseStatus("connected"));
    };

    es.onerror = () => {
      // EventSource will keep retrying. Flip status based on whether we
      // ever connected at all.
      lostRef.current = true;
      dispatch(setSseStatus(hadOpenRef.current ? "reconnecting" : "offline"));
    };

    es.onmessage = (msg) => {
      let e: ServerEvent | null = null;
      try {
        e = JSON.parse(msg.data) as ServerEvent;
      } catch {
        return;
      }
      if (!e) return;
      switch (e.type) {
        case "page-changed": {
          dispatch(
            portalApi.util.invalidateTags([
              { type: "Page", id: e.page_id },
              { type: "PageRendered", id: e.page_id },
              { type: "Revisions", id: e.page_id },
              { type: "Knowledge", id: e.knowledge_id },
              { type: "Page", id: "TITLES" },
              { type: "ActivityLog", id: "LIST" },
            ]),
          );
          break;
        }
        case "page-deleted": {
          dispatch(
            portalApi.util.invalidateTags([
              { type: "Page", id: e.page_id },
              { type: "PageRendered", id: e.page_id },
              { type: "Revisions", id: e.page_id },
              { type: "Knowledge", id: e.knowledge_id },
              { type: "KnowledgeList", id: "LIST" },
              { type: "Page", id: "TITLES" },
              { type: "ActivityLog", id: "LIST" },
            ]),
          );
          break;
        }
        case "knowledge-changed": {
          const tags: Parameters<typeof portalApi.util.invalidateTags>[0] = [
            { type: "KnowledgeList", id: "LIST" },
            { type: "Page", id: "TITLES" },
            { type: "Projects", id: "LIST" },
            { type: "ActivityLog", id: "LIST" },
          ];
          if (e.knowledge_id != null) {
            tags.push({ type: "Knowledge", id: e.knowledge_id });
          }
          dispatch(portalApi.util.invalidateTags(tags));
          break;
        }
      }
    };

    return () => {
      es.close();
    };
  }, [dispatch]);
}
