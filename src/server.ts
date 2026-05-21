import { loadConfig, type Config } from "./lib/config.js";
import { openDb } from "./store/db.js";
import { KnowledgeStore } from "./store/knowledge.js";
import { PageStore } from "./store/pages.js";
import { ImageStore } from "./store/images.js";
import { PromptLogStore } from "./store/promptLog.js";
import { ActivityLogStore } from "./store/activityLog.js";
import { buildToolHandlers } from "./mcp/handlers.js";
import { createMcpServer } from "./mcp/server.js";
import { buildApp } from "./web/app.js";
import { createMcpHandler } from "./web/mcpRoute.js";

export interface RunningServer {
  config: Config;
  knowledge: KnowledgeStore;
  pages: PageStore;
  images: ImageStore;
  promptLog: PromptLogStore;
  activityLog: ActivityLogStore;
  close: () => Promise<void>;
}

export async function startServer(): Promise<RunningServer> {
  const config = loadConfig();
  const db = openDb(config.dbPath);
  const knowledge = new KnowledgeStore(db);
  const pages = new PageStore(db, config.itemsDir);
  const images = new ImageStore(db, config.imagesDir);
  const promptLog = new PromptLogStore(db);
  const activityLog = new ActivityLogStore(db);
  const handlers = buildToolHandlers(
    knowledge,
    pages,
    images,
    promptLog,
    activityLog,
    {
      publicBaseUrl: config.publicBaseUrl,
    },
  );
  const mcpHandler = createMcpHandler(() => createMcpServer(handlers));

  const app = buildApp({
    knowledge,
    pages,
    images,
    promptLog,
    activityLog,
    handlers,
    publicBaseUrl: config.publicBaseUrl,
    mcpHandler,
    mcpToken: config.mcpToken,
  });

  return new Promise((resolve, reject) => {
    const httpServer = app.listen(config.port, config.host, () => {
      // eslint-disable-next-line no-console
      console.log(
        `[wikikai] listening on ${config.publicBaseUrl}  (MCP: ${config.publicBaseUrl}/mcp)` +
          (config.mcpToken ? "  [auth: Bearer token required]" : "  [auth: OFF — no token set]"),
      );
      resolve({
        config,
        knowledge,
        pages,
        images,
        promptLog,
        activityLog,
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            httpServer.close((err) => {
              db.close();
              if (err) rejectClose(err);
              else resolveClose();
            });
          }),
      });
    });
    httpServer.on("error", reject);
  });
}
