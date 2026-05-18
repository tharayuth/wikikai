/**
 * One-shot: create a brand-new user-focused tutorial knowledge document.
 *
 *   PATH=$HOME/.nvm/versions/node/v25.6.1/bin:$PATH \
 *     node --import tsx scripts/create-user-tutorial.ts
 *
 * Idempotent — bails when a knowledge with this title already exists.
 * Style: no code/architecture details. Every page answers
 *   "what does this look like + when do I use it + how do I ask AI for it"
 * from a user's perspective.
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
  /* ok */
}
const config = loadConfig();
const db = openDb(config.dbPath);
const knowledge = new KnowledgeStore(db);
const pages = new PageStore(db, config.itemsDir);

const TITLE = "📖 คู่มือใช้งาน WikiKai — สำหรับผู้ใช้";

// Skip if already created.
const existing = knowledge
  .list({ search: "📖 คู่มือใช้งาน WikiKai — สำหรับผู้ใช้", limit: 5 })
  .find((k) => k.title === TITLE);
if (existing) {
  console.log(
    `knowledge "${TITLE}" already exists at &${existing.id} — nothing to do`,
  );
  db.close();
  process.exit(0);
}

// ─── Create knowledge ────────────────────────────────────────────
const k = knowledge.add({
  title: TITLE,
  project: "examples",
  tags: ["tutorial", "manual", "user-guide"],
  author: "WikiKai",
});
const KID = k.id;
console.log(`created &${KID} "${TITLE}"`);

// ─── Helper to add a page ────────────────────────────────────────
let position = 0;
const addPage = (title: string, body: string, summary?: string) => {
  position += 1;
  const p = pages.add({
    knowledge_id: KID,
    title,
    content: body,
    position,
    summary,
  });
  console.log(`  + #${p.id} pos ${p.position} · ${title}`);
};

// ─── Page 1: Overview + benefits ─────────────────────────────────
addPage(
  "1. แนะนำ",
  `# 📖 WikiKai คืออะไร?

WikiKai เป็น **ที่เก็บเอกสารความรู้** ที่ AI ช่วยคุณสร้างได้ — ไม่ต้องเขียน markdown เอง, ไม่ต้องวาด chart เอง. คุยกับ AI ใน Claude Code (หรือ tool อื่นที่รองรับ MCP) แล้วบอกว่าอยากเก็บอะไร → AI สร้างหน้าเอกสารสวย ๆ ให้ในที่เดียว

\`\`\`stats
[
  { "num": "1", "label": "ที่เก็บความรู้เดียว", "color": "purple" },
  { "num": "🤖", "label": "AI ช่วยสร้าง", "color": "blue" },
  { "num": "📊", "label": "Chart + Diagram", "color": "green" },
  { "num": "🔗", "label": "Share ได้ทันที", "color": "amber" }
]
\`\`\`

## ทำไมถึงควรใช้

- **ไม่หาย** — ทุกครั้งที่คุยกับ AI ขอความรู้บางอย่าง คำตอบจะอยู่กระจัดกระจายในแต่ละ session. WikiKai ให้เก็บเข้าคลังเดียว ค้นหาภายหลังได้
- **พรีเซ้นต์ได้เลย** — ไม่ใช่แค่ข้อความ. มี **diagram (Mermaid)**, **chart**, **stat card**, **checklist ที่ติ๊กได้**, **gallery ภาพ** — เปิดให้คนอื่นดูเหมือนสไลด์
- **AI เข้าใจ context** — รองรับ block id (\`@N\`) ที่คุณบอก AI ได้ว่า "อัพเดต @47 หน่อย" แล้ว AI ก็รู้ทันทีว่ากำลังพูดถึงอะไร
- **มี version history** — ทุกการแก้ไขเก็บไว้ ดูย้อนหลัง / ดู diff / กลับไป version เก่าได้

## เหมาะกับใคร

- คนที่ใช้ AI ช่วยทำงาน แล้วอยากเก็บผลลัพธ์ไว้ดูทีหลัง
- ทีมที่อยากแชร์ความรู้กันแบบมีโครงสร้าง (ไม่ใช่แค่ Slack/LINE thread)
- นักเขียน/ครู/โปรเจคเอกชน ที่ต้องการเอกสารเชิงพรีเซ้นต์ — แต่ไม่อยากเรียนใช้ slide tool

## โครงสร้างเอกสาร

\`\`\`steps
[
  { "title": "Knowledge", "body": "เอกสาร 1 เล่ม (เช่น 'คู่มือใช้งาน X', 'สรุปประชุมโปรเจค Y'). แต่ละเล่มมีชื่อ, project group, tags" },
  { "title": "Page", "body": "หน้าใน knowledge หนึ่งเล่ม. แสดงเป็น tab ด้านบน. แต่ละหน้าเป็นหัวข้อย่อย เช่น 'บทนำ', 'วิธีติดตั้ง', 'FAQ'" },
  { "title": "Block", "body": "ภายในหน้ามี content ปกติ + block พิเศษ (diagram, chart, card, checklist, …). แต่ละ block พิเศษมีเลข \`@N\` ติดไว้ — บอก AI ให้แก้เฉพาะ block นั้นได้" }
]
\`\`\`

> 💡 **ดูตัวอย่างเลย** — กดที่ tab ถัดไปเพื่อดู features ทั้งหมด, หรือไปดูเอกสารตัวอย่างจริง ๆ ใน sidebar (เช่น \`📘 คู่มือใช้งาน WikiKai — Tutorial\`)`,
  "WikiKai คืออะไร · ประโยชน์ · เหมาะกับใคร",
);

// ─── Page 2: Features ─────────────────────────────────────────────
addPage(
  "2. ความสามารถ",
  `# ✨ ความสามารถทั้งหมด

\`\`\`stats
[
  { "num": "9", "label": "Block ชนิดต่าง ๆ", "color": "purple" },
  { "num": "∞", "label": "Page ต่อ knowledge", "color": "blue" },
  { "num": "🌗", "label": "Light / Dark theme", "color": "amber" },
  { "num": "🇹🇭", "label": "ค้นหาภาษาไทย", "color": "green" }
]
\`\`\`

## เนื้อหาที่ใส่ได้

| ประเภท | ใช้ทำอะไร | ตัวอย่าง |
|---|---|---|
| **Markdown ปกติ** | ข้อความ, หัวข้อ, รายการ, ตาราง, ลิงก์ | "เขียน FAQ 5 ข้อ" |
| **Code block** | โค้ดพร้อม syntax highlight | "ใส่ตัวอย่าง python function" |
| **Mermaid** | Flowchart, Sequence, ER, State, Mindmap, Pie | "วาด flow การ login" |
| **Chart.js** | กราฟ bar / line / doughnut / pie | "ทำกราฟยอดขาย 12 เดือน" |
| **Stats card** | กล่องตัวเลขสรุป (KPI) | "สรุปยอดเป็นการ์ด 4 กล่อง" |
| **Step card** | การ์ดขั้นตอน เลขในวงกลม | "ทำขั้นตอน setup เป็นการ์ด" |
| **Checklist** | Todo list ที่กดติ๊กได้จริง | "ทำ checklist เตรียม launch" |
| **Image / Gallery** | ภาพเดี่ยว หรือชุดภาพ click-to-zoom | "เอาภาพหน้าจอเหล่านี้ใส่" |
| **HTML embed** | HTML ดิบสำหรับ layout พิเศษ | "ทำกล่องสีไล่เฉดด้วย CSS" |

## เครื่องมือ navigation

\`\`\`steps
[
  { "title": "Sidebar ซ้าย", "body": "รายการ knowledge ทุกเล่ม group ตาม project. กรองได้ด้วยปุ่ม **⏷ ทุก project**" },
  { "title": "Search 🔍", "body": "พิมพ์ ≥ 3 ตัวอักษร — ค้นในเนื้อหา **ทุกเล่ม** รวมภาษาไทย/CJK. คลิกผลลัพธ์เด้งไปบรรทัดที่เจอ" },
  { "title": "Tab strip", "body": "tab page ด้านบน content. คลิกเปลี่ยน, scroll ดูได้เมื่อเยอะ" },
  { "title": "Info popover", "body": "คลิก **i** ข้างชื่อ knowledge — เห็น session, prompts ที่ใช้สร้าง, ย้าย project, ดู timeline ของ user prompt ทั้งหมด" }
]
\`\`\`

## การจัดการเอกสาร

- **กรอง project** — คลิก **⏷ ทุก project** มุมซ้ายบน → ติ๊กเฉพาะที่อยากเห็น
- **สร้าง project ว่าง** — ใน dialog เดียวกัน มีช่องเพิ่มชื่อใหม่ ใช้ "จองชื่อ" ก่อนมีเอกสาร
- **ย้ายเอกสารระหว่าง project** — คลิก **i** → คลิกแถว project → เลือกใหม่
- **ลบ project ทั้งกลุ่ม** — ใน dialog กด 🗑 — ยืนยันด้วยการพิมพ์ชื่อซ้ำ
- **Edit raw markdown** — กด "Edit raw" บนหน้านั้น → แก้แล้วกด Save
- **ดู revision เก่า** — ปุ่มเลข version ที่ header. กดแล้วเข้าโหมดดูของเก่า + ปุ่ม "ดู diff vs ล่าสุด"

## Theme

- **Light / Dark** — สลับด้วยปุ่ม ☾ / ☀ บน topbar. Diagram + chart เปลี่ยนสีตาม theme อัตโนมัติ
- **คำตอบ AI** — AI ไม่ต้องสนใจ theme. ระบบ render ปรับให้เอง`,
  "ตารางความสามารถทั้งหมด + เครื่องมือ navigation + การจัดการเอกสาร",
);

// ─── Page 3: AI commands ─────────────────────────────────────────
addPage(
  "3. คำสั่ง AI",
  `# 🤖 ตัวอย่างคำสั่งบอก AI

AI ที่รองรับ MCP (เช่น Claude Code) จะใช้ WikiKai ผ่าน tool ในเบื้องหลังให้คุณ — คุณแค่บอกเป็นภาษาธรรมดาว่าอยากได้อะไร

## สร้างเอกสารใหม่

> **คุณ:** สรุปบทสนทนาที่เราคุยกันวันนี้ ทำเป็นเอกสารใน WikiKai หน่อย ตั้งชื่อว่า "บันทึก SLA migration"

> **คุณ:** เอาเรื่อง deployment process ที่อธิบายไปเก็บไว้เป็น knowledge เล่มใหม่ แบ่งเป็นหลายหน้านะ — overview, prerequisites, steps, troubleshooting

## ค้นและอ่านของเก่า

> **คุณ:** หาในเอกสารของเราเรื่อง postgres timeout หน่อย

> **คุณ:** เปิดเอกสารชื่อ "Q4 planning" page เรื่อง marketing ขึ้นมา

## แก้ไข

> **คุณ:** ใน knowledge นั้นเพิ่มหน้าใหม่เกี่ยวกับ rollback procedure ด้วย

> **คุณ:** ที่ knowledge เรื่อง onboarding หน้า "tools" เพิ่มเครื่องมือ Figma เข้าไป

> **คุณ:** เปลี่ยนชื่อหัวข้อ "Old API" เป็น "Legacy API" ทุกที่ใน knowledge นี้

## ทำ block แบบต่าง ๆ

\`\`\`steps
[
  { "title": "Diagram", "body": "'วาด flowchart การ approval แบบมี 3 ขั้น'" },
  { "title": "Chart", "body": "'ทำกราฟ bar รายได้ 6 เดือน — Jan-Jun 100k/150k/120k/200k/180k/250k'" },
  { "title": "Stat cards", "body": "'สรุปเป็น stat card 4 กล่อง: users 12k, revenue 5M, uptime 99.9%, NPS 72'" },
  { "title": "Checklist", "body": "'ทำ checklist เตรียมประชุมพรุ่งนี้ — มี 5 ข้อ'" },
  { "title": "Steps", "body": "'อธิบาย onboarding ใหม่เป็น step card 4 ขั้น'" },
  { "title": "Images", "body": "'อัพภาพหน้าจอนี้ใส่ในหน้า bug report' (paste/drag ภาพให้ AI)" }
]
\`\`\`

## อ้างถึง block เฉพาะ

ทุก block พิเศษมีเลข **\`@N\`** ที่มุมซ้ายบน — ใช้บอก AI ให้แก้เฉพาะอันนั้น

> **คุณ:** แก้ @47 — เปลี่ยนตัวเลข Q3 จาก 180 เป็น 195

> **คุณ:** อัพเดต flowchart @23 ให้เพิ่มขั้น "manager review" หลัง "submit"

> **คุณ:** ติ๊ก @118 item 2 ให้หน่อย — ทำเสร็จแล้ว

## ตัวอย่างคำสั่งครบชุด (paste ได้เลย)

\`\`\`html-embed
<div style="background:linear-gradient(135deg,#eef0ff,#f5f3ff);border:1px solid #c7d2fe;border-radius:8px;padding:16px;font-size:13px;line-height:1.7;color:#1c1c1b;">
<b>📝 prompt ตัวอย่าง — Quarterly Review</b>
<br/><br/>
"ทำ knowledge ชื่อ 'Q1 2026 Review' ใน project 'planning' มี 5 หน้า:
<br/>1. Summary — stat card 4 กล่อง (users / revenue / churn / NPS)
<br/>2. Highlights — bullet list 5 ข้อสิ่งที่ทำสำเร็จ
<br/>3. Metrics — gantt mermaid ของ milestones + chart line รายได้
<br/>4. Issues — checklist 6 ข้อสิ่งที่ต้องตามแก้ Q2
<br/>5. Next steps — step card 4 ขั้นของแผน Q2
<br/><br/>
ใช้ user_prompt = นี่ ในทุก mutation tool เพื่อให้ track ได้ว่าหน้าไหนมาจาก request อะไร"
</div>
\`\`\`

## เคล็ดลับ

- **บอก project ด้วย** — ช่วยให้ AI ตั้ง field \`project\` ถูก: "เก็บใน project 'meeting-notes'"
- **บอกโครงสร้างที่ต้องการ** — "แบ่ง 3 หน้า: A, B, C" ดีกว่า "ทำเอกสาร X"
- **ถ้าผลลัพธ์ไม่ตรง** — บอก "ที่หน้า #N บรรทัดที่พูดถึง X ให้แก้เป็น Y" — AI อ่าน + แก้ตรงจุดได้`,
  "ตัวอย่าง prompt บอก AI สร้าง / ค้น / แก้ / อ้าง @N",
);

// ─── Page 4: Markdown basics ─────────────────────────────────────
addPage(
  "4. Markdown พื้นฐาน + ตาราง",
  `# 📝 Markdown พื้นฐาน

content ที่ AI สร้างให้ส่วนใหญ่เป็น **Markdown** — text format ง่าย ๆ ที่ render เป็น HTML สวย ๆ ในเว็บนี้

## หัวข้อ

# Heading 1 — ใหญ่สุด (ใช้บนหัวหน้าเดียว)
## Heading 2 — แบ่งส่วนหลัก
### Heading 3 — แบ่งย่อย

> Heading h2/h3 มี anchor link — hover ที่หัวข้อจะเห็น # ทางขวา. คลิกแล้ว copy URL ของ section นั้นได้

## เน้นข้อความ

- **ตัวหนา** — เน้นคำสำคัญ
- *ตัวเอน* — ไฮไลต์เบา ๆ หรือชื่อต่างประเทศ
- \`inline code\` — code/command ในกลางประโยค
- ~~ขีดฆ่า~~ — ของเดิมที่ถูกแทน
- [ลิงก์](https://example.com) — เปิด tab ใหม่อัตโนมัติ

## รายการ

แบบ bullet:

- ผลไม้
  - มะม่วง
  - มะละกอ
- ผัก
  - คะน้า

แบบเลข:

1. ตื่นนอน
2. แปรงฟัน
3. กินข้าวเช้า

## ตาราง markdown ปกติ

| สินค้า | ราคา | สต็อก |
|---|---:|:---:|
| มะม่วง | 50 | ✓ |
| มะละกอ | 35 | ✓ |
| ทุเรียน | 200 | — |

> ⚠️ **ตาราง markdown ปกติไม่มี \`@N\` block id** — ถ้าต้องการให้ AI อ้างถึงตารางด้วย \`@N\` ได้, บอก AI ให้เขียนเป็น HTML table ใน html-embed แทน (ดูหน้า HTML embed)

## Quote

> ข้อความ blockquote — ใช้สำหรับ citation หรือเน้นคำพูด
> หลายบรรทัดได้

## เส้นคั่น

---

ใช้ \`---\` คั่น section

## บอก AI

> "ใส่ตาราง compare 3 cloud provider — AWS, GCP, Azure: ราคา, region, support level"

> "เพิ่ม FAQ 5 ข้อแบบ heading + paragraph"`,
  "Heading, lists, bold/italic, link, ตาราง markdown",
);

// ─── Page 5: Code blocks ─────────────────────────────────────────
addPage(
  "5. Code & syntax highlight",
  `# 💻 Code blocks

เอกสาร technical ส่วนใหญ่ต้องการ snippet code — WikiKai ใส่ syntax highlight ให้อัตโนมัติตาม language tag

## ตัวอย่าง

\`\`\`python
def fibonacci(n: int) -> int:
    if n < 2:
        return n
    a, b = 0, 1
    for _ in range(n - 1):
        a, b = b, a + b
    return b

print(fibonacci(10))  # 55
\`\`\`

\`\`\`typescript
interface User {
  id: string;
  email: string;
}

async function findUser(id: string): Promise<User | null> {
  const row = await db.query("SELECT * FROM users WHERE id = $1", [id]);
  return row ?? null;
}
\`\`\`

\`\`\`bash
# ติดตั้ง dependencies
npm install

# รัน dev server
npm run dev
\`\`\`

\`\`\`sql
SELECT u.email, COUNT(o.id) AS orders
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE u.created_at > '2025-01-01'
GROUP BY u.email
ORDER BY orders DESC
LIMIT 10;
\`\`\`

## ภาษาที่รองรับ

- python, javascript, typescript, ts, tsx, jsx
- bash, sh, zsh
- sql, json, yaml, toml
- go, rust, java, kotlin, swift, php, ruby
- html, css, scss
- markdown, dockerfile, nginx
- และอีกหลายภาษา (ผ่าน Shiki)

## บอก AI

> "ใส่ example function python ที่ทำ binary search"

> "แสดง config nginx สำหรับ reverse proxy WebSocket"

> "ใน FAQ ข้อ 3 ใส่ตัวอย่าง curl command"`,
  "Fenced code blocks + syntax highlight (Python, TS, Bash, SQL, …)",
);

// ─── Page 6: Mermaid ─────────────────────────────────────────────
addPage(
  "6. Mermaid Diagrams",
  `# 📊 Mermaid — Diagram ทุกชนิด

Mermaid ทำให้บอก "วาด flowchart นี้" แล้ว AI แปลงเป็นภาพได้ทันที — render ฝั่ง browser, click เพื่อดูใหญ่ + export PNG ได้

## Flowchart

\`\`\`mermaid
flowchart TD
  Start([เริ่ม]) --> Check{ข้อมูลครบ?}
  Check -->|ครบ| Process[ดำเนินการ]
  Check -->|ไม่ครบ| Ask[ถาม user]
  Ask --> Check
  Process --> End([เสร็จ])
\`\`\`

## Sequence diagram

\`\`\`mermaid
sequenceDiagram
  participant U as User
  participant A as App
  participant DB as Database
  U->>A: คลิกล็อกอิน
  A->>DB: เช็ค password
  DB-->>A: ok
  A-->>U: ส่ง token
\`\`\`

## ER diagram

\`\`\`mermaid
erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ ITEM : contains
  PRODUCT ||--o{ ITEM : "appears in"
\`\`\`

## State diagram

\`\`\`mermaid
stateDiagram-v2
  [*] --> Draft
  Draft --> Submitted: submit
  Submitted --> Approved: ok
  Submitted --> Rejected: revise
  Rejected --> Draft
  Approved --> [*]
\`\`\`

## Mindmap

\`\`\`mermaid
mindmap
  root((โปรเจค X))
    เป้าหมาย
      เพิ่ม user 50%
      ลด churn
    ทีม
      Engineering
      Design
      Marketing
    Timeline
      Q1 vision
      Q2 build
\`\`\`

## Pie chart

\`\`\`mermaid
pie title สัดส่วนตลาด
  "iOS" : 55
  "Android" : 40
  "อื่น ๆ" : 5
\`\`\`

## บอก AI

> "วาด flowchart อนุมัติเอกสาร: เริ่ม → manager approve? → ถ้าใช่ go, ถ้าไม่ revise"

> "ทำ sequence diagram การชำระเงินผ่าน QR — มี user, app, gateway, bank"

> "ทำ mindmap หัวข้อหลัก ๆ ในประชุมวันนี้: เป้าหมาย Q1, ทีม, deadline"

> "ใส่ pie chart สัดส่วนเวลาทำงาน: dev 60%, meeting 20%, docs 15%, อื่น ๆ 5%"

## เคล็ดลับ

- คลิก diagram → เปิด tab ใหม่ มี zoom + pan + export PNG
- หลีกเลี่ยง **Gantt** ใน container แคบ ๆ — axis label จะทับ. ใช้ timeline หรือ stat card แทน`,
  "Flowchart / Sequence / ER / State / Mindmap / Pie",
);

// ─── Page 7: Charts ──────────────────────────────────────────────
addPage(
  "7. Charts — กราฟเชิงตัวเลข",
  `# 📈 Chart.js — กราฟตัวเลข

ใช้สำหรับ data ที่เป็นตัวเลขจริง ๆ — รายได้, ยอดขาย, สถิติ. Interactive — hover เห็น tooltip, คลิกเปิด preview ใหญ่ + export PNG

## Bar chart

\`\`\`chart
{
  "type": "bar",
  "data": {
    "labels": ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
    "datasets": [{
      "label": "ยอดขาย (พันบาท)",
      "data": [120, 150, 180, 160, 200, 240],
      "backgroundColor": "#6366f1"
    }]
  }
}
\`\`\`

## Line chart

\`\`\`chart
{
  "type": "line",
  "data": {
    "labels": ["2020", "2021", "2022", "2023", "2024", "2025"],
    "datasets": [
      { "label": "Users", "data": [1.2, 1.8, 2.6, 3.5, 4.8, 6.2], "borderColor": "#10b981", "tension": 0.3 },
      { "label": "Active", "data": [0.8, 1.2, 1.9, 2.8, 4.0, 5.5], "borderColor": "#6366f1", "tension": 0.3 }
    ]
  },
  "options": { "scales": { "y": { "title": { "display": true, "text": "ล้านคน" } } } }
}
\`\`\`

## Doughnut chart

\`\`\`chart
{
  "type": "doughnut",
  "data": {
    "labels": ["Engineering", "Marketing", "Sales", "Ops"],
    "datasets": [{
      "data": [45, 20, 25, 10],
      "backgroundColor": ["#6366f1", "#10b981", "#f59e0b", "#ef4444"]
    }]
  }
}
\`\`\`

## Chart grid — หลายกราฟติดกัน

\`\`\`chart-grid
[
  {
    "title": "Revenue",
    "type": "bar",
    "data": {
      "labels": ["Q1","Q2","Q3","Q4"],
      "datasets": [{ "label": "M฿", "data": [1.2, 1.5, 1.8, 2.4], "backgroundColor": "#6366f1" }]
    }
  },
  {
    "title": "Users",
    "type": "line",
    "data": {
      "labels": ["Q1","Q2","Q3","Q4"],
      "datasets": [{ "label": "k", "data": [12, 18, 25, 38], "borderColor": "#10b981", "tension": 0.3 }]
    }
  }
]
\`\`\`

## บอก AI

> "ทำกราฟ bar รายได้ 12 เดือน ปี 2025 — ตัวเลขสมมุติเริ่ม 100k เพิ่มทีละ 20k"

> "เปรียบเทียบ users vs active users 5 ปี ทำเป็น line chart 2 เส้น"

> "ทำ chart grid — กราฟ revenue + users ราย Q ปี 2025 วางคู่กัน"

## ต่างจาก Mermaid pie อย่างไร

- **Mermaid pie** — เร็ว, สำหรับสัดส่วนสั้น ๆ
- **Chart.js doughnut/pie** — interactive (hover legend), customize สีได้, ใส่หลาย dataset ได้`,
  "Bar / Line / Doughnut + chart-grid (หลายกราฟ)",
);

// ─── Page 8: Stats + Steps ───────────────────────────────────────
addPage(
  "8. Stats + Step cards",
  `# 🎴 Stats + Step cards

การ์ดสำหรับ "พาดหัว" หรือ "อธิบายลำดับ" — สวยกว่ารายการธรรมดา, อ่านเร็วกว่ากราฟ

## Stats card — KPI ตัวเลขสำคัญ

\`\`\`stats
[
  { "num": "1,247", "label": "active users", "color": "purple" },
  { "num": "98.7%", "label": "uptime", "color": "green" },
  { "num": "42ms", "label": "p95 latency", "color": "blue" },
  { "num": "5,820", "label": "messages/day", "color": "amber" }
]
\`\`\`

สี: \`purple\` / \`blue\` / \`green\` / \`amber\` / \`red\` / \`cyan\`

## Step card — ขั้นตอน

\`\`\`steps
[
  { "title": "ขั้นแรก", "body": "ติดตั้ง dependencies ผ่าน \`npm install\` — รอประมาณ 30 วินาที" },
  { "title": "เปิด dev server", "body": "รัน \`npm run dev\` — server จะเปิดที่ port 3939" },
  { "title": "เข้าผ่าน browser", "body": "เปิด [http://localhost:5173](http://localhost:5173) เห็นหน้า portal" },
  { "title": "เริ่มสร้าง", "body": "บอก AI ใน Claude Code: 'สร้าง knowledge ทดสอบใน WikiKai หน่อย'" }
]
\`\`\`

> ใน \`body\` ใช้ markdown ได้ — **bold**, *italic*, [link](#), \`code\`, รูปก็ได้

## บอก AI

> "ทำ stat card 4 กล่อง: revenue 5M, MAU 12k, NPS 72, churn 2.1%"

> "อธิบาย onboarding ใหม่เป็น step card 4 ขั้น: register → verify → setup profile → invite team"

> "สรุปจุดเด่นของ product เป็น 6 step card — แต่ละการ์ดมี title + 1 ประโยค"

## เมื่อไหร่ใช้ stats vs chart

| ใช้ stat card เมื่อ | ใช้ chart เมื่อ |
|---|---|
| มีตัวเลขสำคัญ 2-6 ค่า | มี data series หลายจุด (ช่วงเวลา) |
| ต้องการแสดง snapshot ปัจจุบัน | ต้องการ trend หรือเปรียบเทียบ |
| ตัวเลขตัวเดียวพอ (เช่น "12.5K") | มีหลาย dimension (เช่น users vs revenue) |`,
  "Stats card (KPI ตัวเลข) + Steps card (ลำดับขั้น)",
);

// ─── Page 9: Checklist ───────────────────────────────────────────
addPage(
  "9. Checklist (กดติ๊กได้จริง)",
  `# ✅ Interactive Checklist

Todo list ที่ **คลิกแล้ว save จริง** — state ค้างไว้ในเอกสาร, refresh แล้วยังอยู่. เหมาะกับ release checklist, pre-meeting prep, onboarding tasks

## ตัวอย่างง่าย ๆ

\`\`\`checklist
{
  "title": "Pre-deploy checklist",
  "description": "ก่อนกด deploy ต้องเช็คทั้งหมดให้ครบ",
  "items": [
    { "text": "Tests ผ่าน main branch", "done": true },
    { "text": "Docs อัปเดต", "done": false },
    { "text": "Stakeholder อนุมัติ", "done": false },
    { "text": "Backup database", "done": false }
  ]
}
\`\`\`

> 💡 **กดที่ checkbox ได้เลย** — เห็น strikethrough ขึ้นทันที, refresh หน้าก็ยังอยู่

## ใช้ inline markdown ใน item ได้

\`\`\`checklist
{
  "title": "Setup project ใหม่",
  "items": [
    { "text": "Clone repo: \`git clone https://github.com/...\`", "done": true },
    { "text": "ติดตั้ง — \`npm install\` (อาจใช้เวลา ~30 วินาที)", "done": true },
    { "text": "อ่าน **README.md** ก่อน", "done": false },
    { "text": "ดู [contribution guide](#)", "done": false }
  ]
}
\`\`\`

## ใส่ภาพในแต่ละ item ได้

\`\`\`checklist
{
  "title": "QA visual review",
  "description": "เช็ค screenshot จากทีม design ก่อน sign-off",
  "items": [
    { "text": "Home page — ![home preview](/img/94ab7ffc01bdca05913bcdc6a9749ebf065d5b7d5f772ec7daa0ead91e635bf9.svg \\"x24\\") ดูตรงโลโก้", "done": false },
    { "text": "Login flow", "done": false },
    { "text": "Mobile responsive", "done": false }
  ]
}
\`\`\`

## บอก AI

> "ทำ checklist 6 ข้อสำหรับเตรียมประชุมพรุ่งนี้"

> "Release v2.5 checklist — มี: tests, changelog, blog post, social media post, deploy staging, deploy prod, monitor"

> "เปลี่ยน @118 item 3 ให้ติ๊กแล้ว" — AI จะ toggle ให้

## เคล็ดลับ

- มี progress bar คำนวณ % เสร็จอัตโนมัติบนหัวการ์ด
- ทุกการติ๊กถูกบันทึกเป็น **revision** — ถ้าอยากดูประวัติว่าเสร็จเมื่อไหร่ ดูที่ปุ่ม version ใน header
- AI ก็ติ๊กแทนคุณได้ — บอก "@118 item 0 ทำเสร็จแล้ว"`,
  "Todo list ที่คลิกได้ + progress bar + ใส่ภาพในแต่ละข้อได้",
);

// ─── Page 10: Images ─────────────────────────────────────────────
addPage(
  "10. Images — 3 แบบ",
  `# 🖼 รูปภาพ

3 แบบ เลือกตามจุดที่อยากให้ภาพไปอยู่

## 1. Gallery — \`\`\`images fence

หลายภาพเรียงเป็น grid + คลิกแล้ว lightbox เต็มจอ:

\`\`\`images
[
  { "src": "/img/2b5d19eb2a91970c2a322293542da95ac2b6ba1aa7cfbaa8e15d4a43dc032cf5.svg", "alt": "Data flow", "caption": "Data flow diagram", "width": 280, "height": 160 },
  { "src": "/img/98be11f7c598163ec74c2851fd5be61b05629cfefbc8329610bd82869a1712d7.svg", "alt": "Badge", "caption": "Logo badge", "width": 280, "height": 160 }
]
\`\`\`

**ดี:** มี \`@N\` block id, คลิก lightbox ได้, caption สวย, รองรับหลายภาพ

## 2. Inline markdown — \`![alt](src)\`

ภาพในเนื้อหา paragraph ปกติ — สำหรับ icon, screenshot ใน prose:

ในประโยคนี้มีตราครุฑ ![ครุฑ](/img/b9b050e806a7e38172059601c41b4a57cbfbaf87c47ee3fba53e7ebd7ed735a1.svg "x32") อยู่ตรงกลาง

ภาพในตาราง markdown:

| ประเทศ | ธง | เมืองหลวง |
|---|:---:|---|
| ไทย | ![ธง](/img/18a2e683798840015634f8547db85a077bbb5e5006c119a64bb20b684dafb16d.svg "x24") | กรุงเทพ |
| (ภาพอื่น) | — | — |

**ดี:** ยืดหยุ่นสุด, ใส่ใน list, table cell, paragraph ได้
**ไม่มี:** \`@N\` block id (เพราะเป็น leaf content)

### กำหนดขนาดผ่าน title slot

- \`"300x200"\` — กว้าง 300, สูง 200
- \`"300x"\` — กว้าง 300 (สูง auto)
- \`"x200"\` — สูง 200 (กว้าง auto)
- \`"caption w=300 h=200"\` — caption + size

## 3. \`<img>\` ใน html-embed

เมื่อต้องการ HTML layout ซับซ้อน — flex row, custom CSS, ฯลฯ:

\`\`\`html-embed
<div style="display:flex;gap:14px;align-items:center;padding:12px;background:#fffbeb;border-radius:8px;border:1px solid #f59e0b;">
  <img src="/img/18a2e683798840015634f8547db85a077bbb5e5006c119a64bb20b684dafb16d.svg" alt="flag" width="80" height="48" style="border:1px solid #ccc;border-radius:4px;flex-shrink:0;" />
  <div>
    <h4 style="margin:0 0 4px;color:#92400e;">ธงไตรรงค์</h4>
    <p style="margin:0;color:#78350f;font-size:13px;">3 สี: แดง · ขาว · น้ำเงิน</p>
  </div>
</div>
\`\`\`

## วิธีอัพภาพ

### ทางที่ 1 — ผ่าน UI (ตอน edit)

\`\`\`steps
[
  { "title": "เปิดหน้าที่อยากใส่ภาพ", "body": "กด **Edit raw**" },
  { "title": "วาง cursor", "body": "ในจุดที่อยากให้ภาพไปอยู่ (เช่น ในรายการ checklist หรือนอก fence)" },
  { "title": "กด 🖼 Add Images", "body": "เลือกไฟล์, หรือ drag-drop ลงใน dialog" },
  { "title": "ใส่ขนาด default + alt", "body": "ปรับ กว้าง/สูง ถ้าต้องการ; ใส่ alt text" },
  { "title": "OK", "body": "ระบบ insert code ให้ตามจุดที่ cursor อยู่ — เลือก fence ภาพ, markdown inline, หรือ HTML img tag แล้วแต่ context" }
]
\`\`\`

### ทางที่ 2 — ให้ AI ทำให้

> "อัพภาพหน้าจอนี้ใส่ในหน้า bug report ที่กำลังเขียน" (paste/drag ภาพให้ AI)

> "ใส่ icon ธงชาติไทย (มีอยู่ใน knowledge อื่นแล้ว) ในตารางสรุปประเทศ"

## เคล็ดลับ

- ภาพ identical จะ **dedup** อัตโนมัติ (hash file content) — อัพภาพเดิมซ้ำไม่ใช้ disk เพิ่ม
- รูป internal ทุกตัวมี URL คงที่ — share ลิงก์ภาพได้ตรง ๆ
- รองรับ PNG / JPG / WebP / GIF / SVG`,
  "3 ทาง: gallery (มี @N), inline markdown, <img> ใน html-embed + sizing",
);

// ─── Page 11: HTML embed ─────────────────────────────────────────
addPage(
  "11. HTML embed — เนื้อหายืดหยุ่น",
  `# 🎨 HTML embed

เมื่อ block ปกติทำไม่ได้ตามที่อยาก — ใส่ HTML ดิบเข้าไปได้, ใช้ inline CSS หรือ scoped \`<style>\` เพื่อ customize สวย ๆ

## Card สีไล่เฉด

\`\`\`html-embed
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;">
  <div style="background:linear-gradient(135deg,#a855f7,#6366f1);color:white;padding:16px;border-radius:10px;">
    <div style="font-size:28px;font-weight:700;">12.4K</div>
    <div style="font-size:12px;opacity:0.9;">Total users</div>
  </div>
  <div style="background:linear-gradient(135deg,#10b981,#059669);color:white;padding:16px;border-radius:10px;">
    <div style="font-size:28px;font-weight:700;">฿5.2M</div>
    <div style="font-size:12px;opacity:0.9;">Revenue Q1</div>
  </div>
  <div style="background:linear-gradient(135deg,#f59e0b,#d97706);color:white;padding:16px;border-radius:10px;">
    <div style="font-size:28px;font-weight:700;">94%</div>
    <div style="font-size:12px;opacity:0.9;">Retention</div>
  </div>
</div>
\`\`\`

## ตารางที่ตกแต่งได้เต็มที่

\`\`\`html-embed
<table style="width:100%;border-collapse:collapse;font-size:13px;">
  <thead>
    <tr style="background:#eef0ff;color:#4f46e5;">
      <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #6366f1;">ทีม</th>
      <th style="padding:8px 12px;text-align:center;border-bottom:2px solid #6366f1;">Q1</th>
      <th style="padding:8px 12px;text-align:center;border-bottom:2px solid #6366f1;">Q2</th>
      <th style="padding:8px 12px;text-align:right;border-bottom:2px solid #6366f1;">YTD</th>
    </tr>
  </thead>
  <tbody>
    <tr><td style="padding:6px 12px;">Engineering</td><td style="text-align:center;background:#ecfdf5;">✓</td><td style="text-align:center;background:#ecfdf5;">✓</td><td style="text-align:right;font-weight:600;">100%</td></tr>
    <tr style="background:#fafaf9;"><td style="padding:6px 12px;">Marketing</td><td style="text-align:center;background:#ecfdf5;">✓</td><td style="text-align:center;background:#fef2f2;">✗</td><td style="text-align:right;font-weight:600;">50%</td></tr>
    <tr><td style="padding:6px 12px;">Sales</td><td style="text-align:center;background:#fef2f2;">✗</td><td style="text-align:center;background:#fffbeb;">~</td><td style="text-align:right;font-weight:600;">25%</td></tr>
  </tbody>
</table>
\`\`\`

> **เหตุผลที่ AI แนะนำให้ใช้ html-embed สำหรับตาราง:** จะมี \`@N\` block id ติดมา — ต่างจาก markdown table ปกติที่ไม่มี

## Details / Accordion

\`\`\`html-embed
<details style="background:#f5f3ff;border:1px solid #c4b5fd;border-radius:6px;padding:10px 14px;">
  <summary style="cursor:pointer;font-weight:600;color:#5b21b6;">📌 อ่านเพิ่มเติม — ข้อจำกัด</summary>
  <div style="margin-top:8px;font-size:13px;color:#1c1c1b;line-height:1.7;">
    <ul style="margin:0;padding-left:20px;">
      <li>ไม่รองรับการอัพไฟล์ขนาดเกิน 10 MB</li>
      <li><code>&lt;script&gt;</code> ไม่ทำงาน (ตั้งใจ — ป้องกัน XSS)</li>
      <li>iframe ใส่ได้แต่ต้อง trust source</li>
    </ul>
  </div>
</details>
\`\`\`

## SVG inline

\`\`\`html-embed
<div style="display:flex;justify-content:center;align-items:center;padding:20px;background:#fafaf9;border-radius:8px;">
  <svg width="120" height="120" viewBox="0 0 120 120">
    <circle cx="60" cy="60" r="50" fill="#6366f1" opacity="0.2"/>
    <circle cx="60" cy="60" r="35" fill="#6366f1" opacity="0.5"/>
    <circle cx="60" cy="60" r="20" fill="#6366f1"/>
    <text x="60" y="65" text-anchor="middle" fill="white" font-size="14" font-weight="700">SVG</text>
  </svg>
</div>
\`\`\`

## บอก AI

> "ทำ KPI card 3 ใบไล่เฉด — purple, green, amber — แสดง users / revenue / retention"

> "ทำตารางสถานะ Q1/Q2 ทีม Engineering, Marketing, Sales — สีเขียวถ้าผ่าน, แดงถ้าไม่"

> "ใส่ details collapse สรุปข้อจำกัดของระบบ"

## ข้อควรระวัง

- **อย่าใส่ \`<script>\`** — ระบบเอาออกอัตโนมัติ (security)
- ใช้ **inline CSS** เป็นหลัก — \`<style>\` scoped ก็ได้แต่อาจกระทบ block อื่น
- รูปใน html-embed ใช้ \`<img src="/img/...">\` ปกติ`,
  "HTML ดิบ + inline CSS + ตารางตกแต่งได้ + details + SVG",
);

// ─── Page 12: Block IDs + Revisions + Deep links ─────────────────
addPage(
  "12. Block ID, Revisions, Deep links",
  `# 🔗 อ้างถึง / ย้อนดู / share

## Block ID \`@N\`

ทุก rich block (mermaid, chart, stats, steps, checklist, images, html-embed) มีเลข **\`@N\`** กลาง ๆ ระดับทั้งระบบ:

\`\`\`stats
[
  { "num": "@N", "label": "id เฉพาะตัว", "color": "purple" },
  { "num": "🌐", "label": "ทั่วทั้ง WikiKai", "color": "blue" },
  { "num": "↻", "label": "ไม่ reuse เลขเดิม", "color": "green" }
]
\`\`\`

- เห็น badge \`@N\` มุมซ้ายบนของ block ตอน **hover**
- คลิก badge → เมนูให้เลือก **Copy @N** หรือ **Edit this block** (เด้งไปแก้ที่ source โดยตรง)
- ใช้บอก AI: "อัพเดต **@47**" / "อ่าน **@123**" → AI หาเจอทันทีไม่ต้อง scan ทั้งเอกสาร

> 📌 **ตาราง markdown ปกติไม่มี \`@N\`** — ถ้าต้องการอ้างตารางด้วย \`@N\` ให้ใส่ใน html-embed

## Revisions — ย้อนดูได้

ทุกครั้งที่หน้าถูกแก้ → save **snapshot** เก็บไว้:

- เลข version (v1, v2, v3, …) อยู่ที่ header — คลิกดูของเก่าได้
- กดเลขเก่า → แสดง content version นั้น + banner สีส้มเตือน
- ปุ่ม **🔍 ดู diff vs v[ล่าสุด]** — เห็น line-by-line diff สีเขียว/แดง
- **Delete revisions** — เก็บแค่ 2 version ล่าสุด เพื่อประหยัด

## Deep links — share URL

URL format:

\`\`\`
/&KID            ← knowledge เปิด tab แรกอัตโนมัติ
/&KID/#PID       ← knowledge + tab ที่ระบุ
/&KID/#PID:LINE  ← + scroll ใกล้บรรทัด
\`\`\`

ตัวอย่าง:

| URL | เปิดที่ไหน |
|---|---|
| \`/&5\` | เอกสาร &5 tab แรก |
| \`/&5/#7\` | เอกสาร &5 tab page #7 |
| \`/&5/#7:42\` | + scroll ใกล้บรรทัด 42 |

ทุก search hit, ทุก link ในผลลัพธ์ AI, ทุกการ copy link จาก UI ใช้ format นี้ — share เปิดในอีกเครื่องได้

## Prompt log — เห็น "ทำไมหน้านี้เกิด"

เปิด **i** info popover → ลงล่างเห็น **timeline ของ user prompt** ที่ใช้สร้าง/แก้เอกสารนี้:

- เห็นว่า revision ไหนมาจาก request อะไรของคุณ
- เห็น page id + version ที่ผลกระทบ
- ใช้ตามได้ว่า "ทำไม version 5 ของหน้านี้ถึงเพิ่ม section X" → เพราะคุณบอก "..."

> 💡 AI ส่ง \`user_prompt\` เข้ามาตอน mutation ถึงจะมีใน log — opt-in เพื่อประหยัด token

## บอก AI

> "เลขที่ AI พิมพ์ออกมาตอนสร้างเสร็จ (\`&5\`) ใช้เปิด knowledge นั้นได้เลย ใน sidebar หรือพิมพ์ URL ตรง"

> "บอก AI ว่า 'อ่าน @47' — AI จะดึง block นั้นมาดูทันที"

> "ก่อนแก้ขอ AI ให้ดู v3 เก่าก่อน: 'แสดง v3 ของ #12 ให้ดู'"`,
  "@N block id + Revision history + URL deep links + Prompt log",
);

db.close();
console.log(
  `\n✅ done — created &${KID} with ${position} pages\n   open: /&${KID}`,
);
