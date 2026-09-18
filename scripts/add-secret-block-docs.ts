/**
 * One-shot: document the ```secret credential block.
 *   - &4 tutorial: new tab "15. เก็บ credential" + overview counts / steps on #19
 *                  + a tools table on #26
 *   - &3 showcase: a demo secret on "7. สรุป" (#18)
 *
 *   node --import tsx scripts/add-secret-block-docs.ts
 *
 * Demo keys are printed in the docs on purpose — they guard nothing real.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/lib/config.js";
import { formatSecretFence, sealSecret } from "../src/lib/secret.js";
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

// ── &3 showcase: a demo credential on the summary tab ──
const SHOWCASE_HEADING = "## 🔐 บัญชีสำหรับดึงข้อมูลดิบ (ตัวอย่าง secret block)";
const showcasePage = pages.get(18);
if (!showcasePage) {
  console.log("#18: missing — skipped");
} else if (showcasePage.content.includes(SHOWCASE_HEADING)) {
  console.log("#18: already has the secret showcase");
} else {
  const env = await sealSecret(
    "host: stats.example.test\nuser: stat-reader\npass: Thailand-2024!",
    "thailand",
    { label: "บัญชีอ่านข้อมูลดิบ (demo)", hint: "key คือชื่อประเทศนี้เป็นภาษาอังกฤษ ตัวพิมพ์เล็ก" },
  );
  const section = `
${SHOWCASE_HEADING}

ข้อมูลเข้าระบบเก็บไว้คู่เอกสารได้โดยไม่ต้องเขียนรหัสลงหน้าตรง ๆ — AI เข้ารหัสด้วย \`seal_secret\` แล้ววางเป็น block \`\`\`secret กดปุ่มด้านล่างแล้วใส่ key **thailand** เพื่อดู (เป็นบัญชีสมมติ)

${formatSecretFence(env)}

หน้านี้เก็บแค่ ciphertext — ดู **Edit raw** จะเห็นว่าไม่มีรหัสผ่านอยู่ในต้นฉบับเลย
`;
  pages.update(18, { content: `${showcasePage.content.replace(/\s+$/u, "")}\n${section}` });
  console.log("#18: added the secret showcase");
}

// ── &4 tutorial: new tab ──
const TUTORIAL_KID = 4;
const TAB_TITLE = "15. เก็บ credential";
const existing = pages.list(TUTORIAL_KID).find((p) => p.title === TAB_TITLE);
if (existing) {
  console.log(`#${existing.id}: secret tab already exists`);
} else {
  const demo = await sealSecret(
    "user: demo\npass: correct-horse-battery-staple\nnote: ใช้กับ demo.example.test เท่านั้น",
    "wikikai",
    { label: "รหัส demo", hint: "key คือชื่อโปรเจกต์นี้ ตัวพิมพ์เล็ก" },
  );
  const tabContent = `# 15. เก็บ credential (\`\`\`secret)

รหัสผ่าน token หรือ key file ที่ควรอยู่คู่เอกสาร (runbook, คู่มือ deploy, บัญชีทดสอบ) เก็บได้เลย **แบบเข้ารหัส** —
หน้าเก็บแค่ ciphertext จึงไม่มีรหัสจริงโผล่ใน \`read_page\`, search, revision หรือ export
ผู้อ่านกดปุ่ม 🔒 ใส่ key แล้วถอดรหัส**ในเบราว์เซอร์ของตัวเอง** ส่วน AI ถอดผ่าน MCP ได้เมื่อมี key

\`\`\`stats
[
  { "num": "AES-256", "label": "GCM — ตรวจ key ผิด/ข้อมูลถูกแก้ได้", "color": "purple" },
  { "num": "600k", "label": "PBKDF2-SHA256 iterations", "color": "blue" },
  { "num": "browser", "label": "ถอดรหัสฝั่งผู้อ่าน key ไม่ออกจากเครื่อง", "color": "green" },
  { "num": "2", "label": "MCP tools: seal / reveal", "color": "amber" }
]
\`\`\`

## ลองกดดู

key ของ block นี้คือ **wikikai** (บัญชีสมมติ ไม่ได้ใช้จริง)

${formatSecretFence(demo)}

ใส่ key ผิดจะขึ้น *Wrong key* ทันที ไม่มีทางได้ข้อความมั่ว ๆ ออกมา — เพราะ GCM ตรวจสอบความถูกต้องก่อนคืนผล

## วิธีใช้ (สำหรับ AI / MCP)

\`\`\`steps
[
  { "title": "ขอ key จาก user", "body": "ถ้า user ไม่ได้ให้ key มา ให้ถาม — **ห้ามคิด key เอง** หรือจะไม่ส่ง \`key\` เพื่อใช้ \`WIKIKAI_SECRET_KEY\` ที่ตั้งไว้บน server ก็ได้ (ถ้าไม่ได้ตั้ง tool จะ error)" },
  { "title": "seal_secret", "body": "\`seal_secret({ text, label?, hint?, key? })\` คืน \`fence\` พร้อมวาง. \`label\` บอกว่าเป็นรหัสของอะไร, \`hint\` เตือนว่าใช้ key ไหน — ทั้งคู่อ่านได้บนปุ่ม ห้ามใส่ค่าจริง" },
  { "title": "วาง fence ลงหน้า", "body": "ใช้ add_page / append_page / edit_section ตามปกติ — block ได้ \`{@N}\` เหมือน block อื่น" },
  { "title": "reveal_secret เมื่อต้องใช้", "body": "user ขอรหัส หรือ AI ต้อง ssh/เรียก API: \`reveal_secret({ block_id })\` หรือ \`{ page_id, label? | index? }\` + \`key\`. ทุกครั้งลง activity log (ไม่บันทึกข้อความ) และเคารพสิทธิ์ view ของ project" }
]
\`\`\`

## Source ของ block ด้านบน

\`\`\`md
\`\`\`secret
{ "v": 1, "label": "รหัส demo", "hint": "key คือ…", "iter": 600000, "salt": "<base64>", "iv": "<base64>", "ct": "<base64>" }
\`\`\`
\`\`\`

| เรื่อง | พฤติกรรม |
|---|---|
| อยู่ในหน้าเป็นอะไร | JSON envelope: \`salt\` + \`iv\` สุ่มใหม่ทุกครั้ง, \`ct\` คือ ciphertext — ไม่มีส่วนไหนเดาข้อความเดิมได้ |
| ถอดที่ไหน | ปกติในเบราว์เซอร์ (WebCrypto) — ถ้าเปิดผ่าน http ธรรมดาที่ไม่มี WebCrypto จะส่งให้ server ถอดแทน |
| key ผิด / ถูกแก้ | GCM ตรวจจับ → error ชัดเจน |
| หลาย secret ใน block เดียว | body เป็น array ได้ → ปุ่มเรียงกัน |
| \`WIKIKAI_SECRET_KEY\` | key สำรองฝั่ง server สำหรับ MCP เท่านั้น — ใครมี MCP token ก็ถอด block ที่ seal ด้วย key นี้ได้ ตั้งเมื่อยอมรับได้ |
| block id | ได้ \`{@N}\` → \`get_block\` คืน \`kind: "secret"\` (เห็นแค่ envelope) |
`;
  const added = pages.add({
    knowledge_id: TUTORIAL_KID,
    title: TAB_TITLE,
    content: tabContent,
    summary: "เก็บรหัสผ่าน/token ในเอกสารแบบเข้ารหัส — seal_secret → block ```secret ปุ่ม 🔒 ใส่ key ถอดในเบราว์เซอร์, AI ใช้ reveal_secret",
    keywords: ["secret", "credential", "password", "รหัสผ่าน", "เข้ารหัส", "seal_secret", "reveal_secret"],
  });
  console.log(`#${added.id}: added tab 15 at position ${added.position}`);
}

// ── #19 overview counts + steps ──
const overview = pages.get(19);
if (!overview) {
  console.log("#19: missing — skipped");
} else if (overview.content.includes("15. เก็บ credential")) {
  console.log("#19: already lists tab 15");
} else {
  let next = overview.content
    .replace('{ "num": "14", "label": "tabs สอน", "color": "purple" }', '{ "num": "15", "label": "tabs สอน", "color": "purple" }')
    .replace('{ "num": "10", "label": "fence types", "color": "blue" }', '{ "num": "11", "label": "fence types", "color": "blue" }')
    .replace('{ "num": "39", "label": "MCP tools", "color": "green" }', '{ "num": "41", "label": "MCP tools", "color": "green" }');
  const stepAnchor =
    '{ "title": "14. แนบไฟล์", "body": "add_file → block ```file แสดงชื่อ ขนาด ชนิด คำอธิบาย + ปุ่ม Download; ไฟล์ถูกลบเองเมื่อไม่มีหน้าไหนอ้างถึง" }';
  if (!next.includes(stepAnchor)) throw new Error("#19: step anchor not found");
  next = next.replace(
    stepAnchor,
    `${stepAnchor},\n  { "title": "15. เก็บ credential", "body": "seal_secret → block \`\`\`secret ปุ่ม 🔒 ใส่ key ถอดในเบราว์เซอร์; AI ใช้ reveal_secret เมื่อต้องใช้รหัส" }`,
  );
  pages.update(19, { content: next });
  console.log("#19: bumped counts (15 tabs / 11 fences / 41 tools) + added step");
}

// ── #26 MCP workflow: tools table ──
const mcpPage = pages.get(26);
const MCP_MARKER = "### Credentials (secret)";
if (!mcpPage) {
  console.log("#26: missing — skipped");
} else if (mcpPage.content.includes(MCP_MARKER)) {
  console.log("#26: already has the secret tools table");
} else {
  const anchor = '{ "num": "2", "label": "Search + Example", "color": "green" }';
  let next = mcpPage.content;
  if (next.includes(anchor)) {
    next = next.replace(anchor, `${anchor},\n  { "num": "2", "label": "Secret tools", "color": "red" }`);
  }
  const tableAnchor = /(\| `get_example` \|[^\n]*\n\n\{@413\}\n)/;
  if (!tableAnchor.test(next)) throw new Error("#26: search table anchor not found");
  next = next.replace(
    tableAnchor,
    `$1
${MCP_MARKER}

| Tool | หน้าที่ |
|---|---|
| \`seal_secret\` | เข้ารหัส credential — \`{ text, label?, hint?, key? }\` → \`{ fence, label, key_source }\` วางเป็น block \`\`\`secret; ไม่ส่ง key = ใช้ \`WIKIKAI_SECRET_KEY\` ของ server ไม่มีทั้งคู่ → ถาม user |
| \`reveal_secret\` | ถอดรหัส — \`{ block_id }\` หรือ \`{ page_id, label? \\| index? }\` + \`key?\` → \`{ text, label, hint, … }\`; key ผิด → error, หลาย block ไม่ระบุ → error พร้อมรายชื่อ, ลง activity log ทุกครั้ง |
`,
  );
  pages.update(26, { content: next });
  console.log("#26: added the secret tools table");
}
