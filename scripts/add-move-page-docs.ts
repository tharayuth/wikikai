/**
 * Document the new `move_page_to_knowledge` tool + sidebar drag-to-move
 * affordance in the bundled tutorial (&4):
 *   - #26 (MCP workflow): add a row to the "Pages (tabs)" tool table.
 *   - #19 (overview): bump the stats card "MCP tools" count 21 → 22.
 *
 *   PATH=$HOME/.nvm/versions/node/v25.6.1/bin:$PATH \
 *     node --import tsx scripts/add-move-page-docs.ts
 *
 * Idempotent: each edit bails if its change is already present.
 */
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

// ── #26: add move_page_to_knowledge to the Pages tool table ──
{
  const PAGE_ID = 26;
  const cur = pages.get(PAGE_ID);
  if (!cur) {
    console.error(`page #${PAGE_ID} not found`);
  } else if (cur.content.includes("move_page_to_knowledge")) {
    console.log(`&4 #${PAGE_ID}: move_page_to_knowledge already documented`);
  } else {
    const anchor =
      "| `reorder_pages` | สลับลำดับ tab ด้วย permutation ของ page_ids |";
    const added =
      anchor +
      "\n| `move_page_to_knowledge` | ย้าย page ไป knowledge **อื่น** — คง id, history + รูป; วางที่ `position` หรือท้ายสุด (คน: ลาก handle ของ page ไปวางบน topic อื่นใน sidebar) |";
    if (!cur.content.includes(anchor)) {
      console.error(`&4 #${PAGE_ID}: anchor row not found — skipping`);
    } else {
      pages.update(PAGE_ID, {
        content: cur.content.replace(anchor, added),
      });
      console.log(`&4 #${PAGE_ID}: added move_page_to_knowledge row`);
    }
  }
}

// ── #19: bump the stats card MCP-tools count 21 → 22 ──
{
  const PAGE_ID = 19;
  const cur = pages.get(PAGE_ID);
  if (!cur) {
    console.error(`page #${PAGE_ID} not found`);
  } else if (cur.content.includes('"22", "label": "MCP tools"')) {
    console.log(`&4 #${PAGE_ID}: MCP tools count already 22`);
  } else if (!cur.content.includes('"21", "label": "MCP tools"')) {
    console.error(`&4 #${PAGE_ID}: expected "21" MCP tools stat not found — skipping`);
  } else {
    pages.update(PAGE_ID, {
      content: cur.content.replace(
        '"21", "label": "MCP tools"',
        '"22", "label": "MCP tools"',
      ),
    });
    console.log(`&4 #${PAGE_ID}: bumped MCP tools 21 → 22`);
  }
}

db.close();
