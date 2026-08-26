/**
 * One-shot: the tool-activity badge moved from beside the refresh button to
 * just right of the WikiKai logo. Fix the position wording in the bundled
 * tutorial (&4 #26) and the Thailand showcase (&3 #18).
 *
 *   node --import tsx scripts/move-tool-activity-badge-docs.ts
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

function replaceOnce(pageId: number, from: string, to: string): void {
  const page = pages.get(pageId);
  if (!page) {
    console.log(`#${pageId}: missing — skipped`);
    return;
  }
  if (page.content.includes(to)) {
    console.log(`#${pageId}: already updated`);
    return;
  }
  if (!page.content.includes(from)) {
    console.log(`#${pageId}: old wording not found — skipped`);
    return;
  }
  pages.update(pageId, { content: page.content.replace(from, to) });
  console.log(`#${pageId}: position wording updated`);
}

replaceOnce(
  26,
  "ถัดจากปุ่ม refresh (`↻`) บน topbar มีป้ายเล็ก ๆ บอก",
  "ถัดจาก **โลโก้ WikiKai** บน topbar มีป้ายเล็ก ๆ บอก",
);

replaceOnce(
  18,
  "ป้ายชื่อ tool ข้างปุ่ม `↻` บน topbar",
  "ป้ายชื่อ tool ข้าง **โลโก้ WikiKai** บน topbar",
);

db.close();
