/**
 * One-shot: document line breaks inside table cells (`<br>`, `<br/>`,
 * `</br>`, `&#10;`) in the tutorial (&4 #20 Markdown basics) and use one in
 * the Thailand showcase (&3 #16 tourism). Idempotent — each edit checks for
 * its new text first and skips a page whose old text is not found.
 *
 *   node --import tsx scripts/add-table-cell-breaks-docs.ts
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

// &4 #20 — new section right after the cell-colour notes.
const COLOR_LAST = "- ใช้ร่วมกับ checkbox `[ ]` / `[x]` ตัวหนา และลิงก์ใน cell ได้";
replaceOnce(
  20,
  "cell line breaks",
  COLOR_LAST,
  [
    COLOR_LAST,
    "",
    "### ขึ้นบรรทัดใหม่ใน cell",
    "",
    "cell ของตารางต้องอยู่บรรทัดเดียวใน source — ใส่ `<br>` ตรงที่ต้องการตัดบรรทัด",
    "",
    "```markdown",
    "| ภาค | จังหวัดเด่น |",
    "|---|---|",
    "| เหนือ | เชียงใหม่<br>เชียงราย<br>น่าน |",
    "| ใต้ | ภูเก็ต<br/>กระบี่ |",
    "```",
    "",
    "| ภาค | จังหวัดเด่น |",
    "|---|---|",
    "| เหนือ | เชียงใหม่<br>เชียงราย<br>น่าน |",
    "| ใต้ | ภูเก็ต<br/>กระบี่ |",
    "",
    "- เขียนแบบไหนก็ได้: `<br>` `<br/>` `<br />` `</br>` (ตัวพิมพ์ใหญ่ก็ได้) หรือ `&#10;`",
    "- มีผลเฉพาะใน cell ของตาราง — ใน `` `code` `` และข้อความนอกตาราง `<br>` แสดงตามที่พิมพ์",
    "- tag HTML อื่นในตารางยังแสดงเป็นข้อความเหมือนเดิม ถ้าต้องการ layout ซับซ้อนกว่านี้ใช้ `html-embed`",
  ].join("\n"),
  "### ขึ้นบรรทัดใหม่ใน cell",
);

// &3 #16 — Bangkok has two airports; stack them instead of a slash.
replaceOnce(
  16,
  "airport line break",
  "| สุวรรณภูมิ (BKK) / ดอนเมือง (DMK) |",
  "| สุวรรณภูมิ (BKK)<br>ดอนเมือง (DMK) |",
  "สุวรรณภูมิ (BKK)<br>ดอนเมือง (DMK)",
);

db.close();
