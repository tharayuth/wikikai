/**
 * One-shot: document the calendar's Created / Edited filters in the
 * tutorial (&4, tab #19), inside the section added by
 * add-project-calendar-docs.ts. Idempotent — re-running is a no-op.
 *
 *   node --import tsx scripts/add-calendar-filter-docs.ts
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

const PAGE_ID = 19;
const ANCHOR = "| เปลี่ยนเดือน |";
const ROW =
  "| ดูเฉพาะที่สร้างใหม่ หรือเฉพาะที่แก้ไข | ปุ่ม **+ Created** / **✎ Edited** (เปิดทั้งคู่เป็นค่าเริ่มต้น) — กดปิดฝั่งที่ไม่ต้องการ ช่องวัน รายการของวัน และตัวเลขสรุปจะกรองตาม |";

const page = pages.get(PAGE_ID);
if (!page) {
  console.log(`#${PAGE_ID}: missing — skipped`);
} else if (page.content.includes("**+ Created**")) {
  console.log(`#${PAGE_ID}: already has calendar filter docs`);
} else if (!page.content.includes(ANCHOR)) {
  console.log(`#${PAGE_ID}: calendar section not found — run add-project-calendar-docs.ts first`);
} else {
  pages.update(PAGE_ID, { content: page.content.replace(ANCHOR, `${ROW}\n${ANCHOR}`) });
  console.log(`#${PAGE_ID}: added calendar filter docs`);
}

db.close();
