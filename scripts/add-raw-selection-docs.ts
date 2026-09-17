/**
 * One-shot: document selection-aware raw editing in the bundled
 * tutorial (&4) and the Thailand showcase (&3).
 *
 *   node --import tsx scripts/add-raw-selection-docs.ts
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

const marker = "<!-- raw-selection-docs -->";
for (const [pageId, section] of [
  [19, `## เลือกข้อความก่อน Edit raw

เลือกข้อความบนหน้าอ่าน แล้วกด **Edit raw**: ตัวแก้ไขจะเลื่อนไป โฟกัส และเลือกข้อความต้นฉบับให้ทันที รองรับการเลือกคร่อมตัวหนา ลิงก์ และหลายย่อหน้า โดยช่วงที่เลือกใน raw อาจมีเครื่องหมาย Markdown รวมอยู่ด้วย

ถ้าข้อความถูกแก้ไปแล้วหรือหาตำแหน่งที่แน่นอนไม่ได้ ตัวแก้ไขจะเปิดตามปกติโดยไม่เดาตำแหน่ง`],
  [18, `## ทดลองเลือกข้อความเพื่อแก้ต้นฉบับ

ประชากรไทย — **ข้อมูลตัวอย่างสำหรับทดลองเลือกข้อความ** — อ่านแล้วแก้ต่อได้ทันที

ลากเลือกคำในประโยคด้านบน แล้วกด **Edit raw** เพื่อเลื่อน โฟกัส และเลือกช่วงเดียวกันในต้นฉบับ กด Cancel เพื่อกลับมาอ่านโดยไม่เปลี่ยนข้อมูล`],
] as const) {
  const page = pages.get(pageId);
  if (!page || page.content.includes(marker)) continue;
  pages.update(pageId, { content: `${page.content.trimEnd()}\n\n${marker}\n${section}\n` });
  console.log(`Updated tutorial page #${pageId}`);
}
db.close();
