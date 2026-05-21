import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  dbPath: string;
  itemsDir: string;
  imagesDir: string;
  publicBaseUrl: string;
  /**
   * Optional bearer token. When set, the /mcp endpoint requires
   *   Authorization: Bearer <token>
   * The web UI and viewer pages are not gated (they need to be reachable
   * from a browser without custom headers — protect those at the network
   * layer instead).
   */
  mcpToken: string | null;
  /** Turn the web login on. When false (default), the web UI is open
   *  to anyone who can reach the server — matches the pre-auth
   *  behaviour. When true, every /api/* + the static SPA require a
   *  valid session cookie; unauthenticated browsers get bounced to
   *  /login. */
  webAuth: boolean;
  /** Bootstrap admin — when the `users` table is empty on startup and
   *  both of these are set, an admin row is auto-created. Lets a
   *  fresh install come up usable without a separate setup CLI. */
  bootstrapAdmin: { email: string; password: string; display_name: string } | null;
  /** User id used to tag MCP-source activity-log rows. MCP clients
   *  authenticate by token, not user session — without this every MCP
   *  mutation would log `user_id: null`. Defaults to the bootstrap
   *  admin's id when not set explicitly. */
  mcpDefaultUserId: number | null;
  /** When false, `assertProjectAccess` no-ops — restores pre-ACL behaviour.
   *  Defaults to true. Set `WIKIKAI_PROJECT_ACL=0` to disable in prod. */
  projectAclEnabled: boolean;
}

/**
 * Return the first non-internal IPv4 address on this machine,
 * or null if none found. Used to make URLs reachable from LAN
 * when HOST is 0.0.0.0.
 */
function detectLanIp(): string | null {
  const ifaces = os.networkInterfaces();
  // Prefer en0/eth0-style interfaces first
  const ordered = Object.entries(ifaces).sort(([a], [b]) => {
    const score = (n: string) =>
      /^(en|eth)/.test(n) ? 0 : n === "lo0" || n === "lo" ? 9 : 5;
    return score(a) - score(b);
  });
  for (const [, addrs] of ordered) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === "IPv4" && !addr.internal) return addr.address;
    }
  }
  return null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 3939);
  const host = env.HOST ?? "0.0.0.0";
  const dataDir = env.DATA_DIR ?? path.join(root, "data");
  const dbPath = env.DB_PATH ?? path.join(dataDir, "index.db");
  const itemsDir = env.ITEMS_DIR ?? path.join(dataDir, "items");
  const imagesDir = env.IMAGES_DIR ?? path.join(dataDir, "images");

  let publicBaseUrl = env.PUBLIC_BASE_URL;
  if (!publicBaseUrl) {
    if (host === "0.0.0.0" || host === "::") {
      const lan = detectLanIp();
      publicBaseUrl = `http://${lan ?? "127.0.0.1"}:${port}`;
    } else {
      publicBaseUrl = `http://${host}:${port}`;
    }
  }

  const mcpToken = (env.WIKIKAI_TOKEN ?? "").trim() || null;

  const webAuth = /^(1|true|yes|on)$/i.test(env.WIKIKAI_WEB_AUTH ?? "");
  const adminEmail = (env.WIKIKAI_ADMIN_EMAIL ?? "").trim();
  const adminPassword = env.WIKIKAI_ADMIN_PASSWORD ?? "";
  const adminName =
    (env.WIKIKAI_ADMIN_NAME ?? "").trim() ||
    (adminEmail ? adminEmail.split("@")[0] : "");
  const bootstrapAdmin =
    adminEmail && adminPassword
      ? { email: adminEmail, password: adminPassword, display_name: adminName }
      : null;
  const mcpDefaultUserRaw = (env.WIKIKAI_MCP_DEFAULT_USER ?? "").trim();
  const mcpDefaultUserId = mcpDefaultUserRaw
    ? Number(mcpDefaultUserRaw) || null
    : null;
  const projectAclEnabled = (env.WIKIKAI_PROJECT_ACL ?? "1") !== "0";

  return {
    port,
    host,
    dataDir,
    dbPath,
    itemsDir,
    imagesDir,
    publicBaseUrl,
    mcpToken,
    webAuth,
    bootstrapAdmin,
    mcpDefaultUserId,
    projectAclEnabled,
  };
}
