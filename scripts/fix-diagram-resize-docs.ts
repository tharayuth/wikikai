/**
 * One-shot: diagram resize moved from a right-edge width drag to a
 * bottom-edge height drag (width now always follows the diagram's aspect
 * ratio). Rewrite the section in the bundled tutorial (&4 #22).
 *
 *   node --import tsx scripts/fix-diagram-resize-docs.ts
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

const MARKER = "<!-- diagram-resize-docs -->";
const SECTION = `${MARKER}
## ย่อ/ขยาย diagram

เอาเมาส์ชี้ที่ diagram แล้ว **ลากขอบล่าง** เพื่อปรับความสูง — ตัว diagram จะสเกลตาม ส่วนความกว้างไปตามสัดส่วนของภาพเอง ภาพจึงใหญ่/เล็กทั้งอัน. ดับเบิลคลิกที่ขอบเพื่อคืนขนาดปกติ

| ประเด็น | รายละเอียด |
|---|---|
| เก็บไว้ที่ไหน | ต่อท้าย annotation ของ block เอง — \`{@123 h=320}\` หรือ \`{@123 "caption" h=320}\` |
| ทำไมลากแกนเดียว | SVG มีอัตราส่วนคงที่ ลากสูงแล้วกว้างตามเอง ถ้าเพิ่มแกนที่สองจะกลายเป็นการยืดภาพ ไม่ใช่ย่อขยาย |
| ผลพลอยได้ | ปลดเพดานความสูงเริ่มต้น (48vh) ที่ปกติจะตัด diagram สูง ๆ ทิ้ง |
| ใครเห็นบ้าง | ทุกคนที่เปิดเอกสาร รวมถึงคนที่เปิดผ่านลิงก์แชร์ — ต่างจากความกว้างคอลัมน์อ่านที่จำไว้เฉพาะ browser ของแต่ละคน |
| กระทบเนื้อหาไหม | ไม่ — เป็นค่าการแสดงผลล้วน ๆ แต่นับเป็นการแก้ไขหน้า จึงมี revision ใหม่ทุกครั้งที่ลาก |
| AI ต้องระวังอะไร | ตอนเขียนทับ block เดิม ให้คง \`h=320\` ไว้ ไม่งั้นขนาดที่ผู้ใช้ตั้งจะหายไป |

> 💡 คลิกที่ตัว diagram (ไม่ใช่ขอบ) ยังเปิดหน้าต่างขยายเต็มจอได้เหมือนเดิม — ขอบล่างเป็นพื้นที่ลากอย่างเดียว`;

const page = pages.get(22);
if (!page) {
  console.log("#22: missing — skipped");
} else if (page.content.includes("ลากขอบล่าง")) {
  console.log("#22: already describes the height drag");
} else if (!page.content.includes(MARKER)) {
  console.log("#22: resize section not found — skipped");
} else {
  const start = page.content.indexOf(MARKER);
  const next = `${page.content.slice(0, start)}${SECTION}\n`;
  pages.update(22, { content: next });
  console.log("#22: resize section rewritten for the height drag");
}

db.close();
