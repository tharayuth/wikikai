/**
 * One-shot: document the ```file attachment block.
 *   - &4 tutorial: new tab "14. แนบไฟล์" + overview counts / steps on #19
 *   - &3 showcase: attach a CSV of the population table to "7. สรุป" (#18)
 *
 *   node --import tsx scripts/add-file-attachment-docs.ts
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/lib/config.js";
import { openDb } from "../src/store/db.js";
import { PageStore } from "../src/store/pages.js";
import { FileStore } from "../src/store/files.js";

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.resolve(here, "..", ".env"));
} catch {
  /* ok */
}

const config = loadConfig();
const db = openDb(config.dbPath);
const pages = new PageStore(db, config.itemsDir);
const files = new FileStore(db, config.filesDir);

// ── &3 showcase: a real attachment on the summary tab ──
const SHOWCASE_MARKER = "<!-- thailand-file-attachment -->";
const csv =
  "ปี,ประชากร (ล้านคน),GDP (ล้านล้านบาท),นักท่องเที่ยวต่างชาติ (ล้านคน)\n" +
  "2019,66.5,16.9,39.9\n2020,66.2,15.7,6.7\n2021,66.2,16.2,0.4\n2022,66.1,17.4,11.2\n2023,66.0,17.9,28.2\n2024,65.9,18.6,35.5\n";
const attached = files.add(
  Buffer.from(csv, "utf8"),
  "สถิติประเทศไทย-2019-2024.csv",
  "text/csv",
);
const showcasePage = pages.get(18);
if (!showcasePage) {
  console.log("#18: missing — skipped");
} else if (showcasePage.content.includes(SHOWCASE_MARKER)) {
  console.log("#18: already has the attachment showcase");
} else {
  const section = `
${SHOWCASE_MARKER}
## ดาวน์โหลดข้อมูลดิบ

ตัวเลขหลักในเอกสารนี้ (ประชากร · GDP · นักท่องเที่ยว) รวมเป็นไฟล์เดียวให้เอาไปใช้ต่อใน spreadsheet ได้ — แนบผ่าน \`add_file\` แล้ววาง fence ที่ได้กลับมา:

\`\`\`file
${JSON.stringify({ src: attached.src, name: attached.name, size_bytes: attached.size_bytes, mime: attached.mime, description: "ตารางสรุป 2019–2024 ในรูปแบบ CSV (UTF-8) — เปิดใน Excel / Google Sheets ได้ทันที" })}
\`\`\`

ไฟล์ถูกเก็บด้วยชื่อ hash ที่เดาไม่ได้ แต่ตอนกดดาวน์โหลดจะได้ชื่อไฟล์เดิม
`;
  pages.update(18, { content: `${showcasePage.content.replace(/\s+$/u, "")}\n${section}` });
  console.log(`#18: attached ${attached.name} (${attached.size_bytes} B)`);
}

// ── &4 tutorial: new tab ──
const TUTORIAL_KID = 4;
const MARKER = "<!-- file-attachment-docs -->";
const tabContent = `# 14. แนบไฟล์ (\`\`\`file)

${MARKER}

นอกจากภาพ ตอนนี้ AI แนบ **ไฟล์อะไรก็ได้** ให้ดาวน์โหลดจากในเอกสารได้ — PDF, CSV, XLSX, ZIP ฯลฯ
แต่ละไฟล์แสดงเป็นการ์ด: ชื่อไฟล์ · ขนาด · ชนิด · คำอธิบาย · ปุ่ม **Download**

\`\`\`stats
[
  { "num": "50", "label": "MB ต่อไฟล์ (สูงสุด)", "color": "purple" },
  { "num": "sha256", "label": "ชื่อไฟล์บน disk", "color": "blue" },
  { "num": "เดิม", "label": "ชื่อไฟล์ตอนดาวน์โหลด", "color": "green" },
  { "num": "auto", "label": "ลบไฟล์เมื่อไม่มีใครอ้างถึง", "color": "amber" }
]
\`\`\`

## ตัวอย่างจริง

\`\`\`file
${JSON.stringify({ src: attached.src, name: attached.name, size_bytes: attached.size_bytes, mime: attached.mime, description: "ไฟล์เดียวกับที่แนบไว้ในเอกสาร 🇹🇭 สถิติประเทศไทย (&3) — content-addressed จึงใช้ร่วมกันได้โดยไม่เก็บซ้ำ" })}
\`\`\`

## วิธีแนบ (สำหรับ AI / MCP)

\`\`\`steps
[
  { "title": "อัปโหลดด้วย add_file", "body": "ถ้าไฟล์อยู่บนเครื่อง server ใช้ \`add_file({ path })\` (ไม่ต้องส่ง base64 — root เดียวกับ add_image). ถ้าไม่ ใช้ \`add_file({ data_base64, name })\`. ใส่ \`description\` ได้" },
  { "title": "วาง fence ที่ได้กลับมา", "body": "ผลลัพธ์มี \`fence\` พร้อมวาง — เป็น block \`\`\`file ที่ JSON คือ \`{ src, name, size_bytes, mime, description? }\` (หลายไฟล์ = array)" },
  { "title": "ผู้อ่านกด Download", "body": "ได้ไฟล์ชื่อ **เดิม** ตามที่อัปโหลด แม้ URL จะเป็น \`/file/<hash>.<ext>\` — ลิงก์แชร์ public ก็ดาวน์โหลดได้" },
  { "title": "ลบเองอัตโนมัติ", "body": "เมื่อทุกหน้าที่อ้างถึงไฟล์ตัด block นี้ออก (AI แก้, ลบ page/knowledge, หรือคนกด **Edit raw → Save**) ตัวไฟล์จริงบน disk จะถูกลบทันที — ไม่ต้องไล่เก็บกวาดเอง" }
]
\`\`\`

## Source ของ block ด้านบน

\`\`\`md
\`\`\`file
{ "src": "/file/<sha256>.csv", "name": "สถิติประเทศไทย-2019-2024.csv", "size_bytes": 350, "mime": "text/csv", "description": "..." }
\`\`\`
\`\`\`

| เรื่อง | พฤติกรรม |
|---|---|
| ไฟล์ซ้ำ | เนื้อหาเหมือนกัน = hash เดียวกัน เก็บครั้งเดียว ใช้ได้หลายหน้า |
| ชนิดไฟล์ | รับทุกชนิด — เสิร์ฟเป็น attachment เสมอ (ไม่เปิดเป็นหน้าเว็บ) จึงปลอดภัยแม้เป็น HTML/SVG |
| ชื่อไฟล์ในการ์ด vs ตอนโหลด | การ์ดใช้ \`name\` ใน fence; ตอนโหลดใช้ชื่อที่เก็บไว้ตอนอัปโหลด |
| block id | ได้ \`{@N}\` เหมือน block อื่น → \`get_block\` คืน \`kind: "file"\` |
`;
const existing = pages
  .list(TUTORIAL_KID)
  .find((p) => pages.get(p.id)?.content.includes(MARKER));
if (existing) {
  console.log(`#${existing.id}: file tab already exists`);
} else {
  const added = pages.add({
    knowledge_id: TUTORIAL_KID,
    title: "14. แนบไฟล์",
    content: tabContent,
    summary: "แนบไฟล์ให้ดาวน์โหลดด้วย add_file → block ```file แสดงชื่อ ขนาด ชนิด และปุ่ม Download",
    keywords: ["file", "attachment", "แนบไฟล์", "download", "add_file"],
  });
  console.log(`#${added.id}: added tab 14 at position ${added.position}`);
}

// ── #19 overview counts + steps ──
const overview = pages.get(19);
if (!overview) {
  console.log("#19: missing — skipped");
} else if (overview.content.includes("14. แนบไฟล์")) {
  console.log("#19: already lists tab 14");
} else {
  let next = overview.content
    .replace('{ "num": "13", "label": "tabs สอน", "color": "purple" }', '{ "num": "14", "label": "tabs สอน", "color": "purple" }')
    .replace('{ "num": "9", "label": "fence types", "color": "blue" }', '{ "num": "10", "label": "fence types", "color": "blue" }')
    .replace('{ "num": "38", "label": "MCP tools", "color": "green" }', '{ "num": "39", "label": "MCP tools", "color": "green" }');
  const stepAnchor =
    '{ "title": "13. แชร์ public + รหัส", "body": "ลิงก์แชร์เลือกได้: เปิดได้เลย หรือต้องใส่ user + password เฉพาะเล่ม ตั้งวันหมดอายุได้ต่อ user" }';
  if (!next.includes(stepAnchor)) throw new Error("#19: step anchor not found");
  next = next.replace(
    stepAnchor,
    `${stepAnchor},\n  { "title": "14. แนบไฟล์", "body": "add_file → block \`\`\`file แสดงชื่อ ขนาด ชนิด คำอธิบาย + ปุ่ม Download; ไฟล์ถูกลบเองเมื่อไม่มีหน้าไหนอ้างถึง" }`,
  );
  pages.update(19, { content: next });
  console.log("#19: bumped counts (14 tabs / 10 fences / 39 tools) + added step");
}
