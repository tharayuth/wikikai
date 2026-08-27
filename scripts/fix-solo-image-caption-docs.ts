/**
 * One-shot: the solo-image caption comes from the **alt** text, not the
 * title slot. Rewrite the section in the tutorial's Images tab (&4 #45)
 * that first documented it the other way round.
 *
 *   node --import tsx scripts/fix-solo-image-caption-docs.ts
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
const SECTION = `${MARKER}
## caption ใต้ภาพเดี่ยว

ภาพที่ยืนเดี่ยวจะเอา **ข้อความ alt** (ส่วน \`![…]\`) มาแสดงเป็น caption ใต้ภาพ — ตัวเอียงเล็ก จัดกึ่งกลาง สไตล์เดียวกับ caption ของ mermaid / chart ทุกประการ ส่วน **title slot** ยังเป็น tooltip ตอนเอาเมาส์ชี้ ไว้ใส่คำอธิบายยาว ๆ

\`\`\`markdown
![หน้าดึงข้อมูล Raw API](/img/xxx.png "แท็บดึงข้อมูล — เลือก source / งวด แล้วกด Preview w=520")
\`\`\`

| ส่วน | ไปอยู่ไหน |
|---|---|
| \`หน้าดึงข้อมูล Raw API\` (alt) | caption ใต้ภาพ |
| \`แท็บดึงข้อมูล — เลือก source …\` (title) | tooltip ตอน hover |
| \`w=520\` | ความกว้าง ไม่แสดงเป็นข้อความ |

| กรณี | ผลลัพธ์ |
|---|---|
| มี alt | ขึ้น caption |
| ไม่มี alt (\`![](src)\`) | ไม่ขึ้น caption แม้จะมี title |
| ภาพที่แทรกกลางประโยค | ไม่ขึ้น caption เลย เพราะจะตัดข้อความขาดกลางย่อหน้า — title ยังเป็น tooltip ตามปกติ |

ลากปรับขนาดภาพแล้ว caption ไม่หาย เพราะ alt ไม่ได้ถูกแตะ (ระบบแก้เฉพาะ title slot เป็น \`"… w=240"\`)

> 💡 เขียน alt ให้เป็น **ชื่อสั้น ๆ ของภาพ** เสมอ ไม่ใช่ทิ้งว่างหรือใส่คำลอย ๆ — มันคือ caption ที่คนอ่านเห็น และยังเป็นสิ่งที่ screen reader อ่านด้วย`;

const page = pages.get(45);
if (!page) {
  console.log("#45: missing — skipped");
} else if (page.content.includes("ภาพที่ยืนเดี่ยวจะเอา **ข้อความ alt**")) {
  console.log("#45: already describes the alt-based caption");
} else if (!page.content.includes(MARKER)) {
  console.log("#45: caption section not found — skipped");
} else {
  const start = page.content.indexOf(MARKER);
  pages.update(45, { content: `${page.content.slice(0, start)}${SECTION}\n` });
  console.log("#45: caption section rewritten for alt");
}

db.close();
