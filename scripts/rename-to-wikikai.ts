/**
 * Apply the KnowPort → WikiKai rename to the in-DB content too:
 * - knowledge &4 title
 * - any page content in &4 that still mentions KnowPort
 * Using PageStore.update so version bump + revision snapshot + FTS sync.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/lib/config.js";
import { openDb } from "../src/store/db.js";
import { KnowledgeStore } from "../src/store/knowledge.js";
import { PageStore } from "../src/store/pages.js";

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.resolve(here, "..", ".env"));
} catch {
  /* ok */
}
const config = loadConfig();
const db = openDb(config.dbPath);
const knowledge = new KnowledgeStore(db);
const pages = new PageStore(db, config.itemsDir);

function rename(s: string): string {
  return s
    .replace(/KnowPort/g, "WikiKai")
    .replace(/KNOWPORT/g, "WIKIKAI")
    .replace(/knowport/g, "wikikai");
}

// 1) Knowledge &4 title
const k4 = knowledge.get(4);
if (k4) {
  const renamed = rename(k4.title);
  if (renamed !== k4.title) {
    knowledge.update(4, { title: renamed });
    console.log(`&4 title → ${renamed}`);
  }
}

// 2) Scan every page for KnowPort references and rewrite via pages.update
const allPages = pages.list(4);
// Also handle any other knowledge that might mention it
const allKnowledge = knowledge.list({});
for (const k of allKnowledge) {
  for (const p of pages.list(k.id)) {
    const cur = pages.get(p.id);
    if (!cur) continue;
    if (/KnowPort|KNOWPORT|knowport/.test(cur.content)) {
      const next = rename(cur.content);
      const nextTitle = rename(p.title);
      pages.update(p.id, {
        content: next,
        title: nextTitle !== p.title ? nextTitle : undefined,
      });
      console.log(`page #${p.id} in &${k.id} (${p.title}) — rewritten`);
    }
  }
}
void allPages;

db.close();
console.log("✓ done");
