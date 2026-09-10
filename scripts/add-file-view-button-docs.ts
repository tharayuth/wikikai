/** One-shot: mention the View button on the tutorial's attachment tab (#1015). */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/lib/config.js";
import { openDb } from "../src/store/db.js";
import { PageStore } from "../src/store/pages.js";
const here = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.resolve(here, "..", ".env")); } catch { /* ok */ }
const config = loadConfig();
const pages = new PageStore(openDb(config.dbPath), config.itemsDir);
const page = pages.get(1015);
if (!page) { console.log("#1015 missing"); process.exit(0); }
if (page.content.includes("ปุ่ม **View**")) { console.log("#1015 already mentions View"); process.exit(0); }
let next = page.content
  .replace("แต่ละไฟล์แสดงเป็นการ์ด: ชื่อไฟล์ · ขนาด · ชนิด · คำอธิบาย · ปุ่ม **Download**",
           "แต่ละไฟล์แสดงเป็นการ์ด: ชื่อไฟล์ · ขนาด · ชนิด · คำอธิบาย · ปุ่ม **View** · ปุ่ม **Download**")
  .replace('  { "title": "ผู้อ่านกด Download", "body": "ได้ไฟล์ชื่อ **เดิม** ตามที่อัปโหลด แม้ URL จะเป็น `/file/<hash>.<ext>` — ลิงก์แชร์ public ก็ดาวน์โหลดได้" },',
           '  { "title": "ผู้อ่านกด View หรือ Download", "body": "**View** เปิดไฟล์ใน tab ใหม่ (PDF, รูป, text/CSV/JSON, เสียง, วิดีโอ — ชนิดอื่นไม่มีปุ่มนี้). **Download** ได้ไฟล์ชื่อ **เดิม** ตามที่อัปโหลด แม้ URL จะเป็น `/file/<hash>.<ext>` — ลิงก์แชร์ public ก็ใช้ได้ทั้งคู่" },')
  .replace("| ชนิดไฟล์ | รับทุกชนิด — เสิร์ฟเป็น attachment เสมอ (ไม่เปิดเป็นหน้าเว็บ) จึงปลอดภัยแม้เป็น HTML/SVG |",
           "| ชนิดไฟล์ | รับทุกชนิด — View เปิดใน tab ใหม่ได้เฉพาะชนิดที่ปลอดภัย (PDF/รูป/text/เสียง/วิดีโอ); HTML, SVG, office, zip มีแค่ Download จึงไม่มีทางรันเป็นหน้าเว็บในระบบ |");
if (next === page.content) throw new Error("#1015: no anchors matched");
pages.update(1015, { content: next });
console.log("#1015 updated");
