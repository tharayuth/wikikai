/**
 * One-shot: document the per-project calendar view in the bundled
 * tutorial (&4, overview tab #19). Idempotent — re-running is a no-op.
 *
 *   node --import tsx scripts/add-project-calendar-docs.ts
 *
 * The calendar is a portal view, not a content fence, so the Thailand
 * showcase (&3) has nothing to demonstrate and is left alone.
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
const MARKER = "<!-- project-calendar-docs -->";
const SECTION = `
${MARKER}
## 📅 ปฏิทินของ project

ดูย้อนหลังว่าแต่ละวันมีเอกสารไหนถูกสร้างหรือแก้ไขบ้าง แบบปฏิทินรายเดือน

1. คลิก **ป้ายเลข project** ใน sidebar → เลือก **Calendar**
2. ช่องของแต่ละวันแสดงชื่อ knowledge ที่มี page ถูกสร้างหรือแก้ในวันนั้น ตัวเลขท้ายชื่อคือจำนวน page — เป็น**สีเขียว**ถ้ามีการสร้าง page ใหม่
3. กด **Show pages** เพื่อแสดงรายชื่อ page ในช่องวันด้วย: **+** สร้าง, **✎** แก้ไข, \`×N\` จำนวนครั้งที่เปลี่ยนในวันนั้น
4. คลิกที่วันเพื่อเปิดรายการทั้งหมดของวันนั้น คลิกชื่อ knowledge หรือ page เพื่อเปิดเอกสาร

| ต้องการ | ทำอย่างไร |
|---|---|
| เปลี่ยนเดือน | ปุ่ม **‹** / **›** หรือ **Today** กลับเดือนปัจจุบัน |
| แชร์ลิงก์ปฏิทิน | คัดลอก URL เช่น \`/?calendar=7&month=2026-09\` |
| กลับไปที่ปฏิทินหลังเปิดเอกสาร | กดปุ่ม back ของ browser |

### ข้อควรรู้

- วันตัดตามเวลาของ browser ที่เปิดดู ไม่ใช่เวลา UTC ของ server
- ข้อมูลมาจาก activity log — page ที่ถูกลบไปแล้วจะไม่แสดง ส่วน page ที่ archive จะแสดงแบบขีดฆ่า
- ค่า **Show pages** เก็บไว้ใน browser นี้เท่านั้น
`;

const page = pages.get(PAGE_ID);
if (!page) {
  console.log(`#${PAGE_ID}: missing — skipped`);
} else if (page.content.includes(MARKER)) {
  console.log(`#${PAGE_ID}: already has project-calendar docs`);
} else {
  const next = `${page.content.replace(/\s+$/u, "")}\n\n${SECTION.trim()}\n`;
  pages.update(PAGE_ID, { content: next });
  console.log(`#${PAGE_ID}: appended project-calendar docs`);
}

db.close();
