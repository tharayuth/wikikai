/**
 * One-shot: the project header changed — the calendar is an always-visible
 * icon at the right end, the id badge appears on hover and its menu holds
 * "New knowledge" (the "+" button is gone). Updates the calendar steps in
 * the tutorial (&4 #19). Idempotent.
 *
 *   node --import tsx scripts/move-project-header-actions-docs.ts
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
/** Earlier wordings of step 1, newest last — any of them is replaced. */
const OLD = [
  "1. คลิก **ป้ายเลข project** ใน sidebar → เลือก **Calendar**",
  "1. เอาเมาส์ชี้ที่หัว project ใน sidebar → คลิก**ไอคอนปฏิทิน**ข้างป้ายเลข project (ส่วนการสร้าง knowledge ใหม่ อยู่ในเมนูของป้ายเลข project → **New knowledge**)",
];
const NEW =
  "1. คลิก**ไอคอนปฏิทิน**ที่ท้ายหัว project ใน sidebar (ส่วนการสร้าง knowledge ใหม่: เอาเมาส์ชี้ที่หัว project → คลิกป้ายเลข project → **New knowledge**)";

const page = pages.get(PAGE_ID);
if (!page) console.log(`#${PAGE_ID}: missing — skipped`);
else if (page.content.includes(NEW)) console.log(`#${PAGE_ID}: already done`);
else {
  const old = OLD.find((o) => page.content.includes(o));
  if (!old) console.log(`#${PAGE_ID}: old text not found — skipped`);
  else {
    pages.update(PAGE_ID, { content: page.content.replace(old, NEW) });
    console.log(`#${PAGE_ID}: updated`);
  }
}
db.close();
