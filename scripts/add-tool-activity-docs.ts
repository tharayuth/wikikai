/**
 * One-shot: document the live tool-activity badge in the bundled
 * tutorial (&4 #26 — the AI / MCP page) and the Thailand showcase
 * (&3 #18 — the wrap-up page).
 *
 * The badge shows the name of the MCP tool called most recently and
 * clears 30s after the last call, so it belongs with the MCP material
 * rather than with the content-fence tabs. No new tab, fence, or tool
 * ships with it, so the counts on #19 stay as they are.
 *
 *   node --import tsx scripts/add-tool-activity-docs.ts
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

function appendOnce(pageId: number, marker: string, section: string): void {
  const page = pages.get(pageId);
  if (!page) {
    console.log(`#${pageId}: missing — skipped`);
    return;
  }
  if (page.content.includes(marker)) {
    console.log(`#${pageId}: already has tool-activity docs`);
    return;
  }
  const next = `${page.content.replace(/\s+$/u, "")}\n\n${section.trim()}\n`;
  pages.update(pageId, { content: next });
  console.log(`#${pageId}: appended tool-activity docs`);
}

appendOnce(
  26,
  "<!-- tool-activity-docs -->",
  `
<!-- tool-activity-docs -->
## ดู tool ที่ AI เรียกแบบ realtime

ถัดจากปุ่ม refresh (\`↻\`) บน topbar มีป้ายเล็ก ๆ บอก **ชื่อ MCP tool ที่ถูกเรียกล่าสุด** — ขึ้นทันทีที่ tool ถูกเรียก ไม่ต้อง refresh หน้า

| พฤติกรรม | รายละเอียด |
|---|---|
| ครอบคลุมแค่ไหน | ทุก tool รวมที่แค่อ่าน (\`read_page\`, \`search\`, \`get_outline\`) ไม่ใช่เฉพาะตอนแก้ไข |
| ค้างไว้นานเท่าไหร่ | 30 วินาทีนับจากการเรียกครั้งล่าสุด — เรียกใหม่ = นับหนึ่งใหม่ |
| topbar ว่าง | แปลว่า AI ไม่ได้เรียก tool อะไรมาเกิน 30 วินาทีแล้ว |
| เปิด tab ใหม่ตอน AI กำลังทำงาน | เห็นชื่อ tool ล่าสุดทันที ไม่ต้องรอรอบถัดไป |

ป้ายนี้ส่งผ่าน SSE ช่องเดียวกับที่ใช้ push การเปลี่ยนแปลงเนื้อหา (\`/api/events\`) แต่เป็นสัญญาณ **liveness** ล้วน ๆ ไม่ได้ invalidate cache อะไร — ใช้ดูว่า agent ยังเดินอยู่ไหม หรือค้างอยู่ที่ tool ไหน

> 💡 ถ้าอยากดูย้อนหลังว่ามีอะไรเปลี่ยนไปบ้าง ให้เปิด **Activity log** (ปุ่มนาฬิกาบน topbar) — ป้ายนี้ตอบแค่ "ตอนนี้ AI ทำอะไรอยู่" ส่วน activity log เก็บประวัติการ add / edit / delete จริง ๆ
`,
);

appendOnce(
  18,
  "<!-- thailand-tool-activity-showcase -->",
  `
<!-- thailand-tool-activity-showcase -->
## ดู AI ทำงานระหว่างอัปเดตชุดข้อมูล

เวลาให้ AI ไล่อัปเดตสถิติทั้งเอกสารนี้ทีเดียว (ประชากร → เศรษฐกิจ → ท่องเที่ยว) ป้ายชื่อ tool ข้างปุ่ม \`↻\` บน topbar ช่วยให้เห็นว่ากำลังทำถึงไหน โดยไม่ต้องถาม:

| สิ่งที่เห็นบนป้าย | ตีความได้ว่า |
|---|---|
| \`search\` / \`get_outline\` | กำลังหาว่าตัวเลขเดิมอยู่หน้าไหน บรรทัดไหน |
| \`edit_section\` / \`replace_text\` | เริ่มแก้เนื้อหาจริงแล้ว |
| \`append_table_rows\` | กำลังเติมแถวข้อมูลปีล่าสุดเข้าตาราง |
| ป้ายหายไป | ไม่มีการเรียก tool มา 30 วินาที — งานน่าจะจบ หรือ agent หยุดรออะไรอยู่ |

เหมาะกับงานอัปเดตชุดใหญ่ที่กินเวลาหลายนาที: เปิดหน้านี้ทิ้งไว้บนจอที่สอง แล้วดูป้ายแทนการไล่ถามความคืบหน้า
`,
);

db.close();
