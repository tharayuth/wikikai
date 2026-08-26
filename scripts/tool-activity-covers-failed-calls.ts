/**
 * One-shot: the tool-activity badge now reports every `tools/call` the
 * transport receives, including ones the SDK rejects on schema validation.
 * Widen the coverage row in the bundled tutorial (&4 #26).
 *
 *   node --import tsx scripts/tool-activity-covers-failed-calls.ts
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

const FROM =
  "| ครอบคลุมแค่ไหน | ทุก tool รวมที่แค่อ่าน (`read_page`, `search`, `get_outline`) ไม่ใช่เฉพาะตอนแก้ไข |";
const TO =
  "| ครอบคลุมแค่ไหน | ทุก tool รวมที่แค่อ่าน (`read_page`, `search`, `get_outline`) ไม่ใช่เฉพาะตอนแก้ไข |\n" +
  "| เรียกผิดล่ะ | ขึ้นเหมือนกัน — ป้ายอ่านจาก request ที่เข้ามา ก่อนตรวจ argument ดังนั้นใส่ argument ผิด (เช่น `get_block({block_id})` ที่จริงต้องเป็น `id`) หรือเรียก tool ที่ไม่มีอยู่ ก็ยังเห็นชื่อ |";

const page = pages.get(26);
if (!page) {
  console.log("#26: missing — skipped");
} else if (page.content.includes("| เรียกผิดล่ะ |")) {
  console.log("#26: already updated");
} else if (!page.content.includes(FROM)) {
  console.log("#26: coverage row not found — skipped");
} else {
  pages.update(26, { content: page.content.replace(FROM, TO) });
  console.log("#26: coverage row widened");
}

db.close();
