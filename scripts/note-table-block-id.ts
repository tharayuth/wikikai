/**
 * Append a note to the in-DB Raw HTML tutorial page about how markdown
 * tables do NOT receive an `@N` block id, and users should author
 * referenceable tables as `<table>` inside an `html-embed` instead.
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

const NOTE = `
## ตารางที่อยากอ้างด้วย \`@N\` → เขียนเป็น \`<table>\` ใน \`html-embed\`

ทุก rich block (mermaid / chart / chart-grid / stats / steps / **html-embed**) ได้ \`@N\` ระดับ global ติดมุม — user เรียก "อัพเดต @47" ได้

แต่ **ตาราง markdown ปกติ** (\`| col | col |\`) ไม่มี \`@N\` เพราะมันเป็น text ไม่ใช่ fence

ถ้าตารางใดอาจถูกอ้าง/แก้ทีหลัง → เขียนเป็น HTML \`<table>\` ภายใน \`html-embed\` — ได้ \`@N\` ฟรี + ตกแต่งได้ละเอียด (ดูตัวอย่างที่ 2 ด้านบน)
`;

for (const pid of [43, 44]) {
  const cur = pages.get(pid);
  if (!cur) continue;
  if (cur.content.includes("เขียนเป็น `<table>` ใน `html-embed`")) {
    console.log(`#${pid} already has the note`);
    continue;
  }
  pages.update(pid, { content: cur.content.trimEnd() + "\n" + NOTE });
  console.log(`appended note to #${pid}`);
}
db.close();
