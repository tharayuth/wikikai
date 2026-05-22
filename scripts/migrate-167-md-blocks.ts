/**
 * One-shot migration: convert page #167's three plain ``` fences
 * (ASCII column-flow diagram, card template, connection diagram) to
 * `md` rich-block fences with descriptive captions.
 *
 * Two-step (so caption travels with auto-allocated @N):
 *   1. Rewrite each bare opening `\`\`\`` → `\`\`\`md` immediately
 *      after a known heading. Save via pages.update — injectBlockIds
 *      sees `md` in the RICH set and appends `{@N}` to each line.
 *   2. Read the page back; for each of the 3 new openings (in source
 *      order, mapped to the 3 captions), call pages.setBlockCaption
 *      to rewrite `{@N}` → `{@N "caption"}`.
 *
 * Idempotent: if every caption is already present in the file, exit
 * without touching anything.
 *
 * Run with:
 *   PATH=$HOME/.nvm/versions/node/v25.6.1/bin:$PATH \
 *     npx tsx scripts/migrate-167-md-blocks.ts
 */
import { loadConfig } from "../src/lib/config.js";
import { openDb } from "../src/store/db.js";
import { KnowledgeStore } from "../src/store/knowledge.js";
import { PageStore } from "../src/store/pages.js";

const PAGE_ID = 167;

interface Replacement {
  /** Heading marker — the line immediately above the fence opening. */
  heading: string;
  /** Whether the heading is followed by a blank line before the fence.
   *  167.md uses both styles (heading\n\n``` and heading\n```). */
  blankBefore: boolean;
  caption: string;
}

const REPLACEMENTS: Replacement[] = [
  {
    heading: "## คอลัมน์ปัจจุบัน (10 columns)",
    blankBefore: true,
    caption:
      "Bug board columns — Triage → Backlog → In Progress → Review → Passed/Failed flow",
  },
  {
    heading: "## Card Template",
    blankBefore: false,
    caption: "Bug card template — required fields + label conventions",
  },
  {
    heading: "## Connection กับ Implementation Board",
    blankBefore: true,
    caption:
      "Bug board ↔ Implementation board link — bug blocks story until verified",
  },
];

function rewriteBareFences(content: string): { next: string; touched: number } {
  let touched = 0;
  let next = content;
  for (const { heading, blankBefore } of REPLACEMENTS) {
    const sep = blankBefore ? "\n\n" : "\n";
    const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(${escapedHeading}${sep})\`\`\`\n`);
    const before = next;
    next = next.replace(pattern, "$1```md\n");
    if (next === before) {
      console.warn(`heading not matched: "${heading}"`);
    } else {
      touched++;
    }
  }
  return { next, touched };
}

function main(): void {
  const cfg = loadConfig();
  const db = openDb(cfg.dbPath);
  new KnowledgeStore(db);
  const pages = new PageStore(db, cfg.itemsDir);

  const page = pages.get(PAGE_ID);
  if (!page) {
    console.error(`page #${PAGE_ID} not found`);
    process.exit(1);
  }

  const captions = REPLACEMENTS.map((r) => r.caption);
  const alreadyMigrated = captions.every((c) => page.content.includes(c));
  if (alreadyMigrated) {
    console.log("page #167: already migrated — nothing to do");
    return;
  }

  // ─── Step 1: bare ``` → ```md (injectBlockIds appends {@N}) ───
  const { next, touched } = rewriteBareFences(page.content);
  if (touched === 0) {
    console.log("page #167: no patterns matched — exiting");
    return;
  }
  if (next !== page.content) {
    pages.update(PAGE_ID, { content: next });
    console.log(`page #167 step 1: rewrote ${touched} fence(s) → \`\`\`md`);
  }

  // ─── Step 2: attach captions to the new {@N} annotations ───
  const reread = pages.get(PAGE_ID);
  if (!reread) {
    console.error("page #167 vanished after step 1 — aborting");
    process.exit(1);
  }
  const lines = reread.content.split("\n");
  // Collect annotated ```md openings in source order. We only attach
  // to fences that still lack a caption (so re-running with one
  // partial pass is safe).
  const newAnnotated: number[] = [];
  for (const line of lines) {
    const m = /^```md\s+\{@(\d+)\}\s*$/.exec(line);
    if (m) newAnnotated.push(Number(m[1]));
  }
  if (newAnnotated.length < REPLACEMENTS.length) {
    console.warn(
      `expected ${REPLACEMENTS.length} bare \`\`\`md {@N} lines, found ${newAnnotated.length}`,
    );
  }
  // Map: first new ```md → first caption, etc.
  const pairs = newAnnotated
    .slice(0, REPLACEMENTS.length)
    .map((id, i) => ({ id, caption: REPLACEMENTS[i].caption }));
  for (const { id, caption } of pairs) {
    pages.setBlockCaption(id, caption);
    console.log(`  attached caption to @${id}: ${caption.slice(0, 60)}…`);
  }

  // Final verification — print every ```md opening in the page.
  const final = pages.get(PAGE_ID);
  if (!final) return;
  const finalLines = final.content.split("\n");
  console.log("\n--- ```md openings after migration ---");
  for (let i = 0; i < finalLines.length; i++) {
    if (finalLines[i].startsWith("```md")) {
      console.log(`  L${i + 1}: ${finalLines[i]}`);
    }
  }
}

main();
