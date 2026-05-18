/**
 * One-shot script: add an "HTML embed" showcase tab to knowledge &3
 * (Thailand statistics example doc) so the new html-embed fence has a
 * thematic showcase in this corpus too.
 *
 *   PATH=$HOME/.nvm/versions/node/v25.6.1/bin:$PATH \
 *     ./node_modules/.bin/tsx scripts/add-html-tab-to-3.ts
 *
 * Idempotent — skips insertion if an "HTML" tab already exists in &3.
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

const KID = 3;
const list = pages.list(KID);

const existing = list.find((p) => /HTML|html/i.test(p.title));
if (existing) {
  console.log(`HTML tab already exists in &${KID} (#${existing.id}) — skipping`);
  db.close();
  process.exit(0);
}

const nextPos = list.length + 1;
const content = `# Custom HTML — เลย์เอาต์อิสระ

ตัวอย่างการใช้ \`html-embed\` fence สำหรับเนื้อหาที่ markdown ปกติทำไม่ได้ — ใช้กับเอกสารสถิติประเทศไทยเช่นกัน

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

## การ์ดสรุปแบบ custom layout

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

## ตารางเทียบ — ใช้ \`<details>\` ซ่อนรายละเอียด

\`\`\`html-embed
<details style="border:1px solid #e5e7eb;border-radius:8px;padding:10px 14px;background:#f9fafb;">
  <summary style="cursor:pointer;font-weight:600;">🌏 เปรียบเทียบกับเพื่อนบ้านอาเซียน (คลิกเพื่อขยาย)</summary>
  <table style="margin-top:10px;width:100%;font-size:13px;border-collapse:collapse;">
    <thead>
      <tr style="background:#eef0ff;color:#4f46e5;">
        <th style="padding:6px 10px;text-align:left;border-bottom:1px solid #c7d2fe;">ประเทศ</th>
        <th style="padding:6px 10px;text-align:right;border-bottom:1px solid #c7d2fe;">ประชากร</th>
        <th style="padding:6px 10px;text-align:right;border-bottom:1px solid #c7d2fe;">GDP (USD B)</th>
      </tr>
    </thead>
    <tbody>
      <tr><td style="padding:5px 10px;">🇮🇩 อินโดนีเซีย</td><td style="padding:5px 10px;text-align:right;">279M</td><td style="padding:5px 10px;text-align:right;">1,371</td></tr>
      <tr><td style="padding:5px 10px;"><b>🇹🇭 ไทย</b></td><td style="padding:5px 10px;text-align:right;"><b>71.6M</b></td><td style="padding:5px 10px;text-align:right;"><b>548</b></td></tr>
      <tr><td style="padding:5px 10px;">🇲🇾 มาเลเซีย</td><td style="padding:5px 10px;text-align:right;">34M</td><td style="padding:5px 10px;text-align:right;">399</td></tr>
      <tr><td style="padding:5px 10px;">🇵🇭 ฟิลิปปินส์</td><td style="padding:5px 10px;text-align:right;">117M</td><td style="padding:5px 10px;text-align:right;">437</td></tr>
      <tr><td style="padding:5px 10px;">🇻🇳 เวียดนาม</td><td style="padding:5px 10px;text-align:right;">100M</td><td style="padding:5px 10px;text-align:right;">430</td></tr>
    </tbody>
  </table>
</details>
\`\`\`

## เมื่อไหร่ควรใช้ \`html-embed\`

- เลย์เอาต์ที่ \`stats\` / \`steps\` ทำไม่ได้ (custom card style, gradient, asymmetric grid)
- กราฟิก inline (logo / flag SVG)
- เนื้อหายุบ-ขยาย (\`<details>\`)
- embed media (iframe map, video)

ใช้แบบ declarative (\`stats\`, \`chart\`, \`mermaid\`) ก่อนเสมอ — สั้นกว่าและ AI generate ได้แม่นกว่า. \`html-embed\` เป็น **escape hatch** สำหรับเคสที่ declarative ไม่พอ
`;

const added = pages.add({
  knowledge_id: KID,
  title: `${nextPos}. Custom HTML`,
  content,
  position: nextPos,
  summary: "html-embed showcase — Thai flag SVG, gradient cards, <details>",
  keywords: ["html", "embed", "svg", "custom", "ธงชาติ"],
});
console.log(`added page #${added.id} at position ${added.position} to &${KID}`);

db.close();
