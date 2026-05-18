/**
 * Documentation update for the new `images` fence + `add_image` /
 * `get_image` MCP tools.
 *
 *   1. Uploads two sample SVG images (architecture, badge) into the
 *      ImageStore so the tutorial tab can reference real internal
 *      `/img/<hash>.<ext>` paths.
 *   2. Adds a new "8. Images" tab to knowledge &4 covering both embed
 *      paths (```images fence and <img> inside ```html-embed) and
 *      external URLs.
 *   3. Rewrites &4 #19 (overview): bump stats card counts (10 tabs,
 *      8 fence types, 21 MCP tools) and add the Images entry to the
 *      tabs walkthrough.
 *
 * Idempotent — skips re-inserting if the Images tab already exists.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/lib/config.js";
import { openDb } from "../src/store/db.js";
import { KnowledgeStore } from "../src/store/knowledge.js";
import { PageStore } from "../src/store/pages.js";
import { ImageStore } from "../src/store/images.js";

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
const images = new ImageStore(db, config.imagesDir);

// ─── 1. Upload sample SVGs ───────────────────────────────────────────
const ARCH_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 280" width="640" height="280">
  <defs>
    <linearGradient id="g1" x1="0" x2="1">
      <stop offset="0%" stop-color="#6366f1"/>
      <stop offset="100%" stop-color="#ec4899"/>
    </linearGradient>
    <linearGradient id="g2" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="#fafaf9"/>
      <stop offset="100%" stop-color="#e5e5e3"/>
    </linearGradient>
  </defs>
  <rect width="640" height="280" fill="url(#g2)"/>
  <rect x="40"  y="100" width="120" height="80" rx="10" fill="url(#g1)"/>
  <text x="100" y="148" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="15" font-weight="700">MCP client</text>
  <rect x="260" y="60"  width="120" height="160" rx="10" fill="#1f2937"/>
  <text x="320" y="135" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="15" font-weight="700">WikiKai</text>
  <text x="320" y="158" text-anchor="middle" fill="#9ca3af" font-family="sans-serif" font-size="11">/mcp · /api · /img</text>
  <rect x="480" y="100" width="120" height="80" rx="10" fill="#10b981"/>
  <text x="540" y="148" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="15" font-weight="700">Web portal</text>
  <line x1="160" y1="140" x2="260" y2="140" stroke="#6366f1" stroke-width="3" marker-end="url(#arr)"/>
  <line x1="380" y1="140" x2="480" y2="140" stroke="#10b981" stroke-width="3" marker-end="url(#arr)"/>
  <defs>
    <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M0,0 L10,5 L0,10 z" fill="#1f2937"/>
    </marker>
  </defs>
  <text x="320" y="40" text-anchor="middle" fill="#374151" font-family="sans-serif" font-size="16" font-weight="700">WikiKai data flow</text>
</svg>
`;
const BADGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 100" width="320" height="100">
  <defs>
    <linearGradient id="bg" x1="0" x2="1">
      <stop offset="0%" stop-color="#4f46e5"/>
      <stop offset="100%" stop-color="#ec4899"/>
    </linearGradient>
  </defs>
  <rect width="320" height="100" rx="14" fill="url(#bg)"/>
  <circle cx="50" cy="50" r="22" fill="#fff" opacity="0.9"/>
  <text x="50" y="56" text-anchor="middle" fill="#4f46e5" font-family="sans-serif" font-size="22" font-weight="900">W</text>
  <text x="90" y="46" fill="#fff" font-family="sans-serif" font-size="20" font-weight="700">WikiKai</text>
  <text x="90" y="70" fill="#fff" font-family="sans-serif" font-size="11" opacity="0.85">Self-hosted knowledge over MCP</text>
</svg>
`;

const arch = images.add(Buffer.from(ARCH_SVG, "utf8"), "image/svg+xml", "WikiKai data flow diagram");
const badge = images.add(Buffer.from(BADGE_SVG, "utf8"), "image/svg+xml", "WikiKai badge");
console.log(`uploaded sample images: ${arch.src}, ${badge.src}`);

// ─── 2. New "Images" tab in &4 ───────────────────────────────────────
const list = pages.list(4);
const existing = list.find((p) => /\bimages?\b/i.test(p.title));
if (existing) {
  console.log(`Images tab already exists (#${existing.id}) — skipping insert`);
} else {
  const TAB_POSITION = 8; // between "7. Raw HTML embed" and "8. Deep links"
  const TAB_TITLE = "8. Images";
  const content = `# Images — ภาพในเนื้อหา

มี 3 วิธีฝังภาพในหน้า:

1. **อัปโหลดเข้า server** ผ่าน MCP tool \`add_image\` → ได้ \`src\` แบบ \`/img/<hash>.<ext>\` → วางใน \`\`\`\`images\`\`\`\` fence
2. ใช้ \`<img src="/img/..." />\` ใน \`\`\`\`html-embed\`\`\`\` (เมื่อต้องการ layout เอง)
3. ใช้ URL ภายนอก (ภาพที่ host อยู่ที่อื่น) — ใส่ใน \`\`\`\`html-embed\`\`\`\` ตรง ๆ

## วิธี A — \`\`\`images\`\`\` fence (gallery / single)

ผลลัพธ์: thumbnail grid + click → lightbox เต็มจอ

\`\`\`images
[
  { "src": "${arch.src}", "alt": "WikiKai data flow", "caption": "Client ↔ server ↔ portal" },
  { "src": "${badge.src}", "alt": "WikiKai badge", "caption": "logo SVG" }
]
\`\`\`

ใส่ 1 ภาพก็ได้ — fence รับทั้ง array และ object เดี่ยว:

\`\`\`images
{ "src": "${arch.src}", "alt": "WikiKai data flow", "caption": "ภาพเดี่ยว — render เต็ม centered max 720px" }
\`\`\`

## วิธี B — \`<img>\` ใน \`html-embed\` (ภาพคู่กับ layout)

เมื่อต้องการให้ภาพอยู่ข้าง text ใน flex / grid layout, ใส่ใน \`<details>\`, หรือกำหนด width/border เอง:

\`\`\`html-embed
<div style="display:flex;gap:14px;align-items:flex-start;padding:14px;background:#f9fafb;border-radius:10px;">
  <img src="${badge.src}" alt="WikiKai badge" style="width:160px;border-radius:8px;flex-shrink:0;" />
  <div>
    <h4 style="margin:0 0 6px;">WikiKai badge</h4>
    <p style="margin:0;color:#374151;font-size:13px;">โลโก้ SVG พร้อม gradient — ภาพจาก server ภายในเดียวกัน (<code>/img/&lt;hash&gt;.svg</code>) ฝังตรง ๆ ใน <code>&lt;img&gt;</code></p>
  </div>
</div>
\`\`\`

## วิธี C — URL ภายนอก

ใส่ URL ของภาพที่ host อยู่ที่อื่น (Wikipedia, GitHub raw, ฯลฯ):

\`\`\`html-embed
<figure style="text-align:center;">
  <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Flag_of_Thailand.svg/640px-Flag_of_Thailand.svg.png"
       alt="ธงไตรรงค์"
       style="width:280px;border:1px solid #e5e7eb;border-radius:6px;" />
  <figcaption style="font-size:12px;color:#6b7280;margin-top:6px;">External — Flag of Thailand (Wikipedia)</figcaption>
</figure>
\`\`\`

## เลือกแบบไหนดี

| เคส | ใช้ |
|---|---|
| Gallery ภาพล้วน ๆ (1+ ภาพ) | \`\`\`\`images\`\`\`\` |
| ภาพคู่ข้อความใน layout เอง | \`\`\`\`html-embed\`\`\`\` + \`<img>\` |
| ต้องการให้ AI \`get_image\` ดูได้ + กู้คืนได้ + cache forever | **upload เข้า server** (\`/img/<hash>\`) |
| Reference outside content / OG image / decorative | URL ภายนอก |

## MCP tools

| Tool | หน้าที่ |
|---|---|
| \`add_image\` | upload bytes (base64) → คืน \`src\` ใช้วางใน fence ได้ทันที |
| \`get_image\` | view ภาพ inline ใน assistant (รองรับเฉพาะ internal \`/img/\` paths) |

## Read flow

\`read_page\` ตอบ \`images_referenced\` ที่รวมทั้ง 2 surface แล้ว — มี field \`via: "images" | "html-embed"\` บอกว่ามาจาก fence ไหน. ไม่ต้อง parse fence เอง.

> ⚠️ Block id \`@N\`: \`\`\`\`images\`\`\`\` fence ได้ \`@N\` ปกติ. ส่วน \`<img>\` ใน \`html-embed\` block ครอบจะมี \`@N\` ของ html-embed อยู่แล้ว — ภาพภายในยึดติด block ของ \`html-embed\`
`;

  const added = pages.add({
    knowledge_id: 4,
    title: TAB_TITLE,
    content,
    position: TAB_POSITION,
    summary: "การฝังภาพ — images fence + html-embed + URL ภายนอก",
    keywords: ["image", "img", "html-embed", "add_image", "get_image"],
  });
  console.log(`added "${TAB_TITLE}" at position ${added.position} as #${added.id}`);

  // Renumber the existing 8/9 tabs in &4 (Deep links, AI/MCP) to 9/10
  for (const p of pages.list(4)) {
    const stripped = p.title.replace(/^\d+\.\s*/, "");
    const next = `${p.position}. ${stripped}`;
    if (next !== p.title) {
      pages.update(p.id, { title: next });
      console.log(`renumbered #${p.id} → "${next}"`);
    }
  }
}

// ─── 3. Rewrite #19 (welcome) — bump stats, add Images to steps ─────
const welcome = pages.get(19);
if (welcome) {
  const NEW_WELCOME = `# 🎓 คู่มือใช้งาน WikiKai

ยินดีต้อนรับ! เอกสารฉบับนี้คือ **ตัวอย่างครบทุกฟีเจอร์** ของ WikiKai — ใช้เป็นเทมเพลตได้ทันที

\`\`\`stats
[
  { "num": "10", "label": "tabs สอน", "color": "purple" },
  { "num": "8", "label": "fence types", "color": "blue" },
  { "num": "21", "label": "MCP tools", "color": "green" },
  { "num": "&# @", "label": "id markers", "color": "amber" }
]
\`\`\`

## WikiKai คืออะไร?

**MCP server + web portal** สำหรับเก็บ knowledge ที่ presentation-ready — รับ markdown ผ่าน MCP จาก client (Claude Code, Claude Desktop, หรือ MCP-aware tool อื่น ๆ) แล้ว render เป็นหน้าเว็บพร้อม diagram + chart + stats + raw HTML + images — share link ให้คนอื่นดูได้ทันที

## โครงสร้างคีย์

| ระดับ | สัญลักษณ์ | เรียกว่า | ตัวอย่าง |
|---|:---:|---|---|
| Container | \`&N\` | knowledge / เอกสาร | \`&4\` = เอกสารนี้ |
| Sub-page | \`#N\` | page / tab | \`#19\` = tab "1. เริ่มต้น" |
| In-page | \`:42\` | line number | \`:42\` = บรรทัด 42 |
| Block | \`@N\` | global rich-block id | \`@108\` = block ใด ๆ ทั้งระบบ |

URL bar: \`/&4/#19:42\` — บอกตำแหน่งครบในตัว

## วิธีอ่านเอกสารนี้

แต่ละ tab ด้านบนคือ **1 หัวข้อสอน**:

\`\`\`steps
[
  { "title": "1. เริ่มต้น", "body": "หน้านี้ — overview + concept" },
  { "title": "2. Markdown พื้นฐาน", "body": "headings, lists, bold, links, tables" },
  { "title": "3. Code & syntax", "body": "code blocks กับ syntax highlight" },
  { "title": "4. Mermaid", "body": "flowchart, sequence, ER, gantt, state" },
  { "title": "5. Charts", "body": "Chart.js: bar, line, doughnut + grid" },
  { "title": "6. Cards", "body": "stats cards + step cards" },
  { "title": "7. Raw HTML", "body": "html-embed fence — escape hatch สำหรับ HTML ดิบ" },
  { "title": "8. Images", "body": "ภาพ: upload → images fence | <img> ใน html-embed | URL ภายนอก" },
  { "title": "9. Deep links", "body": "URL format + symbols" },
  { "title": "10. สำหรับ AI / MCP", "body": "MCP workflow + tools reference" }
]
\`\`\`

## แต่ละ tab ในนี้แสดงแบบไหน?

แต่ละฟีเจอร์จะมี **source code** ของ markdown + **ผลลัพธ์** ที่ render ออกมา เพื่อให้ copy ไปใช้ต่อได้

> 💡 **Tip** — กดปุ่ม \`Edit raw\` มุมขวาบนของแต่ละหน้า เพื่อดู markdown ดิบของ tab ที่กำลังเปิดอยู่
`;
  pages.update(19, { content: NEW_WELCOME, title: "1. เริ่มต้น" });
  console.log("refreshed #19 (welcome) — stats + steps updated");
}

db.close();
console.log("\n✓ &4 updated for images feature");
