/**
 * One-shot: bring the tutorial (&4) in line with curl uploads
 * (get_upload_url), the removal of base64 uploads over MCP, and the
 * scaled copies get_image now returns. Idempotent — every edit checks for
 * its new text first and skips a page whose old text is not found.
 *
 *   node --import tsx scripts/update-upload-docs.ts
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

/** Replace `oldText` with `newText` once. `doneMarker` (default: newText)
 *  is how a re-run recognises the edit was already made. */
function replaceOnce(
  pageId: number,
  label: string,
  oldText: string,
  newText: string,
  doneMarker: string = newText,
): void {
  const page = pages.get(pageId);
  if (!page) {
    console.log(`#${pageId} ${label}: page missing — skipped`);
    return;
  }
  if (page.content.includes(doneMarker)) {
    console.log(`#${pageId} ${label}: already done`);
    return;
  }
  if (!page.content.includes(oldText)) {
    console.log(`#${pageId} ${label}: old text not found — skipped`);
    return;
  }
  pages.update(pageId, { content: page.content.replace(oldText, newText) });
  console.log(`#${pageId} ${label}: updated`);
}

// #19 overview — tool count
replaceOnce(
  19,
  "tool count",
  `{ "num": "41", "label": "MCP tools", "color": "green" }`,
  `{ "num": "42", "label": "MCP tools", "color": "green" }`,
);

// #45 Images — MCP tools table. Only the rows change, so the table keeps its
// `{@407}` id; the guidance paragraphs go after that annotation, never
// between the table and it (that would give the table a new id).
replaceOnce(
  45,
  "image tools",
  "| `add_image` | นำภาพเข้า → คืน `src` วางใน fence ได้ทันที. **`{ path }`** = import ไฟล์ที่อยู่บนเครื่อง server (server อ่านจาก disk เอง ไม่ส่ง base64 → ประหยัด token มากเมื่อไฟล์อยู่เครื่องเดียวกัน; เปิดด้วย `WIKIKAI_IMAGE_IMPORT_ROOTS`). **`{ data_base64, mime_type }`** = ส่ง bytes สำหรับไฟล์ที่อยู่ที่อื่น |\n| `get_image` | view ภาพ inline ใน assistant (รองรับเฉพาะ internal `/img/` paths) |",
  [
    "| `get_upload_url` | **วิธีหลักในการอัปโหลดรูป** — ได้ลิงก์ชั่วคราว (15 นาที อัปโหลดได้หลายไฟล์) แล้วส่งไฟล์ด้วย `curl -sS --data-binary @shot.png '<image_url>?alt=...'` ไฟล์ไปจาก disk ถึง server โดยไม่ผ่านโมเดล ผลลัพธ์มี `src`, `markdown` พร้อมวาง, `width`, `height` และ `warnings` |",
    "| `add_image` | import รูปที่อยู่บนเครื่อง server อยู่แล้ว — **`{ path }`** (server อ่านจาก disk เอง; เปิดด้วย `WIKIKAI_IMAGE_IMPORT_ROOTS`) ผลลัพธ์เหมือน `get_upload_url`. **ไม่รับ base64 แล้ว** เพราะการพิมพ์รูปออกมาเป็นข้อความเปลือง token มาก |",
    "| `get_image` | ให้ AI ดูรูป — ได้รุ่นย่อด้านยาวไม่เกิน 1280px (WebP) เป็นค่าเริ่มต้น อ่านตัวหนังสือใน screenshot ได้แต่ใช้ token น้อยลง; `max_edge: N` เลือกขนาดเอง, `original: true` เอาต้นฉบับ (ต้นฉบับไม่ถูกแก้) |",
  ].join("\n"),
);
replaceOnce(
  45,
  "image guidance",
  "{@407}\n",
  [
    "{@407}",
    "",
    "**ใส่ `src` หรือ `markdown` ลงเอกสารเสมอ ห้ามใช้ `url`** — `url` มีโดเมนของ server ติดมา ถ้าย้ายโดเมนลิงก์จะเสีย (ลิงก์ `/img/` และ `/file/` ที่มีโดเมนของเราเองจะถูกแปลงเป็น path ให้ตอนบันทึกอยู่แล้ว)",
    "",
    "**รูปคมชัด:** ถ่าย screenshot เป็น **PNG ที่ความละเอียด 2x** — รูปกว้าง N px จะคมบนจอ Retina ได้ถึงประมาณ N/2 px บนหน้าจอ และ JPEG ทำให้ขอบตัวหนังสือแตก",
    "",
  ].join("\n"),
  "**รูปคมชัด:**",
);

// #1015 Attachments — step 1
replaceOnce(
  1015,
  "attach step",
  '{ "title": "อัปโหลดด้วย add_file", "body": "ถ้าไฟล์อยู่บนเครื่อง server ใช้ `add_file({ path })` (ไม่ต้องส่ง base64 — root เดียวกับ add_image). ถ้าไม่ ใช้ `add_file({ data_base64, name })`. ใส่ `description` ได้" }',
  '{ "title": "อัปโหลดด้วย curl", "body": "เรียก `get_upload_url` แล้วส่งไฟล์ `curl -sS --data-binary @report.pdf \'<file_url>?name=report.pdf&description=...\'` — ไฟล์ไม่ผ่านโมเดล ไม่รับ base64. ถ้าไฟล์อยู่บนเครื่อง server อยู่แล้วใช้ `add_file({ path })` ได้ (root เดียวกับ add_image)" }',
);

// #26 MCP workflow — tools reference
replaceOnce(
  26,
  "tools reference",
  "| `get_example` | template สำหรับ markdown — kind = full / minimal / mermaid / chart / stats / steps / er |",
  [
    "| `get_example` | template สำหรับ markdown — kind = full / minimal / mermaid / chart / stats / steps / er |",
    "| `get_upload_url` | ลิงก์อัปโหลดชั่วคราว (15 นาที) — ส่งรูปหรือไฟล์ด้วย `curl --data-binary @file` ไม่ผ่านโมเดล. MCP ไม่รับ base64 แล้ว |",
    "| `get_image` | ดูรูป — ได้รุ่นย่อด้านยาว ≤ 1280px เป็นค่าเริ่มต้น; `original: true` เอาต้นฉบับ |",
  ].join("\n"),
);

db.close();
