/**
 * One-shot: note that a solo image's title slot now renders as a visible
 * caption, in the bundled tutorial's Images tab (&4 #45). Extends the
 * centring section added alongside it.
 *
 *   node --import tsx scripts/add-solo-image-caption-docs.ts
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

const MARKER = "<!-- solo-image-caption-docs -->";
const SECTION = `
${MARKER}
## caption ใต้ภาพเดี่ยว

ข้อความใน **title slot** ของภาพเดี่ยว (ส่วนที่ไม่ใช่ตัวเลขขนาด) จะแสดงเป็น caption ใต้ภาพ — ตัวเอียงเล็ก จัดกึ่งกลาง ใช้สไตล์เดียวกับ caption ของ mermaid / chart ทุกประการ

\`\`\`markdown
![alt](/img/xxx.png "แผนผังระบบโดยรวม w=520")
\`\`\`

| เขียนแบบนี้ | ผลลัพธ์ |
|---|---|
| \`"แผนผังระบบ"\` | แสดง caption "แผนผังระบบ" ใต้ภาพ |
| \`"แผนผังระบบ w=520"\` | ตัดขนาดออก เหลือ caption "แผนผังระบบ" |
| \`"520x"\` หรือ \`"520x300"\` | เป็นขนาดล้วน ๆ ไม่ใช่ caption จึงไม่แสดงอะไร |
| ไม่ใส่ title | ไม่มี caption |
| ภาพที่แทรกกลางประโยค | title ยังเป็น tooltip เหมือนเดิม ไม่ขึ้นเป็น caption เพราะจะตัดข้อความขาดกลางย่อหน้า |

ค่า title ยังคงติดอยู่กับ \`<img>\` ด้วย — lightbox และ screen reader อ่านจากตรงนั้น. ลากปรับขนาดภาพแล้ว caption ก็ยังอยู่ (ระบบเขียนกลับเป็น \`"แผนผังระบบ w=240"\` ให้เอง)

> 💡 ใส่ caption ให้ภาพที่ยืนเดี่ยวเสมอ เหมือนที่ควรใส่ให้ทุก rich block — ช่วยทั้งคนอ่านและ AI ที่เรียก \`read_page({ mode: "summary" })\`
`;

const page = pages.get(45);
if (!page) {
  console.log("#45: missing — skipped");
} else if (page.content.includes(MARKER)) {
  console.log("#45: already documented");
} else {
  const next = `${page.content.replace(/\s+$/u, "")}\n\n${SECTION.trim()}\n`;
  pages.update(45, { content: next });
  console.log("#45: appended solo-image caption docs");
}

db.close();
