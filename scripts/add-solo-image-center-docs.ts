/**
 * One-shot: note that an image alone in its own paragraph now renders
 * centred, in the bundled tutorial's Images tab (&4 #45).
 *
 *   node --import tsx scripts/add-solo-image-center-docs.ts
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

const MARKER = "<!-- solo-image-center-docs -->";
const SECTION = `
${MARKER}
## ภาพเดี่ยวจัดกึ่งกลางให้เอง

ถ้า \`![alt](src)\` อยู่ **ลำพังในย่อหน้าของตัวเอง** (ไม่มีข้อความอื่นในย่อหน้านั้น) จะถูกจัดกึ่งกลางอัตโนมัติ — เหมือน block อื่น ๆ อย่าง mermaid / chart / gallery ที่มีภาพเดียว ไม่ต้องใส่ HTML ครอบเอง

| เขียนแบบนี้ | ผลลัพธ์ |
|---|---|
| \`![alt](src)\` อยู่บรรทัดเดียวโดด ๆ | จัดกึ่งกลาง |
| \`[![alt](src)](url)\` โดด ๆ | จัดกึ่งกลาง (ภาพที่เป็นลิงก์ก็นับ) |
| \`ข้อความ ![alt](src) ข้อความ\` | ไหลไปกับตัวอักษรตามปกติ ไม่จัดกึ่งกลาง |
| ภาพสองรูปในย่อหน้าเดียว | ไหลตามปกติ — ไม่ใช่กรณี "ภาพเดี่ยว" |

การลากปรับขนาดและคลิกเปิดเต็มจอยังทำงานเหมือนเดิม ภาพจะอยู่กึ่งกลางตลอดขณะปรับขนาด
`;

const page = pages.get(45);
if (!page) {
  console.log("#45: missing — skipped");
} else if (page.content.includes(MARKER)) {
  console.log("#45: already documented");
} else {
  const next = `${page.content.replace(/\s+$/u, "")}\n\n${SECTION.trim()}\n`;
  pages.update(45, { content: next });
  console.log("#45: appended solo-image centring docs");
}

db.close();
