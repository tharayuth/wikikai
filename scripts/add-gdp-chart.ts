/**
 * Insert a 10-year GDP line chart into &3 #12 (Thailand Overview).
 * Placed right before the "สัดส่วน GDP 2023" section so trend (chart)
 * leads composition (bar).
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

const cur = pages.get(12);
if (!cur) {
  console.error("page #12 not found");
  process.exit(1);
}

const marker = "## สัดส่วน GDP 2023";
if (!cur.content.includes(marker)) {
  console.error(`marker '${marker}' not found in page #12`);
  process.exit(1);
}

const chartBlock = `## GDP ย้อนหลัง 10 ปี (USD พันล้าน)

\`\`\`chart
{
  "type": "line",
  "data": {
    "labels": ["2014","2015","2016","2017","2018","2019","2020","2021","2022","2023"],
    "datasets": [
      {
        "label": "GDP (USD B, ราคาตลาด)",
        "data": [407, 401, 413, 456, 507, 544, 500, 506, 495, 514],
        "borderColor": "#4f46e5",
        "backgroundColor": "rgba(99,102,241,0.18)",
        "tension": 0.35,
        "fill": true,
        "pointBackgroundColor": "#4f46e5",
        "pointRadius": 4,
        "pointHoverRadius": 6
      }
    ]
  },
  "options": {
    "plugins": {
      "legend": { "display": true, "position": "bottom" },
      "tooltip": { "callbacks": {} }
    },
    "scales": {
      "y": {
        "title": { "display": true, "text": "USD พันล้าน" },
        "beginAtZero": false
      },
      "x": {
        "title": { "display": true, "text": "ปี" }
      }
    }
  }
}
\`\`\`

แนวโน้มหลัก: เติบโตต่อเนื่องจนถึง 2019 ($544B จุดสูงสุดก่อนโควิด), หล่นลง 2020 (-8% จากการล็อกดาวน์), ฟื้นช้ากว่าเพื่อนบ้านเพราะพึ่งพาท่องเที่ยวสูง, แตะ $548B ปี 2024 (ตามตัวเลขประมาณการ ธปท.)

`;

const next = cur.content.replace(marker, chartBlock + marker);
pages.update(12, { content: next });
console.log("refreshed &3 #12 — GDP 10-year chart inserted");
db.close();
