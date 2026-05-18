/**
 * One-shot: pull the checklist demo out of &4 #19 (the tutorial overview),
 * bump the stats card / steps list to reflect 11 tabs + 9 fence types,
 * and create a dedicated tab "11. Checklist" with plain + image-bearing
 * examples.
 *
 *   PATH=$HOME/.nvm/versions/node/v25.6.1/bin:$PATH \
 *     node --import tsx scripts/add-checklist-tutorial.ts
 *
 * Idempotent: bails out cleanly if the checklist tab already exists.
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

const KID = 4;
const OVERVIEW_PID = 19;
const CHECKLIST_TAB_TITLE = "11. Checklist";

// ─── 1. Trim #19 ──────────────────────────────────────────────────
const ov = pages.get(OVERVIEW_PID);
if (!ov) {
  console.error(`page #${OVERVIEW_PID} not found`);
  process.exit(1);
}

let next = ov.content;

// Remove the "## Checklist แบบ interactive" section to the end of file.
next = next.replace(/\n+## Checklist แบบ interactive[\s\S]*$/m, "\n");

// Bump stats counts: 10 tabs → 11, 8 fences → 9.
next = next.replace(
  /\{ "num": "10", "label": "tabs สอน", "color": "purple" \}/,
  `{ "num": "11", "label": "tabs สอน", "color": "purple" }`,
);
next = next.replace(
  /\{ "num": "8", "label": "fence types", "color": "blue" \}/,
  `{ "num": "9", "label": "fence types", "color": "blue" }`,
);

// Append the checklist tab to the steps array (right before the closing ]).
const stepEntry = `,\n  { "title": "11. Checklist", "body": "todo / progress card ที่ติ๊กแล้วบันทึกลง DB ทันที (รองรับภาพในแต่ละ item)" }`;
next = next.replace(
  /(\{ "title": "10\. สำหรับ AI \/ MCP"[^}]*\})\n\]/,
  `$1${stepEntry}\n]`,
);

if (next !== ov.content) {
  pages.update(OVERVIEW_PID, { content: next });
  console.log(`updated &${KID} #${OVERVIEW_PID} (trimmed + bumped counts)`);
} else {
  console.log(`&${KID} #${OVERVIEW_PID} already up to date`);
}

// ─── 2. Add new "11. Checklist" page ─────────────────────────────
const existing = pages.list(KID).find((p) => p.title === CHECKLIST_TAB_TITLE);
if (existing) {
  console.log(`#${existing.id} already exists at position ${existing.position}; nothing to insert`);
  db.close();
  process.exit(0);
}

// Use two existing internal images from the &3 showcase (flag + seal).
const FLAG_SRC = "/img/18a2e683798840015634f8547db85a077bbb5e5006c119a64bb20b684dafb16d.svg";
const SEAL_SRC = "/img/b9b050e806a7e38172059601c41b4a57cbfbaf87c47ee3fba53e7ebd7ed735a1.svg";

const checklistTabBody = `# ✅ Interactive Checklist

แสดง **todo / progress card** ที่คลิกแล้ว save ลง DB ทันที — มี progress bar คำนวณจากจำนวน \`done:true / total\` อัตโนมัติ

## JSON shape

\`\`\`json
{
  "title":       "หัวข้อ (optional)",
  "description": "อธิบาย — รองรับ inline markdown (optional)",
  "items": [
    { "text": "ทำ X", "done": false },
    { "text": "ทำ Y", "done": true }
  ]
}
\`\`\`

## ตัวอย่าง 1 — Todo ธรรมดา

\`\`\`checklist
{
  "title": "Pre-deploy checklist",
  "description": "ก่อนกด deploy ต้องเช็คทั้งหมดให้ครบ",
  "items": [
    { "text": "tests ผ่านบน main", "done": true },
    { "text": "docs อัปเดตแล้ว", "done": false },
    { "text": "PM อนุมัติ", "done": false },
    { "text": "deploy", "done": false }
  ]
}
\`\`\`

## ตัวอย่าง 2 — Inline markdown ใน item

\`text\` รับ markdown inline ปกติ — **bold**, *italic*, \`code\`, [link](#)

\`\`\`checklist
{
  "title": "Setup ครั้งแรก",
  "description": "หลังจาก \`git clone\` แล้ว",
  "items": [
    { "text": "ติดตั้งด้วย \`npm install\`", "done": true },
    { "text": "รัน \`npm run dev\`", "done": true },
    { "text": "เปิด [http://localhost:5173](http://localhost:5173)", "done": false },
    { "text": "อ่าน **คู่มือ** (\`&4\`) ให้ครบทุก tab", "done": false }
  ]
}
\`\`\`

## ตัวอย่าง 3 — มีภาพประกอบใน item

ใช้ markdown image \`![alt](/img/...)\` ใน \`text\` ได้เลย — sizing ผ่าน title slot (\`"x32"\` = สูง 32px เก็บ aspect ratio):

\`\`\`checklist
{
  "title": "เตรียมงานวันชาติ",
  "description": "ของที่ต้องเตรียมก่อนงานเริ่ม",
  "items": [
    { "text": "ติด ![ธงชาติ](${FLAG_SRC} \\"x28\\") **ธงไตรรงค์** บนเสา", "done": true },
    { "text": "ติดตรา ![ครุฑ](${SEAL_SRC} \\"x32\\") **ตราครุฑ** กลางเวที", "done": true },
    { "text": "ซ้อมเพลงชาติ", "done": false },
    { "text": "ตรวจเครื่องเสียง", "done": false }
  ]
}
\`\`\`

## กลไกการ toggle

\`\`\`steps
[
  { "title": "User คลิก checkbox", "body": "browser flip \`checked\` + fire native \`change\` event" },
  { "title": "Frontend จับ event", "body": "delegation บน \`document\` (รอดจาก React remount) อ่าน \`data-block-id\` + \`data-item-idx\` จาก input" },
  { "title": "PATCH /api/blocks/:bid/checklist/:idx", "body": "body = \`{ done }\`; ใช้ RTK Query mutation ที่ตั้ง \`invalidatesTags: []\` เพื่อกัน scroll-to-top" },
  { "title": "Server toggle + persist", "body": "\`PageStore.toggleChecklistItem()\` หา block ตาม \`@N\` → mutate JSON → \`editLines()\` → bump page version + revision snapshot + FTS reindex" },
  { "title": "Optimistic UI", "body": "\`.checklist-item\` ได้ class \`done\` ทันทีเมื่อคลิก (strikethrough); revert + toast เมื่อ PATCH ล้มเหลว" }
]
\`\`\`

> 💡 **AI ก็ toggle ได้** — เรียก MCP tool \`toggle_checklist_item({ block_id, index, done })\` ลงไปยัง code path เดียวกัน. ใช้ตอน user บอก "tick @47 item 1" / "uncheck @123 item 0"

## เคล็ดลับ

- \`description\` รับ inline markdown
- \`text\` รับ inline markdown รวมถึง \`![image](/img/...)\` — ใช้ title \`"WxH"\` / \`"Wx"\` / \`"xH"\` คุม size
- progress bar คำนวณจาก ratio \`done:true\` / total อัตโนมัติ
- block id \`@N\` บนมุมขวาบนของการ์ด — คลิก copy ได้ AI จะ refer ถึงด้วย "tick @N item K"
- ทุกการ toggle เก็บเป็น **revision** — ดู history ได้ผ่านปุ่มเลข version ที่ header
`;

const inserted = pages.add({
  knowledge_id: KID,
  title: CHECKLIST_TAB_TITLE,
  content: checklistTabBody,
  position: 11,
  summary: "Interactive checklist — todo + progress card with toggle persistence",
  keywords: ["checklist", "todo", "interactive", "checkbox", "progress"],
});

console.log(
  `inserted #${inserted.id} "${CHECKLIST_TAB_TITLE}" at position ${inserted.position}`,
);

db.close();
