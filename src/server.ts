import { loadConfig, type Config } from "./lib/config.js";
import { openDb } from "./store/db.js";
import { KnowledgeStore } from "./store/knowledge.js";
import { PageStore } from "./store/pages.js";
import { ImageStore } from "./store/images.js";
import { PromptLogStore } from "./store/promptLog.js";
import { ActivityLogStore } from "./store/activityLog.js";
import { SessionStore, UserStore } from "./store/users.js";
import { PermissionStore } from "./store/permissions.js";
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
  users: UserStore;
  sessions: SessionStore;
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
  const users = new UserStore(db);
  const sessions = new SessionStore(db, users);
  const permissions = new PermissionStore(db);
  sessions.purgeExpired();
  // Backfill MCP tokens for any user that predates the column.
  const issued = users.ensureMcpTokens();
  if (issued > 0) {
    // eslint-disable-next-line no-console
    console.log(`[wikikai] issued MCP tokens for ${issued} pre-existing user(s)`);
  }

  // Bootstrap admin from env vars when the users table is empty —
  // lets a fresh install come up usable without a separate CLI.
  let mcpDefaultUserId = config.mcpDefaultUserId;
  if (users.count() === 0 && config.bootstrapAdmin) {
    const admin = users.create({
      email: config.bootstrapAdmin.email,
      password: config.bootstrapAdmin.password,
      display_name: config.bootstrapAdmin.display_name,
      is_admin: true,
    });
    // eslint-disable-next-line no-console
    console.log(
      `[wikikai] bootstrap admin created — ${admin.email} (#${admin.id})`,
    );
    if (mcpDefaultUserId == null) mcpDefaultUserId = admin.id;
  }
  // Last-resort MCP default user: when none configured but at least one
  // user exists, tag MCP rows with user #1 so the activity log isn't
  // empty of user info.
  if (mcpDefaultUserId == null && users.count() > 0) {
    const first = users.list()[0];
    if (first) mcpDefaultUserId = first.id;
  }

  const handlers = buildToolHandlers(
    knowledge,
    pages,
    images,
    promptLog,
    activityLog,
    {
      publicBaseUrl: config.publicBaseUrl,
      projectAclEnabled: config.projectAclEnabled,
    },
    permissions,
    users,
    db,
  );
  const mcpHandler = createMcpHandler(() =>
    createMcpServer(handlers, { defaultUserId: mcpDefaultUserId }),
  );

  const app = buildApp({
    knowledge,
    pages,
    images,
    promptLog,
    activityLog,
    users,
    sessions,
    permissions,
    projectAclEnabled: config.projectAclEnabled,
    handlers,
    publicBaseUrl: config.publicBaseUrl,
    mcpHandler,
    mcpToken: config.mcpToken,
    webAuth: config.webAuth,
    mcpDefaultUserId,
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
        users,
        sessions,
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
