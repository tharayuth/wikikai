/**
 * Expand the "เหมาะกับใคร" section in &9 #62 with 4 concrete use-case
 * cards (dev / research / writing / education) on top of the original
 * three-line list, rendered as a styled html-embed grid.
 *
 *   PATH=$HOME/.nvm/versions/node/v25.6.1/bin:$PATH \
 *     node --import tsx scripts/expand-audience-62.ts
 *
 * Idempotent — bails when the v1 marker is already present.
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

const PAGE_ID = 62;
const MARKER = "<!-- audience-grid v1 -->";

const cur = pages.get(PAGE_ID);
if (!cur) {
  console.error(`page #${PAGE_ID} not found`);
  process.exit(1);
}
if (cur.content.includes(MARKER)) {
  console.log(`page #${PAGE_ID}: already expanded — nothing to do`);
  db.close();
  process.exit(0);
}

interface UseCase {
  icon: string;
  title: string;
  blurb: string;
  bullets: string[];
  promptLabel: string;
  prompt: string;
  accent: string;
  bg: string;
  border: string;
  iconBg: string;
  text: string;
}

const CASES: UseCase[] = [
  {
    icon: "🛠",
    title: "งานพัฒนา / วิเคราะห์ระบบ",
    blurb: "ให้ AI กางระบบใหญ่ ๆ ออก แล้วทำเป็นเอกสารหลายหน้าที่อ่านง่าย",
    bullets: [
      "วิเคราะห์ codebase → architecture · data flow · API reference",
      "คู่มือใช้งาน + technical report ฉบับพร้อมส่ง",
      "Postmortem · RFC · design doc — เก็บค้นภายหลังได้",
      "Onboarding doc สำหรับสมาชิกใหม่ในทีม",
    ],
    promptLabel: "ตัวอย่าง prompt",
    prompt:
      "วิเคราะห์ระบบ payment ของเราแล้วทำเอกสาร 5 หน้า: overview, components, data flow, จุดที่ควรปรับ, roadmap",
    accent: "linear-gradient(135deg,#6366f1,#4338ca)",
    bg: "#eef2ff",
    border: "#a5b4fc",
    iconBg: "#e0e7ff",
    text: "#3730a3",
  },
  {
    icon: "🔬",
    title: "งานวิจัย / ศึกษาเชิงลึก",
    blurb: "อยากรู้เรื่องใหม่ — AI สรุปให้ + เก็บใน knowledge เดียวค้นได้",
    bullets: [
      "สรุป paper · บทความ · spec ยาว ๆ เป็นหัวข้อย่อย",
      "เปรียบเทียบทางเลือก (เช่น tech stack) เป็นตาราง / matrix",
      "Mindmap แตกหัวข้อให้เห็นภาพรวม",
      "Citation + ลิงก์อ้างอิงรวมอยู่ที่เดียว",
    ],
    promptLabel: "ตัวอย่าง prompt",
    prompt:
      "ศึกษา Vector DB ทั้ง 5 — Qdrant / Weaviate / Milvus / Chroma / Pinecone — เปรียบเทียบ feature, ราคา, scale, ภาษา binding และแนะนำว่าควรใช้ตัวไหนกับเคสไหน",
    accent: "linear-gradient(135deg,#06b6d4,#0891b2)",
    bg: "#ecfeff",
    border: "#67e8f9",
    iconBg: "#cffafe",
    text: "#155e75",
  },
  {
    icon: "✍️",
    title: "งานเขียน / นิยาย",
    blurb: "ให้ AI ร่าง — แล้วเข้ามาแต่งต่อ. ทุกการแก้เก็บเป็น revision",
    bullets: [
      "ร่างพล็อต · ตัวละคร · ฉาก — แต่ละบทเป็น page แยกได้",
      "แก้ inline ใน editor — ไม่กลัวเขียนทับของดี เพราะมี version history",
      "ใส่ภาพประกอบบรรยากาศได้ทุกหน้า",
      "ทำสารบัญด้วย step / mindmap ให้คนอ่านนำทาง",
    ],
    promptLabel: "ตัวอย่าง prompt",
    prompt:
      "ร่างนิยายแฟนตาซีสั้น 6 บท ตัวเอกเป็นเด็กชายในเมืองลอยฟ้า — บทละ ~500 คำ, แต่ละบทเป็นหน้าแยก, ใส่ภาพประกอบบรรยากาศตอนหัวบท",
    accent: "linear-gradient(135deg,#ec4899,#be185d)",
    bg: "#fdf2f8",
    border: "#f9a8d4",
    iconBg: "#fce7f3",
    text: "#9d174d",
  },
  {
    icon: "🎓",
    title: "การศึกษา / Course design",
    blurb: "ออกแบบหลักสูตรหรือคอร์สเรียนเต็มชุดให้ AI ทำให้ครบในที่เดียว",
    bullets: [
      "AI สร้างหลักสูตร — overview + lessons + lab + quiz",
      "แต่ละ lesson เป็น page → student เปิดเรียงตามได้",
      "ใส่ diagram, code sample, checklist exercise ได้ครบ",
      "แชร์ลิงก์ให้ class เปิดดูได้ทันที",
    ],
    promptLabel: "ตัวอย่าง prompt",
    prompt:
      "สร้าง course สอน Docker สำหรับ junior dev 6 บท: intro, run container, build image, compose, volume, networking — แต่ละบทเป็นหน้าแยก มี code sample + checklist สรุปสิ่งที่ต้องทำได้",
    accent: "linear-gradient(135deg,#10b981,#059669)",
    bg: "#ecfdf5",
    border: "#86efac",
    iconBg: "#d1fae5",
    text: "#065f46",
  },
];

const cards = CASES.map(
  (c) => `
  <div style="background:${c.bg};border:1px solid ${c.border};border-radius:12px;padding:0;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.04),0 4px 12px rgba(0,0,0,.03);">
    <div style="height:4px;background:${c.accent};"></div>
    <div style="padding:14px 16px 16px;display:flex;flex-direction:column;gap:10px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <div style="width:44px;height:44px;background:${c.iconBg};border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">${c.icon}</div>
        <div>
          <div style="font-size:15px;font-weight:700;color:${c.text};line-height:1.3;">${c.title}</div>
          <div style="font-size:11.5px;color:#64748b;margin-top:2px;line-height:1.4;">${c.blurb}</div>
        </div>
      </div>
      <ul style="margin:0;padding-left:18px;font-size:12.5px;color:#1e293b;line-height:1.6;">
        ${c.bullets.map((b) => `<li>${b}</li>`).join("")}
      </ul>
      <div style="background:rgba(255,255,255,.7);border:1px dashed ${c.border};border-radius:6px;padding:8px 10px;font-size:11.5px;color:${c.text};">
        <div style="font-size:9.5px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.6px;margin-bottom:3px;">${c.promptLabel}</div>
        <div style="font-style:italic;color:#1e293b;line-height:1.5;">&ldquo;${c.prompt}&rdquo;</div>
      </div>
    </div>
  </div>`,
).join("");

// MARKER lives INSIDE the fence so it stays as a real HTML comment
// (invisible) instead of being escaped to literal text by markdown-it
// (the renderer is configured with html: false at the markdown level).
const grid = `\`\`\`html-embed
${MARKER}
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;margin:8px 0;">${cards}
</div>
\`\`\`

> 💡 **และคนทั่วไปที่:** ใช้ AI ช่วยทำงานอยู่แล้วและอยากให้ผลลัพธ์ไม่หายในแชต · ทีมที่อยากแชร์ความรู้กันแบบมีโครงสร้าง (ไม่ใช่แค่ Slack/LINE thread) · ผู้สอน/พรีเซ้นเตอร์ที่อยากได้เอกสารเชิงพรีเซ้นต์ — แต่ไม่อยากเรียนใช้ slide tool`;

const startIdx = cur.content.indexOf("## เหมาะกับใคร");
const endIdx = cur.content.indexOf("## โครงสร้างเอกสาร");
if (startIdx < 0 || endIdx < 0 || endIdx <= startIdx) {
  console.error("could not locate the section markers in #62");
  process.exit(1);
}

const before = cur.content.slice(0, startIdx);
const after = cur.content.slice(endIdx);
const next = before + "## เหมาะกับใคร\n\n" + grid + "\n\n" + after;

pages.update(PAGE_ID, { content: next });
console.log(`expanded &9 #${PAGE_ID} — audience grid (4 use cases)`);
db.close();
