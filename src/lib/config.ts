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

  return { port, host, dataDir, dbPath, itemsDir, imagesDir, publicBaseUrl, mcpToken };
}
