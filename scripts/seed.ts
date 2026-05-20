/**
 * Seed a fresh WikiKai install with the bundled English tutorial.
 *
 *   PATH=$HOME/.nvm/versions/node/v25.6.1/bin:$PATH \
 *     node --import tsx scripts/seed.ts
 *
 * Or via npm script:
 *
 *   npm run seed
 *
 * Idempotent: bails when a knowledge with the same title already exists.
 * Aimed at first-time users — a 12-tab walkthrough that shows what
 * every fence type looks like + how to ask AI for each one.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/lib/config.js";
import { openDb } from "../src/store/db.js";
import { KnowledgeStore } from "../src/store/knowledge.js";
import { PageStore } from "../src/store/pages.js";

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.resolve(here, "..", ".env"));
} catch {
  /* ok */
}
const config = loadConfig();
const db = openDb(config.dbPath);
const knowledge = new KnowledgeStore(db);
const pages = new PageStore(db, config.itemsDir);

const TITLE = "📖 WikiKai — User Guide";

const existing = knowledge
  .list({ search: TITLE, limit: 5 })
  .find((k) => k.title === TITLE);
if (existing) {
  console.log(
    `[seed] "${TITLE}" already present at &${existing.id} — nothing to do`,
  );
  db.close();
  process.exit(0);
}

const k = knowledge.add({
  title: TITLE,
  project: "tutorial",
  tags: ["tutorial", "manual", "user-guide", "seed"],
  author: "Tharayuth Kaewma <tharayuth@gmail.com>",
});
const KID = k.id;
console.log(`[seed] created &${KID} "${TITLE}"`);

let position = 0;
const addPage = (title: string, body: string, summary?: string) => {
  position += 1;
  const p = pages.add({
    knowledge_id: KID,
    title,
    content: body,
    position,
    summary,
  });
  console.log(`  + #${p.id} pos ${p.position} · ${title}`);
};

// ─── Page 1: Welcome ─────────────────────────────────────────────
addPage(
  "1. Welcome",
  `# 📖 What is WikiKai?

WikiKai is a **knowledge base your AI assistant can write to**. Talk to Claude Code (or any MCP-aware client) and ask it to remember things, draft documents, build diagrams — the result lives here, searchable, versioned, share-able.

\`\`\`stats
[
  { "num": "1", "label": "One library", "color": "purple" },
  { "num": "🤖", "label": "AI-authored", "color": "blue" },
  { "num": "📊", "label": "Diagrams + charts", "color": "green" },
  { "num": "🔗", "label": "Shareable URLs", "color": "amber" }
]
\`\`\`

## Why bother

- **Nothing gets lost** — every helpful answer you get from an AI normally lives buried in a chat session. WikiKai is one searchable home for the keepers
- **Presentation-ready** — not just text. **Diagrams (Mermaid)**, **charts**, **stat cards**, **interactive checklists**, **image galleries** — open the URL and it looks like a polished doc, not a transcript
- **The AI understands references** — every rich block has a global \`@N\` id. Say "update @47" and the AI knows exactly which block you mean, no re-pasting
- **Version history built-in** — every edit snapshots. Roll back, diff old vs new, prune what you don't need

## Who it's for

\`\`\`html-embed
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;margin:8px 0;">

  <div style="background:#eef2ff;border:1px solid #a5b4fc;border-radius:12px;padding:0;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.04),0 4px 12px rgba(0,0,0,.03);">
    <div style="height:4px;background:linear-gradient(135deg,#6366f1,#4338ca);"></div>
    <div style="padding:14px 16px 16px;display:flex;flex-direction:column;gap:10px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <div style="width:44px;height:44px;background:#e0e7ff;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">🛠</div>
        <div>
          <div style="font-size:15px;font-weight:700;color:#3730a3;line-height:1.3;">Engineering · System analysis</div>
          <div style="font-size:11.5px;color:#64748b;margin-top:2px;line-height:1.4;">Let AI take a codebase apart into readable docs</div>
        </div>
      </div>
      <ul style="margin:0;padding-left:18px;font-size:12.5px;color:#1e293b;line-height:1.6;">
        <li>Architecture · data flow · API reference</li>
        <li>Technical reports and user-facing manuals</li>
        <li>Post-mortems · RFCs · design docs</li>
        <li>Onboarding for new teammates</li>
      </ul>
    </div>
  </div>

  <div style="background:#ecfeff;border:1px solid #67e8f9;border-radius:12px;padding:0;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.04),0 4px 12px rgba(0,0,0,.03);">
    <div style="height:4px;background:linear-gradient(135deg,#06b6d4,#0891b2);"></div>
    <div style="padding:14px 16px 16px;display:flex;flex-direction:column;gap:10px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <div style="width:44px;height:44px;background:#cffafe;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">🔬</div>
        <div>
          <div style="font-size:15px;font-weight:700;color:#155e75;line-height:1.3;">Research · Deep dives</div>
          <div style="font-size:11.5px;color:#64748b;margin-top:2px;line-height:1.4;">AI summarises, you keep it where you can find it again</div>
        </div>
      </div>
      <ul style="margin:0;padding-left:18px;font-size:12.5px;color:#1e293b;line-height:1.6;">
        <li>Summarise papers / specs / long articles</li>
        <li>Compare options as a matrix or table</li>
        <li>Mindmaps to lay out a domain visually</li>
        <li>Citations + sources in one place</li>
      </ul>
    </div>
  </div>

  <div style="background:#fdf2f8;border:1px solid #f9a8d4;border-radius:12px;padding:0;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.04),0 4px 12px rgba(0,0,0,.03);">
    <div style="height:4px;background:linear-gradient(135deg,#ec4899,#be185d);"></div>
    <div style="padding:14px 16px 16px;display:flex;flex-direction:column;gap:10px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <div style="width:44px;height:44px;background:#fce7f3;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">✍️</div>
        <div>
          <div style="font-size:15px;font-weight:700;color:#9d174d;line-height:1.3;">Writing · Fiction</div>
          <div style="font-size:11.5px;color:#64748b;margin-top:2px;line-height:1.4;">AI drafts, you edit. Versions don't get lost</div>
        </div>
      </div>
      <ul style="margin:0;padding-left:18px;font-size:12.5px;color:#1e293b;line-height:1.6;">
        <li>Plot · characters · scenes — chapter per page</li>
        <li>Edit inline; revision history protects past drafts</li>
        <li>Drop in mood illustrations</li>
        <li>Steps + mindmap for outlines</li>
      </ul>
    </div>
  </div>

  <div style="background:#ecfdf5;border:1px solid #86efac;border-radius:12px;padding:0;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.04),0 4px 12px rgba(0,0,0,.03);">
    <div style="height:4px;background:linear-gradient(135deg,#10b981,#059669);"></div>
    <div style="padding:14px 16px 16px;display:flex;flex-direction:column;gap:10px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <div style="width:44px;height:44px;background:#d1fae5;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">🎓</div>
        <div>
          <div style="font-size:15px;font-weight:700;color:#065f46;line-height:1.3;">Education · Course design</div>
          <div style="font-size:11.5px;color:#64748b;margin-top:2px;line-height:1.4;">A whole curriculum drafted and ready to share</div>
        </div>
      </div>
      <ul style="margin:0;padding-left:18px;font-size:12.5px;color:#1e293b;line-height:1.6;">
        <li>Overview + lessons + labs + quizzes</li>
        <li>One lesson per page — students follow tabs</li>
        <li>Diagrams · code samples · checklists per lesson</li>
        <li>Share a URL, the class is in</li>
      </ul>
    </div>
  </div>

</div>
\`\`\`

> 💡 **Also for** anyone already working with an AI who wants results to stop disappearing into the chat backscroll, teams that want a structured place to share knowledge (not just Slack threads), and educators / presenters who want polished docs without learning a slide tool.

## How content is organised

\`\`\`steps
[
  { "title": "Knowledge", "body": "One document (e.g. 'X User Guide', 'Project Y Meeting Notes'). Has a title, optional project group, tags, author" },
  { "title": "Page", "body": "A tab inside a knowledge. Each page is one sub-topic — 'Introduction', 'Installation', 'FAQ'" },
  { "title": "Block", "body": "Inside a page sits regular markdown plus rich blocks (diagrams, charts, cards, checklists, …). Each rich block gets a global \`@N\` id you can hand to the AI" }
]
\`\`\`

> 👉 Click the next tab to see every feature. Or browse other docs in the sidebar — the AI created them the same way you can.`,
  "What WikiKai is · Why use it · Who it's for · How content is organised",
);

// ─── Page 2: Features ─────────────────────────────────────────────
addPage(
  "2. Features",
  `# ✨ Features at a glance

\`\`\`stats
[
  { "num": "9", "label": "Block kinds", "color": "purple" },
  { "num": "∞", "label": "Pages per doc", "color": "blue" },
  { "num": "🌗", "label": "Light / dark theme", "color": "amber" },
  { "num": "🇹🇭", "label": "Full-text · CJK", "color": "green" }
]
\`\`\`

## What you can put on a page

\`\`\`html-embed
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin:8px 0;">

  <div style="background:#ffffff;border:1px solid #cbd5e1;border-radius:12px;padding:14px 16px 16px;display:flex;flex-direction:column;gap:8px;box-shadow:0 1px 3px rgba(0,0,0,.04),0 4px 12px rgba(0,0,0,.03);position:relative;overflow:hidden;">
    <div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(135deg,#f8fafc,#e2e8f0);"></div>
    <div style="display:flex;align-items:center;gap:10px;"><div style="width:38px;height:38px;background:#f1f5f9;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">📝</div><div style="font-size:14px;font-weight:700;color:#1e293b;line-height:1.3;">Markdown</div></div>
    <div style="font-size:12px;color:#475569;line-height:1.5;min-height:36px;">Headings · lists · bold · links · tables · inline code</div>
    <div style="background:rgba(255,255,255,.7);border:1px dashed #cbd5e1;border-radius:6px;padding:6px 10px;font-size:11.5px;color:#1e293b;font-style:italic;"><span style="opacity:.55;font-style:normal;">Tell AI: </span>&ldquo;write a 5-item FAQ&rdquo;</div>
  </div>

  <div style="background:#f1f5f9;border:1px solid #475569;border-radius:12px;padding:14px 16px 16px;display:flex;flex-direction:column;gap:8px;box-shadow:0 1px 3px rgba(0,0,0,.04),0 4px 12px rgba(0,0,0,.03);position:relative;overflow:hidden;">
    <div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(135deg,#0f172a,#334155);"></div>
    <div style="display:flex;align-items:center;gap:10px;"><div style="width:38px;height:38px;background:#0f172a;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">💻</div><div style="font-size:14px;font-weight:700;color:#0f172a;line-height:1.3;">Code blocks</div></div>
    <div style="font-size:12px;color:#475569;line-height:1.5;min-height:36px;">Syntax-highlighted code, 30+ languages</div>
    <div style="background:rgba(255,255,255,.7);border:1px dashed #475569;border-radius:6px;padding:6px 10px;font-size:11.5px;color:#0f172a;font-style:italic;"><span style="opacity:.55;font-style:normal;">Tell AI: </span>&ldquo;add a python binary-search example&rdquo;</div>
  </div>

  <div style="background:#faf5ff;border:1px solid #c4b5fd;border-radius:12px;padding:14px 16px 16px;display:flex;flex-direction:column;gap:8px;box-shadow:0 1px 3px rgba(0,0,0,.04),0 4px 12px rgba(0,0,0,.03);position:relative;overflow:hidden;">
    <div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(135deg,#a855f7,#7c3aed);"></div>
    <div style="display:flex;align-items:center;gap:10px;"><div style="width:38px;height:38px;background:#f3e8ff;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">🔀</div><div style="font-size:14px;font-weight:700;color:#5b21b6;line-height:1.3;">Mermaid</div></div>
    <div style="font-size:12px;color:#475569;line-height:1.5;min-height:36px;">Flowchart · Sequence · ER · State · Mindmap · Pie</div>
    <div style="background:rgba(255,255,255,.7);border:1px dashed #c4b5fd;border-radius:6px;padding:6px 10px;font-size:11.5px;color:#5b21b6;font-style:italic;"><span style="opacity:.55;font-style:normal;">Tell AI: </span>&ldquo;draw the login flow&rdquo;</div>
  </div>

  <div style="background:#ecfdf5;border:1px solid #86efac;border-radius:12px;padding:14px 16px 16px;display:flex;flex-direction:column;gap:8px;box-shadow:0 1px 3px rgba(0,0,0,.04),0 4px 12px rgba(0,0,0,.03);position:relative;overflow:hidden;">
    <div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(135deg,#10b981,#059669);"></div>
    <div style="display:flex;align-items:center;gap:10px;"><div style="width:38px;height:38px;background:#d1fae5;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">📈</div><div style="font-size:14px;font-weight:700;color:#065f46;line-height:1.3;">Chart.js</div></div>
    <div style="font-size:12px;color:#475569;line-height:1.5;min-height:36px;">Bar / line / doughnut / pie — interactive</div>
    <div style="background:rgba(255,255,255,.7);border:1px dashed #86efac;border-radius:6px;padding:6px 10px;font-size:11.5px;color:#065f46;font-style:italic;"><span style="opacity:.55;font-style:normal;">Tell AI: </span>&ldquo;chart of 12-month sales&rdquo;</div>
  </div>

  <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:12px;padding:14px 16px 16px;display:flex;flex-direction:column;gap:8px;box-shadow:0 1px 3px rgba(0,0,0,.04),0 4px 12px rgba(0,0,0,.03);position:relative;overflow:hidden;">
    <div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(135deg,#f59e0b,#d97706);"></div>
    <div style="display:flex;align-items:center;gap:10px;"><div style="width:38px;height:38px;background:#fef3c7;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">🎯</div><div style="font-size:14px;font-weight:700;color:#92400e;line-height:1.3;">Stat cards</div></div>
    <div style="font-size:12px;color:#475569;line-height:1.5;min-height:36px;">KPI boxes — big number, semantic color</div>
    <div style="background:rgba(255,255,255,.7);border:1px dashed #fcd34d;border-radius:6px;padding:6px 10px;font-size:11.5px;color:#92400e;font-style:italic;"><span style="opacity:.55;font-style:normal;">Tell AI: </span>&ldquo;summarise as 4 KPI cards&rdquo;</div>
  </div>

  <div style="background:#eff6ff;border:1px solid #93c5fd;border-radius:12px;padding:14px 16px 16px;display:flex;flex-direction:column;gap:8px;box-shadow:0 1px 3px rgba(0,0,0,.04),0 4px 12px rgba(0,0,0,.03);position:relative;overflow:hidden;">
    <div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(135deg,#3b82f6,#1d4ed8);"></div>
    <div style="display:flex;align-items:center;gap:10px;"><div style="width:38px;height:38px;background:#dbeafe;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">🪜</div><div style="font-size:14px;font-weight:700;color:#1e3a8a;line-height:1.3;">Step cards</div></div>
    <div style="font-size:12px;color:#475569;line-height:1.5;min-height:36px;">Numbered cards in sequence</div>
    <div style="background:rgba(255,255,255,.7);border:1px dashed #93c5fd;border-radius:6px;padding:6px 10px;font-size:11.5px;color:#1e3a8a;font-style:italic;"><span style="opacity:.55;font-style:normal;">Tell AI: </span>&ldquo;turn the setup into step cards&rdquo;</div>
  </div>

  <div style="background:#ecfeff;border:1px solid #67e8f9;border-radius:12px;padding:14px 16px 16px;display:flex;flex-direction:column;gap:8px;box-shadow:0 1px 3px rgba(0,0,0,.04),0 4px 12px rgba(0,0,0,.03);position:relative;overflow:hidden;">
    <div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(135deg,#06b6d4,#0891b2);"></div>
    <div style="display:flex;align-items:center;gap:10px;"><div style="width:38px;height:38px;background:#cffafe;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">✅</div><div style="font-size:14px;font-weight:700;color:#155e75;line-height:1.3;">Checklist</div></div>
    <div style="font-size:12px;color:#475569;line-height:1.5;min-height:36px;">Real clickable todo + progress bar</div>
    <div style="background:rgba(255,255,255,.7);border:1px dashed #67e8f9;border-radius:6px;padding:6px 10px;font-size:11.5px;color:#155e75;font-style:italic;"><span style="opacity:.55;font-style:normal;">Tell AI: </span>&ldquo;launch-prep checklist, 5 items&rdquo;</div>
  </div>

  <div style="background:#fdf2f8;border:1px solid #f9a8d4;border-radius:12px;padding:14px 16px 16px;display:flex;flex-direction:column;gap:8px;box-shadow:0 1px 3px rgba(0,0,0,.04),0 4px 12px rgba(0,0,0,.03);position:relative;overflow:hidden;">
    <div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(135deg,#ec4899,#be185d);"></div>
    <div style="display:flex;align-items:center;gap:10px;"><div style="width:38px;height:38px;background:#fce7f3;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">🖼</div><div style="font-size:14px;font-weight:700;color:#9d174d;line-height:1.3;">Image / Gallery</div></div>
    <div style="font-size:12px;color:#475569;line-height:1.5;min-height:36px;">One image · grid · in tables · in list items</div>
    <div style="background:rgba(255,255,255,.7);border:1px dashed #f9a8d4;border-radius:6px;padding:6px 10px;font-size:11.5px;color:#9d174d;font-style:italic;"><span style="opacity:.55;font-style:normal;">Tell AI: </span>&ldquo;drop these screenshots in&rdquo;</div>
  </div>

  <div style="background:#eef2ff;border:1px solid #a5b4fc;border-radius:12px;padding:14px 16px 16px;display:flex;flex-direction:column;gap:8px;box-shadow:0 1px 3px rgba(0,0,0,.04),0 4px 12px rgba(0,0,0,.03);position:relative;overflow:hidden;">
    <div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(135deg,#6366f1,#4338ca);"></div>
    <div style="display:flex;align-items:center;gap:10px;"><div style="width:38px;height:38px;background:#e0e7ff;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">🎨</div><div style="font-size:14px;font-weight:700;color:#3730a3;line-height:1.3;">HTML embed</div></div>
    <div style="font-size:12px;color:#475569;line-height:1.5;min-height:36px;">Raw HTML for layouts markdown can't express</div>
    <div style="background:rgba(255,255,255,.7);border:1px dashed #a5b4fc;border-radius:6px;padding:6px 10px;font-size:11.5px;color:#3730a3;font-style:italic;"><span style="opacity:.55;font-style:normal;">Tell AI: </span>&ldquo;gradient KPI cards with CSS&rdquo;</div>
  </div>

</div>
\`\`\`

## Navigation

\`\`\`steps
[
  { "title": "Sidebar (left)", "body": "Every knowledge document, grouped by project. The **⏷ All projects** button next to the WikiKai logo opens a filter dialog where you can also add empty projects" },
  { "title": "Search 🔍", "body": "Type ≥ 3 characters — full-text across all documents. Works with Thai and CJK scripts. Click a hit and the viewer jumps to that line" },
  { "title": "Tab strip", "body": "Pages of the current document run as tabs above the content. Click to switch; scroll horizontally when there are many" },
  { "title": "Info popover", "body": "Click **i** next to the title. Shows session id, the page's prompt-log timeline, and an inline editor to move the document to a different project" }
]
\`\`\`

## Editing & history

- **Edit raw** — every page has an inline editor (CodeMirror). The **🖼 Add Images** button uploads files and inserts the right form at the cursor — fence for top-level, markdown for inside a checklist, HTML \`<img>\` for inside an html-embed
- **Revisions** — every save snapshots. Click a version number in the header to view it, or open the diff modal to see line-by-line changes
- **Prune** — keep only the latest two revisions for a page with one button
- **Checklists are live** — clicking a box writes back to source instantly. AI can do the same via the \`toggle_checklist_item\` tool

## Theme

- **Light / dark** toggle on the topbar — diagrams and charts re-skin automatically
- AI doesn't have to think about themes — the renderer handles it`,
  "Block kinds at a glance · navigation · editing · revisions",
);

// ─── Page 3: AI commands ─────────────────────────────────────────
addPage(
  "3. Talking to the AI",
  `# 🤖 Example prompts

Any MCP-compatible client (Claude Code, Claude Desktop, …) sees WikiKai's tools automatically once the server is registered. You talk in plain language; the AI picks the right tool.

## Create a document

> **You:** Summarise the conversation we just had into a WikiKai knowledge titled "SLA migration notes".

> **You:** Save the deployment process I described as a new knowledge. Split it into overview · prerequisites · steps · troubleshooting pages.

## Search and recall

> **You:** Find anything in our docs about postgres timeout.

> **You:** Open the Q4 planning doc on the marketing page.

## Edit

> **You:** Add a "Rollback procedure" page to that knowledge.

> **You:** In the onboarding doc, add Figma to the Tools page.

> **You:** Rename every "Old API" heading to "Legacy API" across this knowledge.

## Make rich blocks

\`\`\`steps
[
  { "title": "Diagram", "body": "&ldquo;Draw a 3-step approval flowchart&rdquo;" },
  { "title": "Chart", "body": "&ldquo;Bar chart of monthly revenue Jan–Jun: 100k/150k/120k/200k/180k/250k&rdquo;" },
  { "title": "Stat cards", "body": "&ldquo;Summarise as four KPI cards: users 12k, revenue 5M, uptime 99.9%, NPS 72&rdquo;" },
  { "title": "Checklist", "body": "&ldquo;Make a checklist of five things to prep for tomorrow's standup&rdquo;" },
  { "title": "Steps", "body": "&ldquo;Turn the onboarding into a four-step card series&rdquo;" },
  { "title": "Images", "body": "&ldquo;Drop these screenshots into the bug-report page&rdquo; (paste / drag the images into the AI chat)" }
]
\`\`\`

## Reference a specific block

Every rich block has \`@N\` shown in its top-left corner on hover — use it to point the AI at one block.

> **You:** Update @47 — change the Q3 figure from 180 to 195.

> **You:** Edit the flowchart @23 — add a "manager review" step after "submit".

> **You:** Tick @118 item 2, that's done.

## A copy-paste prompt template

\`\`\`html-embed
<div style="background:linear-gradient(135deg,#eef0ff,#f5f3ff);border:1px solid #c7d2fe;border-radius:8px;padding:16px;font-size:13px;line-height:1.7;color:#1c1c1b;">
<b>📝 Template — Quarterly Review</b>
<br/><br/>
"Create a knowledge titled 'Q1 2026 Review' in project 'planning'. 5 pages:
<br/>1. Summary — 4 KPI stat cards (users / revenue / churn / NPS)
<br/>2. Highlights — bullet list of 5 wins
<br/>3. Metrics — a Mermaid gantt of milestones + a Chart.js line of revenue
<br/>4. Issues — checklist of 6 items to follow up in Q2
<br/>5. Next steps — 4 step cards for the Q2 plan
<br/><br/>
Set \`user_prompt\` on each mutation so the prompt log records which request produced which page."
</div>
\`\`\`

## Tips

- **Mention the project** — "save in project 'meeting-notes'". The AI will fill the field correctly
- **Be specific about structure** — "split into 3 pages: A, B, C" beats "make a doc about X"
- **Point at lines or blocks for edits** — "on page #12 in the line that mentions X, change it to Y" gets a surgical edit, not a rewrite`,
  "Example prompts: create · search · edit · build rich blocks · reference @N",
);

// ─── Page 4: Markdown basics ─────────────────────────────────────
addPage(
  "4. Markdown basics + tables",
  `# 📝 Markdown basics

Most of what an AI writes for you is plain markdown. Quick reference + a normal markdown table.

## Headings

# Heading 1 — biggest (one per page)
## Heading 2 — main sections
### Heading 3 — sub-sections

> H2 / H3 headings carry anchor links — hover and the # marker appears on the right. Click it to copy a deep link to that section.

## Inline emphasis

- **Bold** — call attention
- *Italic* — light highlight or foreign-language terms
- \`inline code\` — commands / function names in prose
- ~~strikethrough~~ — replaced wording
- [link text](https://example.com) — opens in a new tab

## Lists

Bulleted:

- Fruit
  - Mango
  - Papaya
- Vegetables
  - Kale

Numbered:

1. Wake up
2. Brush teeth
3. Eat breakfast

## A normal markdown table

| Product | Price | In stock |
|---|---:|:---:|
| Mango | 50 | ✓ |
| Papaya | 35 | ✓ |
| Durian | 200 | — |

> ✨ **Tables get \`@N\` ids too.** The server appends a trailing \`{@N}\` line under every table on save (with one blank line in between) — the renderer attaches it as \`data-block-id\` on the \`<table>\`, so search-flash, deep links, and \`get_block\` / \`get_table_row\` / \`find_table_rows\` all work on plain markdown tables. No HTML wrapper needed.

**What you can ask the AI:**

- "Update @<N> — add a \`supplier\` column" → AI reads the table via \`get_block({ id: <N> })\` and rewrites it
- "What's the price of Mango from @<N>?" → AI uses \`find_table_rows({ block_id: <N>, where: { Product: "Mango" } })\` — no need to dump the whole table
- "How many rows does @<N> have?" → \`get_block({ id: <N>, summary: true })\` returns \`columns\` + \`row_count\` only (cheap probe)
- "Drop the last row of @<N>" → \`get_table_row({ block_id: <N>, index: -1 })\` finds the line, then \`edit_lines\`

**Interactive checkboxes inside table cells**

| Step | Done | Owner |
|------|------|-------|
| Cut release branch | [x] | DevOps |
| Smoke test staging | [ ] | QA |
| Roll forward | [ ] | Release |

> 💡 Drop \`[ ]\` or \`[x]\` anywhere in a cell — start, middle, or multiple per cell. Each becomes a clickable checkbox sharing the same task-index counter as the GFM list. To keep a literal \`[x]\` as text in a cell (e.g. when documenting the syntax), wrap it in backticks: \`\\\`[x]\\\`\`. See the Interactive checkboxes page for the full reference.

## Block quotes

> A quoted line — for citations or emphasis.
> Multiple lines work too.

## Horizontal rule

---

Use \`---\` between sections.

## Ask the AI

> "Add a comparison table of three cloud providers — AWS, GCP, Azure — covering price, regions, support tier"

> "Append a 5-item FAQ in heading + paragraph form"`,
  "Headings · emphasis · lists · plain markdown table · quotes",
);

// ─── Page 5: Code blocks ─────────────────────────────────────────
addPage(
  "5. Code & syntax highlight",
  `# 💻 Code blocks

Fenced code blocks get syntax highlighting automatically (Shiki, 30+ grammars).

## Examples

\`\`\`python
def fibonacci(n: int) -> int:
    if n < 2:
        return n
    a, b = 0, 1
    for _ in range(n - 1):
        a, b = b, a + b
    return b

print(fibonacci(10))  # 55
\`\`\`

\`\`\`typescript
interface User {
  id: string;
  email: string;
}

async function findUser(id: string): Promise<User | null> {
  const row = await db.query("SELECT * FROM users WHERE id = $1", [id]);
  return row ?? null;
}
\`\`\`

\`\`\`bash
# install dependencies
npm install

# start the dev server
npm run dev
\`\`\`

\`\`\`sql
SELECT u.email, COUNT(o.id) AS orders
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE u.created_at > '2025-01-01'
GROUP BY u.email
ORDER BY orders DESC
LIMIT 10;
\`\`\`

## Common languages

- python, javascript, typescript, ts, tsx, jsx
- bash, sh, zsh
- sql, json, yaml, toml
- go, rust, java, kotlin, swift, php, ruby
- html, css, scss
- markdown, dockerfile, nginx
- and dozens more via Shiki

## Ask the AI

> "Add a Python example of binary search"

> "Show an nginx config that reverse-proxies a WebSocket"

> "FAQ item 3 needs a curl example"`,
  "Fenced code blocks with syntax highlighting (Python · TS · Bash · SQL · …)",
);

// ─── Page 6: Mermaid ─────────────────────────────────────────────
addPage(
  "6. Mermaid diagrams",
  `# 🔀 Mermaid — diagrams of every shape

Tell the AI to draw something and it produces a Mermaid block. The browser renders it; click any diagram to open a fullscreen viewer with pan / zoom / PNG export.

## Flowchart

\`\`\`mermaid
flowchart TD
  Start([Start]) --> Check{Valid?}
  Check -->|Yes| Process[Process]
  Check -->|No| Ask[Ask user]
  Ask --> Check
  Process --> End([Done])
\`\`\`

## Sequence diagram

\`\`\`mermaid
sequenceDiagram
  participant U as User
  participant A as App
  participant DB as Database
  U->>A: Click login
  A->>DB: Check password
  DB-->>A: ok
  A-->>U: Send token
\`\`\`

## ER diagram

\`\`\`mermaid
erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ ITEM : contains
  PRODUCT ||--o{ ITEM : "appears in"
\`\`\`

## State diagram

\`\`\`mermaid
stateDiagram-v2
  [*] --> Draft
  Draft --> Submitted: submit
  Submitted --> Approved: ok
  Submitted --> Rejected: revise
  Rejected --> Draft
  Approved --> [*]
\`\`\`

## Mindmap

\`\`\`mermaid
mindmap
  root((Project X))
    Goals
      +50% users
      Reduce churn
    Team
      Engineering
      Design
      Marketing
    Timeline
      Q1 vision
      Q2 build
\`\`\`

## Pie chart

\`\`\`mermaid
pie title Market share
  "iOS" : 55
  "Android" : 40
  "Other" : 5
\`\`\`

## Ask the AI

> "Draw an approval flowchart: submit → manager approve? → ok = go, no = revise"

> "Sequence diagram of a QR payment: user, app, gateway, bank"

> "Mindmap of today's meeting topics: goals, team, deadline"

> "Pie of work-time split: dev 60%, meeting 20%, docs 15%, other 5%"

## Tips

- Click a diagram → fullscreen tab with zoom + pan + PNG export
- Avoid **Gantt** charts inside narrow containers — the axis labels collide. Reach for a timeline or stat-card summary instead.`,
  "Flowchart · Sequence · ER · State · Mindmap · Pie",
);

// ─── Page 7: Charts ──────────────────────────────────────────────
addPage(
  "7. Charts — real numbers",
  `# 📈 Chart.js — quantitative data

For actual numbers — revenue, headcount, latency. Interactive: hover for tooltips, click to open a fullscreen viewer with PNG export.

## Bar chart

\`\`\`chart
{
  "type": "bar",
  "data": {
    "labels": ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
    "datasets": [{
      "label": "Sales (k)",
      "data": [120, 150, 180, 160, 200, 240],
      "backgroundColor": "#6366f1"
    }]
  }
}
\`\`\`

## Line chart

\`\`\`chart
{
  "type": "line",
  "data": {
    "labels": ["2020", "2021", "2022", "2023", "2024", "2025"],
    "datasets": [
      { "label": "Users", "data": [1.2, 1.8, 2.6, 3.5, 4.8, 6.2], "borderColor": "#10b981", "tension": 0.3 },
      { "label": "Active", "data": [0.8, 1.2, 1.9, 2.8, 4.0, 5.5], "borderColor": "#6366f1", "tension": 0.3 }
    ]
  },
  "options": { "scales": { "y": { "title": { "display": true, "text": "millions" } } } }
}
\`\`\`

## Doughnut

\`\`\`chart
{
  "type": "doughnut",
  "data": {
    "labels": ["Engineering", "Marketing", "Sales", "Ops"],
    "datasets": [{
      "data": [45, 20, 25, 10],
      "backgroundColor": ["#6366f1", "#10b981", "#f59e0b", "#ef4444"]
    }]
  }
}
\`\`\`

## Chart grid — several side by side

\`\`\`chart-grid
[
  {
    "title": "Revenue",
    "type": "bar",
    "data": {
      "labels": ["Q1","Q2","Q3","Q4"],
      "datasets": [{ "label": "M", "data": [1.2, 1.5, 1.8, 2.4], "backgroundColor": "#6366f1" }]
    }
  },
  {
    "title": "Users",
    "type": "line",
    "data": {
      "labels": ["Q1","Q2","Q3","Q4"],
      "datasets": [{ "label": "k", "data": [12, 18, 25, 38], "borderColor": "#10b981", "tension": 0.3 }]
    }
  }
]
\`\`\`

## Ask the AI

> "Bar chart of 2025 monthly revenue — start at 100k, grow by 20k each month"

> "Compare users vs active users over 5 years — line chart, two series"

> "Chart grid: revenue by quarter + user count by quarter, 2025"

## Chart.js vs Mermaid pie?

- **Mermaid pie** — quick, sketch-quality, no interaction
- **Chart.js doughnut / pie** — interactive, configurable colors, multiple datasets`,
  "Bar / Line / Doughnut + chart-grid (multiple charts side by side)",
);

// ─── Page 8: Stats + Steps ───────────────────────────────────────
addPage(
  "8. Stat cards + Step cards",
  `# 🎴 Stat cards + Step cards

Quick-read cards for headline numbers ("KPI strip") or sequential instructions.

## Stat cards — headline numbers

\`\`\`stats
[
  { "num": "1,247", "label": "active users", "color": "purple" },
  { "num": "98.7%", "label": "uptime", "color": "green" },
  { "num": "42ms", "label": "p95 latency", "color": "blue" },
  { "num": "5,820", "label": "messages/day", "color": "amber" }
]
\`\`\`

Colors: \`purple\` · \`blue\` · \`green\` · \`amber\` · \`red\` · \`cyan\`.

## Step cards — ordered procedures

\`\`\`steps
[
  { "title": "Step 1", "body": "Install dependencies with \`npm install\` — about 30 seconds" },
  { "title": "Step 2", "body": "Start the dev server with \`npm run dev\` — opens on port 3939" },
  { "title": "Step 3", "body": "Open [http://localhost:5173](http://localhost:5173) in a browser" },
  { "title": "Step 4", "body": "In Claude Code, say: 'Create a test knowledge in WikiKai'" }
]
\`\`\`

> The \`body\` field supports inline markdown — **bold**, *italic*, [links](#), \`code\`, even images.

## Ask the AI

> "Four stat cards: revenue 5M, MAU 12k, NPS 72, churn 2.1%"

> "Walk through the onboarding as 4 step cards: register → verify → set up profile → invite team"

> "Six step cards summarising the product's main features — title + one sentence each"

## When to reach for which

| Use stat cards when | Use a chart when |
|---|---|
| You have 2–6 standalone numbers | You have a series across time / categories |
| You want a snapshot of current state | You want trend or comparison |
| One number is enough ("12.5K") | You have multiple dimensions (users vs revenue) |`,
  "Stat cards (KPI numbers) + Step cards (numbered sequence)",
);

// ─── Page 9: Interactive checkboxes ──────────────────────────────
addPage(
  "9. Interactive checkboxes",
  `# ✅ Interactive checkboxes

Click a box, the page **really saves** — state persists across reloads. Same path the AI uses when you say "tick task 2". Good for release lists, prep, onboarding, QA, anything you'd write as a todo.

## 1. Plain markdown — the simple way

Write a GFM task list anywhere a normal markdown list would go. Each \`- [ ]\` becomes a clickable checkbox.

- [x] Tests green on main
- [ ] Docs updated
- [ ] Stakeholder sign-off
- [ ] Database backup taken

> 💡 **Click any box above** — the strikethrough flips and the source is saved. Reload the page; state is still there.

### Inline formatting works

- [x] Clone the repo: \`git clone https://github.com/...\`
- [x] Install — \`npm install\` (takes ~30 seconds)
- [ ] Read the **README.md** first
- [ ] Skim the [contribution guide](https://github.com/tharayuth/wikikai)

### Nested lists work too

- [ ] Launch prep
  - [x] Smoke tests
  - [ ] Final review
  - [ ] Announce on Slack
- [ ] Post-launch
  - [ ] Watch dashboards 24h
  - [ ] Blog post

## 2. Checkboxes inside a table

Markdown table cells don't auto-render \`[ ]\` as a clickable box (the GFM task-list rule only fires inside list items). For an interactive checkbox **inside a table**, drop it into an \`html-embed\`:

\`\`\`html-embed
<table style="width:100%;border-collapse:collapse;font-size:13px;">
  <thead>
    <tr style="background:#eef0ff;color:#4f46e5;">
      <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #6366f1;">Step</th>
      <th style="padding:8px 12px;text-align:center;border-bottom:2px solid #6366f1;width:90px;">Done</th>
      <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #6366f1;">Owner</th>
    </tr>
  </thead>
  <tbody>
    <tr><td style="padding:6px 12px;">Cut release branch</td><td style="text-align:center;"><input type="checkbox" checked disabled></td><td style="padding:6px 12px;">DevOps</td></tr>
    <tr><td style="padding:6px 12px;">Build & tag</td><td style="text-align:center;"><input type="checkbox" checked disabled></td><td style="padding:6px 12px;">CI</td></tr>
    <tr><td style="padding:6px 12px;">Smoke test staging</td><td style="text-align:center;"><input type="checkbox" disabled></td><td style="padding:6px 12px;">QA</td></tr>
    <tr><td style="padding:6px 12px;">Roll forward production</td><td style="text-align:center;"><input type="checkbox" disabled></td><td style="padding:6px 12px;">Release manager</td></tr>
  </tbody>
</table>
\`\`\`

> 💡 \`<input type="checkbox">\` inside \`html-embed\` is **also clickable** — the renderer rewrites each one with a shared task index, so toggles in a styled table or card save back to source just like the plain-markdown list above. The \`disabled\` boxes in the table below are intentionally inert (the column shows historical status); remove \`disabled\` to make them live.

## 3. Checkboxes inside any HTML layout

Same html-embed trick works for gradient cards, sidebars, or any custom layout:

\`\`\`html-embed
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;">
  <div style="background:#ecfdf5;border:1px solid #86efac;border-left:4px solid #10b981;border-radius:8px;padding:12px 14px;">
    <div style="font-weight:700;color:#065f46;margin-bottom:6px;">🟢 Shipped</div>
    <div style="font-size:13px;line-height:1.7;color:#1c1c1b;">
      <div><input type="checkbox" checked disabled> Onboarding redesign</div>
      <div><input type="checkbox" checked disabled> i18n round 1</div>
    </div>
  </div>
  <div style="background:#fffbeb;border:1px solid #fcd34d;border-left:4px solid #f59e0b;border-radius:8px;padding:12px 14px;">
    <div style="font-weight:700;color:#92400e;margin-bottom:6px;">🟡 In flight</div>
    <div style="font-size:13px;line-height:1.7;color:#1c1c1b;">
      <div><input type="checkbox" disabled> Search ranking v2</div>
      <div><input type="checkbox" disabled> Image OCR</div>
    </div>
  </div>
  <div style="background:#eff6ff;border:1px solid #93c5fd;border-left:4px solid #3b82f6;border-radius:8px;padding:12px 14px;">
    <div style="font-weight:700;color:#1e3a8a;margin-bottom:6px;">🔵 Backlog</div>
    <div style="font-size:13px;line-height:1.7;color:#1c1c1b;">
      <div><input type="checkbox" disabled> Mobile sidebar</div>
      <div><input type="checkbox" disabled> Multi-user auth</div>
    </div>
  </div>
</div>
\`\`\`

## Ask the AI

> "Six-item checklist to prep tomorrow's standup" — AI will write a \`- [ ]\` list

> "Release v2.5 checklist: tests, changelog, blog post, social-media post, deploy staging, deploy prod, monitor"

> "Tick task 3 on this page — done" (the AI calls \`toggle_task\` with index 3)

> "Mark the 'docs updated' line off" — AI finds the line and flips it

## Tips

- Every toggle is a **revision** — see when items got checked via the version dropdown on the page header
- AI can flip boxes via \`toggle_task({ page_id, index })\` — index is the 0-based position of \`- [ ]\` / \`- [x]\` lines on the page (top-down, skipping any inside fenced code)
- Tasks inside fenced code blocks are intentionally NOT rendered as checkboxes — you can show literal \`- [ ]\` examples in a \`\`\`markdown block without them becoming clickable`,
  "Interactive `- [ ]` checkboxes — plain · in tables (html-embed) · in cards",
);

// ─── Page 10: Images ─────────────────────────────────────────────
addPage(
  "10. Images — three ways",
  `# 🖼 Images

Pick the form that fits where the image goes.

## 1. Gallery — \`\`\`images fence

Multiple images in a grid + click-to-lightbox:

\`\`\`images
[
  { "src": "/img/2b5d19eb2a91970c2a322293542da95ac2b6ba1aa7cfbaa8e15d4a43dc032cf5.svg", "alt": "Data flow", "caption": "Data flow diagram", "width": 280, "height": 160 },
  { "src": "/img/98be11f7c598163ec74c2851fd5be61b05629cfefbc8329610bd82869a1712d7.svg", "alt": "Badge", "caption": "Logo badge", "width": 280, "height": 160 }
]
\`\`\`

**Good for:** galleries · gets a \`@N\` block id · click for fullscreen

## 2. Inline markdown — \`![alt](src)\`

For images inside paragraphs or list items — icons in prose, screenshots inline:

In this sentence the emblem ![emblem](/img/b9b050e806a7e38172059601c41b4a57cbfbaf87c47ee3fba53e7ebd7ed735a1.svg "x32") sits between words.

Inside a markdown table:

| Country | Flag | Capital |
|---|:---:|---|
| Thailand | ![flag](/img/18a2e683798840015634f8547db85a077bbb5e5006c119a64bb20b684dafb16d.svg "x24") | Bangkok |
| (other)  | — | — |

**Good for:** maximum flexibility — works inside paragraphs, list items, table cells.
**No \`@N\`** — inline images are leaves, not blocks.

### Size via the title slot

- \`"300x200"\` — max width 300, max height 200
- \`"300x"\` — width only
- \`"x200"\` — height only
- \`"caption w=300 h=200"\` — mix caption text with size

## 3. \`<img>\` inside html-embed

When you want the image as part of a custom HTML layout:

\`\`\`html-embed
<div style="display:flex;gap:14px;align-items:center;padding:12px;background:#fffbeb;border-radius:8px;border:1px solid #f59e0b;">
  <img src="/img/18a2e683798840015634f8547db85a077bbb5e5006c119a64bb20b684dafb16d.svg" alt="flag" width="80" height="48" style="border:1px solid #ccc;border-radius:4px;flex-shrink:0;" />
  <div>
    <h4 style="margin:0 0 4px;color:#92400e;">Thai flag</h4>
    <p style="margin:0;color:#78350f;font-size:13px;">Three colors: red · white · blue</p>
  </div>
</div>
\`\`\`

## How to upload

### Option 1 — through the UI (while editing)

\`\`\`steps
[
  { "title": "Open the page", "body": "Click **Edit raw**" },
  { "title": "Place the cursor", "body": "Where you want the image to land (inside a checklist item, in a paragraph, etc.)" },
  { "title": "Click 🖼 Add Images", "body": "Pick files, or drag-and-drop them onto the dialog" },
  { "title": "Set defaults + alt", "body": "Tweak width / height if needed; the alt prefills from the filename" },
  { "title": "OK", "body": "The dialog inserts the right code form for where the cursor is — fence at top level, inline markdown inside a checklist, HTML img inside an html-embed" }
]
\`\`\`

### Option 2 — let the AI do it

> "Drop this screenshot into the bug-report page" (paste / drag the image into the AI chat)

> "Add a Thai-flag icon to the country summary table" (if it's already uploaded)

## Tips

- Identical images **de-duplicate automatically** — uploading the same file twice doesn't double the disk
- Internal image URLs are immutable, share-able, cache-able forever
- Supports PNG · JPG · WebP · GIF · SVG (up to 10 MB)`,
  "Three ways to embed images (gallery / markdown / HTML) + sizing + upload",
);

// ─── Page 11: HTML embed ─────────────────────────────────────────
addPage(
  "11. HTML embed — flexible layouts",
  `# 🎨 HTML embed

When the other block types don't reach far enough — drop raw HTML in. Inline CSS, scoped \`<style>\`, SVG, \`<details>\`, custom grids. The fence is a first-class rich block so it still gets a \`@N\`.

## Gradient KPI cards

\`\`\`html-embed
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;">
  <div style="background:linear-gradient(135deg,#a855f7,#6366f1);color:white;padding:16px;border-radius:10px;">
    <div style="font-size:28px;font-weight:700;">12.4K</div>
    <div style="font-size:12px;opacity:0.9;">Total users</div>
  </div>
  <div style="background:linear-gradient(135deg,#10b981,#059669);color:white;padding:16px;border-radius:10px;">
    <div style="font-size:28px;font-weight:700;">$5.2M</div>
    <div style="font-size:12px;opacity:0.9;">Revenue Q1</div>
  </div>
  <div style="background:linear-gradient(135deg,#f59e0b,#d97706);color:white;padding:16px;border-radius:10px;">
    <div style="font-size:28px;font-weight:700;">94%</div>
    <div style="font-size:12px;opacity:0.9;">Retention</div>
  </div>
</div>
\`\`\`

## Tables with row colors

\`\`\`html-embed
<table style="width:100%;border-collapse:collapse;font-size:13px;">
  <thead>
    <tr style="background:#eef0ff;color:#4f46e5;">
      <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #6366f1;">Team</th>
      <th style="padding:8px 12px;text-align:center;border-bottom:2px solid #6366f1;">Q1</th>
      <th style="padding:8px 12px;text-align:center;border-bottom:2px solid #6366f1;">Q2</th>
      <th style="padding:8px 12px;text-align:right;border-bottom:2px solid #6366f1;">YTD</th>
    </tr>
  </thead>
  <tbody>
    <tr><td style="padding:6px 12px;">Engineering</td><td style="text-align:center;background:#ecfdf5;">✓</td><td style="text-align:center;background:#ecfdf5;">✓</td><td style="text-align:right;font-weight:600;">100%</td></tr>
    <tr style="background:#fafaf9;"><td style="padding:6px 12px;">Marketing</td><td style="text-align:center;background:#ecfdf5;">✓</td><td style="text-align:center;background:#fef2f2;">✗</td><td style="text-align:right;font-weight:600;">50%</td></tr>
    <tr><td style="padding:6px 12px;">Sales</td><td style="text-align:center;background:#fef2f2;">✗</td><td style="text-align:center;background:#fffbeb;">~</td><td style="text-align:right;font-weight:600;">25%</td></tr>
  </tbody>
</table>
\`\`\`

> **Why html-embed for tables?** It gets a \`@N\` id — plain markdown tables don't.

## Collapsible details

\`\`\`html-embed
<details style="background:#f5f3ff;border:1px solid #c4b5fd;border-radius:6px;padding:10px 14px;">
  <summary style="cursor:pointer;font-weight:600;color:#5b21b6;">📌 Read more — limits</summary>
  <div style="margin-top:8px;font-size:13px;color:#1c1c1b;line-height:1.7;">
    <ul style="margin:0;padding-left:20px;">
      <li>Uploads larger than 10 MB are rejected</li>
      <li><code>&lt;script&gt;</code> tags are inert (anti-XSS)</li>
      <li>iframes work but only with trusted sources</li>
    </ul>
  </div>
</details>
\`\`\`

## Inline SVG

\`\`\`html-embed
<div style="display:flex;justify-content:center;align-items:center;padding:20px;background:#fafaf9;border-radius:8px;">
  <svg width="120" height="120" viewBox="0 0 120 120">
    <circle cx="60" cy="60" r="50" fill="#6366f1" opacity="0.2"/>
    <circle cx="60" cy="60" r="35" fill="#6366f1" opacity="0.5"/>
    <circle cx="60" cy="60" r="20" fill="#6366f1"/>
    <text x="60" y="65" text-anchor="middle" fill="white" font-size="14" font-weight="700">SVG</text>
  </svg>
</div>
\`\`\`

## Ask the AI

> "Three gradient KPI cards: users / revenue / retention — purple, green, amber"

> "Q1/Q2 team status table — Engineering, Marketing, Sales — green for done, red for missed"

> "Collapsible details listing system limits"

## Watch out

- **No \`<script>\`** — stripped on render (security)
- Inline CSS works best; scoped \`<style>\` blocks can leak if you forget to namespace
- Internal images: \`<img src="/img/...">\` works the same as anywhere else`,
  "Raw HTML — gradient cards · decorated tables · details · inline SVG",
);

// ─── Page 12: Block IDs + Revisions + Deep links ─────────────────
addPage(
  "12. Block IDs, revisions, deep links",
  `# 🔗 Referencing · history · sharing

## Block IDs (\`@N\`)

Every rich block (mermaid, chart, stats, steps, checklist, images, html-embed) gets a **\`@N\`** — a global id, unique across the entire WikiKai instance.

\`\`\`stats
[
  { "num": "@N", "label": "block id", "color": "purple" },
  { "num": "🌐", "label": "globally unique", "color": "blue" },
  { "num": "↻", "label": "never reused", "color": "green" }
]
\`\`\`

- Hover any rich block → \`@N\` badge appears at the top-left
- Click the badge → **Copy** the id or **Edit this block** (jumps the editor straight to its source line)
- Tell the AI "update **@47**" / "read **@123**" — it finds the block without scanning the document

> 📌 **Plain markdown tables don't have a \`@N\`** — if you need to address a table, write it inside an \`html-embed\`.

## Revisions — go back in time

Every edit to a page creates a snapshot:

- The header shows version numbers (v1, v2, v3, …). Click an older one to view it.
- A banner reminds you you're looking at history; the **🔍 Diff vs v[latest]** button shows a line-by-line comparison.
- **Delete revisions** prunes everything except the two most recent versions — useful once an old draft is no longer worth keeping.

## Deep links — share by URL

URL format:

\`\`\`
/&KID            ← knowledge, first page auto-selected
/&KID/#PID       ← knowledge + a specific page
/&KID/#PID:LINE  ← + scroll near a line
\`\`\`

Examples:

| URL | Opens |
|---|---|
| \`/&5\` | Knowledge 5, first tab |
| \`/&5/#7\` | Knowledge 5, page 7 |
| \`/&5/#7:42\` | + scrolled near line 42 |

Every search result, every link an AI hands you, every URL copied from the UI follows this scheme — share in chat and the recipient lands at exactly the same place.

## Prompt log — why a revision happened

Open the **i** info popover next to a knowledge's title. At the bottom you see a timeline of user prompts that produced each revision:

- Which version of which page came from which message you sent
- Filter by page if the doc has many tabs
- Useful for "why did v5 add section X?" — because you said "..."

> 💡 The AI only sends \`user_prompt\` to the log when there's a clear ask (opt-in to save tokens). Trivial follow-ups stay out.

## Ask the AI

> "The doc id you printed earlier (\`&5\`) — open that knowledge in the sidebar."

> "Read @47 and tell me what's in it."

> "Show me v3 of page #12 — what did it look like before the rewrite?"`,
  "@N block ids · revisions · diff · prune · deep-link URLs · prompt log",
);

db.close();
console.log(
  `\n✅ seed complete — &${KID} with ${position} pages\n   open: /&${KID}\n`,
);
