/** One-shot: describe the in-app viewer dialog on the tutorial's attachment tab (#1015). */
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
if (page.content.includes("dialog ใหญ่ในแอป")) { console.log("#1015 already describes the dialog"); process.exit(0); }
const next = page.content
  .replace('  { "title": "ผู้อ่านกด View หรือ Download", "body": "**View** เปิดไฟล์ใน tab ใหม่ (PDF, รูป, text/CSV/JSON, เสียง, วิดีโอ — ชนิดอื่นไม่มีปุ่มนี้). **Download** ได้ไฟล์ชื่อ **เดิม** ตามที่อัปโหลด แม้ URL จะเป็น `/file/<hash>.<ext>` — ลิงก์แชร์ public ก็ใช้ได้ทั้งคู่" },',
           '  { "title": "ผู้อ่านกด View หรือ Download", "body": "**View** เปิด dialog ใหญ่ในแอป: รูป / PDF / เสียง / วิดีโอ แสดงตรง ๆ, ไฟล์ text ทุกชนิด (CSV, JSON, .http, .sql, ไม่มีนามสกุลก็ได้ — server ตรวจจาก bytes) แสดงเป็นข้อความทันที; ใน dialog มีปุ่มเปิดใน tab ใหม่และ Download. **Download** ได้ไฟล์ชื่อ **เดิม** ตามที่อัปโหลด แม้ URL จะเป็น `/file/<hash>.<ext>` — ลิงก์แชร์ public ก็ใช้ได้ทั้งคู่" },')
  .replace("| ชนิดไฟล์ | รับทุกชนิด — View เปิดใน tab ใหม่ได้เฉพาะชนิดที่ปลอดภัย (PDF/รูป/text/เสียง/วิดีโอ); HTML, SVG, office, zip มีแค่ Download จึงไม่มีทางรันเป็นหน้าเว็บในระบบ |",
           "| ชนิดไฟล์ | รับทุกชนิด — View แสดง รูป/PDF/เสียง/วิดีโอ และไฟล์ text ทุกชนิดในตัว; binary อื่น (office, zip) บอกให้ Download แทน. HTML/SVG แสดงได้แค่เป็นข้อความ ไม่ render เป็นหน้าเว็บ จึงไม่มีทางรันในระบบ |");
if (next === page.content) throw new Error("#1015: no anchors matched");
pages.update(1015, { content: next });
console.log("#1015 updated");
