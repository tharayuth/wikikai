/**
 * One-shot: bring the bundled docs in line with the ranked search.
 *
 *   &17 #123 — the manual's stat card still advertised "FTS5" and a 2-character
 *              minimum, neither of which describes what the box does now.
 *   &17 #124 — the Text mode page told readers to start with a single word,
 *              which was good advice when every word had to match and is the
 *              opposite of good advice now. It also claimed a unicode
 *              tokenizer (it is trigram) and promised highlighting that had
 *              stopped happening.
 *   &4  #26  — the AI/MCP workflow page gains the guidance an agent needs:
 *              ask in sentences, and read the hit before reading the page.
 *
 * No new tab, fence or tool ships with this, so the counts on &4 #19 stay.
 *
 *   node --import tsx scripts/update-search-docs.ts
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

function replaceOnce(pageId: number, find: string, replace: string, label: string): void {
  const page = pages.get(pageId);
  if (!page) {
    console.log(`#${pageId}: missing — skipped`);
    return;
  }
  if (!page.content.includes(find)) {
    console.log(`#${pageId}: ${label} — nothing to replace (already updated?)`);
    return;
  }
  pages.update(pageId, { content: page.content.replace(find, replace) });
  console.log(`#${pageId}: ${label}`);
}

function appendOnce(pageId: number, marker: string, section: string): void {
  const page = pages.get(pageId);
  if (!page) {
    console.log(`#${pageId}: missing — skipped`);
    return;
  }
  if (page.content.includes(marker)) {
    console.log(`#${pageId}: already has the section`);
    return;
  }
  pages.update(pageId, {
    content: `${page.content.replace(/\s+$/u, "")}\n\n${section.trim()}\n`,
  });
  console.log(`#${pageId}: appended`);
}

// ─── &17 #123 — the stat card ───
replaceOnce(
  123,
  `  { "label": "Backend", "value": "FTS5", "caption": "SQLite full-text index", "color": "green" },
  { "label": "Min query", "value": "2", "caption": "characters before dropdown opens", "color": "orange" },
  { "label": "Hit cap", "value": "16", "caption": "results shown in dropdown", "color": "purple" }`,
  `  { "label": "Ranking", "value": "rarity", "caption": "คำหายาก = น้ำหนักมาก", "color": "green" },
  { "label": "Min query", "value": "3", "caption": "ตัวอักษร (id mode ใช้ 2)", "color": "orange" },
  { "label": "Hit cap", "value": "20", "caption": "ผลที่แสดงใน dropdown", "color": "purple" }`,
  "stat card refreshed",
);

// ─── &17 #124 — Text mode, rewritten ───
replaceOnce(
  124,
  `พิมพ์คำใด ๆ ที่ **ไม่ขึ้นต้น** ด้วย \`&\`, \`#\`, \`@\` — ระบบจะส่งคำนั้นผ่าน SQLite FTS5 ค้นหาในทุก knowledge ที่เปิดให้แสดง (ตาม filter ของปุ่ม \`All projects\`)`,
  `พิมพ์อะไรก็ได้ที่ **ไม่ขึ้นต้น** ด้วย \`&\`, \`#\`, \`@\` — ระบบจะค้นทุก knowledge ที่เปิดให้แสดง (ตาม filter ของปุ่ม \`All projects\`)

## ถามเป็นประโยคเลย อย่าพยายามเดาคีย์เวิร์ด

ทุกคำในคำค้นถูกถ่วงน้ำหนักด้วย **ความหายากของคำนั้นในคลัง** คำที่บอกว่าคุณกำลังหาอะไรจึงเป็นตัวตัดสินอันดับ ส่วนคำเชื่อมอย่าง "ทำไม" "อย่างไร" "the" แทบไม่มีผล — และคำที่พบเกิน 1 ใน 5 ของทุกหน้าถูกตัดทิ้งไปเลย

| อยากรู้ | พิมพ์แบบนี้ | ไม่ต้องพิมพ์แบบนี้ |
|---|---|---|
| ทำไมถึงเลือก DB ตัวนี้ | \`ทำไมถึงเลือก better-sqlite3 แทน ORM\` | \`sqlite\` |
| งวดเงินมีกี่งวด | \`งวดการจ่ายเงิน OIE มีกี่งวด\` | \`งวด\` |
| หน้าไหนพูดเรื่อง revision | \`how does the revision system work\` | \`revision\` |

ภาษาไทยไม่ต้องเว้นวรรคให้ถูกหลัก ระบบซอยคำยาวให้เอง และ**ถามไทยเจอเอกสารที่เขียนเป็นอังกฤษได้** ถ้าในหน้ามีศัพท์เทคนิคตัวเดียวกัน

> ⚠️ คำที่สั้นกว่า 3 ตัวอักษรค้นไม่ได้ (\`AI\`, \`QS\`) — index เก็บเป็น trigram จึงไม่มีอะไรให้จับ ใส่คำอื่นประกอบไปด้วย`,
  "text-mode intro rewritten",
);

replaceOnce(
  124,
  `  { "title": "Snippet", "body": "ข้อความรอบ ๆ คำที่ match พร้อม \`…\` ตัดหน้า/หลัง" },
  { "title": "Line + IDs", "body": "ขวาสุด — เลขบรรทัด, &knowledge_id, #page_id" }`,
  `  { "title": "Snippet", "body": "ข้อความรอบคำที่หายากที่สุดที่ match พร้อมไฮไลต์คำนั้น — ถ้า match ไปโดนหัวข้อ จะยกย่อหน้าใต้หัวข้อมาให้แทน" },
  { "title": "ป้าย partial", "body": "ขึ้นเมื่อหน้านั้น match แค่บางส่วนของที่ถาม — ชี้เมาส์ดูได้ว่าตรงคำไหนบ้าง" },
  { "title": "Line + IDs", "body": "ขวาสุด — เลขบรรทัด, &knowledge_id, #page_id" }`,
  "result-row anatomy updated",
);

replaceOnce(
  124,
  `- ใช้คำเดียวก่อนเพื่อกวาดผล แล้วค่อยเติมเงื่อนไขเพิ่ม
- ภาษาไทยใช้ได้ (FTS5 มี unicode tokenizer)
- Snippet จะ bold คำที่ match ในจริง (ใน screenshot จะเห็นไฮไลต์)
- คลิก hit ใดก็ได้ → URL จะกลายเป็น \`/&N/#M:L\` (กระโดดถึงบรรทัด)`,
  `- **เติมคำ ไม่ใช่ตัดคำ** — ยิ่งบอกละเอียด อันดับยิ่งแม่น ตรงข้ามกับ search รุ่นก่อนที่ยิ่งพิมพ์ยิ่งไม่เจอ
- หัวตารางบอก \`20 of 340\` = กำลังดู 20 จากทั้งหมด 340 ไม่ใช่มีแค่ 20
- เห็นป้าย \`partial\` แปลว่าเจอไม่ครบที่ถาม — มักข้ามได้เลย
- คำที่ match ถูกไฮไลต์ใน snippet ไม่ต้องไล่อ่านหาเอง
- คลิก hit ใดก็ได้ → URL จะกลายเป็น \`/&N/#M:L\` (กระโดดถึงบรรทัด)`,
  "tips rewritten",
);

// ─── &4 #26 — what an agent should do differently ───
appendOnce(
  26,
  "<!-- ranked-search-docs -->",
  `
<!-- ranked-search-docs -->
## ค้นให้เปลือง token น้อยที่สุด

\`search\` จัดอันดับด้วย **ความหายากของคำ** ไม่ใช่การบังคับให้เจอครบทุกคำ วิธีเรียกจึงเปลี่ยนไปจากเดิม

\`\`\`steps
[
  { "title": "ถามเป็นประโยค", "body": "ส่งคำถามของ user ไปทั้งประโยคได้เลย คำเชื่อมไม่กินน้ำหนัก ส่วนคำเฉพาะอย่างชื่อ service หรือชื่อไฟล์คือตัวตัดสินอันดับ — ตัดเหลือคีย์เวิร์ดสั้น ๆ กลับได้ผลแย่ลง" },
  { "title": "อ่าน hit ก่อน อย่าเพิ่ง read_page", "body": "แต่ละ hit มี snippet ที่ตัดรอบคำหายากที่สุด + heading ที่ครอบอยู่ ส่วนมากพอตอบได้แล้ว เรียก read_page เมื่อต้องการบรรทัดรอบ ๆ เท่านั้น ไม่ใช่เพื่อเช็กว่า hit ตรงไหม" },
  { "title": "ใช้ match_ratio คัดทิ้ง", "body": "ค่าต่ำกว่า 1 แปลว่าหน้านั้นตรงแค่บางคำ — ถ้าคำที่ขาดคือคำสำคัญ ข้ามได้เลยโดยไม่ต้องเปิด" },
  { "title": "ดู total ก่อนสรุปว่าไม่มี", "body": "total คือจำนวนที่ match จริง ถ้า hits.length < total แปลว่ายังมีอีกหลัง limit — ค่อยขยาย limit หรือแคบด้วย project/knowledge_id" }
]
\`\`\`

| อาการ | แปลว่า | ทำอะไรต่อ |
|---|---|---|
| ได้ 0 hit | ทุกคำสั้นกว่า 3 ตัวอักษร หรือไม่มีคำไหนอยู่ในคลังเลย | ลองคำพ้อง/อีกภาษา หรือ \`list_knowledge({ search })\` ที่ค้นจาก title/tag แทน |
| อันดับ 1 ตรงเลย | คำหายากในคำถามชี้ตรงจุด | อ่าน snippet แล้วตอบ — ไม่ต้อง read_page |
| ทุก hit \`match_ratio\` ต่ำ | คำถามกว้างเกิน | เติมคำเฉพาะ เช่น ชื่อ service ชื่อไฟล์ ชื่อเมนู |

> 💡 อยากให้หน้าถูกค้นเจอด้วยคำที่ไม่มีในเนื้อหา (คำพ้อง ตัวย่อ หรืออีกภาษา) ให้ใส่ \`keywords\` ตอน \`add_page\` / \`edit_page\` — มันคือคำค้นเพิ่มของหน้านั้น
`,
);

console.log("done");
