/**
 * Append a short "จัดระเบียบด้วย project" section to &4 #19 (tutorial
 * overview) documenting the new project filter dialog + inline
 * move-knowledge-to-project editor in the info popover.
 *
 *   PATH=$HOME/.nvm/versions/node/v25.6.1/bin:$PATH \
 *     node --import tsx scripts/add-project-organize-19.ts
 *
 * Idempotent: bails if the section header is already present.
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
const MARKER = "## จัดระเบียบด้วย project";

const cur = pages.get(PAGE_ID);
if (!cur) {
  console.error(`page #${PAGE_ID} not found`);
  process.exit(1);
}
if (cur.content.includes(MARKER)) {
  console.log(`&4 #${PAGE_ID}: project organize section already present — nothing to do`);
  db.close();
  process.exit(0);
}

const APPENDED = `

${MARKER}

knowledge หลายเล่มจัดกลุ่มได้ด้วย **project** — ฟิลด์เดียวบน knowledge ใช้เป็น group key ใน sidebar

\`\`\`steps {@-}
[
  { "title": "เปิด dialog กรอง project", "body": "คลิกหัวข้อ **WikiKai** บน sidebar — เห็นรายการ project ทั้งหมด + จำนวน knowledge ในแต่ละ project" },
  { "title": "สร้าง project ว่าง", "body": "พิมพ์ชื่อใน input ด้านบน → กด **+ เพิ่ม** → project ใหม่จะอยู่ในรายการทันที (มี badge **ว่าง**) — เอาไว้รอย้าย knowledge เข้าไป" },
  { "title": "ย้าย knowledge ไป project อื่น", "body": "เปิด info popover (ปุ่ม **i** ข้างชื่อ knowledge) → คลิกแถว **project** → input พร้อม autocomplete ของ project ที่มี. พิมพ์ชื่อเดิมก็ได้ ชื่อใหม่ก็ได้ — Enter บันทึก, Esc ยกเลิก" },
  { "title": "ลบ project", "body": "ในรายการ project คลิก 🗑 → ต้องพิมพ์ชื่อ project ซ้ำเพื่อยืนยัน → ลบ project ออกจาก registry **และ** ลบ knowledge ทุกเล่มใน project นั้น (รวมไฟล์ markdown บน disk)" }
]
\`\`\`

> 💡 **Tip** — project ที่มี badge **ว่าง** หมายความว่าไม่มี knowledge อยู่เลย; ใช้สำหรับ "จองชื่อ" project ก่อนยังไม่มีเอกสาร (เช่น เริ่มงานใหม่แล้วอยากให้ชื่อ project ปรากฏใน picker ทันที)
`;

const next = cur.content.trimEnd() + APPENDED;
pages.update(PAGE_ID, { content: next });
console.log(`appended project organize section to &4 #${PAGE_ID}`);
db.close();
