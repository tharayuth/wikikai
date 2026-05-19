import { useEffect } from "react";
import { useAppDispatch } from "../store";
import { portalApi } from "../store/api";

/**
 * Subscribe to the server's `/api/events` SSE stream and invalidate the
 * matching RTK Query tags so every open tab sees fresh data within a
 * roundtrip of a mutation made anywhere (web UI, AI / MCP, another
 * session).
 *
 * Browser `EventSource` handles reconnect itself; we only close on
 * component unmount.
 */
type ServerEvent =
  | { type: "page-changed"; page_id: number; knowledge_id: number }
  | { type: "page-deleted"; page_id: number; knowledge_id: number }
  | { type: "knowledge-changed"; knowledge_id?: number };

export function useServerEvents(): void {
  const dispatch = useAppDispatch();

  useEffect(() => {
    const es = new EventSource("/api/events");
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
            ]),
          );
          break;
        }
        case "knowledge-changed": {
          const tags: Parameters<typeof portalApi.util.invalidateTags>[0] = [
            { type: "KnowledgeList", id: "LIST" },
            { type: "Page", id: "TITLES" },
            { type: "Projects", id: "LIST" },
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
