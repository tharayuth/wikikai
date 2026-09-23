/**
 * One-shot: rewrite links to this server's own /img/ and /file/ written with
 * its domain (`https://<PUBLIC_BASE_URL host>/img/<hash>.png`) into plain
 * paths, in pages saved before writes started doing that automatically.
 * Dry run by default — lists what would change; pass --apply to save.
 * Saving goes through PageStore, so version, revision and FTS all update.
 *
 *   node --import tsx scripts/relativize-asset-urls.ts [--apply]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/lib/config.js";
import { openDb } from "../src/store/db.js";
import { PageStore, relativizeAssetUrls } from "../src/store/pages.js";

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.resolve(here, "..", ".env"));
} catch {
  /* ok */
}

const apply = process.argv.includes("--apply");
const config = loadConfig();
const db = openDb(config.dbPath);
const pages = new PageStore(db, config.itemsDir);
const origins = [config.publicBaseUrl];
pages.setAssetOrigins(origins);

const ids = db.prepare(`SELECT id FROM pages ORDER BY id`).all() as { id: number }[];
let changed = 0;
for (const { id } of ids) {
  const page = pages.get(id);
  if (!page) continue;
  const next = relativizeAssetUrls(page.content, origins);
  if (next === page.content) continue;
  changed++;
  console.log(`#${id} (&${page.knowledge_id}): ${apply ? "rewritten" : "would rewrite"}`);
  // update() normalises on write; passing the rewritten text keeps it explicit.
  if (apply) pages.update(id, { content: next });
}
console.log(`${changed} page(s) ${apply ? "rewritten" : "to rewrite — re-run with --apply"}`);
db.close();
