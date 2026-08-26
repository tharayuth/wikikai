import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { emitToolCall } from "../lib/events.js";

const SESSION_HEADER = "mcp-session-id";

/**
 * Push every `tools/call` this transport receives to the live-activity
 * channel, so the portal's topbar badge can name what the AI is doing.
 *
 * Deliberately done here, on the raw JSON-RPC body, rather than around the
 * tool handlers: the SDK validates arguments before it ever reaches a
 * handler, so a call wrapped further in goes unreported precisely when the
 * AI passed a wrong argument name — the moment the badge is most useful.
 * The name is whatever the client asked for; unknown names are still real
 * attempts and worth surfacing.
 *
 * `body` is untrusted client input, so every level is narrowed before use.
 * JSON-RPC allows a batch array, hence the normalisation.
 */
function announceToolCalls(body: unknown): void {
  for (const msg of Array.isArray(body) ? body : [body]) {
    if (typeof msg !== "object" || msg === null) continue;
    if ((msg as { method?: unknown }).method !== "tools/call") continue;
    const params = (msg as { params?: unknown }).params;
    if (typeof params !== "object" || params === null) continue;
    const name = (params as { name?: unknown }).name;
    if (typeof name === "string" && name !== "") emitToolCall(name);
  }
}

interface Session {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

export function createMcpHandler(serverFactory: () => McpServer): RequestHandler {
  const sessions = new Map<string, Session>();

  return async (req, res) => {
    try {
      const sessionId = req.header(SESSION_HEADER) ?? undefined;
      let session = sessionId ? sessions.get(sessionId) : undefined;

      if (!session) {
        const server = serverFactory();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid: string) => {
            sessions.set(sid, { server, transport });
          },
        });
        transport.onclose = () => {
          if (transport.sessionId) sessions.delete(transport.sessionId);
        };
        await server.connect(transport);
        session = { server, transport };
      }

      announceToolCalls(req.body);
      await session.transport.handleRequest(req, res, req.body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) {
        res.status(500).json({ error: message });
      } else {
        res.end();
      }
    }
  };
}
