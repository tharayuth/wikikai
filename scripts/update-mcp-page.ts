/**
 * Refresh &4 #26 (MCP workflow doc) to cover the @N block-id system,
 * the new get_block tool, and updated tool count (18 → 19).
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

const cur = pages.get(26);
if (!cur) {
  console.error("page #26 not found");
  process.exit(1);
}

let next = cur.content;

// 1. Bump tool count + add Block group
next = next.replace(
  /\{ "num": "2", "label": "Search \+ Example", "color": "green" \}\n\]/,
  `{ "num": "1", "label": "Block lookup", "color": "cyan" },
  { "num": "2", "label": "Search + Example", "color": "green" }
]`,
);

// 2. Add get_block row to Search + Helper table
next = next.replace(
  /\| `search` \| FTS5 ค้นข้าม content\/title\/keywords — คืน `\{ kid, pid, line, snippet, url \}` \|\n\| `get_example` /,
  "| `search` | FTS5 ค้นข้าม content/title/keywords — คืน `{ kid, pid, line, snippet, url }` |\n" +
    "| `get_block` | ดึง rich block ด้วย `@N` id ใน 1 call — คืน `{ kind, source, inner, line_start, line_end, page_id, knowledge_id, url }` |\n" +
    "| `get_example` ",
);

// 3. Add @N section before "Best practices" — only if not already present
const blockSectionMarker = "## Block ids (`@N`) — อ้างถึง rich block";
if (!next.includes(blockSectionMarker)) {
  const insertBefore = "## Best practices สำหรับ AI";
  const blockSection = `${blockSectionMarker}

ทุก rich block (mermaid / chart / chart-grid / stats / steps / html-embed) ที่ AI สร้างผ่าน \`add_page\` / \`edit_*\` จะได้ **id ระดับ global \`@N\` อัตโนมัติ** — server stamp ลง source เป็น \`\`\`\`mermaid {@123}\`\`\`\`. ผู้ใช้พูด "อัพเดต @47" แล้ว AI ตอบสนองได้ทันที.

### Flow แนะนำเมื่อ user อ้าง \`@N\`

\`\`\`steps {@99999}
[
  { "title": "1. get_block({ id })", "body": "1 call ได้ \`{ kind, source, inner, line_start, line_end, page_id, knowledge_id, ... }\` — รู้ตำแหน่ง fence ทันที ไม่ต้อง FTS หรือ parse เอง" },
  { "title": "2. read_page (line_start, line_end)", "body": "อ่าน range เดียวกันอีกครั้งเพื่อเอา **hash** ใหม่ — ใช้เป็น \`expected_hash\` กัน race" },
  { "title": "3. edit_lines (...new_text, expected_hash)", "body": "เขียนทับ fence. **อย่าลืม keep \`{@N}\` annotation ใน new_text** — ถ้าลบทิ้ง server จะ alloc id ใหม่ block เก่าหายจากระบบอ้างอิง" }
]
\`\`\`

### หลักการ \`@N\`

| คุณสมบัติ | รายละเอียด |
|---|---|
| Global | counter เดียวทั้งระบบ (\`block_seq\`) — \`@1\` \`@57\` \`@99\` อาจอยู่คนละ knowledge |
| ไม่ reuse | ลบ block แล้ว id ไม่ถูกใช้ซ้ำ |
| ไม่ renumber | เพิ่ม/ลบ block อื่นไม่กระทบ id เดิม |
| ติด source | เก็บใน fence info \`\`\`\`lang {@N}\`\`\`\` → \`read_page\` เห็น |
| Backfill อัตโนมัติ | block ที่ AI สร้างจาก \`add_page\` ได้ id โดยไม่ต้องใส่เอง |

> ⚠️ **ตาราง markdown ปกติ** (\`| col | col |\`) ไม่ใช่ fence → **ไม่มี \`@N\`**. ถ้าผู้ใช้ต้องการอ้างตารางด้วย \`@N\` ให้เขียนเป็น \`<table>\` ใน \`html-embed\` fence แทน (จะกลายเป็น rich block ได้ id อัตโนมัติ)

`;
  next = next.replace(insertBefore, blockSection + insertBefore);
}

if (next === cur.content) {
  console.log("page #26 already up to date");
} else {
  pages.update(26, { content: next });
  console.log("refreshed &4 #26 (MCP doc + @N section)");
}

db.close();
