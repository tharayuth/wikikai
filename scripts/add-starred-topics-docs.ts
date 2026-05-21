/**
 * One-shot: document the starred-topic UI affordance in the bundled
 * tutorial (&4) and the Thailand showcase (&3).
 *
 *   node --import tsx scripts/add-starred-topics-docs.ts
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

function appendOnce(pageId: number, marker: string, section: string): void {
  const page = pages.get(pageId);
  if (!page) {
    console.log(`#${pageId}: missing — skipped`);
    return;
  }
  if (page.content.includes(marker)) {
    console.log(`#${pageId}: already has starred-topic docs`);
    return;
  }
  const next = `${page.content.replace(/\s+$/u, "")}\n\n${section.trim()}\n`;
  pages.update(pageId, { content: next });
  console.log(`#${pageId}: appended starred-topic docs`);
}

appendOnce(
  19,
  "<!-- starred-topic-docs -->",
  `
<!-- starred-topic-docs -->
## Starred topics

Use the star button to keep high-value knowledge close at hand:

- Click the star on any topic row in the sidebar to mark it important.
- Click the star next to the active topic title, before the info button, to toggle the current knowledge.
- Click the star beside the sidebar filter input to show starred topics only.

Stars are stored in this browser's localStorage, so they are personal quick filters and do not change shared knowledge metadata.
`,
);

appendOnce(
  18,
  "<!-- thailand-starred-showcase -->",
  `
<!-- thailand-starred-showcase -->
## Starred topic example

When the Thailand statistics showcase grows, star the pages or related knowledge that are most useful for recurring briefings:

| Use case | Suggested action |
|---|---|
| Weekly executive briefing | Star the top-level Thailand statistics knowledge so it stays visible in the sidebar |
| GDP or population deep dive | Use the sidebar text filter first, then star the matching topic for quick return |
| Preparing a public presentation | Turn on the star filter to keep only approved, presentation-ready references in view |

This keeps exploratory notes searchable while making the curated briefing set easy to scan.
`,
);

db.close();
