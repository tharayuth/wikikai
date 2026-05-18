/**
 * Replace the placeholder "ตราประจำชาติ" SVG (allocated as @116 sample)
 * in &3 #44 with the real Garuda emblem of Thailand fetched from
 * Wikimedia Commons. Uploads the real file via ImageStore so the new
 * /img/<hash>.svg is available + get_image-able, then rewrites the
 * page source to point at the new src.
 *
 * The old placeholder image stays on disk + in the images table but
 * becomes unreferenced — content-addressed storage is fine with that.
 */
import fs from "node:fs";
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

const SVG_PATH = "/tmp/garuda.svg";
if (!fs.existsSync(SVG_PATH)) {
  console.error(`expected real Garuda SVG at ${SVG_PATH}`);
  process.exit(1);
}
const bytes = fs.readFileSync(SVG_PATH);

const config = loadConfig();
const db = openDb(config.dbPath);
const pages = new PageStore(db, config.itemsDir);
const images = new ImageStore(db, config.imagesDir);

const newImg = images.add(
  bytes,
  "image/svg+xml",
  "ตราครุฑ — ตราประจำชาติของประเทศไทย",
);
console.log(`uploaded real Garuda → ${newImg.src} (${newImg.size_bytes} bytes)`);

const PAGE_ID = 44;
const cur = pages.get(PAGE_ID);
if (!cur) {
  console.error("&3 #44 not found");
  process.exit(1);
}

// Find the placeholder src — the old fake seal we generated earlier.
// Match any /img/<hash>.svg referenced near the "ตราราชอาณาจักรไทย" alt
// to be safe across re-runs.
const placeholderMatch =
  /"src":\s*"(\/img\/[a-f0-9]{64}\.svg)",\s*"alt":\s*"ตราราชอาณาจักรไทย/.exec(cur.content);
if (!placeholderMatch) {
  console.error("could not locate the placeholder seal src in &3 #44");
  process.exit(1);
}
const oldSrc = placeholderMatch[1];
console.log(`replacing old src ${oldSrc} with ${newImg.src}`);

let next = cur.content
  .replaceAll(oldSrc, newImg.src)
  // Update the caption + alt text to reflect the real artwork.
  .replace(
    `"alt": "ตราราชอาณาจักรไทย", "caption": "ตราประจำชาติ (ภาพประกอบ)"`,
    `"alt": "ตราครุฑ", "caption": "ตราครุฑ — ตราประจำชาติของประเทศไทย"`,
  )
  .replace(/ตราราชอาณาจักรไทย \(สมมุติ\)/g, "ตราครุฑ");

if (next === cur.content) {
  console.error("no edits applied — content already up to date?");
  process.exit(0);
}
pages.update(PAGE_ID, { content: next });
console.log("✓ &3 #44 now points at the real Garuda emblem");
db.close();
