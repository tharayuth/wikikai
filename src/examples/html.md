# Raw HTML embed (`html-embed` fence)

ใช้ `html-embed` เมื่อต้องการอิสระเต็มที่กับเลย์เอาต์ — เขียน HTML ดิบ ๆ พร้อมทุก attribute (`style`, `class`, `id`) และ style block ครอบเอง  ใช้ทำได้หลายอย่าง:

- **ตารางขั้นสูง** ที่ markdown ทำลำบาก (สีพื้นแถว, col-span, row-span, sticky header, สี border ต่างกันต่อ column)
- **Layout แบบ flex / grid** — การ์ดเรียง, sidebar, hero section
- **Card style ที่ออกแบบเอง** (gradient, glow, badge ฟลอต)
- **Collapsible** ผ่าน `<details>` / `<summary>`
- **กราฟิก SVG inline** (logo, badge, icon, ธง)
- **Embed media** — `<iframe>` (YouTube, Google Maps), `<video>`, `<audio>`

ทุกอย่างใน fence ถูกใส่ลงใน `<div class="html-embed">…</div>` แบบไม่ sanitize → **คุมสไตล์ได้ทั้งหมด**.

> **Safety note:** `<script>` ใน fence ไม่ทำงาน (ฝั่ง client mount ผ่าน `innerHTML` — script tag inert) — interactivity ของ HTML ใช้ได้ทั้งหมด ยกเว้น JS

## ตัวอย่าง 1 — Alert box ออกแบบเอง

```html-embed
<div style="display:flex;gap:12px;padding:14px;background:#fef3c7;border-radius:8px;border:1px solid #f59e0b;">
  <span style="font-size:24px;">⚠️</span>
  <div>
    <strong style="display:block;color:#92400e;">Heads up</strong>
    <span style="color:#78350f;">เนื้อหานี้เป็น HTML ฝังตรง ๆ — style เต็มที่</span>
  </div>
</div>
```

## ตัวอย่าง 2 — ตารางที่ markdown ทำไม่ได้ (สีแถว, col-span)

```html-embed
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
```

## ตัวอย่าง 3 — Pricing grid ด้วย scoped `<style>`

```html-embed
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
```

## ตัวอย่าง 4 — `<details>` collapsible

```html-embed
<details>
  <summary><strong>คลิกดู SQL ที่ใช้</strong></summary>
  <pre style="background:#f3f4f6;padding:12px;border-radius:6px;font-size:12px;overflow:auto;">SELECT user_id, COUNT(*) as n
FROM events
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY 1
ORDER BY n DESC
LIMIT 10;</pre>
</details>
```

## ตัวอย่าง 5 — iframe (embed YouTube, Google Maps)

```html-embed
<iframe
  src="https://www.youtube.com/embed/dQw4w9WgXcQ"
  width="560" height="315"
  style="border:none;border-radius:8px;max-width:100%;"
  allow="accelerometer; clipboard-write; encrypted-media; gyroscope"
  allowfullscreen></iframe>
```

## ตัวอย่าง 6 — SVG inline (logo / badge)

```html-embed
<svg viewBox="0 0 200 60" style="width:200px;height:60px;">
  <defs>
    <linearGradient id="g" x1="0" x2="1">
      <stop offset="0%" stop-color="#6366f1"/>
      <stop offset="100%" stop-color="#ec4899"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="200" height="60" rx="8" fill="url(#g)"/>
  <text x="100" y="36" text-anchor="middle" fill="white" font-family="sans-serif" font-size="20" font-weight="700">WikiKai</text>
</svg>
```

## เลือกใช้แบบไหนดี

`html-embed` คือเครื่องมือ **first-class** ของ WikiKai เช่นเดียวกับ `chart` / `mermaid` / `stats` / `steps` — ใช้ได้อิสระ ไม่ใช่ของสำรอง.

| เคส | ใช้อะไรดี |
|---|---|
| ตารางธรรมดา (2-4 column, ไม่ต้องสไตล์พิเศษ) | markdown table |
| ตารางที่ต้องการสีพื้นแถว, col-span, sticky header | **`html-embed`** |
| KPI ตัวเลขเรียง (4-6 ค่า, สีตาม semantic) | `stats` |
| การ์ดออกแบบเอง (gradient, layout asymmetric) | **`html-embed`** |
| แผนภาพ / ER / flowchart | `mermaid` |
| กราฟ data series | `chart` / `chart-grid` |
| ขั้นตอน 3-6 ข้อพร้อมเลข | `steps` |
| Embed video / map / external page | **`html-embed` + iframe** |

**Rule of thumb:** ถ้า declarative fence (chart/mermaid/stats/steps) ตอบโจทย์ — ใช้เลย เพราะสั้นและ template ง่าย. ถ้าต้องการเลย์เอาต์เฉพาะหรือสไตล์ที่ไม่อยู่ในชุดนั้น — `html-embed` คือคำตอบ

## ตาราง: ใช้ markdown ปกติเป็นค่าเริ่มต้น

ทั้ง **ตาราง markdown ปกติ** (`| col | col |`) และ rich block อื่น ๆ (mermaid / chart / stats / steps / html-embed) ได้ **block id แบบ global** `@N` ทั้งหมด — server ใส่บรรทัด `{@N}` ใต้ทุกตารางอัตโนมัติตอน save (เว้น 1 บรรทัด). user เรียก "อัพเดต @47" ได้กับตารางด้วย.

แนวทางเลือก:

- **ตารางทั่วไป → markdown table ปกติ** (อ่านง่ายใน source, ใส่ `[ ]`/`[x]` ใน cell ได้, แก้ผ่าน `get_table_row` / `find_table_rows`)
- **ตารางที่ต้อง styling พิเศษ** (gradient header, sticky col, badge, row coloring) → ใช้ `html-embed` กับ `<table>` — เพื่อความยืดหยุ่นของ HTML/CSS ล้วน ๆ ไม่ใช่เพื่อ `@N`
