/**
 * Convert the "เมื่อไหร่ใช้ html-embed" decision table in &4 #43 from a
 * plain markdown table into an html-embed block. Eats own dogfood + gets
 * an @N id so the table can be referenced.
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

const cur = pages.get(43);
if (!cur) {
  console.error("page #43 not found");
  process.exit(1);
}

const OLD = `| ต้องการ | ใช้ |
|---|---|
| ตาราง 2-4 column ธรรมดา | markdown table |
| **ตารางที่มีสีพื้นแถว / col-span / sticky header** | **\`html-embed\`** |
| KPI ตัวเลขเรียง 4-6 ค่า | \`stats\` |
| **การ์ดออกแบบเอง (gradient, asymmetric grid)** | **\`html-embed\`** |
| flowchart / ER / sequence | \`mermaid\` |
| กราฟ data | \`chart\` / \`chart-grid\` |
| ขั้นตอน 3-6 step | \`steps\` |
| **Embed YouTube / Google Maps / Codepen** | **\`html-embed\` + iframe** |
| **Logo / badge / Icon เอง** | **\`html-embed\` + inline SVG** |`;

// Server will inject {@N} for this new html-embed automatically.
const NEW = `\`\`\`html-embed
<style>
  .decision-tbl { width:100%; border-collapse:collapse; font-size:13px; }
  .decision-tbl th { background:#1f2937; color:#fff; padding:8px 12px; text-align:left; font-weight:600; }
  .decision-tbl td { padding:7px 12px; border-bottom:1px solid #e5e7eb; vertical-align:top; }
  .decision-tbl tr.pick td { background:#eef0ff; }
  .decision-tbl tr.pick td:last-child { font-weight:700; color:#4f46e5; }
  .decision-tbl code { background:#f3f4f6; padding:1px 6px; border-radius:3px; font-size:12px; }
</style>
<table class="decision-tbl">
  <thead>
    <tr><th style="width:55%;">ต้องการ</th><th>ใช้</th></tr>
  </thead>
  <tbody>
    <tr>          <td>ตาราง 2-4 column ธรรมดา</td>                          <td>markdown table</td></tr>
    <tr class="pick"><td>ตารางที่มีสีพื้นแถว / col-span / sticky header</td><td><code>html-embed</code></td></tr>
    <tr>          <td>KPI ตัวเลขเรียง 4-6 ค่า</td>                          <td><code>stats</code></td></tr>
    <tr class="pick"><td>การ์ดออกแบบเอง (gradient, asymmetric grid)</td>     <td><code>html-embed</code></td></tr>
    <tr>          <td>flowchart / ER / sequence</td>                        <td><code>mermaid</code></td></tr>
    <tr>          <td>กราฟ data</td>                                       <td><code>chart</code> / <code>chart-grid</code></td></tr>
    <tr>          <td>ขั้นตอน 3-6 step</td>                                <td><code>steps</code></td></tr>
    <tr class="pick"><td>Embed YouTube / Google Maps / Codepen</td>         <td><code>html-embed</code> + iframe</td></tr>
    <tr class="pick"><td>Logo / badge / Icon เอง</td>                       <td><code>html-embed</code> + inline SVG</td></tr>
  </tbody>
</table>
\`\`\``;

if (!cur.content.includes(OLD)) {
  console.error("decision table not found — content may have drifted");
  process.exit(1);
}
const next = cur.content.replace(OLD, NEW);
pages.update(43, { content: next });
console.log("✓ converted decision table in #43 to html-embed");
db.close();
