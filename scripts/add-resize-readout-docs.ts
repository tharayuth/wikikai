/**
 * One-shot: note the live px readout shown while dragging, in the
 * tutorial's Mermaid tab (&4 #22) and Images tab (&4 #45).
 *
 *   node --import tsx scripts/add-resize-readout-docs.ts
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
    console.log(`#${pageId}: already documented`);
    return;
  }
  pages.update(pageId, {
    content: `${page.content.replace(/\s+$/u, "")}\n\n${section.trim()}\n`,
  });
  console.log(`#${pageId}: appended resize-readout note`);
}

const MARKER = "<!-- resize-readout-docs -->";

appendOnce(
  22,
  MARKER,
  `
${MARKER}
### ป้ายบอกขนาดระหว่างลาก

ระหว่างลากขอบล่างจะมีป้ายเล็ก ๆ ขึ้นข้างจุดที่ลาก บอกความสูงปัจจุบันเป็น px — ไม่ต้องเดาว่าตอนนี้ใหญ่แค่ไหน แล้วหายไปเองเมื่อปล่อยเมาส์

ตัวเลขที่เห็นคือ **ขนาดที่เรนเดอร์จริง** ไม่ใช่ค่าที่กำลังจะบันทึก จึงตรงกับสิ่งที่ตาเห็นเสมอ
`,
);

appendOnce(
  45,
  MARKER,
  `
${MARKER}
## ป้ายบอกขนาดระหว่างลาก

ลากปรับขนาดภาพเมื่อไหร่ จะมีป้ายบอกขนาดเป็น px ขึ้นมาที่มุมขวาล่างของภาพ และหายไปเมื่อปล่อย

| ลากตรงไหน | ป้ายบอกอะไร |
|---|---|
| ขอบขวา | ความกว้าง เช่น \`320px\` |
| ขอบล่าง | ความสูง เช่น \`145px\` |
| มุมขวาล่าง | ทั้งคู่ เช่น \`272 × 170\` |

ตัวเลขคือ **ขนาดที่เรนเดอร์จริง** — ถ้าลากเลยความกว้างธรรมชาติของไฟล์ภาพ ตัวเลขจะหยุดนิ่ง ซึ่งเป็นสัญญาณว่าใหญ่กว่านี้ไม่ได้แล้ว
`,
);

db.close();
