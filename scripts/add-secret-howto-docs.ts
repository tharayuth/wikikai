/**
 * One-shot: add the ```secret credential block to the two public how-to
 * guides (project `wikikai-howto`): Thai &193 and English &194.
 *   - tab 1 "Start here": one bullet in the AI-native list
 *   - tab 5 "Images, files and MCP": a section with a live demo block
 *   - tab 6 "Every block": a row in the block-family table
 *
 *   node --import tsx scripts/add-secret-howto-docs.ts
 *
 * The demo key is printed in the guide on purpose — it guards nothing real.
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

const DEMO_KEY = "howto";

interface Guide {
  kid: number;
  start: number;
  media: number;
  blocks: number;
  startBullet: string;
  startAnchor: string;
  mediaHeading: string;
  mediaAnchor: string;
  mediaSection: (fence: string) => string;
  caption: string;
  blocksRow: string;
  blocksAnchor: string;
  secretText: string;
  label: string;
  hint: string;
}

const guides: Guide[] = [
  {
    kid: 193,
    start: 1018,
    media: 1022,
    blocks: 1023,
    startAnchor: "- **ส่งต่อให้คนอื่นอ่านได้** — แชร์แบบ public หรือให้ผู้อ่านใช้ user + password เฉพาะเอกสาร\n",
    startBullet:
      "- **เก็บข้อมูลลับไว้คู่เอกสารได้** — รหัสผ่านหรือ token เก็บเป็นบล็อกเข้ารหัส ผู้อ่านถอดในเบราว์เซอร์ด้วย key ของตัวเอง และ AI ถอดผ่าน MCP ได้เมื่อคุณให้ key\n",
    mediaHeading: "## เก็บรหัสผ่านไว้กับเอกสารแบบเข้ารหัส",
    mediaAnchor: "## เชื่อมต่อ MCP ครั้งแรก\n",
    mediaSection: (fence) => `## เก็บรหัสผ่านไว้กับเอกสารแบบเข้ารหัส

รหัสผ่าน token หรือ key ที่ต้องใช้คู่กับคู่มือ เช่น บัญชีทดสอบของระบบที่คู่มืออธิบาย เก็บไว้ในหน้าเดียวกันได้โดยไม่ต้องเขียนเป็นข้อความธรรมดา AI เข้ารหัสให้ผ่าน MCP แล้ววางเป็นปุ่ม 🔒 ผู้อ่านกดปุ่ม ใส่ key ของตัวเอง แล้วข้อความจะถูกถอดรหัส**ในเบราว์เซอร์** โดย key ไม่ถูกส่งไปที่ใด

**ลองกดดู:** key ของปุ่มนี้คือ **${DEMO_KEY}** (บัญชีสมมติ ใช้กับตัวอย่างนี้เท่านั้น)

${fence}

> เก็บรหัสผ่านของบัญชีทดสอบนี้ไว้ท้ายคู่มือ WikiKai ของฉันแบบเข้ารหัส ตั้ง label ว่า “บัญชีทดสอบ staging” และใช้ key ที่ฉันจะพิมพ์ให้ในข้อความถัดไป

หน้าเก็บเฉพาะข้อความที่เข้ารหัสแล้ว การค้นหา ประวัติการแก้ไข และการอ่านผ่าน MCP จึงไม่เห็นรหัสจริง เมื่อ AI ต้องใช้รหัสนั้นทำงาน เช่น เรียก API ที่คู่มืออธิบาย AI จะขอ key จากคุณแล้วถอดรหัสผ่าน MCP ได้ ทุกครั้งที่ถอดจะถูกบันทึกในประวัติกิจกรรม ใส่ key ผิดจะได้ข้อความแจ้งเตือน ไม่ใช่ข้อมูลผิด ๆ

`,
    caption: `ตัวอย่างข้อมูลเข้าใช้งานที่เข้ารหัสไว้ — key คือ ${DEMO_KEY}`,
    blocksAnchor: "| File attachment | [ดาวน์โหลด CSV](/&193/#1022) |\n",
    blocksRow: "| Secret (รหัสผ่านเข้ารหัส) | [ปุ่ม 🔒 ในหน้าภาพ ไฟล์ และ MCP](/&193/#1022) |\n",
    secretText: "ระบบ: staging.example.test\nผู้ใช้: demo\nรหัสผ่าน: Try-WikiKai-2026",
    label: "บัญชีทดสอบ staging (ตัวอย่าง)",
    hint: "key อยู่ในข้อความเหนือปุ่มนี้",
  },
  {
    kid: 194,
    start: 1025,
    media: 1029,
    blocks: 1030,
    startAnchor: "- **Share the result with others.** Create a public read-only link, or require a document-specific username and password.\n",
    startBullet:
      "- **Keep secrets with the document.** A password or token is stored as an encrypted block. Readers unlock it in the browser with their own key, and AI can unlock it through MCP when you provide the key.\n",
    mediaHeading: "## Keep a password with the document, encrypted",
    mediaAnchor: "## Connect MCP for the first time\n",
    mediaSection: (fence) => `## Keep a password with the document, encrypted

A password, token or key that belongs with a guide, such as the test account for the system it describes, can live on the same page without ever being written in the clear. AI encrypts it through MCP and places a 🔒 button. A reader clicks the button, types their own key, and the text is decrypted **in the browser**; the key is never sent anywhere.

**Try it:** the key for this button is **${DEMO_KEY}** (a fictional account used only for this example).

${fence}

> Store the password of this test account at the end of my WikiKai guide, encrypted. Label it “staging test account” and use the key I will type in my next message.

The page holds only the encrypted text, so search, revision history and reads through MCP never see the real value. When AI needs that credential for a task, such as calling the API the guide describes, it asks you for the key and decrypts through MCP. Every reveal is recorded in the activity log. A wrong key produces a clear error, not wrong data.

`,
    caption: `An encrypted credential example — the key is ${DEMO_KEY}`,
    blocksAnchor: "| File attachment | [Download the demo CSV](/&194/#1029) |\n",
    blocksRow: "| Secret (encrypted credential) | [The 🔒 button on Images, files and MCP](/&194/#1029) |\n",
    secretText: "host: staging.example.test\nuser: demo\npassword: Try-WikiKai-2026",
    label: "staging test account (example)",
    hint: "the key is written above this button",
  },
];

for (const g of guides) {
  const tag = `&${g.kid}`;
  const start = pages.get(g.start);
  const media = pages.get(g.media);
  const blocks = pages.get(g.blocks);
  if (!start || !media || !blocks) {
    console.log(`${tag}: pages missing — skipped`);
    continue;
  }

  if (start.content.includes(g.startBullet.trim())) {
    console.log(`${tag} #${g.start}: bullet already present`);
  } else if (!start.content.includes(g.startAnchor)) {
    console.log(`${tag} #${g.start}: bullet anchor not found — skipped`);
  } else {
    pages.update(g.start, { content: start.content.replace(g.startAnchor, g.startAnchor + g.startBullet) });
    console.log(`${tag} #${g.start}: bullet added`);
  }

  if (media.content.includes(g.mediaHeading)) {
    console.log(`${tag} #${g.media}: section already present`);
  } else if (!media.content.includes(g.mediaAnchor)) {
    console.log(`${tag} #${g.media}: section anchor not found — skipped`);
  } else {
    const env = await sealSecret(g.secretText, DEMO_KEY, { label: g.label, hint: g.hint });
    const next = media.content.replace(g.mediaAnchor, g.mediaSection(formatSecretFence(env)) + g.mediaAnchor);
    pages.update(g.media, { content: next });
    const stamped = /```secret \{@(\d+)\}/.exec(pages.get(g.media)!.content);
    if (stamped) {
      pages.setBlockCaption(Number(stamped[1]), g.caption);
      console.log(`${tag} #${g.media}: section added, block @${stamped[1]} captioned`);
    } else {
      console.log(`${tag} #${g.media}: section added (no block id stamped?)`);
    }
  }

  if (blocks.content.includes(g.blocksRow.trim())) {
    console.log(`${tag} #${g.blocks}: table row already present`);
  } else if (!blocks.content.includes(g.blocksAnchor)) {
    console.log(`${tag} #${g.blocks}: table anchor not found — skipped`);
  } else {
    pages.update(g.blocks, { content: blocks.content.replace(g.blocksAnchor, g.blocksAnchor + g.blocksRow) });
    console.log(`${tag} #${g.blocks}: table row added`);
  }
}
