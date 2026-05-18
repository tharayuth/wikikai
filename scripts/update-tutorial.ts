/**
 * One-shot script: refresh knowledge &4 (the tutorial) to match the
 * renamed product (WikiKai) and the new html-embed fence.
 *
 *   PATH=$HOME/.nvm/versions/node/v25.6.1/bin:$PATH \
 *     node --import tsx scripts/update-tutorial.ts
 *
 * Safe to re-run — it's idempotent against title text + page lookups
 * (it skips the html-embed page if one already exists at any position).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/lib/config.js";
import { openDb } from "../src/store/db.js";
import { KnowledgeStore } from "../src/store/knowledge.js";
import { PageStore } from "../src/store/pages.js";

// Load .env from project root so WIKIKAI_TOKEN / DATA_DIR etc. apply.
const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.resolve(here, "..", ".env"));
} catch {
  /* ok if missing */
}

const KID = 4;
const HTML_TUTORIAL_TITLE = "7. Raw HTML embed";

const config = loadConfig();
const db = openDb(config.dbPath);
const knowledge = new KnowledgeStore(db);
const pages = new PageStore(db, config.itemsDir);

const meta = knowledge.get(KID);
if (!meta) {
  console.error(`knowledge &${KID} not found`);
  process.exit(1);
}

// ─── 1. Rename knowledge ─────────────────────────────────────────────
const renamed = "📘 คู่มือใช้งาน WikiKai — Tutorial";
if (meta.title !== renamed) {
  knowledge.update(KID, { title: renamed });
  console.log(`renamed &${KID} title → ${renamed}`);
} else {
  console.log(`&${KID} title already up to date`);
}

// ─── 2. Refresh page #19 (welcome / overview) ────────────────────────
const list = pages.list(KID);
const welcome = list.find((p) => p.position === 1);
if (welcome) {
  const newWelcome = `# 🎓 คู่มือใช้งาน WikiKai

ยินดีต้อนรับ! เอกสารฉบับนี้คือ **ตัวอย่างครบทุกฟีเจอร์** ของ WikiKai — ใช้เป็นเทมเพลตได้ทันที

\`\`\`stats
[
  { "num": "9", "label": "tabs สอน", "color": "purple" },
  { "num": "7", "label": "fence types", "color": "blue" },
  { "num": "18", "label": "MCP tools", "color": "green" },
  { "num": "&#", "label": "id markers", "color": "amber" }
]
\`\`\`

## WikiKai คืออะไร?

**MCP server + web portal** สำหรับเก็บ knowledge ที่ presentation-ready — รับ markdown ผ่าน MCP จาก client (Claude Code, Claude Desktop, หรือ MCP-aware tool อื่น ๆ) แล้ว render เป็นหน้าเว็บพร้อม diagram + chart + stats + raw HTML embed — share link ให้คนอื่นดูได้ทันที

## โครงสร้างคีย์

| ระดับ | สัญลักษณ์ | เรียกว่า | ตัวอย่าง |
|---|:---:|---|---|
| Container | \`&N\` | knowledge / เอกสาร | \`&4\` = เอกสารนี้ |
| Sub-page | \`#N\` | page / tab | \`#19\` = tab "1. เริ่มต้น" |
| In-page | \`:42\` | line number | \`:42\` = บรรทัด 42 |

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
  { "title": "8. Deep links", "body": "URL format + symbols" },
  { "title": "9. สำหรับ AI / MCP", "body": "MCP workflow + tools reference" }
]
\`\`\`

## แต่ละ tab ในนี้แสดงแบบไหน?

แต่ละฟีเจอร์จะมี **source code** ของ markdown + **ผลลัพธ์** ที่ render ออกมา เพื่อให้ copy ไปใช้ต่อได้

> 💡 **Tip** — กดปุ่ม \`Edit raw\` มุมขวาบนของแต่ละหน้า เพื่อดู markdown ดิบของ tab ที่กำลังเปิดอยู่
`;

  pages.update(welcome.id, { content: newWelcome, title: "1. เริ่มต้น" });
  console.log(`refreshed page #${welcome.id} (welcome)`);
} else {
  console.warn("welcome page (pos 1) not found");
}

// ─── 3. Insert new "Raw HTML" tab at position 7 (between Cards and Deep links) ──
const existingHtmlPage = list.find((p) => p.title.startsWith("7. Raw HTML"));
if (existingHtmlPage) {
  console.log(`Raw HTML page already exists (#${existingHtmlPage.id}) — skipping insert`);
} else {
  const htmlContent = `# Raw HTML embed

ใช้ \`html-embed\` fence เมื่อ markdown ปกติทำเลย์เอาต์/สไตล์ที่ต้องการไม่ได้ — ฝัง HTML ดิบ ๆ พร้อม inline \`style\`, scoped \`<style>\`, classes, iframes, SVG ฯลฯ

> **Safety:** \`<script>\` ใน fence จะไม่ทำงาน เพราะ React mount ผ่าน \`dangerouslySetInnerHTML\` (innerHTML ไม่ exec script) — เป็น side-effect ที่ดี

## ตัวอย่าง 1 — Alert box ด้วย inline styles

\`\`\`html-embed
<div style="display:flex;gap:12px;padding:14px;background:#fef3c7;border-radius:8px;border:1px solid #f59e0b;">
  <span style="font-size:24px;">⚠️</span>
  <div>
    <strong style="display:block;color:#92400e;">Heads up</strong>
    <span style="color:#78350f;">เนื้อหานี้เป็น HTML ดิบ — style เต็มที่</span>
  </div>
</div>
\`\`\`

## ตัวอย่าง 2 — \`<style>\` block + class scope

\`\`\`html-embed
<style>
  .pricing-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; }
  .pricing-grid > div { padding:18px; border:1px solid #e5e7eb; border-radius:10px; text-align:center; }
  .pricing-grid .price { font-size:28px; font-weight:700; color:#4f46e5; margin:8px 0; }
  .pricing-grid .feat { font-size:12px; color:#6b7280; }
</style>
<div class="pricing-grid">
  <div><h4>Hobby</h4><div class="price">฿0</div><div class="feat">1 project · community</div></div>
  <div><h4>Pro</h4><div class="price">฿299</div><div class="feat">10 projects · priority</div></div>
  <div><h4>Team</h4><div class="price">฿999</div><div class="feat">unlimited · SSO</div></div>
</div>
\`\`\`

## ตัวอย่าง 3 — \`<details>\` collapsible

\`\`\`html-embed
<details>
  <summary><strong>คลิกดู SQL ที่ใช้</strong></summary>
  <pre style="background:#f3f4f6;padding:12px;border-radius:6px;font-size:12px;overflow:auto;">SELECT user_id, COUNT(*) as n
FROM events
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY 1
ORDER BY n DESC
LIMIT 10;</pre>
</details>
\`\`\`

## ตัวอย่าง 4 — SVG inline (สำหรับ logo / badge)

\`\`\`html-embed
<svg viewBox="0 0 240 60" style="width:240px;height:60px;">
  <defs>
    <linearGradient id="g" x1="0" x2="1">
      <stop offset="0%" stop-color="#6366f1"/>
      <stop offset="100%" stop-color="#ec4899"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="240" height="60" rx="8" fill="url(#g)"/>
  <text x="120" y="36" text-anchor="middle" fill="white" font-family="sans-serif" font-size="20" font-weight="700">WikiKai</text>
</svg>
\`\`\`

## เมื่อไหร่ควรใช้

- ทำ layout ที่ markdown ปกติแสดงไม่ได้ (grid, flex)
- embed media (iframe, audio, video)
- ใส่ \`<details>\`, custom collapsibles, banners
- branding (logo SVG, badge)

**อย่าใช้ html-embed เมื่อ:** declarative fence อื่น (\`mermaid\`, \`chart\`, \`stats\`, \`steps\`) ทำได้แล้ว — declarative เก็บง่ายและ AI generate ได้แม่นกว่า
`;

  const added = pages.add({
    knowledge_id: KID,
    title: HTML_TUTORIAL_TITLE,
    content: htmlContent,
    position: 7,
    summary: "html-embed fence ตัวอย่างครบ — escape hatch สำหรับ raw HTML",
    keywords: ["html", "embed", "raw", "iframe", "svg"],
  });
  console.log(`added new page #${added.id} at position ${added.position}`);
}

// ─── 4. Refresh page #26 (MCP / AI workflow) — bump tool count + rename ──
const mcpPage = list.find((p) => /MCP\s*Workflow|สำหรับ AI/i.test(p.title));
if (mcpPage) {
  const cur = pages.get(mcpPage.id);
  if (cur && cur.content.includes("AI Knowledge Portal")) {
    const next = cur.content.replace(
      /AI Knowledge Portal/g,
      "WikiKai",
    );
    pages.update(mcpPage.id, { content: next });
    console.log(`refreshed page #${mcpPage.id} (MCP workflow)`);
  } else {
    console.log(`page #${mcpPage?.id} already clean`);
  }
}

db.close();
console.log("\n✓ knowledge &4 refreshed");
