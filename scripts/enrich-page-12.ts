/**
 * Enrich the Overview page (&3 #12) of the Thailand stats doc with
 * html-embed visuals: flag + identity ribbon at top, regional
 * population heatmap mid-page, GDP composition bar at the bottom.
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

const content = `# 🇹🇭 สถิติประเทศไทย 2024 — ภาพรวม

\`\`\`html-embed
<div style="display:flex;gap:18px;align-items:center;padding:16px 18px;border:1px solid #e5e7eb;border-radius:10px;background:linear-gradient(135deg,#fff,#fef9f9);">
  <svg viewBox="0 0 300 200" style="width:140px;height:94px;border:1px solid #d4d4d2;border-radius:4px;flex-shrink:0;">
    <rect x="0" y="0"   width="300" height="33"  fill="#ED1C24"/>
    <rect x="0" y="33"  width="300" height="33"  fill="#ffffff"/>
    <rect x="0" y="66"  width="300" height="68"  fill="#241D4F"/>
    <rect x="0" y="134" width="300" height="33"  fill="#ffffff"/>
    <rect x="0" y="167" width="300" height="33"  fill="#ED1C24"/>
  </svg>
  <div style="min-width:0;">
    <div style="font-size:20px;font-weight:700;color:#1f2937;line-height:1.2;">ราชอาณาจักรไทย</div>
    <div style="font-size:13px;color:#6b7280;">Kingdom of Thailand · 🌏 ใจกลางคาบสมุทรอินโดจีน</div>
    <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;">
      <span style="font-size:11px;background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:10px;font-weight:600;">เมืองหลวง: กรุงเทพฯ</span>
      <span style="font-size:11px;background:#dcfce7;color:#166534;padding:2px 8px;border-radius:10px;font-weight:600;">ภาษา: ไทย</span>
      <span style="font-size:11px;background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:10px;font-weight:600;">UTC+7</span>
      <span style="font-size:11px;background:#ede9fe;color:#5b21b6;padding:2px 8px;border-radius:10px;font-weight:600;">.th</span>
    </div>
  </div>
</div>
\`\`\`

ประเทศไทยตั้งอยู่ในใจกลางคาบสมุทรอินโดจีน เป็นประเทศที่มีเศรษฐกิจขนาดใหญ่อันดับ **2 ของอาเซียน** รองจากอินโดนีเซีย และเป็นศูนย์กลางการค้า การท่องเที่ยว และการผลิตยานยนต์ของภูมิภาค

\`\`\`stats
[
  { "num": "71.6M", "label": "ประชากร (2024)", "color": "blue" },
  { "num": "513,120", "label": "ตร.กม. (พื้นที่)", "color": "green" },
  { "num": "$548B", "label": "GDP USD (2023)", "color": "amber" },
  { "num": "77", "label": "จังหวัด (รวม กทม.)", "color": "purple" },
  { "num": "35.5M", "label": "นักท่องเที่ยว 2024", "color": "cyan" },
  { "num": "78.7", "label": "อายุขัยเฉลี่ย (ปี)", "color": "red" }
]
\`\`\`

## ประชากรราย 6 ภูมิภาค (heatmap)

ขนาดและสีของกล่องแสดงสัดส่วนประชากรของแต่ละภูมิภาค

\`\`\`html-embed
<style>
  .region-heatmap { display:grid; grid-template-columns:repeat(6, 1fr); gap:6px; margin:6px 0; }
  .region-heatmap > div { padding:14px 10px; border-radius:8px; color:#fff; text-align:center; }
  .region-heatmap .name { font-size:12px; font-weight:600; }
  .region-heatmap .pop  { font-size:18px; font-weight:700; margin-top:4px; line-height:1; }
  .region-heatmap .pct  { font-size:10.5px; opacity:.85; margin-top:3px; }
  .h-9 { background:#7c2d12; }
  .h-8 { background:#9a3412; }
  .h-7 { background:#c2410c; }
  .h-6 { background:#ea580c; }
  .h-5 { background:#f59e0b; }
  .h-4 { background:#fbbf24; color:#5a3a00; }
</style>
<div class="region-heatmap">
  <div class="h-9"><div class="name">อีสาน</div><div class="pop">22.1M</div><div class="pct">30.9%</div></div>
  <div class="h-7"><div class="name">กลาง</div><div class="pop">17.4M</div><div class="pct">24.3%</div></div>
  <div class="h-6"><div class="name">เหนือ</div><div class="pop">11.7M</div><div class="pct">16.3%</div></div>
  <div class="h-5"><div class="name">ใต้</div><div class="pop">9.5M</div><div class="pct">13.3%</div></div>
  <div class="h-5"><div class="name">กทม.+ปริมณฑล</div><div class="pop">10.7M</div><div class="pct">14.9%</div></div>
  <div class="h-4"><div class="name">ตะวันออก</div><div class="pop">4.9M</div><div class="pct">6.9%</div></div>
</div>
\`\`\`

## ข้อมูลพื้นฐาน

| รายการ | ค่า |
|---|---|
| ชื่อทางการ | ราชอาณาจักรไทย (Kingdom of Thailand) |
| เมืองหลวง | กรุงเทพมหานคร (~10.7 ล้านคน เขตปริมณฑล) |
| ภาษาราชการ | ไทย |
| สกุลเงิน | บาท (THB) |
| ระบอบการปกครอง | ราชาธิปไตยภายใต้รัฐธรรมนูญ |
| เขตเวลา | UTC+7 (ICT) |
| รหัสประเทศ | TH / THA |
| โดเมน | .th |

## สัดส่วน GDP 2023

\`\`\`html-embed
<style>
  .gdp-bar { display:flex; width:100%; height:34px; border-radius:8px; overflow:hidden; font-size:11px; font-weight:700; color:#fff; }
  .gdp-bar > div { display:flex; align-items:center; justify-content:center; }
  .gdp-bar > div span { padding:0 6px; }
  .gdp-leg { display:flex; flex-wrap:wrap; gap:14px; margin-top:10px; font-size:12px; color:#374151; }
  .gdp-leg .sw { display:inline-block; width:11px; height:11px; border-radius:3px; vertical-align:middle; margin-right:6px; }
</style>
<div class="gdp-bar">
  <div style="flex:56;background:#4f46e5;"><span>บริการ 56%</span></div>
  <div style="flex:32;background:#10b981;"><span>อุตสาหกรรม 32%</span></div>
  <div style="flex:8;background:#f59e0b;"><span>เกษตร 8%</span></div>
  <div style="flex:4;background:#ef4444;"><span>อื่นๆ 4%</span></div>
</div>
<div class="gdp-leg">
  <span><i class="sw" style="background:#4f46e5;"></i>บริการ — ท่องเที่ยว, ค้าปลีก, การเงิน</span>
  <span><i class="sw" style="background:#10b981;"></i>อุตสาหกรรม — ยานยนต์, อิเล็กทรอนิกส์, ปิโตรเคมี</span>
  <span><i class="sw" style="background:#f59e0b;"></i>เกษตร — ข้าว, ยาง, ผลไม้</span>
  <span><i class="sw" style="background:#ef4444;"></i>อื่นๆ — เหมือง, ก่อสร้าง</span>
</div>
\`\`\`

## หัวข้อในเอกสารนี้

แต่ละ tab ด้านบนคือ 1 หัวข้อ:

1. **Overview** — หน้านี้ ภาพรวมตัวเลขสำคัญ
2. **ภูมิศาสตร์** — 6 ภูมิภาค พื้นที่ ประชากร
3. **ประชากร** — โครงสร้างอายุ urban/rural การเติบโต
4. **เศรษฐกิจ** — GDP รายภาคธุรกิจ การส่งออก
5. **การท่องเที่ยว** — จำนวนนักท่องเที่ยว ชาติที่เข้ามามากที่สุด
6. **กระบวนการสำมะโน** — ขั้นตอนการเก็บข้อมูลของ สสช.
7. **สรุปและแหล่งอ้างอิง** — key takeaways + references
8. **Custom HTML** — ตัวอย่าง html-embed เพิ่มเติม

> ข้อมูลในเอกสารนี้รวบรวมจาก สำนักงานสถิติแห่งชาติ (สสช.), ธนาคารโลก (World Bank), การท่องเที่ยวแห่งประเทศไทย (ททท.) และ Bank of Thailand — ตัวเลขเป็นค่าประมาณการที่ใช้กันทั่วไปในสื่อสาธารณะ
`;

pages.update(12, { content });
console.log("refreshed &3 #12");
db.close();
