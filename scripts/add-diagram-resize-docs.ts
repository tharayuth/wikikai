/**
 * One-shot: document drag-to-resize for diagram blocks in the bundled
 * tutorial (&4 #22 — the Mermaid tab).
 *
 *   node --import tsx scripts/add-diagram-resize-docs.ts
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
const SECTION = `
${MARKER}
## ย่อ/ขยาย diagram

เอาเมาส์ชี้ที่ diagram แล้ว **ลากขอบขวา** เพื่อปรับความกว้าง — ตัว diagram จะสเกลตาม ส่วนความสูงไปตามสัดส่วนเดิม (SVG มีอัตราส่วนคงที่ จึงมีแกนเดียวให้ลาก). ดับเบิลคลิกที่ขอบเพื่อคืนขนาดปกติ

| ประเด็น | รายละเอียด |
|---|---|
| เก็บไว้ที่ไหน | ต่อท้าย annotation ของ block เอง — \`\`\`mermaid {@123 640px} หรือ {@123 "caption" 640px} |
| ใครเห็นบ้าง | ทุกคนที่เปิดเอกสาร รวมถึงคนที่เปิดผ่านลิงก์แชร์ — ต่างจากความกว้างคอลัมน์อ่านที่จำไว้เฉพาะ browser ของแต่ละคน |
| กระทบเนื้อหาไหม | ไม่ — เป็นค่าการแสดงผลล้วน ๆ แต่นับเป็นการแก้ไขหน้า จึงมี revision ใหม่ทุกครั้งที่ลาก |
| AI ต้องระวังอะไร | ตอนเขียนทับ block เดิม ให้คง \`640px\` ไว้ ไม่งั้นขนาดที่ผู้ใช้ตั้งจะหายไป |

> 💡 คลิกที่ตัว diagram (ไม่ใช่ขอบ) ยังเปิดหน้าต่างขยายเต็มจอได้เหมือนเดิม — ขอบขวาเป็นพื้นที่ลากอย่างเดียว
`;

const page = pages.get(22);
if (!page) {
  console.log("#22: missing — skipped");
} else if (page.content.includes(MARKER)) {
  console.log("#22: already has diagram-resize docs");
} else {
  const next = `${page.content.replace(/\s+$/u, "")}\n\n${SECTION.trim()}\n`;
  pages.update(22, { content: next });
  console.log("#22: appended diagram-resize docs");
}

db.close();
