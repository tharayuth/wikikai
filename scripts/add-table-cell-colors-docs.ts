/**
 * One-shot: document table cell colours (`{bg=green fg=red}` at the start of
 * a cell) in the tutorial (&4 #20 Markdown basics) and use them in the
 * Thailand showcase (&3 #15 economy). Idempotent — each edit checks for its
 * new text first and skips a page whose old text is not found.
 *
 *   node --import tsx scripts/add-table-cell-colors-docs.ts
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

function replaceOnce(pageId: number, label: string, oldText: string, newText: string, doneMarker: string): void {
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

// &4 #20 — new section right after the table alignment note.
const ALIGN_NOTE = "> Header alignment: `:---` ซ้าย · `:---:` กลาง · `---:` ขวา";
replaceOnce(
  20,
  "cell colours",
  ALIGN_NOTE,
  [
    ALIGN_NOTE,
    "",
    "### สีใน cell",
    "",
    "ใส่ `{bg=สี}` (พื้นหลัง) และ/หรือ `{fg=สี}` (ตัวอักษร) ไว้**ต้น cell** — ระบบตัด marker ออกแล้วระบายสีให้ ใช้กับ header ได้ด้วย",
    "",
    "```markdown",
    "| ตัวชี้วัด | Q3 | สถานะ |",
    "|---|--:|:-:|",
    "| รายได้ | {fg=green} **13.1** | {bg=green fg=green} ผ่าน |",
    "| ต้นทุน | {fg=red} 9.0 | {bg=red fg=red} เกินงบ |",
    "| ลูกค้าใหม่ | {fg=amber} 298 | {bg=amber fg=amber} เฝ้าระวัง |",
    "| NPS | 44 | {bg=blue} [x] ตรวจแล้ว |",
    "```",
    "",
    "| ตัวชี้วัด | Q3 | สถานะ |",
    "|---|--:|:-:|",
    "| รายได้ | {fg=green} **13.1** | {bg=green fg=green} ผ่าน |",
    "| ต้นทุน | {fg=red} 9.0 | {bg=red fg=red} เกินงบ |",
    "| ลูกค้าใหม่ | {fg=amber} 298 | {bg=amber fg=amber} เฝ้าระวัง |",
    "| NPS | 44 | {bg=blue} [x] ตรวจแล้ว |",
    "",
    "- สีที่ใช้ได้: `red` `green` `amber` `blue` `cyan` `purple` `gray` — มาจาก theme จึงอ่านออกทั้งโหมดสว่างและโหมดมืด",
    "- `color=` ใช้แทน `fg=` ได้; ใส่หลายค่าในวงเล็บเดียวคั่นด้วยช่องว่าง เช่น `{bg=amber fg=red}`",
    "- ต้องอยู่ต้น cell เท่านั้น และต้องเป็น key กับชื่อสีที่รู้จัก — ข้อความอื่นในวงเล็บปีกกา เช่น `{id}` หรือ `{bg=pink}` จะแสดงตามเดิม",
    "- ใช้ร่วมกับ checkbox `[ ]` / `[x]` ตัวหนา และลิงก์ใน cell ได้",
  ].join("\n"),
  "### สีใน cell",
);

// &3 #15 — colour the top three exports and the total row.
const ROWS_OLD = [
  "| 1 | รถยนต์ ชิ้นส่วนยานยนต์ | 41.2 | 14.4% |",
  "| 2 | คอมพิวเตอร์ + ฮาร์ดดิสก์ | 27.8 | 9.7% |",
  "| 3 | ผลิตภัณฑ์ยาง | 19.5 | 6.8% |",
].join("\n");
const ROWS_NEW = [
  "| {bg=amber} 1 | รถยนต์ ชิ้นส่วนยานยนต์ | 41.2 | {fg=green} **14.4%** |",
  "| {bg=gray} 2 | คอมพิวเตอร์ + ฮาร์ดดิสก์ | 27.8 | {fg=green} **9.7%** |",
  "| {bg=gray} 3 | ผลิตภัณฑ์ยาง | 19.5 | {fg=green} **6.8%** |",
].join("\n");
replaceOnce(15, "top-3 colours", ROWS_OLD, ROWS_NEW, "{bg=amber} 1 |");
replaceOnce(
  15,
  "total row colour",
  "| | **10 อันดับแรกรวม** | **170.3** | **59.6%** |",
  "| {bg=blue} | {bg=blue} **10 อันดับแรกรวม** | {bg=blue} **170.3** | {bg=blue} **59.6%** |",
  "{bg=blue} **10 อันดับแรกรวม**",
);

db.close();
