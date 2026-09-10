/**
 * One-shot: document the password-protected share link in the bundled
 * tutorial (&4) — a new tab "13. แชร์ public + รหัส" plus the overview
 * counts / steps list on #19.
 *
 *   node --import tsx scripts/add-share-password-docs.ts
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
const TUTORIAL_KID = 4;
const MARKER = "<!-- share-password-docs -->";

const tabContent = `# 13. แชร์ public + รหัส

${MARKER}

ลิงก์แชร์ (\`/share/<token>\`) เปิดให้คนนอกอ่าน knowledge ได้โดยไม่ต้องล็อกอิน.
ตอนนี้เลือกได้ว่าลิงก์นั้นจะ **เปิดได้เลย** หรือ **ต้องใส่ user + password ก่อน** —
โดย user/password ชุดนี้เป็นของ knowledge เล่มนั้นเท่านั้น ไม่เกี่ยวกับบัญชีระบบ.

\`\`\`stats
[
  { "num": "2", "label": "โหมดลิงก์", "color": "purple" },
  { "num": "∞", "label": "จำนวน user ต่อลิงก์", "color": "blue" },
  { "num": "30", "label": "วัน — cookie อยู่ได้นานสุด", "color": "green" },
  { "num": "10", "label": "ครั้ง — ลองผิดแล้วโดนพัก", "color": "amber" }
]
\`\`\`

## เปิดโหมดรหัส

\`\`\`steps
[
  { "title": "เปิดหน้าต่างแชร์", "body": "คลิก badge **&N** → **Share…** (หรือคลิกไอคอนโซ่ข้าง badge ถ้าแชร์อยู่แล้ว) แล้วกด **เปิดการแชร์แบบ public** ถ้ายังไม่เปิด" },
  { "title": "เลือก \\"ต้องใส่ user + password ก่อนอ่าน\\"", "body": "ในกล่อง **ใครเปิดลิงก์ได้** — สลับกลับเป็น **เปิดได้เลย** ได้ทุกเมื่อ user ที่ตั้งไว้ยังอยู่" },
  { "title": "เพิ่ม user", "body": "พิมพ์ user, password, และ **จำนวนวัน** ก่อนหมดอายุ (เว้นว่าง = ไม่หมดอายุ, ไม่มีเพดาน) → **เพิ่ม**. พอพิมพ์เลขวัน ระบบบอกทันทีว่าหมดอายุ **วันเดือนปี เวลา** ไหน" },
  { "title": "ส่งลิงก์ + user/password ให้ผู้อ่าน", "body": "คนที่เปิดลิงก์จะเห็นฟอร์มใส่รหัสก่อน — ใส่ถูกแล้วอ่านได้บน browser นั้นนานสุด 30 วัน หรือจนกว่า user จะหมดอายุ" },
  { "title": "ดูแล user", "body": "user ที่หมดอายุยังอยู่ในรายการแบบจางพร้อมป้าย **หมดอายุแล้ว** ให้รู้ว่าต้องต่อใคร (ลบแล้วเพิ่มใหม่). กด **ลบ** = เข้าไม่ได้ทันที" }
]
\`\`\`

## สิ่งที่ควรรู้

| เรื่อง | พฤติกรรม |
|---|---|
| user ซ้ำชื่อ | ซ้ำได้ข้าม knowledge แต่ซ้ำใน knowledge เดียวกันไม่ได้ |
| แก้ password / วันหมดอายุ | ไม่มีปุ่มแก้ — ลบแล้วเพิ่มใหม่ (ตั้งใจให้เรียบง่าย) |
| สร้างลิงก์ใหม่ (rotate) | ผู้อ่านทุกคนต้องล็อกอินใหม่ แต่ user ยังใช้ได้ |
| ปิดโหมดรหัสตอนไม่มี user ที่ใช้ได้ | หน้าต่างเตือนสีแดง — ตอนนั้นไม่มีใครเปิดลิงก์ได้เลย |
| diagram / chart แบบเต็มจอ | เปิดได้เหมือนเดิมหลังล็อกอิน — หน้าต่างขยายใช้ cookie เดียวกัน |
| ลองรหัสผิดซ้ำ ๆ | ผิด 10 ครั้งใน 15 นาทีจากเครื่องเดียวกัน → ถูกพัก ลองใหม่ได้เมื่อครบเวลา |
| ใช้ MCP ตั้งค่าได้ไหม | ยังไม่มี tool — ตั้งได้จาก portal เท่านั้น |

> 💡 **Tip** — user เหล่านี้เห็นได้เฉพาะ knowledge เล่มที่แชร์ ไม่เห็น sidebar, search, หรือเล่มอื่น
> จึงเหมาะกับ "ส่งรายงานให้ลูกค้าดู 7 วัน" มากกว่าการสร้างบัญชีระบบให้เขา.
`;

const existing = pages
  .list(TUTORIAL_KID)
  .find((p) => pages.get(p.id)?.content.includes(MARKER));
let tabId: number;
if (existing) {
  tabId = existing.id;
  console.log(`#${tabId}: share-password tab already exists — skipped add`);
} else {
  const added = pages.add({
    knowledge_id: TUTORIAL_KID,
    title: "13. แชร์ public + รหัส",
    content: tabContent,
    summary: "เลือกให้ลิงก์แชร์เปิดได้เลย หรือต้องใส่ user + password ที่ตั้งเฉพาะเล่ม พร้อมวันหมดอายุ",
    keywords: ["share", "password", "แชร์", "รหัส", "public link", "expire"],
  });
  tabId = added.id;
  console.log(`#${tabId}: added tab 13 at position ${added.position}`);
}

// Overview (#19): bump the tab count + add the step.
const overview = pages.get(19);
if (!overview) {
  console.log("#19: missing — skipped");
} else if (overview.content.includes("13. แชร์ public + รหัส")) {
  console.log("#19: already lists tab 13");
} else {
  let next = overview.content.replace(
    '{ "num": "12", "label": "tabs สอน", "color": "purple" }',
    '{ "num": "13", "label": "tabs สอน", "color": "purple" }',
  );
  const stepAnchor =
    '{ "title": "12. Knowledge tags", "body": "ติด tags ให้ knowledge, เลือกกรองจาก tag picker และล้างด้วย chips / Clear" }';
  if (!next.includes(stepAnchor)) throw new Error("#19: step anchor not found");
  next = next.replace(
    stepAnchor,
    `${stepAnchor},\n  { "title": "13. แชร์ public + รหัส", "body": "ลิงก์แชร์เลือกได้: เปิดได้เลย หรือต้องใส่ user + password เฉพาะเล่ม ตั้งวันหมดอายุได้ต่อ user" }`,
  );
  pages.update(19, { content: next });
  console.log("#19: bumped tab count to 13 + added step");
}
