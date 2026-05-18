import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/lib/config.js";
import { openDb } from "../src/store/db.js";
import { PageStore } from "../src/store/pages.js";

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.resolve(here, "..", ".env"));
} catch {
  /* ok */
}
const config = loadConfig();
const db = openDb(config.dbPath);
const pages = new PageStore(db, config.itemsDir);

// Renumber tabs in &4 — strip the "N." prefix and prepend the actual position.
const list = pages.list(4);
for (const p of list) {
  const stripped = p.title.replace(/^\d+\.\s*/, "");
  const next = `${p.position}. ${stripped}`;
  if (next !== p.title) {
    pages.update(p.id, { title: next });
    console.log(`#${p.id} → "${next}"`);
  }
}
db.close();
console.log("done");
