import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./server.js";

// Load .env from the project root (Node 20.12+ built-in, no dotenv dep).
// Failure is silent — env vars from the shell still work.
const here = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(here, "..", ".env");
try {
  process.loadEnvFile(envPath);
} catch {
  /* .env missing or unreadable — fine, fall through to shell env */
}

startServer().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[wikikai] failed to start:", err);
  process.exit(1);
});
