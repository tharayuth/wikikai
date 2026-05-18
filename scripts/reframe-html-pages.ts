/**
 * Reframe the html-embed tutorial pages to position the fence as a
 * first-class tool for flexible content (tables, layouts, ...) rather
 * than a last-resort escape hatch.
 *
 *   PATH=$HOME/.nvm/versions/node/v25.6.1/bin:$PATH \
 *     ./node_modules/.bin/tsx scripts/reframe-html-pages.ts
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

// ─── &4 / #43 — tutorial "Raw HTML embed" page ─────────────────────
const PAGE_4_43 = `# Raw HTML embed — เนื้อหายืดหยุ่น

\`html-embed\` คือ fence ระดับเดียวกับ \`mermaid\` / \`chart\` / \`stats\` / \`steps\` — ใช้ได้อิสระ ไม่ใช่ของสำรอง. เหมาะกับเคสที่ต้องการ **อิสระเต็มที่กับสไตล์และเลย์เอาต์** เช่น ตารางที่ตกแต่งเอง, การ์ด, gradient, iframe, SVG ดิบ

> **Safety:** \`<script>\` ไม่ทำงาน (mount ผ่าน innerHTML — script tag inert) — interactivity ของ HTML อย่างอื่น (\`<details>\`, hover, transition) ใช้ได้ปกติ

## เมื่อไหร่ใช้ \`html-embed\`

| ต้องการ | ใช้ |
|---|---|
| ตาราง 2-4 column ธรรมดา | markdown table |
| **ตารางที่มีสีพื้นแถว / col-span / sticky header** | **\`html-embed\`** |
| KPI ตัวเลขเรียง 4-6 ค่า | \`stats\` |
| **การ์ดออกแบบเอง (gradient, asymmetric grid)** | **\`html-embed\`** |
| flowchart / ER / sequence | \`mermaid\` |
| กราฟ data | \`chart\` / \`chart-grid\` |
| ขั้นตอน 3-6 step | \`steps\` |
| **Embed YouTube / Google Maps / Codepen** | **\`html-embed\` + iframe** |
| **Logo / badge / Icon เอง** | **\`html-embed\` + inline SVG** |

## ตัวอย่าง 1 — Alert box ออกแบบเอง

\`\`\`html-embed
<div style="display:flex;gap:12px;padding:14px;background:#fef3c7;border-radius:8px;border:1px solid #f59e0b;">
  <span style="font-size:24px;">⚠️</span>
  <div>
    <strong style="display:block;color:#92400e;">Heads up</strong>
    <span style="color:#78350f;">เนื้อหานี้เป็น HTML ดิบ — style เต็มที่</span>
  </div>
</div>
\`\`\`

## ตัวอย่าง 2 — ตารางขั้นสูง (สีแถว, sticky header)

\`\`\`html-embed
<style>
  .rank-table { width:100%; border-collapse:collapse; font-size:13px; }
  .rank-table th { background:#1f2937; color:#fff; padding:8px 12px; text-align:left; }
  .rank-table td { padding:7px 12px; border-bottom:1px solid #e5e7eb; }
  .rank-table tr.gold td   { background:#fef3c7; }
  .rank-table tr.silver td { background:#f1f5f9; }
  .rank-table tr.bronze td { background:#fef2f2; }
  .rank-table td.center { text-align:center; font-weight:700; }
</style>
<table class="rank-table">
  <thead>
    <tr><th style="width:60px;text-align:center;">#</th><th>ชื่อ</th><th>คะแนน</th></tr>
  </thead>
  <tbody>
    <tr class="gold">  <td class="center">🥇 1</td><td>Alice</td><td>98</td></tr>
    <tr class="silver"><td class="center">🥈 2</td><td>Bob</td><td>92</td></tr>
    <tr class="bronze"><td class="center">🥉 3</td><td>Charlie</td><td>87</td></tr>
    <tr>               <td class="center">4</td><td>Dave</td><td>78</td></tr>
  </tbody>
</table>
\`\`\`

## ตัวอย่าง 3 — Pricing grid

\`\`\`html-embed
<style>
  .pricing-card { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; }
  .pricing-card > div { padding:18px; border:1px solid #e5e7eb; border-radius:10px; text-align:center; }
  .pricing-card .price { font-size:28px; font-weight:700; color:#4f46e5; margin:8px 0; }
  .pricing-card .feat { font-size:12px; color:#6b7280; }
</style>
<div class="pricing-card">
  <div><h4>Hobby</h4><div class="price">฿0</div><div class="feat">1 project · community</div></div>
  <div><h4>Pro</h4><div class="price">฿299</div><div class="feat">10 projects · priority</div></div>
  <div><h4>Team</h4><div class="price">฿999</div><div class="feat">unlimited · SSO</div></div>
</div>
\`\`\`

## ตัวอย่าง 4 — \`<details>\` collapsible

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

## ตัวอย่าง 5 — SVG inline (logo)

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

## Tip

ใช้ **scoped class** (เช่น \`.my-table\`, \`.pricing-card\`) ใน \`<style>\` เพื่อไม่ให้ชน CSS ของ portal — ใช้ชื่อ class ที่เฉพาะเจาะจง หรือ wrap ใน parent class ของตัวเอง
`;

pages.update(43, { content: PAGE_4_43, title: "7. Raw HTML embed" });
console.log("refreshed &4 #43");

// ─── &3 / #44 — Thailand "Custom HTML" page ────────────────────────
const PAGE_3_44 = `# Custom HTML — เลย์เอาต์อิสระ

\`html-embed\` คือ fence ระดับเดียวกับ \`chart\` / \`stats\` — ใช้สร้างเนื้อหา **ที่ต้องการความยืดหยุ่นสูง** เช่น ตารางตกแต่งเอง, การ์ดออกแบบเอง, SVG, iframe, \`<details>\` — ใช้ได้อิสระไม่ใช่ของสำรอง

## ธงชาติไทย — SVG inline

\`\`\`html-embed
<div style="display:flex;gap:18px;align-items:center;padding:14px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;">
  <svg viewBox="0 0 300 200" style="width:120px;height:80px;border:1px solid #d4d4d2;border-radius:4px;">
    <rect x="0" y="0"   width="300" height="33"  fill="#ED1C24"/>
    <rect x="0" y="33"  width="300" height="33"  fill="#ffffff"/>
    <rect x="0" y="66"  width="300" height="68"  fill="#241D4F"/>
    <rect x="0" y="134" width="300" height="33"  fill="#ffffff"/>
    <rect x="0" y="167" width="300" height="33"  fill="#ED1C24"/>
  </svg>
  <div>
    <div style="font-size:18px;font-weight:700;color:#1f2937;">ไตรรงค์ (Thong Trairong)</div>
    <div style="font-size:12px;color:#6b7280;margin-top:4px;">แดง · ขาว · น้ำเงิน · ขาว · แดง — สัดส่วน 1:1:2:1:1 (พ.ศ. 2460)</div>
  </div>
</div>
\`\`\`

## การ์ดสรุปแบบ custom — gradient + responsive grid

\`\`\`html-embed
<style>
  .th-card-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:12px; margin-top:8px; }
  .th-card { padding:14px; border-radius:10px; color:#fff; }
  .th-card .big { font-size:24px; font-weight:700; line-height:1.1; }
  .th-card .lbl { font-size:11px; opacity:.85; margin-top:6px; text-transform:uppercase; letter-spacing:.6px; }
  .c-red    { background:linear-gradient(135deg,#ef4444,#b91c1c); }
  .c-blue   { background:linear-gradient(135deg,#3b82f6,#1d4ed8); }
  .c-green  { background:linear-gradient(135deg,#10b981,#047857); }
  .c-amber  { background:linear-gradient(135deg,#f59e0b,#b45309); }
</style>
<div class="th-card-grid">
  <div class="th-card c-red"><div class="big">71.6M</div><div class="lbl">ประชากร</div></div>
  <div class="th-card c-blue"><div class="big">513,120</div><div class="lbl">พื้นที่ (ตร.กม.)</div></div>
  <div class="th-card c-green"><div class="big">$548B</div><div class="lbl">GDP 2023</div></div>
  <div class="th-card c-amber"><div class="big">35.5M</div><div class="lbl">นักท่องเที่ยว 2024</div></div>
</div>
\`\`\`

## ตารางตกแต่งเอง — สีพื้นแถว, สีแยก column

ตัวอย่างเปรียบเทียบไทยกับเพื่อนบ้านอาเซียน — ทำด้วย markdown table ปกติได้ลำบาก (สีพื้นเฉพาะแถว ไทย, font weight ต่างกัน) แต่ \`html-embed\` ทำได้ง่าย:

\`\`\`html-embed
<style>
  .asean-table { width:100%; border-collapse:collapse; font-size:13px; }
  .asean-table th { background:#4f46e5; color:#fff; padding:8px 12px; text-align:left; }
  .asean-table th.num { text-align:right; }
  .asean-table td { padding:7px 12px; border-bottom:1px solid #e5e7eb; }
  .asean-table td.num { text-align:right; font-variant-numeric:tabular-nums; }
  .asean-table tr.th td { background:#fffbeb; font-weight:700; color:#92400e; }
</style>
<table class="asean-table">
  <thead>
    <tr><th>ประเทศ</th><th class="num">ประชากร</th><th class="num">GDP (USD B)</th><th class="num">GDP/หัว</th></tr>
  </thead>
  <tbody>
    <tr>          <td>🇮🇩 อินโดนีเซีย</td><td class="num">279M</td><td class="num">1,371</td><td class="num">$4,910</td></tr>
    <tr class="th"><td>🇹🇭 ไทย</td>      <td class="num">71.6M</td><td class="num">548</td><td class="num">$7,650</td></tr>
    <tr>          <td>🇲🇾 มาเลเซีย</td>   <td class="num">34M</td><td class="num">399</td><td class="num">$11,730</td></tr>
    <tr>          <td>🇵🇭 ฟิลิปปินส์</td> <td class="num">117M</td><td class="num">437</td><td class="num">$3,730</td></tr>
    <tr>          <td>🇻🇳 เวียดนาม</td>   <td class="num">100M</td><td class="num">430</td><td class="num">$4,300</td></tr>
  </tbody>
</table>
\`\`\`

## \`<details>\` — ซ่อนข้อมูลที่ไม่ได้ใช้บ่อย

\`\`\`html-embed
<details style="border:1px solid #e5e7eb;border-radius:8px;padding:10px 14px;background:#f9fafb;">
  <summary style="cursor:pointer;font-weight:600;">📊 รายชื่อ 5 จังหวัดที่มีประชากรมากที่สุด</summary>
  <ol style="margin:10px 0 0 22px;font-size:13px;line-height:1.7;">
    <li>กรุงเทพมหานคร — 5.5M (เขตเมือง 10.7M รวมปริมณฑล)</li>
    <li>นครราชสีมา — 2.6M</li>
    <li>อุบลราชธานี — 1.9M</li>
    <li>ขอนแก่น — 1.8M</li>
    <li>เชียงใหม่ — 1.8M</li>
  </ol>
</details>
\`\`\`

## สรุป

\`html-embed\` เปิดทางให้เลย์เอาต์/สไตล์ทำได้แทบทุกอย่างที่หน้าเว็บปกติทำได้. ใช้คู่กับ \`stats\` / \`chart\` / \`mermaid\` ตามเคส — declarative fence สะดวกกว่าเมื่อเพียงพอ, \`html-embed\` ตอบโจทย์เมื่อต้องการการตกแต่งเฉพาะ
`;

pages.update(44, { content: PAGE_3_44, title: "8. Custom HTML" });
console.log("refreshed &3 #44");

db.close();
console.log("✓ done");
