import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const SESSION_HEADER = "mcp-session-id";

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
