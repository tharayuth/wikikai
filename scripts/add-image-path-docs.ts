/**
 * Document the new `add_image({ path })` local-path import (token-saver for
 * same-machine images) in the bundled knowledge:
 *   • &4 #45 (Images tutorial) — MCP tools table gains the path option.
 *   • &3 #44 (Thailand showcase, Custom HTML tab) — note on the image
 *     showcase explaining the two ingest paths.
 * Idempotent: re-running is a no-op once the markers are present.
 * Edits go through PageStore so version bump + revision snapshot + FTS
 * reindex all run.
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
  /* ok — env optional */
}
const config = loadConfig();
const db = openDb(config.dbPath);
const pages = new PageStore(db, config.itemsDir);

// ─── &4 #45 — Images tutorial: MCP tools table ───
{
  const cur = pages.get(45);
  if (!cur) {
    console.error("page #45 not found");
  } else if (cur.content.includes("WIKIKAI_IMAGE_IMPORT_ROOTS")) {
    console.log("&4 #45 already documents path import — skipping");
  } else {
    const oldRow =
      "| `add_image` | upload bytes (base64) → คืน `src` ใช้วางใน fence ได้ทันที |";
    const newRow =
      "| `add_image` | นำภาพเข้า → คืน `src` วางใน fence ได้ทันที. **`{ path }`** = import ไฟล์ที่อยู่บนเครื่อง server (server อ่านจาก disk เอง ไม่ส่ง base64 → ประหยัด token มากเมื่อไฟล์อยู่เครื่องเดียวกัน; เปิดด้วย `WIKIKAI_IMAGE_IMPORT_ROOTS`). **`{ data_base64, mime_type }`** = ส่ง bytes สำหรับไฟล์ที่อยู่ที่อื่น |";
    if (!cur.content.includes(oldRow)) {
      console.error("&4 #45: add_image row not found verbatim — aborting #45");
    } else {
      pages.update(45, { content: cur.content.replace(oldRow, newRow) });
      console.log("updated &4 #45 (add_image path option)");
    }
  }
}

// ─── &3 #44 — Thailand showcase: image ingest note ───
{
  const cur = pages.get(44);
  if (!cur) {
    console.error("page #44 not found");
  } else if (cur.content.includes("นำภาพเข้าได้ 2 ทาง")) {
    console.log("&3 #44 already documents path import — skipping");
  } else {
    const anchor =
      "URL ภายนอก (วัดพระแก้ว) แสดงในเว็บได้ปกติ แต่ `get_image` fetch ไม่ได้ + ไม่อยู่ใน `images_referenced`";
    const note =
      "\n\n> **นำภาพเข้าได้ 2 ทาง:** ปกติ AI ส่ง bytes แบบ base64 ผ่าน `add_image`. " +
      "แต่ถ้าภาพ (เช่น 3 SVG ด้านบน) อยู่บนเครื่องเดียวกับ server อยู่แล้ว ใช้ `add_image({ path })` " +
      "ให้ server อ่านไฟล์จาก disk เอง — ไม่มี base64 วิ่งผ่าน context จึงประหยัด token มาก " +
      "(เปิดด้วย `WIKIKAI_IMAGE_IMPORT_ROOTS` บน self-host)";
    if (!cur.content.includes(anchor)) {
      console.error("&3 #44: showcase note anchor not found — aborting #44");
    } else {
      pages.update(44, { content: cur.content.replace(anchor, anchor + note) });
      console.log("updated &3 #44 (image ingest note)");
    }
  }
}

db.close();
