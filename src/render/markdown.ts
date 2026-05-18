import MarkdownIt from "markdown-it";
import anchor from "markdown-it-anchor";
import { createHighlighter, type Highlighter } from "shiki";

const SHIKI_LANGS = [
  "javascript",
  "typescript",
  "tsx",
  "jsx",
  "json",
  "bash",
  "shell",
  "sh",
  "python",
  "go",
  "rust",
  "java",
  "kotlin",
  "ruby",
  "sql",
  "yaml",
  "toml",
  "html",
  "css",
  "diff",
  "markdown",
];

const LANG_ALIAS: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  md: "markdown",
  yml: "yaml",
  zsh: "bash",
};

function resolveLang(lang: string): string | null {
  const lower = lang.toLowerCase();
  const aliased = LANG_ALIAS[lower] ?? lower;
  return SHIKI_LANGS.includes(aliased) ? aliased : null;
}

let highlighterPromise: Promise<Highlighter> | null = null;
function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-light", "github-dark"],
      langs: SHIKI_LANGS,
    });
  }
  return highlighterPromise;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

interface StatItem {
  num: string;
  label: string;
  color?: string;
}

const COLOR_WHITELIST = new Set([
  "purple",
  "blue",
  "green",
  "amber",
  "red",
  "cyan",
]);

/** Extract the `{@N}` annotation from a fence info string and return both
 *  the annotation (HTML attrs + visible badge) and the cleaned-up info. */
function extractBlockId(info: string): { id: number | null; rest: string } {
  const m = /\{@(\d+)\}/.exec(info);
  if (!m) return { id: null, rest: info };
  return { id: Number(m[1]), rest: info.replace(/\s*\{@\d+\}\s*/, " ").trim() };
}

function blockBadge(id: number | null): string {
  if (id == null) return "";
  return `<button type="button" class="block-badge" data-block-id="${id}" title="Click for menu (copy @${id} or edit)">@${id}</button>`;
}

function blockIdAttr(id: number | null): string {
  return id == null ? "" : ` data-block-id="${id}"`;
}

function renderStats(jsonText: string, blockId: number | null = null): string {
  let items: StatItem[];
  try {
    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed)) throw new Error("stats must be array");
    items = parsed;
  } catch (e) {
    return `<div class="render-error">stats error: ${escapeHtml(
      (e as Error).message,
    )}</div>`;
  }
  const cards = items
    .map((it) => {
      const num = escapeHtml(String(it.num ?? ""));
      const label = escapeHtml(String(it.label ?? ""));
      const color =
        it.color && COLOR_WHITELIST.has(it.color) ? ` ${it.color}` : "";
      return `<div class="stat-card${color}"><div class="num${color}">${num}</div><div class="label">${label}</div></div>`;
    })
    .join("");
  return `<div class="stats-bar"${blockIdAttr(blockId)}>${cards}${blockBadge(blockId)}</div>`;
}

function renderChart(jsonText: string, blockId: number | null = null): string {
  let cfg: unknown;
  try {
    cfg = JSON.parse(jsonText);
  } catch (e) {
    return `<div class="render-error">chart error: ${escapeHtml(
      (e as Error).message,
    )}</div>`;
  }
  const safe = escapeAttr(JSON.stringify(cfg));
  return `<div class="chart-wrap"${blockIdAttr(blockId)}><canvas class="chart" data-chart="${safe}"></canvas>${blockBadge(blockId)}</div>`;
}

function renderSteps(jsonText: string, md: MarkdownIt, blockId: number | null = null): string {
  let items: unknown;
  try {
    items = JSON.parse(jsonText);
  } catch (e) {
    return `<div class="render-error">steps error: ${escapeHtml(
      (e as Error).message,
    )}</div>`;
  }
  if (!Array.isArray(items)) {
    return `<div class="render-error">steps error: must be a JSON array of step objects</div>`;
  }
  const cards = items
    .map((raw, idx) => {
      if (typeof raw !== "object" || raw === null) {
        return `<div class="step-card"><div class="render-error">item ${idx}: not an object</div></div>`;
      }
      const obj = raw as { n?: unknown; title?: unknown; body?: unknown };
      const n =
        typeof obj.n === "number" || typeof obj.n === "string"
          ? String(obj.n)
          : String(idx + 1);
      const titleHtml =
        obj.title !== undefined && obj.title !== null
          ? `<div class="step-title">${escapeHtml(String(obj.title))}</div>`
          : "";
      const bodyMd = obj.body === undefined || obj.body === null ? "" : String(obj.body);
      // Render body markdown using the same pipeline (inline formatting + paragraphs).
      // Authors should avoid nesting another `steps` fence inside body.
      const bodyHtml = bodyMd ? md.render(bodyMd) : "";
      return (
        `<div class="step-card">` +
        `<div class="step-num">${escapeHtml(n)}</div>` +
        titleHtml +
        `<div class="step-body">${bodyHtml}</div>` +
        `</div>`
      );
    })
    .join("");
  return `<div class="steps-grid"${blockIdAttr(blockId)}>${cards}${blockBadge(blockId)}</div>`;
}

interface ImageEntry {
  src: string;
  alt?: string;
  caption?: string;
  /** Optional max width in px (per-image override of grid default). */
  width?: number;
  /** Optional max height in px (per-image override of grid default). */
  height?: number;
}

function renderImages(jsonText: string, blockId: number | null = null): string {
  let items: unknown;
  try {
    items = JSON.parse(jsonText);
  } catch (e) {
    return `<div class="render-error">images error: ${escapeHtml(
      (e as Error).message,
    )}</div>`;
  }
  // Accept either a single object or an array of objects.
  const arr: unknown[] = Array.isArray(items) ? items : [items];
  if (arr.length === 0) {
    return `<div class="render-error">images error: empty array</div>`;
  }
  const figures = arr
    .map((raw, i) => {
      if (typeof raw !== "object" || raw === null) {
        return `<div class="render-error">item ${i}: not an object</div>`;
      }
      const obj = raw as Partial<ImageEntry>;
      if (typeof obj.src !== "string" || obj.src.length === 0) {
        return `<div class="render-error">item ${i}: missing src</div>`;
      }
      const src = escapeAttr(obj.src);
      const alt = escapeAttr(obj.alt ?? "");
      const captionHtml = obj.caption
        ? `<figcaption>${escapeHtml(obj.caption)}</figcaption>`
        : "";
      // Optional per-image size — overrides the default thumbnail
      // dimensions the CSS gives every `.image-thumb img`. Width is
      // applied at the figure level (controls layout), height at the
      // img level (controls thumbnail height). object-fit: cover keeps
      // aspect ratio inside whatever box the user asks for.
      const figParts: string[] = [];
      const imgParts: string[] = [];
      if (typeof obj.width === "number" && Number.isFinite(obj.width) && obj.width > 0) {
        figParts.push(`max-width:${Math.round(obj.width)}px`);
      }
      if (typeof obj.height === "number" && Number.isFinite(obj.height) && obj.height > 0) {
        imgParts.push(`height:${Math.round(obj.height)}px`);
      }
      const figStyle = figParts.length > 0 ? ` style="${figParts.join(";")}"` : "";
      const imgStyle = imgParts.length > 0 ? ` style="${imgParts.join(";")}"` : "";
      return (
        `<figure class="image-thumb" data-src="${src}" data-alt="${alt}"${figStyle}>` +
        `<img src="${src}" alt="${alt}" loading="lazy"${imgStyle} />` +
        captionHtml +
        `</figure>`
      );
    })
    .join("");
  const layoutClass = arr.length === 1 ? "image-grid solo" : "image-grid";
  return `<div class="${layoutClass}"${blockIdAttr(blockId)}>${figures}${blockBadge(blockId)}</div>`;
}

interface ChecklistItem {
  text: string;
  done?: boolean;
}

interface ChecklistConfig {
  title?: string;
  description?: string;
  items: ChecklistItem[];
}

function parseChecklist(jsonText: string):
  | { ok: true; cfg: ChecklistConfig }
  | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: "must be a JSON object" };
  }
  const obj = parsed as Partial<ChecklistConfig>;
  if (!Array.isArray(obj.items)) {
    return { ok: false, error: "`items` must be an array" };
  }
  const items: ChecklistItem[] = obj.items.map((raw, i) => {
    if (typeof raw === "string") return { text: raw, done: false };
    if (typeof raw !== "object" || raw === null) {
      return { text: `(item ${i}: invalid)`, done: false };
    }
    const r = raw as { text?: unknown; done?: unknown };
    return {
      text: typeof r.text === "string" ? r.text : `(item ${i}: missing text)`,
      done: r.done === true,
    };
  });
  return {
    ok: true,
    cfg: {
      title: typeof obj.title === "string" ? obj.title : undefined,
      description:
        typeof obj.description === "string" ? obj.description : undefined,
      items,
    },
  };
}

function renderChecklist(
  jsonText: string,
  md: MarkdownIt,
  blockId: number | null = null,
): string {
  const result = parseChecklist(jsonText);
  if (!result.ok) {
    return `<div class="render-error">checklist error: ${escapeHtml(result.error)}</div>`;
  }
  const { cfg } = result;
  const total = cfg.items.length;
  const doneCount = cfg.items.filter((it) => it.done).length;
  const pct = total === 0 ? 0 : Math.round((doneCount / total) * 100);
  const blockAttr = blockId == null ? "" : ` data-block-id="${blockId}"`;
  const titleHtml = cfg.title
    ? `<div class="checklist-title">${escapeHtml(cfg.title)}</div>`
    : "";
  const descHtml = cfg.description
    ? `<div class="checklist-desc">${md.renderInline(cfg.description)}</div>`
    : "";
  const items = cfg.items
    .map((it, i) => {
      const doneClass = it.done ? " done" : "";
      const checked = it.done ? " checked" : "";
      // Interactive: client attaches a change handler that PATCHes
      // /api/blocks/:bid/checklist/:idx. The `disabled` attribute is
      // NOT set here so the box is clickable in the rendered page.
      // If blockId is missing (shouldn't happen post-backfill) we
      // disable the input — there's no server target to write back to.
      const disabled = blockId == null ? " disabled" : "";
      return (
        `<li class="checklist-item${doneClass}">` +
        `<label>` +
        `<input type="checkbox" class="checklist-toggle"${blockAttr} data-item-idx="${i}"${checked}${disabled} />` +
        `<span class="checklist-text">${md.renderInline(it.text)}</span>` +
        `</label>` +
        `</li>`
      );
    })
    .join("");
  return (
    `<div class="checklist"${blockAttr} data-total="${total}" data-done="${doneCount}">` +
    titleHtml +
    descHtml +
    `<div class="checklist-progress" data-pct="${pct}">` +
    `<div class="checklist-progress-bar" style="width:${pct}%"></div>` +
    `<div class="checklist-progress-text">${doneCount} / ${total}` +
    (total > 0 ? ` <span>(${pct}%)</span>` : "") +
    `</div>` +
    `</div>` +
    `<ul class="checklist-items">${items}</ul>` +
    blockBadge(blockId) +
    `</div>`
  );
}

function renderChartGrid(jsonText: string, blockId: number | null = null): string {
  let items: unknown;
  try {
    items = JSON.parse(jsonText);
  } catch (e) {
    return `<div class="render-error">chart-grid error: ${escapeHtml(
      (e as Error).message,
    )}</div>`;
  }
  if (!Array.isArray(items)) {
    return `<div class="render-error">chart-grid error: must be a JSON array of chart configs</div>`;
  }
  const cards = items
    .map((raw, i) => {
      if (typeof raw !== "object" || raw === null) {
        return `<div class="chart-card"><div class="render-error">item ${i}: not an object</div></div>`;
      }
      const { title, ...cfg } = raw as { title?: unknown };
      const safe = escapeAttr(JSON.stringify(cfg));
      const titleHtml =
        title !== undefined && title !== null
          ? `<h4 class="chart-card-title">${escapeHtml(String(title))}</h4>`
          : "";
      return `<div class="chart-card">${titleHtml}<canvas class="chart" data-chart="${safe}"></canvas></div>`;
    })
    .join("");
  return `<div class="chart-grid"${blockIdAttr(blockId)}>${cards}${blockBadge(blockId)}</div>`;
}

function buildMd(highlighter: Highlighter): MarkdownIt {
  const md: MarkdownIt = new MarkdownIt({
    html: false,
    linkify: true,
    breaks: false,
    highlight: (code, lang) => {
      const resolved = lang ? resolveLang(lang) : null;
      if (!resolved) {
        return `<pre class="plain"><code>${escapeHtml(code)}</code></pre>`;
      }
      try {
        return highlighter.codeToHtml(code, {
          lang: resolved,
          themes: { light: "github-light", dark: "github-dark" },
        });
      } catch {
        return `<pre class="plain"><code>${escapeHtml(code)}</code></pre>`;
      }
    },
  });

  md.use(anchor, {
    slugify,
    permalink: anchor.permalink.linkInsideHeader({
      symbol: "#",
      placement: "after",
      class: "header-anchor",
    }),
  });

  const defaultFence = md.renderer.rules.fence!;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const rawInfo = (token.info || "").trim();
    const { id: blockId, rest } = extractBlockId(rawInfo);
    const info = rest.split(/\s+/)[0].toLowerCase();
    if (info === "mermaid") {
      // Mermaid wipes its host's innerHTML when rendering, so the badge has
      // to live in a wrapper sibling rather than inside <pre class="mermaid">.
      return `<div class="rich-block-mermaid"${blockIdAttr(blockId)}><pre class="mermaid">${escapeHtml(token.content)}</pre>${blockBadge(blockId)}</div>\n`;
    }
    if (info === "chart") {
      return renderChart(token.content, blockId) + "\n";
    }
    if (info === "chart-grid") {
      return renderChartGrid(token.content, blockId) + "\n";
    }
    if (info === "stats") {
      return renderStats(token.content, blockId) + "\n";
    }
    if (info === "steps") {
      return renderSteps(token.content, md, blockId) + "\n";
    }
    if (info === "images") {
      return renderImages(token.content, blockId) + "\n";
    }
    if (info === "checklist") {
      return renderChecklist(token.content, md, blockId) + "\n";
    }
    if (info === "html-embed") {
      // Raw HTML for flexible content — richer tables, custom layouts,
      // gradient cards, <details>, inline SVG, iframes. Dropped as-is
      // inside a wrapper div so authors can scope styles via
      // `.html-embed > X`. <script> tags are inert (mounted via
      // dangerouslySetInnerHTML → innerHTML, which doesn't run scripts).
      return `<div class="html-embed"${blockIdAttr(blockId)}>\n${token.content}\n${blockBadge(blockId)}</div>\n`;
    }
    return defaultFence(tokens, idx, options, env, self);
  };

  // ─── Image sizing via the markdown title slot ───
  // Authors can constrain a `![alt](src "...")` image by writing the size
  // inside the title:
  //   "300x200"        → max-width 300, max-height 200
  //   "300x"           → max-width 300 only
  //   "x200"           → max-height 200 only
  //   "w=300 h=200"    → same, can mix with caption text ("photo w=300 h=200")
  // The image always keeps its aspect ratio (max-* + auto on the other axis).
  // Recognized size tokens are stripped from the rendered title attribute.
  const defaultImage = md.renderer.rules.image;
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const tok = tokens[idx];
    const titleIdx = tok.attrIndex("title");
    if (titleIdx >= 0) {
      const raw = tok.attrs![titleIdx][1];
      const parsed = parseImageSize(raw);
      if (parsed) {
        if (parsed.rest) tok.attrs![titleIdx][1] = parsed.rest;
        else tok.attrs!.splice(titleIdx, 1);
        const parts: string[] = [];
        if (parsed.width != null) parts.push(`max-width:${parsed.width}px`);
        if (parsed.height != null) parts.push(`max-height:${parsed.height}px`);
        parts.push("width:auto", "height:auto");
        tok.attrSet("style", parts.join(";"));
      }
    }
    return defaultImage
      ? defaultImage(tokens, idx, options, env, self)
      : self.renderToken(tokens, idx, options);
  };

  // ─── GFM task lists ───
  // Find inline tokens that sit inside `<li><p>…` and whose first text
  // child starts with `[ ]` or `[x]`. Strip the marker, prepend an
  // <input type="checkbox"> with a page-wide 0-based index, and mark the
  // parent <li> + <ul> so CSS can drop the bullet.
  md.core.ruler.after("inline", "task-lists", (state) => {
    const tokens = state.tokens;
    let taskIndex = 0;
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok.type !== "inline") continue;
      const prev1 = tokens[i - 1];
      const prev2 = tokens[i - 2];
      if (!prev1 || prev1.type !== "paragraph_open") continue;
      if (!prev2 || prev2.type !== "list_item_open") continue;
      const first = tok.children?.[0];
      if (!first || first.type !== "text") continue;
      const m = /^\[([ xX])\]\s+/.exec(first.content);
      if (!m) continue;
      const done = m[1].toLowerCase() === "x";
      const idx = taskIndex++;
      first.content = first.content.slice(m[0].length);
      const checkbox = new state.Token("html_inline", "", 0);
      checkbox.content = `<input type="checkbox" class="task-list-item-checkbox" data-task-index="${idx}"${done ? " checked" : ""}> `;
      tok.children = [checkbox, ...(tok.children ?? [])];
      prev2.attrJoin("class", "task-list-item");
      // Walk back to the enclosing list opener and tag it too.
      for (let j = i - 3; j >= 0; j--) {
        const t = tokens[j];
        if (t.type === "bullet_list_open" || t.type === "ordered_list_open") {
          t.attrJoin("class", "contains-task-list");
          break;
        }
      }
    }
    return false;
  });

  return md;
}

/**
 * Extract optional w/h constraints from an image title.
 * Returns null if the title carries no size hint.
 */
function parseImageSize(
  title: string,
): { width?: number; height?: number; rest: string } | null {
  const trimmed = title.trim();
  // Compact "WxH" / "Wx" / "xH"
  const m1 = /^(\d+)?x(\d+)?$/.exec(trimmed);
  if (m1 && (m1[1] || m1[2])) {
    return {
      width: m1[1] ? Number(m1[1]) : undefined,
      height: m1[2] ? Number(m1[2]) : undefined,
      rest: "",
    };
  }
  // Verbose "w=N" / "h=N" tokens (may co-exist with caption text)
  const tokenRe = /\b(w|width|h|height)=(\d+)\b/gi;
  let width: number | undefined;
  let height: number | undefined;
  let matched = false;
  for (let m: RegExpExecArray | null; (m = tokenRe.exec(trimmed)) !== null; ) {
    matched = true;
    const k = m[1].toLowerCase();
    if (k === "w" || k === "width") width = Number(m[2]);
    else height = Number(m[2]);
  }
  if (!matched) return null;
  const rest = trimmed
    .replace(/\b(?:w|width|h|height)=\d+\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return { width, height, rest };
}

export async function renderMarkdown(source: string): Promise<string> {
  const highlighter = await getHighlighter();
  const md = buildMd(highlighter);
  return md.render(source);
}

export interface TocEntry {
  level: number;
  id: string;
  text: string;
}

export function buildToc(source: string): TocEntry[] {
  const entries: TocEntry[] = [];
  const lines = source.split(/\r?\n/);
  let inFence = false;
  for (const line of lines) {
    if (/^```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = line.match(/^(#{2,3})\s+(.+?)\s*$/);
    if (!m) continue;
    const level = m[1].length;
    const text = m[2].replace(/\s*#+\s*$/, "");
    entries.push({ level, id: slugify(text), text });
  }
  return entries;
}
