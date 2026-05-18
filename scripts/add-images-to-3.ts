/**
 * Add an image showcase to the Custom HTML tab (&3 #44) so the
 * Thailand example doc demonstrates the new images fence + <img> in
 * html-embed + external-URL paths in a thematic context (Thai
 * landmarks / flag).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/lib/config.js";
import { openDb } from "../src/store/db.js";
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
const pages = new PageStore(db, config.itemsDir);
const images = new ImageStore(db, config.imagesDir);

// Upload three small Thai-themed SVGs into the image store so the
// page references real internal /img/ paths.
const FLAG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200" width="300" height="200">
  <rect x="0" y="0"   width="300" height="33"  fill="#ED1C24"/>
  <rect x="0" y="33"  width="300" height="33"  fill="#ffffff"/>
  <rect x="0" y="66"  width="300" height="68"  fill="#241D4F"/>
  <rect x="0" y="134" width="300" height="33"  fill="#ffffff"/>
  <rect x="0" y="167" width="300" height="33"  fill="#ED1C24"/>
</svg>
`;
const SEAL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <defs>
    <radialGradient id="rg" cx="0.5" cy="0.5" r="0.6">
      <stop offset="0%" stop-color="#fef3c7"/>
      <stop offset="100%" stop-color="#f59e0b"/>
    </radialGradient>
  </defs>
  <circle cx="100" cy="100" r="92" fill="url(#rg)" stroke="#92400e" stroke-width="4"/>
  <text x="100" y="76" text-anchor="middle" fill="#7c2d12" font-family="serif" font-size="16" font-weight="700">ราชอาณาจักรไทย</text>
  <text x="100" y="118" text-anchor="middle" fill="#7c2d12" font-family="serif" font-size="28" font-weight="900">TH</text>
  <text x="100" y="148" text-anchor="middle" fill="#92400e" font-family="serif" font-size="13">Kingdom of Thailand</text>
</svg>
`;
const MAP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 320" width="240" height="320">
  <rect width="240" height="320" fill="#dbeafe"/>
  <path d="M120,30 L150,55 L155,90 L130,110 L140,140 L155,170 L150,200 L160,225 L150,250 L155,275 L140,300 L120,295 L100,280 L95,250 L100,225 L85,200 L95,170 L80,140 L90,110 L75,80 L95,55 Z"
        fill="#10b981" stroke="#047857" stroke-width="2"/>
  <circle cx="135" cy="120" r="4" fill="#dc2626"/>
  <text x="142" y="124" font-family="sans-serif" font-size="10" fill="#1f2937">Bangkok</text>
  <text x="120" y="20" text-anchor="middle" fill="#1f2937" font-family="sans-serif" font-size="14" font-weight="700">Thailand</text>
</svg>
`;

const flag = images.add(Buffer.from(FLAG_SVG), "image/svg+xml", "ธงไตรรงค์");
const seal = images.add(Buffer.from(SEAL_SVG), "image/svg+xml", "ตราราชอาณาจักรไทย (สมมุติ)");
const map = images.add(Buffer.from(MAP_SVG), "image/svg+xml", "Thailand outline (illustrative)");
console.log(`uploaded: ${flag.src}, ${seal.src}, ${map.src}`);

const cur = pages.get(44);
if (!cur) {
  console.error("&3 #44 not found");
  process.exit(1);
}

if (cur.content.includes("Images — ภาพในเอกสาร")) {
  console.log("images section already present in &3 #44 — skipping");
  db.close();
  process.exit(0);
}

const APPENDED = `

## Images — ภาพในเอกสาร

### Gallery (\`\`\`\`images\`\`\`\` fence)

\`\`\`images
[
  { "src": "${flag.src}", "alt": "ธงไตรรงค์", "caption": "ธงชาติไทย" },
  { "src": "${seal.src}", "alt": "ตราราชอาณาจักรไทย", "caption": "ตราประจำชาติ (ภาพประกอบ)" },
  { "src": "${map.src}", "alt": "แผนที่ประเทศไทย", "caption": "Outline แบบสไตล์ไลซ์" }
]
\`\`\`

### ภาพคู่กับข้อความ (\`<img>\` ใน \`html-embed\`)

\`\`\`html-embed
<div style="display:flex;gap:18px;align-items:flex-start;padding:14px;background:#fffbeb;border-radius:10px;border:1px solid #f59e0b;">
  <img src="${flag.src}" alt="ธงชาติไทย" style="width:140px;border:1px solid #d4d4d2;border-radius:4px;flex-shrink:0;" />
  <div>
    <h4 style="margin:0 0 6px;color:#92400e;">ไตรรงค์ (Thong Trairong)</h4>
    <p style="margin:0;color:#78350f;font-size:13px;line-height:1.6;">
      ธงชาติไทยใช้สามสีหลัก คือ <b>แดง · ขาว · น้ำเงิน</b> สัดส่วน
      <code>1 : 1 : 2 : 1 : 1</code>. ประกาศใช้ครั้งแรกในรัชสมัย ร. 6
      เมื่อปี <b>พ.ศ. 2460</b> แทนธงช้างเดิม.
    </p>
  </div>
</div>
\`\`\`

### URL ภายนอก — ภาพจาก Wikipedia

ใช้ตรง ๆ ใน \`html-embed\` ได้เลย:

\`\`\`html-embed
<figure style="text-align:center;margin:0;">
  <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/0/03/Wat_Phra_Kaew_-_Bangkok.jpg/640px-Wat_Phra_Kaew_-_Bangkok.jpg"
       alt="วัดพระแก้ว กรุงเทพฯ"
       style="width:100%;max-width:480px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);" />
  <figcaption style="font-size:12px;color:#6b7280;margin-top:8px;">วัดพระศรีรัตนศาสดาราม (วัดพระแก้ว) — Wikipedia (external URL)</figcaption>
</figure>
\`\`\`

> **ความต่าง:** ภาพ <code>/img/&lt;hash&gt;.&lt;ext&gt;</code> ที่ upload เข้า server (3 อันแรก) จะ \`get_image\` ดูได้ใน assistant + อยู่ใน \`read_page\` → \`images_referenced\`. URL ภายนอก (วัดพระแก้ว) แสดงในเว็บได้ปกติ แต่ \`get_image\` fetch ไม่ได้ + ไม่อยู่ใน \`images_referenced\`
`;

const next = cur.content.trimEnd() + APPENDED;
pages.update(44, { content: next });
console.log("appended images section to &3 #44");
db.close();
