/**
 * Replace the plain markdown table in &9 #63 with an HTML-embed grid
 * of decorated cards — one per block kind, each with an icon, accent
 * color, description, and example prompt.
 *
 *   PATH=$HOME/.nvm/versions/node/v25.6.1/bin:$PATH \
 *     node --import tsx scripts/restyle-features-grid.ts
 *
 * Idempotent — bails when the new section header is already present.
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
const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const pages = new PageStore(db, cfg.itemsDir);

const PAGE_ID = 63;
const MARKER = "<!-- features-grid v1 -->";

const cur = pages.get(PAGE_ID);
if (!cur) {
  console.error(`page #${PAGE_ID} not found`);
  process.exit(1);
}
if (cur.content.includes(MARKER)) {
  console.log(`page #${PAGE_ID}: already restyled — nothing to do`);
  db.close();
  process.exit(0);
}

interface Feature {
  icon: string;
  name: string;
  desc: string;
  example: string;
  accent: string; // gradient stops
  bg: string;
  border: string;
  iconBg: string;
  text: string;
}

const FEATURES: Feature[] = [
  {
    icon: "📝",
    name: "Markdown ปกติ",
    desc: "ข้อความ · หัวข้อ · รายการ · ตาราง · ลิงก์",
    example: "เขียน FAQ 5 ข้อ",
    accent: "linear-gradient(135deg,#f8fafc,#e2e8f0)",
    bg: "#ffffff",
    border: "#cbd5e1",
    iconBg: "#f1f5f9",
    text: "#1e293b",
  },
  {
    icon: "💻",
    name: "Code block",
    desc: "โค้ดพร้อม syntax highlight 30+ ภาษา",
    example: "ใส่ตัวอย่าง python function",
    accent: "linear-gradient(135deg,#0f172a,#334155)",
    bg: "#f1f5f9",
    border: "#475569",
    iconBg: "#0f172a",
    text: "#0f172a",
  },
  {
    icon: "🔀",
    name: "Mermaid",
    desc: "Flowchart · Sequence · ER · State · Mindmap · Pie",
    example: "วาด flow การ login",
    accent: "linear-gradient(135deg,#a855f7,#7c3aed)",
    bg: "#faf5ff",
    border: "#c4b5fd",
    iconBg: "#f3e8ff",
    text: "#5b21b6",
  },
  {
    icon: "📈",
    name: "Chart.js",
    desc: "กราฟ bar / line / doughnut / pie แบบ interactive",
    example: "ทำกราฟยอดขาย 12 เดือน",
    accent: "linear-gradient(135deg,#10b981,#059669)",
    bg: "#ecfdf5",
    border: "#86efac",
    iconBg: "#d1fae5",
    text: "#065f46",
  },
  {
    icon: "🎯",
    name: "Stats card",
    desc: "กล่องตัวเลขสรุป (KPI) — สีและเลขใหญ่",
    example: "สรุปยอดเป็นการ์ด 4 กล่อง",
    accent: "linear-gradient(135deg,#f59e0b,#d97706)",
    bg: "#fffbeb",
    border: "#fcd34d",
    iconBg: "#fef3c7",
    text: "#92400e",
  },
  {
    icon: "🪜",
    name: "Step card",
    desc: "การ์ดขั้นตอนเรียงลำดับ — เลขในวงกลม",
    example: "ทำขั้นตอน setup เป็นการ์ด",
    accent: "linear-gradient(135deg,#3b82f6,#1d4ed8)",
    bg: "#eff6ff",
    border: "#93c5fd",
    iconBg: "#dbeafe",
    text: "#1e3a8a",
  },
  {
    icon: "✅",
    name: "Checklist",
    desc: "Todo list ที่กดติ๊กได้จริง + progress bar",
    example: "ทำ checklist เตรียม launch",
    accent: "linear-gradient(135deg,#06b6d4,#0891b2)",
    bg: "#ecfeff",
    border: "#67e8f9",
    iconBg: "#cffafe",
    text: "#155e75",
  },
  {
    icon: "🖼",
    name: "Image / Gallery",
    desc: "ภาพเดี่ยว · ชุดภาพ click-to-zoom · ในตาราง · ในรายการ",
    example: "เอาภาพหน้าจอเหล่านี้ใส่",
    accent: "linear-gradient(135deg,#ec4899,#be185d)",
    bg: "#fdf2f8",
    border: "#f9a8d4",
    iconBg: "#fce7f3",
    text: "#9d174d",
  },
  {
    icon: "🎨",
    name: "HTML embed",
    desc: "HTML ดิบ — layout พิเศษ · gradient · SVG · details",
    example: "ทำกล่องสีไล่เฉดด้วย CSS",
    accent: "linear-gradient(135deg,#6366f1,#4338ca)",
    bg: "#eef2ff",
    border: "#a5b4fc",
    iconBg: "#e0e7ff",
    text: "#3730a3",
  },
];

const cards = FEATURES.map(
  (f) => `
  <div style="background:${f.bg};border:1px solid ${f.border};border-radius:12px;padding:14px 16px 16px;display:flex;flex-direction:column;gap:8px;box-shadow:0 1px 3px rgba(0,0,0,.04),0 4px 12px rgba(0,0,0,.03);position:relative;overflow:hidden;">
    <div style="position:absolute;top:0;left:0;right:0;height:3px;background:${f.accent};"></div>
    <div style="display:flex;align-items:center;gap:10px;">
      <div style="width:38px;height:38px;background:${f.iconBg};border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">${f.icon}</div>
      <div style="font-size:14px;font-weight:700;color:${f.text};line-height:1.3;">${f.name}</div>
    </div>
    <div style="font-size:12px;color:#475569;line-height:1.5;min-height:36px;">${f.desc}</div>
    <div style="background:rgba(255,255,255,.7);border:1px dashed ${f.border};border-radius:6px;padding:6px 10px;font-size:11.5px;color:${f.text};font-style:italic;">
      <span style="opacity:.55;font-style:normal;">บอก AI: </span>&ldquo;${f.example}&rdquo;
    </div>
  </div>`,
).join("");

// MARKER lives INSIDE the fence so it stays as a real HTML comment
// (invisible) instead of being escaped to literal text by markdown-it
// (the renderer is configured with html: false at the markdown level).
const grid = `\`\`\`html-embed
${MARKER}
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin:8px 0;">${cards}
</div>
\`\`\``;

// Replace the old table + its heading; keep everything before "## เนื้อหา"
// and everything after "## เครื่องมือ navigation".
const startIdx = cur.content.indexOf("## เนื้อหาที่ใส่ได้");
const endIdx = cur.content.indexOf("## เครื่องมือ navigation");
if (startIdx < 0 || endIdx < 0 || endIdx <= startIdx) {
  console.error("could not locate the section markers in #63");
  process.exit(1);
}

const before = cur.content.slice(0, startIdx);
const after = cur.content.slice(endIdx);
const next =
  before +
  "## เนื้อหาที่ใส่ได้\n\n" +
  grid +
  "\n\n" +
  after;

pages.update(PAGE_ID, { content: next });
console.log(`restyled &9 #${PAGE_ID} — features grid (HTML embed)`);
db.close();
