/**
 * One-shot: document the knowledge-tag editor/filter UI in the bundled
 * tutorial (&4) and exercise it in the Thailand showcase (&3).
 *
 * Edits go through KnowledgeStore/PageStore so versions, revisions and FTS
 * stay in sync. Idempotent: re-running is a no-op after every marker exists.
 *
 *   node --import tsx scripts/add-knowledge-tags-docs.ts
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/lib/config.js";
import { openDb } from "../src/store/db.js";
import { KnowledgeStore } from "../src/store/knowledge.js";
import { PageStore } from "../src/store/pages.js";

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.resolve(here, "..", ".env"));
} catch {
  /* env is optional */
}

const config = loadConfig();
const db = openDb(config.dbPath);
const knowledge = new KnowledgeStore(db);
const pages = new PageStore(db, config.itemsDir);

const tutorialContent = `# 12. Knowledge tags

<!-- knowledge-tags-filter-picker-v3 -->

Tags ใช้จัดหมวด **knowledge ทั้งเล่ม** ข้าม project ได้ เช่น \`urgent\`,
\`customer-a\`, \`research\` หรือ \`briefing-ready\`. Tags ต่างจาก page
\`keywords\`: tags แสดงบน topic และใช้กรอง knowledge; keywords ช่วย FTS ของ
เนื้อหาแต่ละ page.

## เพิ่มและแก้ tags ใน portal

\`\`\`steps
[
  { "title": "เปิดเมนู knowledge", "body": "คลิก badge **&N** ที่ topbar หรือแถว topic ใน sidebar" },
  { "title": "เปิด tag manager", "body": "เลือก **จัดการ tags** ซึ่งอยู่ก่อน **Edit knowledge name** — หรือใช้ editor เดียวกันที่ **i → tags**" },
  { "title": "เพิ่ม tags", "body": "พิมพ์ tag แล้วกด Enter, เลือก suggestion จาก tag ที่มีอยู่ หรือวางหลาย tag คั่นด้วย comma/newline" },
  { "title": "ตรวจและบันทึก", "body": "กด × ที่ chip เพื่อลบ แล้วกด **Save** — รองรับสูงสุด 20 tags, tag ละ 60 ตัวอักษร" },
  { "title": "กรองจากรายการ tags", "body": "คลิกปุ่มรูป tag ก่อน **Show archived only**, ค้นหาแล้วติ๊ก tags ที่ต้องการ — topic ที่ตรงกับ tag ใด tag หนึ่งจะเหลืออยู่" },
  { "title": "ดูและล้าง filter", "body": "Tags ที่เลือกแสดงเป็น chips บรรทัดถัดจากช่องค้นหา; กด × เพื่อลบทีละ tag หรือ **Clear** เพื่อล้างทั้งหมด" }
]
\`\`\`

## ผ่าน MCP

\`\`\`typescript
await wikikai.add_knowledge({
  title: "Thailand weekly briefing",
  project: "examples",
  tags: ["thailand", "briefing-ready", "weekly"]
});

await wikikai.edit_knowledge({
  id: 3,
  tags: ["thailand", "statistics", "economy", "tourism"]
});
\`\`\`

## แนวทางตั้งชื่อ

- ใช้คำสั้น สม่ำเสมอ และค้นง่าย เช่น \`customer-a\` แทนหลายรูปสะกด
- Project ตอบว่า “งานชุดไหน”; tag ตอบว่า “เนื้อหาหรือสถานะอะไร”
- หลีกเลี่ยง tag ที่ซ้ำกันต่างแค่ตัวพิมพ์ใหญ่/เล็ก — editor จะ dedupe ให้
`;

// ─── &4: add a dedicated tutorial tab ───
const existingTagPage = pages
  .list(4)
  .find((page) => page.title === "12. Knowledge tags");
if (existingTagPage) {
  const current = pages.get(existingTagPage.id);
  if (current && !current.content.includes("knowledge-tags-filter-picker-v3")) {
    pages.update(existingTagPage.id, {
      content: tutorialContent,
      summary: "ติด tags ผ่านเมนู &N และกรองด้วย tag picker ใน sidebar",
      keywords: ["tags", "knowledge metadata", "sidebar filter", "organize"],
    });
    console.log(`&4 #${existingTagPage.id}: refreshed knowledge-tags tutorial`);
  } else {
    console.log(`&4 #${existingTagPage.id}: knowledge-tags tutorial already current`);
  }
} else {
  const added = pages.add({
    knowledge_id: 4,
    title: "12. Knowledge tags",
    content: tutorialContent,
    summary: "ติด tags ให้ knowledge, แก้ด้วย chip editor และกรองจาก sidebar",
    keywords: ["tags", "knowledge metadata", "sidebar filter", "organize"],
  });
  console.log(`&4 #${added.id}: added knowledge-tags tutorial`);
}

// ─── &4 #19: bump tab count and table-of-contents steps ───
{
  const page = pages.get(19);
  if (!page) {
    console.error("&4 #19 missing — overview was not updated");
  } else {
    let next = page.content;
    if (next.includes('"11", "label": "tabs สอน"')) {
      next = next.replace(
        '"11", "label": "tabs สอน"',
        '"12", "label": "tabs สอน"',
      );
    }
    if (!next.includes('"title": "12. Knowledge tags"')) {
      const anchor =
        '  { "title": "11. Checklist", "body": "todo / progress card ที่ติ๊กแล้วบันทึกลง DB ทันที (รองรับภาพในแต่ละ item)" }';
      if (next.includes(anchor)) {
        next = next.replace(
          anchor,
          `${anchor},\n  { "title": "12. Knowledge tags", "body": "ติด tags ให้ knowledge, แก้ด้วย chip editor และค้นจาก sidebar" }`,
        );
      } else {
        console.error("&4 #19: checklist step anchor missing");
      }
    }
    next = next.replace(
      '"title": "12. Knowledge tags", "body": "ติด tags ให้ knowledge, แก้ด้วย chip editor และค้นจาก sidebar"',
      '"title": "12. Knowledge tags", "body": "ติด tags ให้ knowledge, เลือกกรองจาก tag picker และล้างด้วย chips / Clear"',
    );
    if (next !== page.content) {
      pages.update(19, { content: next });
      console.log("&4 #19: bumped tab count and added tags to the overview");
    } else {
      console.log("&4 #19: knowledge-tags overview already current");
    }
  }
}

// ─── &3: apply real tags to the Thailand showcase metadata ───
{
  const current = knowledge.get(3);
  if (!current) {
    console.error("&3 missing — showcase tags were not applied");
  } else {
    const wanted = [
      "thailand",
      "statistics",
      "economy",
      "tourism",
      "briefing-ready",
    ];
    const seen = new Set(current.tags.map((tag) => tag.toLocaleLowerCase()));
    const next = [...current.tags];
    for (const tag of wanted) {
      if (!seen.has(tag)) next.push(tag);
    }
    if (next.length !== current.tags.length) {
      knowledge.update(3, { tags: next });
      console.log(`&3: applied showcase tags (${next.join(", ")})`);
    } else {
      console.log("&3: showcase tags already applied");
    }
  }
}

// ─── &3 #18: explain the Thailand-themed tag set ───
{
  const page = pages.get(18);
  const marker = "<!-- knowledge-tags-showcase -->";
  const filterMarker = "<!-- knowledge-tags-filter-picker-v3 -->";
  if (!page) {
    console.error("&3 #18 missing — showcase note was not added");
  } else if (page.content.includes(marker)) {
    let next = page.content;
    const oldPaths = [
      "ปุ่ม **i → tags → Edit**.",
      "badge **&N → Manage tags** (หรือ **i → tags → Edit**).",
    ];
    const newPath =
      "badge **&N → จัดการ tags** (หรือ **i → tags → Edit**).";
    const oldPath = oldPaths.find((candidate) =>
      next.includes(candidate),
    );
    if (oldPath) {
      next = next.replace(oldPath, newPath);
    }
    if (!next.includes(filterMarker)) {
      next = `${next.replace(/\s+$/u, "")}

${filterMarker}
### ลองกรองจากรายการ tags

กดปุ่มรูป tag ก่อน **Show archived only** แล้วติ๊ก \`tourism\` หรือ
\`briefing-ready\`. รายการที่เลือกจะแสดงเป็น chips บรรทัดถัดไป กด × เพื่อลบ
ทีละ tag หรือ **Clear** เพื่อล้างทั้งหมด. เมื่อเลือกหลาย tag ระบบจะแสดง topic
ที่ตรงกับ tag ใด tag หนึ่ง.
`;
    }
    if (next !== page.content) {
      pages.update(18, { content: next });
      console.log("&3 #18: refreshed tag picker showcase");
    } else {
      console.log("&3 #18: knowledge-tags showcase already current");
    }
  } else {
    const section = `
${marker}
${filterMarker}
## Tags สำหรับชุดข้อมูลประเทศไทย

Knowledge นี้ติด tags จริงไว้ 5 ตัว:

| Tag | ใช้สื่อความหมาย |
|---|---|
| \`thailand\` | ขอบเขตประเทศ |
| \`statistics\` | ประเภทเนื้อหา |
| \`economy\` | มีตัวชี้วัดเศรษฐกิจ |
| \`tourism\` | มีข้อมูลการท่องเที่ยว |
| \`briefing-ready\` | พร้อมนำไปใช้ใน briefing |

กดปุ่มรูป tag ก่อน **Show archived only** แล้วติ๊ก \`briefing-ready\` หรือ
\`tourism\`. WikiKai จะแสดง topic ที่ตรงกับ tag ใด tag หนึ่ง พร้อมแสดงตัวกรอง
เป็น chips บรรทัดถัดไป ลบทีละ tag ด้วย × หรือล้างทั้งหมดด้วย **Clear**.
แก้ชุด tags ได้จาก badge **&N → จัดการ tags** (หรือ **i → tags → Edit**).
`;
    pages.update(18, {
      content: `${page.content.replace(/\s+$/u, "")}\n\n${section.trim()}\n`,
    });
    console.log("&3 #18: appended Thailand knowledge-tags showcase");
  }
}

db.close();
