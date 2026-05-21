import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { EXAMPLE_KINDS } from "./examples.js";
import type { ToolHandlers } from "./handlers.js";
import { getCallContext, withCallContext } from "../lib/callContext.js";

const SESSION_NOTE =
  "Claude Code chat session UUID (the value used by `claude --resume <id>`). " +
  "Available to hooks as session_id. Optional if unknown.";

const USER_PROMPT_NOTE =
  "User's message/question that triggered this doc — verbatim if possible. Shown in info popover.";
const TOKENS_NOTE =
  "Optional: token count AI used producing this knowledge (input+output). Shown in info popover.";

// `user_prompt` on every mutation tool. Opt-in: send only when the prompt
// carries intent — skip trivial follow-ups. The server caps at 500 chars.
const USER_PROMPT_EDIT_NOTE =
  "Optional. User's verbatim message that triggered this edit. Appended to the prompt-log so the UI can show 'why each revision happened'. Capped at 500 chars on insert. Skip for retries / trivial follow-ups.";

const addKnowledgeShape = {
  title: z.string().min(1).max(200).describe("Knowledge title shown in sidebar"),
  project: z
    .string()
    .min(1, "project is required")
    .max(100)
    .describe("Group key (e.g. repo/project name). Required — ACL gates on this."),
  session_id: z.string().max(200).optional().describe(SESSION_NOTE),
  user_prompt: z.string().max(8000).optional().describe(USER_PROMPT_NOTE),
  tokens_used: z.number().int().min(0).optional().describe(TOKENS_NOTE),
  tags: z.array(z.string().max(60)).max(20).optional(),
  author: z.string().max(100).optional(),
  first_page: z
    .object({
      title: z.string().min(1).max(200),
      content: z.string(),
      summary: z.string().max(500).optional(),
      keywords: z.array(z.string().max(60)).max(20).optional(),
    })
    .optional()
    .describe("Convenience: also create the first page in one call"),
};

const editKnowledgeShape = {
  id: z.number().int().positive(),
  title: z.string().min(1).max(200).optional(),
  project: z.string().min(1, "project is required").max(100).optional(),
  session_id: z.string().max(200).optional().describe(SESSION_NOTE),
  user_prompt: z.string().max(8000).optional().describe(USER_PROMPT_NOTE),
  tokens_used: z.number().int().min(0).optional().describe(TOKENS_NOTE),
  tags: z.array(z.string().max(60)).max(20).optional(),
};

const listKnowledgeShape = {
  project: z.string().optional(),
  session_id: z.string().optional(),
  tag: z.string().optional(),
  search: z.string().optional().describe("Title / project / tag / user_prompt substring (not content — use `search` for content)"),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
};

const getKnowledgeShape = {
  id: z.number().int().positive(),
  include_pages: z.boolean().optional().describe("Include page list (default true)"),
};

const deleteKnowledgeShape = { id: z.number().int().positive() };
const getOutlineShape = { knowledge_id: z.number().int().positive() };

const addPageShape = {
  knowledge_id: z.number().int().positive(),
  title: z.string().min(1).max(200).describe("Tab label"),
  content: z.string().describe(
    "Markdown body. **Block-choice guidance**: prefer plain markdown + the prepared semantic blocks FIRST — they're cheaper to read/edit, get richer search/extract tooling, render consistently across themes, and avoid inline-style noise. Pick by intent: " +
      "diagram / flow / sequence / ER → ```mermaid · " +
      "numeric series / comparison → ```chart or ```chart-grid · " +
      "KPI numbers → ```stats · " +
      "ordered procedure / how-to → ```steps · " +
      "tabular data → **plain markdown table** (gets `@N`, `[ ]` checkboxes in cells, `find_table_rows` search, `get_table_row` random access) · " +
      "showcase image grid (4+ side-by-side) → ```images (otherwise inline `![alt](src \"WxH\")` is simpler and supports drag-to-resize + lightbox). " +
      "Only reach for ```html-embed when a custom layout genuinely improves understanding (gradient status cards, decision matrix with row/col colors, badges + flex layout, `<details>` accordions, inline SVG, iframes) AND no prepared block fits. Inline `style=\"...\"` in html-embed is real token cost — it gets stripped by default when AI reads, so picking the right block upfront stays the cheapest. " +
      "Full fence list (for reference): ```mermaid (diagrams), ```chart / ```chart-grid (Chart.js), ```stats (KPI cards), ```steps (numbered step cards), ```html-embed (raw HTML for flexible tables, layouts, SVG, iframes), ```images (multi-image gallery — legacy; for a single image prefer plain markdown `![alt](src \"WxH\")` which now supports drag-to-resize + click-to-lightbox just like the gallery). " +
      "Each rendered fenced block is auto-assigned a stable global id and annotated in source as ```mermaid {@123}; you can refer to it by `@N` thereafter (e.g. 'update @123'). The annotation can carry a **caption** (like an HTML `<figcaption>` / a Word figure caption): ```mermaid {@123 \"Architecture: API → DB\"} — short text describing what the block IS, rendered as small italic text directly below the block. **Always set a caption when creating a rich block** so an AI calling `get_block({ id, summary: true })` or `read_page({ mode: \"summary\" })` can answer 'what is @123?' without paying the body's token cost. Set/update later via `set_block_caption({ id, caption })`. " +
      "Interactive checkboxes (three surfaces, all live, all flipped via the same `toggle_task` tool): " +
      "(a) GFM task list `- [ ] thing` / `- [x] done` inside any bulleted list, " +
      "(b) `[ ]` / `[x]` anywhere inside a markdown-table cell — e.g. `| Task | [ ] | Owner |` or `| Tests [x] Lint [x] Types [ ] |` (multiple per cell). The bracket pair must be bounded by whitespace or the cell separator `|`; wrap a literal `[x]` in backticks if you want to keep it as text, " +
      "(c) raw `<input type=\"checkbox\">` markup inside an ```html-embed block (use only when you need full HTML/CSS control — for ordinary todo tables prefer (b)). " +
      "The UI renders real clickable boxes that write back to source on click (server-side toggle, version-bumped, FTS-reindexed). `toggle_task` flips the Nth checkbox counted top-down across all three surfaces in source order (skipping any inside non-html-embed fenced code blocks). " +
      "Plain markdown tables also receive an `@N` id — the server appends a trailing `{@N}` line under every table on save (one blank line above it). `get_block({ id })` / `get_table_row` / `find_table_rows` all work on tables; `get_block({ id, summary: true })` returns just `columns` + `row_count` for cheap schema probes on big tables. " +
      "Images: upload via `add_image` first, then embed the returned `src`. **Default: plain markdown `![alt](/img/...)`** — works in paragraphs, list items, and markdown table cells. Sized via the title slot — `![alt](src \"WxH\")` (`\"300x200\"`, `\"300x\"` width-only, `\"x200\"` height-only, or `\"caption w=300 h=200\"`); aspect ratio always preserved. The web UI gives every inline image **drag-to-resize handles** (right edge / bottom edge / corner) that persist the new size back to the title slot, and **click opens a lightbox** with the full-resolution version — so a single `![](src \"WxH\")` covers both the inline-thumb-with-zoom case and the explicit-sized-figure case. Article column is ~860px wide on a typical screen, so a `\"720x\"` cap is a safe full-bleed default. The CSS clamps any over-large image to the column width as a safety net. " +
      "Two other surfaces, used only when the default doesn't fit: " +
      "(a) `<img src='/img/...' style='max-width:Npx'>` inside ```html-embed — when the image is part of a custom HTML layout (flex row, badges, `<details>`); the inline `style` attribute is where sizing lives. " +
      "(b) ```images fence (multi-image gallery, JSON array of `{ src, alt?, caption? }`) — rendered as a uniform thumbnail grid; useful for 4+ screenshots side by side. For a single image, plain markdown is now equivalent and simpler. " +
      "All three surfaces are picked up by `read_page`'s `images_referenced` list. " +
      "See get_example for templates.",
  ),
  position: z.number().int().min(1).optional().describe("1-based insert position; default = append"),
  summary: z.string().max(500).optional().describe("One-line tooltip on the tab"),
  keywords: z.array(z.string().max(60)).max(20).optional().describe("Per-page search hints"),
  user_prompt: z.string().max(2000).optional().describe(USER_PROMPT_EDIT_NOTE),
};

const editPageShape = {
  page_id: z.number().int().positive(),
  title: z.string().min(1).max(200).optional(),
  content: z.string().optional().describe("Replace entire page content"),
  summary: z.string().max(500).optional(),
  keywords: z.array(z.string().max(60)).max(20).optional(),
  user_prompt: z.string().max(2000).optional().describe(USER_PROMPT_EDIT_NOTE),
};

const appendPageShape = {
  page_id: z.number().int().positive(),
  text: z.string().min(1).describe("Text to append (auto-prepends newline if needed)"),
  user_prompt: z.string().max(2000).optional().describe(USER_PROMPT_EDIT_NOTE),
};

const deletePageShape = { page_id: z.number().int().positive() };
const listPagesShape = { knowledge_id: z.number().int().positive() };

const reorderPagesShape = {
  knowledge_id: z.number().int().positive(),
  order: z.array(z.number().int().positive()).min(1).describe("Permutation of existing page ids (new position = index+1)"),
};

const readPageShape = {
  page_id: z.number().int().positive(),
  line_start: z.number().int().min(1).optional().describe("1-based; default 1"),
  line_end: z.number().int().min(1).optional().describe("inclusive; default = last line"),
  mode: z
    .enum(["full", "summary"])
    .optional()
    .describe(
      "How to return the page body. `summary` (DEFAULT) = compact skeleton where every annotated rich block (mermaid / chart / chart-grid / stats / steps / html-embed / images) AND every annotated markdown table is replaced by a single placeholder line of the form `[@N kind 25 lines: caption]` (or `[@N table 12r × 3c: caption]`). Response also gains a `blocks` array listing each placeholder's id / kind / caption / source-line range. Typical 5-10× token saving for first reads, navigation, and 'tell me what's on this page' / 'find @47' probes. **`hash` is OMITTED in summary mode** — switch to `mode: \"full\"` (or pass `line_start`/`line_end`) BEFORE any `edit_lines` call. `full` returns verbatim markdown with hash + line numbers matching source.",
    ),
  include_styles: z
    .boolean()
    .optional()
    .describe(
      "By DEFAULT every `style=\"...\"` attribute inside `html-embed` fence bodies is stripped from the returned `content` — saves 60-70% of an html-embed block's tokens when you're just reading text/structure. Pass `true` only when you genuinely need to see/edit the presentation (recolouring, redesigning layout). No effect outside html-embed bodies.",
    ),
};

const editLinesShape = {
  page_id: z.number().int().positive(),
  line_start: z.number().int().min(1),
  line_end: z.number().int().min(1),
  new_text: z.string().describe("Lines replacing [line_start..line_end]. Empty string deletes the range. **Block-id preservation**: every `{@N}` annotation present in the replaced region is auto-carried into the first eligible slot in `new_text` (fence info / table-trailing line) when missing — so converting a block from one type to another (e.g. markdown table → html-embed) keeps the same `@N`. To opt out, include a different `{@N}` explicitly."),
  expected_hash: z
    .string()
    .optional()
    .describe(
      "Optional: hash of the line range from a recent read_page. Server rejects if hash doesn't match (gates against stale concurrent edits).",
    ),
  user_prompt: z.string().max(2000).optional().describe(USER_PROMPT_EDIT_NOTE),
};

const editSectionShape = {
  page_id: z.number().int().positive(),
  heading: z.string().min(1).describe('Exact heading line, e.g. "## 3. Performance" — section ends at next equal-or-higher heading'),
  new_content: z.string().describe("Body to put under the heading. The heading line itself is kept automatically — if you accidentally include it as the first line of new_content the server silently strips it (along with one optional blank line after) to avoid duplication. **Block-id preservation**: every `{@N}` from the replaced section is auto-carried into the first eligible slot in `new_content` (fence info / table-trailing line), so converting a block from one type to another keeps the same `@N`."),
  user_prompt: z.string().max(2000).optional().describe(USER_PROMPT_EDIT_NOTE),
};

const replaceTextShape = {
  knowledge_id: z.number().int().positive(),
  page_id: z.number().int().positive().optional().describe("Restrict to a single page; omit = all pages of knowledge"),
  find: z.string().min(1).describe("Literal substring (not regex)"),
  replace: z.string(),
  count: z.number().int().min(1).optional().describe("Max replacements total; omit = unlimited"),
  user_prompt: z.string().max(2000).optional().describe(USER_PROMPT_EDIT_NOTE),
};

const getPromptLogShape = {
  knowledge_id: z.number().int().positive(),
  limit: z.number().int().min(1).max(500).optional().describe("Default 100; max 500."),
  offset: z.number().int().min(0).optional(),
};

const toggleTaskShape = {
  page_id: z.number().int().positive(),
  index: z
    .number()
    .int()
    .min(0)
    .describe(
      "0-based index of the checkbox on the page, counted top-down in source order across GFM `- [ ]`/`- [x]` items, markdown-table cells (`[ ]`/`[x]` anywhere in a cell), and `<input type=\"checkbox\">` inside `html-embed`. Code fences other than `html-embed` are skipped. The web UI exposes the same index in each rendered checkbox's `data-task-index`.",
    ),
  expected_version: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Optional but recommended for AI workflows. Page `version` from the most recent `read_page` / `get_block`. The server rejects the toggle if the page has been edited since (another tool may have inserted / removed a checkbox earlier in the document, shifting all subsequent indices). Web UI clicks omit this (no race window between render and click). Read → toggle in the same turn? Pass `expected_version` from the read response.",
    ),
  user_prompt: z.string().max(2000).optional().describe(USER_PROMPT_EDIT_NOTE),
};

const searchShape = {
  query: z.string().min(1).describe("Full-text search (SQLite FTS5). Searches page content, title, keywords."),
  project: z.string().optional(),
  knowledge_id: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(200).optional(),
};

const addImageShape = {
  data_base64: z
    .string()
    .min(4)
    .describe(
      "Image bytes, base64-encoded. Max ~10MB decoded. Raw bytes only — no `data:` URI prefix.",
    ),
  mime_type: z
    .enum([
      "image/png",
      "image/jpeg",
      "image/jpg",
      "image/gif",
      "image/webp",
      "image/svg+xml",
    ])
    .describe("MIME type of the bytes. Determines the file extension."),
  alt: z
    .string()
    .max(500)
    .optional()
    .describe("Optional default alt text stored with the image record."),
};

const getImageShape = {
  hash: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional()
    .describe("Image SHA-256 (64-hex). Mutually exclusive with `src`."),
  src: z
    .string()
    .optional()
    .describe("Image path (`/img/<hash>.<ext>`). Mutually exclusive with `hash`."),
  max_bytes: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Skip inline embedding (return metadata only) when the image exceeds this byte budget. Default ~6MB.",
    ),
};

const getBlockShape = {
  id: z
    .number()
    .int()
    .positive()
    .describe(
      "Global block id — the `N` in `@N`. Each rendered rich fenced block (mermaid / chart / chart-grid / stats / steps / images / html-embed) is stamped with one of these in its fence info string. Plain markdown tables can also be annotated with a standalone `{@N}` line directly under the last row, in which case `kind` in the response is `\"table\"`.",
    ),
  summary: z
    .boolean()
    .optional()
    .describe(
      "When true, omit `source` and `inner` (no body bytes). For table blocks the response gains `columns: string[]` + `row_count: number` so you can probe a table's schema cheaply before deciding whether to fetch the full source or slice rows via get_table_row / find_table_rows. Use this for large tables where the body would be expensive.",
    ),
  include_styles: z
    .boolean()
    .optional()
    .describe(
      "Only meaningful for `kind: \"html-embed\"`. DEFAULT strips every `style=\"...\"` attribute from the returned source/inner — inline styles eat 60-70% of an html-embed block's tokens and add nothing when you're editing content or structure. Pass `true` only when you genuinely need the presentation (recolouring a card, redesigning layout). All non-style attrs (src/href/alt/title/data-*/class) are preserved either way.",
    ),
};

const getTableRowShape = {
  block_id: z
    .number()
    .int()
    .positive()
    .describe("Table block id (`@N`) — the table annotated with `{@N}` on the line directly below its last row."),
  index: z
    .number()
    .int()
    .describe("0-based data-row index (header + separator excluded). Negative wraps from the end: -1 = last row, -2 = second-last, …"),
};

const setBlockCaptionShape = {
  id: z.number().int().positive().describe("Block id (the N in @N)."),
  caption: z
    .string()
    .max(500)
    .nullable()
    .describe(
      "Caption text — short human description of what the block IS (like an HTML `<figcaption>` / Word figure caption: \"Architecture: API → DB\", \"Monthly revenue 2024 by region\", \"Q1 inventory by SKU\"). Pass an empty string or null to remove the caption. Max 500 chars.",
    ),
  user_prompt: z.string().max(2000).optional().describe(USER_PROMPT_EDIT_NOTE),
};

const findTableRowsShape = {
  block_id: z
    .number()
    .int()
    .positive()
    .describe("Table block id (`@N`)."),
  q: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Substring search (case-insensitive). Matched against every cell of every row, unless `columns` narrows the candidate set. Cheaper than pulling the whole table when you just need rows containing some text.",
    ),
  where: z
    .record(z.string())
    .optional()
    .describe(
      "Exact column=value match. Multiple keys are AND-ed. Case-sensitive — use `q` for fuzzy text search.",
    ),
  columns: z
    .array(z.string())
    .optional()
    .describe(
      "Restrict the `q` substring search to these column names. Has no effect on `where`. Omit to search all columns.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe("Cap on returned rows. Default 50, max 500. `total_matched` always reflects the full match count so callers know when results were truncated."),
};

const getExampleShape = {
  kind: z
    .enum(EXAMPLE_KINDS)
    .optional()
    .describe(
      "Example flavor; default 'full' shows every fenced-block type. " +
        "Pick one to learn the template for that fence: full / minimal / mermaid / chart / stats / steps / er / html. " +
        "Note: rendered rich blocks (mermaid/chart/chart-grid/stats/steps/html-embed/images) AND plain markdown tables all carry a `@N` id you can refer to later — tables get a trailing `{@N}` line auto-stamped under them on save. The annotation can also carry an optional caption (`{@N \"short description\"}`) — recommended for every non-trivial block so AI can probe it via `get_block({ summary: true })` / `read_page({ mode: \"summary\" })` without fetching the body.",
    ),
  outline_only: z
    .boolean()
    .optional()
    .describe("Return only the heading outline (cheapest — no body content)"),
  line_start: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Read only from this line (1-based, inclusive)"),
  line_end: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Read only up to this line (inclusive); default = last line"),
};

function jsonContent(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

/** Tool result containing the image (MCP `image` content block) followed by
 *  a JSON sidecar with metadata. The host (Claude Code etc.) renders the
 *  image inline; the JSON gives the agent the structured fields. */
function imageContent(meta: {
  data_base64?: string;
  mime: string;
  embedded: boolean;
  [k: string]: unknown;
}) {
  const content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  > = [];
  if (meta.embedded && meta.data_base64) {
    content.push({
      type: "image",
      data: meta.data_base64,
      mimeType: meta.mime,
    });
  }
  // Strip the bulky base64 from the sidecar to keep the text small.
  const sidecar = { ...meta };
  delete sidecar.data_base64;
  content.push({ type: "text", text: JSON.stringify(sidecar, null, 2) });
  return { content };
}

export function createMcpServer(
  rawHandlers: ToolHandlers,
  opts: { defaultUserId?: number | null } = {},
): McpServer {
  const server = new McpServer({ name: "wikikai", version: "0.2.0" });

  // Wrap every handler method so each MCP tool call runs inside an
  // AsyncLocalStorage context tagged with `{ source: "mcp", tool_name,
  // user_id }`. The activity-log recorder reads this context when
  // stamping rows — saves us threading source/tool/user through every
  // handler signature. `user_id` comes from `WIKIKAI_MCP_DEFAULT_USER`
  // (or the bootstrap admin) since MCP clients authenticate by token,
  // not user session.
  const fallbackUid = opts.defaultUserId ?? null;
  const handlers = new Proxy(rawHandlers, {
    get(target, prop) {
      const orig = (target as unknown as Record<string | symbol, unknown>)[
        prop
      ];
      if (typeof orig !== "function") return orig;
      return (input: unknown) => {
        // Prefer the user_id resolved by the /mcp route (per-user
        // Bearer token); fall back to the configured default when the
        // legacy `WIKIKAI_TOKEN` env var was used.
        const outer = getCallContext();
        const userId = outer.user_id ?? fallbackUid;
        return withCallContext(
          { source: "mcp", tool_name: String(prop), user_id: userId },
          () =>
            (orig as (i: unknown) => Promise<unknown>).call(target, input),
        );
      };
    },
  }) as ToolHandlers;

  // ─── Knowledge (container) ───
  server.registerTool(
    "add_knowledge",
    {
      title: "Create knowledge document",
      description:
        "Create a new multi-page knowledge document. Returns id you (or user) reference later. Optionally seed with `first_page` to do create-doc + create-page in one call.",
      inputSchema: addKnowledgeShape,
    },
    async (input) => jsonContent(await handlers.add_knowledge(input)),
  );

  server.registerTool(
    "edit_knowledge",
    {
      title: "Edit knowledge metadata",
      description: "Edit knowledge metadata only (title/project/tags/session_id/user_prompt). Use add_page/edit_page for content.",
      inputSchema: editKnowledgeShape,
    },
    async (input) => jsonContent(await handlers.edit_knowledge(input)),
  );

  server.registerTool(
    "list_knowledge",
    {
      title: "List knowledge documents",
      description: "List knowledge entries (metadata only). Use `get_knowledge` for page list, `search` for content search.",
      inputSchema: listKnowledgeShape,
    },
    async (input) => jsonContent(await handlers.list_knowledge(input)),
  );

  server.registerTool(
    "get_knowledge",
    {
      title: "Get knowledge + page list",
      description: "Return knowledge metadata + list of its pages (line counts, no content). Use `read_page` for content.",
      inputSchema: getKnowledgeShape,
    },
    async (input) => jsonContent(await handlers.get_knowledge(input)),
  );

  server.registerTool(
    "delete_knowledge",
    {
      title: "Delete knowledge",
      description: "Delete knowledge and all its pages.",
      inputSchema: deleteKnowledgeShape,
    },
    async (input) => jsonContent(await handlers.delete_knowledge(input)),
  );

  server.registerTool(
    "get_outline",
    {
      title: "Get token-efficient outline",
      description:
        "Return tree of page titles + heading hierarchy (no body). Best first call when reading existing knowledge — scan cheaply, then `read_page` the parts you care about.",
      inputSchema: getOutlineShape,
    },
    async (input) => jsonContent(await handlers.get_outline(input)),
  );

  // ─── Pages (chapters) ───
  server.registerTool(
    "add_page",
    {
      title: "Add a page to knowledge",
      description: "Append (or insert at position) a new page in a knowledge document. Each page is a tab in the UI.",
      inputSchema: addPageShape,
    },
    async (input) => jsonContent(await handlers.add_page(input)),
  );

  server.registerTool(
    "edit_page",
    {
      title: "Edit a page (replace content / metadata)",
      description: "Edit a page. Use `content` to replace, or `edit_lines`/`edit_section`/`replace_text` for surgical edits.",
      inputSchema: editPageShape,
    },
    async (input) => jsonContent(await handlers.edit_page(input)),
  );

  server.registerTool(
    "append_page",
    {
      title: "Append text to a page",
      description: "Append text to end of page (auto-prepends newline if needed). Doesn't require re-reading.",
      inputSchema: appendPageShape,
    },
    async (input) => jsonContent(await handlers.append_page(input)),
  );

  server.registerTool(
    "delete_page",
    {
      title: "Delete a page",
      description: "Delete a single page; remaining pages compact in position.",
      inputSchema: deletePageShape,
    },
    async (input) => jsonContent(await handlers.delete_page(input)),
  );

  server.registerTool(
    "list_pages",
    {
      title: "List pages in knowledge",
      description: "List pages with title, position, summary, line count, version.",
      inputSchema: listPagesShape,
    },
    async (input) => jsonContent(await handlers.list_pages(input)),
  );

  server.registerTool(
    "reorder_pages",
    {
      title: "Reorder pages",
      description: "Provide an array of page_ids in the new order (must be permutation of all existing pages).",
      inputSchema: reorderPagesShape,
    },
    async (input) => jsonContent(await handlers.reorder_pages(input)),
  );

  // ─── Line / section operations ───
  server.registerTool(
    "read_page",
    {
      title: "Read page (with parent knowledge context)",
      description:
        "Return page content + total line count + hash, plus the parent knowledge (&) with all sibling pages so you know where this page sits without a separate get_knowledge call. " +
        "**Two modes** (control via `mode`):\\n" +
        "  • `summary` (DEFAULT) — compact skeleton: every annotated rich fenced block is replaced by `[@N kind 25 lines: caption]` and every annotated markdown table by `[@N table 12r × 3c: caption]`. Response gains a `blocks` array listing each placeholder's id / kind / caption / source-line range. Typical 5–10× token saving — use for first reads, navigation, 'find @47' probes. **`hash` omitted** — switch to `full` before any line-based edit.\\n" +
        "  • `full` — verbatim markdown with `hash`, line numbers matching source. Use immediately before `edit_lines` / `edit_section` / any line-based op.\\n" +
        "The returned content (either mode) includes `{@N \"caption\"?}` annotations on every rich fenced block AND on every plain markdown table (as a trailing `{@N}` line under the table) — that's the global block id the user (or you) can refer to by `@N` later. `get_block({ id })` resolves either kind in one call; `get_block({ id, summary: true })` is even cheaper (returns caption + schema only). " +
        "If the page references any internal image (via plain markdown `![alt](/img/...)`, an ```images fence, OR a `<img src=\"/img/...\" />` inside an ```html-embed fence), the response carries `images_referenced` — pre-parsed list of `{ src, alt?, caption?, block_id?, via }` where `via` is `markdown` / `images` / `html-embed`. Use with `get_image({ src })` to view bytes inline. " +
        "Optional `line_start`/`line_end` to read just a slice. Always re-read with `mode: \"full\"` before `edit_lines` if you intend to use expected_hash.",
      inputSchema: readPageShape,
    },
    async (input) => jsonContent(await handlers.read_page(input)),
  );

  server.registerTool(
    "edit_lines",
    {
      title: "Edit a line range",
      description:
        "Replace lines [line_start..line_end] with new_text. ⚠️ Line numbers shift after every edit; prefer `edit_section` or `replace_text` when possible, or pass `expected_hash` from a recent read_page to detect drift.",
      inputSchema: editLinesShape,
    },
    async (input) => jsonContent(await handlers.edit_lines(input)),
  );

  server.registerTool(
    "edit_section",
    {
      title: "Replace a section (heading-based, stable)",
      description:
        "Find exact heading line and replace everything under it until the next equal-or-higher heading. Stable across other edits — preferred over edit_lines.",
      inputSchema: editSectionShape,
    },
    async (input) => jsonContent(await handlers.edit_section(input)),
  );

  server.registerTool(
    "replace_text",
    {
      title: "Find/replace literal text",
      description: "Replace `find` with `replace` across one page or all pages of a knowledge. No regex — literal substring only.",
      inputSchema: replaceTextShape,
    },
    async (input) => jsonContent(await handlers.replace_text(input)),
  );

  // ─── Search ───
  server.registerTool(
    "search",
    {
      title: "Full-text search across pages",
      description:
        "FTS5 trigram-tokenized search across page content, title, and keywords. " +
        "Project filter is optional — omit `project` to search every project. " +
        "Each hit returns the parent knowledge (&knowledge_id + title + project) and " +
        "the page (#page_id + position + title), the matched line, and the nearest " +
        "preceding heading containing it (level + text + anchor id) so you can deep-link " +
        "or call read_page with a tight line_start/line_end. Works for Thai/CJK too.",
      inputSchema: searchShape,
    },
    async (input) => jsonContent(await handlers.search(input)),
  );

  // ─── Block lookup ───
  server.registerTool(
    "get_block",
    {
      title: "Fetch a rich block or annotated table by its @N id",
      description:
        "Locate the page containing the given `@N` block id, parse the surrounding block, and return its source + inner body + line range + parent page/knowledge in one call. " +
        "Resolves both: (a) rich fenced blocks (mermaid / chart / chart-grid / stats / steps / images / html-embed) where `{@N}` lives in the fence info string, and (b) plain markdown tables annotated with a standalone `{@N}` line directly below the last data row — in that case `kind === \"table\"`, `source` is the header + separator + data rows, and `inner` is the data rows only. " +
        "Use this when the user references a block by id (e.g. 'update @47' / 'read @123') so you don't need to FTS + read_page + parse boundaries yourself. " +
        "Throws if the id isn't found. After reading, edit with `edit_lines({page_id, line_start, line_end, new_text, expected_hash})` from a fresh `read_page`, or rewrite the whole page section with `edit_section`.",
      inputSchema: getBlockShape,
    },
    async (input) => jsonContent(await handlers.get_block(input)),
  );

  server.registerTool(
    "get_table_row",
    {
      title: "Read a single row from a markdown table by @N + index",
      description:
        "Returns one data row of a table block as a `{ columnName: cellText }` object. `block_id` is the table's `@N` (use `get_block` if you only know the page). `index` is the 0-based data-row position (the header row + separator row are NOT counted); pass a negative number to wrap from the end (`-1` = last row, `-2` = second-last). " +
        "Also returns `source_line` — the 1-based line number of that row in the page source, handy for follow-up `edit_lines`. Throws if `@N` isn't a table or the index is out of range. " +
        "When you don't know the index (e.g. 'find the row where name=Alice' / 'rows containing X'), use `find_table_rows` instead.",
      inputSchema: getTableRowShape,
    },
    async (input) => jsonContent(await handlers.get_table_row(input)),
  );

  server.registerTool(
    "find_table_rows",
    {
      title: "Search rows inside a markdown table by text or column value",
      description:
        "Search for rows inside a markdown-table block without pulling the whole table. " +
        "Returns `{ block_id, columns, matches: [{ row_index, columns, source_line, url }], total_matched, truncated }` where `columns` is the table's header list and each match is one data row as a `{ columnName: cellText }` object. " +
        "Three filter modes (combine freely):\\n" +
        "  • `q` — substring search (case-insensitive). Matched against every cell, unless `columns` narrows the candidate set.\\n" +
        "  • `where` — exact column=value match. Multiple keys are AND-ed. Case-sensitive (use `q` for fuzzy).\\n" +
        "  • `columns` — restrict the `q` search to these column names only. No effect on `where`.\\n" +
        "Use this for 'rows mentioning X' / 'row where col=value' / 'first N rows of @47' (call with no filters + `limit`). " +
        "`limit` defaults to 50, max 500; `total_matched` always reports the full count so you can detect truncation. " +
        "Cheaper than `get_block` for large tables — only the matching rows + their source-line numbers come back, not the whole body.",
      inputSchema: findTableRowsShape,
    },
    async (input) => jsonContent(await handlers.find_table_rows(input)),
  );

  server.registerTool(
    "set_block_caption",
    {
      title: "Set or clear a block's caption (figcaption)",
      description:
        "Update the `caption` text on the annotation of a rich block (mermaid / chart / chart-grid / stats / steps / html-embed / images) or a markdown table. The caption is the same idea as an HTML `<figcaption>` or a Word figure caption — short human description of what the block IS, rendered as small italic text directly below the block. " +
        "Captions are recommended on every non-trivial block so the AI can answer 'what is @47?' via `get_block({ id: 47, summary: true })` (returns the caption without fetching the body — a ~10× token saving on large mermaid/chart bodies). " +
        "Source-level form: `{@N \"caption text\"}` for fences, or the trailing-line annotation under a table. Pass `null` or empty string to remove an existing caption. Bumps page version + snapshots revision like any other edit.",
      inputSchema: setBlockCaptionShape,
    },
    async (input) => jsonContent(await handlers.set_block_caption(input)),
  );

  // ─── Image upload ───
  server.registerTool(
    "add_image",
    {
      title: "Upload an image (content-addressed)",
      description:
        "Store raw image bytes (base64-encoded). Returns `{ src, hash, mime, size_bytes, … }` where `src` is the public path (`/img/<hash>.<ext>`). " +
        "Filenames derive from the SHA-256 of the bytes, so identical content dedupes and URLs are immutable (client-cached forever). " +
        "Supported types: image/png, image/jpeg, image/gif, image/webp, image/svg+xml. " +
        "**Default: plain markdown `![alt](<src>)`** — works in paragraphs, list items, AND markdown table cells (e.g. `| Logo | ![brand](/img/abc….png) | … |`). Size via the title slot — `![alt](<src> \"WxH\")` (`\"300x200\"` fits both, `\"300x\"` width-only, `\"x200\"` height-only, or `\"caption w=300 h=200\"` to mix with caption text); aspect ratio always preserved (max-width / max-height + auto on the other axis). The web UI gives every inline image **drag-to-resize handles** (right/bottom/corner) that persist back to the title slot, and **click opens a lightbox** with the full-resolution image — so one markdown line covers both inline-thumbnail-with-zoom and explicit-size-figure cases. Article column is ~860px wide on a typical screen; `\"720x\"` is a safe full-bleed cap. The CSS clamps any over-large image to the column as a safety net.\\n" +
        "Two other surfaces, used only when the default doesn't fit:\\n" +
        "  • `<img src='<src>' style='max-width:Npx' />` inside an ```html-embed fence — when the image must live inside a custom HTML layout (flex row, gradient card, `<details>`, custom border). Inline `style` is where sizing lives.\\n" +
        "  • ```images fence (JSON array of `{ src, alt?, caption? }`) — uniform thumbnail grid for **4+ side-by-side screenshots**. For a single image, plain markdown is now equivalent and simpler — only reach for this fence when you genuinely want the grid layout.\\n" +
        "All three surfaces are picked up by `read_page`'s `images_referenced` list (with `via` set to `markdown` / `images` / `html-embed`). Use `get_image({ hash })` later to view the bytes inline in the assistant.",
      inputSchema: addImageShape,
    },
    async (input) => jsonContent(await handlers.add_image(input)),
  );

  // ─── Image fetch ───
  server.registerTool(
    "get_image",
    {
      title: "View an uploaded image inline",
      description:
        "Resolve an image by hash or by its `/img/<hash>.<ext>` path and return it as an MCP image content block — the assistant sees the picture rendered alongside the JSON metadata. " +
        "Use this when a page contains an ```images fence and you need to describe / edit / validate what the user is referring to. " +
        "If the image is larger than `max_bytes` (default ~6MB), the call still returns metadata but skips the inline bytes (`embedded: false`).",
      inputSchema: getImageShape,
    },
    async (input) => imageContent(await handlers.get_image(input)),
  );

  // ─── Example template ───
  server.registerTool(
    "get_example",
    {
      title: "Get example markdown template (3 read modes)",
      description:
        "Fetch a ready-made markdown example showing portal-friendly conventions (mermaid, chart, stats, steps, tables). Three modes to keep token usage low:\n" +
        "  1. outline_only:true → just the heading list + total_lines (cheapest scan)\n" +
        "  2. line_start/line_end → read only a slice (after scanning outline)\n" +
        "  3. default → full content + outline\n" +
        "Recommended flow: outline_only first → pick the section by heading line → read just that line range.",
      inputSchema: getExampleShape,
    },
    async (input) => jsonContent(await handlers.get_example(input)),
  );

  // ─── Interactive checkboxes ───
  // GFM-style `- [ ] item` / `- [x] item` task lists. Same code path
  // the rendered UI uses when the user clicks a checkbox.
  server.registerTool(
    "toggle_task",
    {
      title: "Toggle an interactive checkbox on a page",
      description:
        "Flip an interactive checkbox by `page_id` + a 0-based `index` counted top-down across the page in source order. Three surfaces are detected, sharing the same counter: " +
        "(a) GFM task items `- [ ] thing` / `- [x] thing` inside a list, " +
        "(b) `[ ]` / `[x]` anywhere inside a markdown-table cell — start, middle, or multiple per cell (e.g. `| [ ] one [ ] two | done |`). The bracket pair must be bounded by whitespace or the cell separator `|`, so `[abc]` and markdown links like `[link](url)` are not detected. Wrap literal `[x]` in backticks to keep it as text. " +
        "(c) `<input type=\"checkbox\">` markup inside an `html-embed` fence. " +
        "Tasks inside any non-`html-embed` fenced code block are skipped. Writes the new state back to the page source (bumps version, snapshots revision, reindexes FTS). Web UI calls this same endpoint when a user clicks a rendered checkbox. " +
        "**Race-safety note for AI**: indices are recomputed top-down from current source on every call, so if another tool inserts / removes a checkbox earlier in the document between your `read_page` and your `toggle_task`, index N now points at a DIFFERENT checkbox. Pass `expected_version` from your most recent read to make the server reject the call instead of flipping the wrong box. Without `expected_version` you get the web UI's behaviour (immediate flip, no race check). " +
        "Use when the user says 'tick task 2 on page #19', 'mark the third checkbox done', or 'uncheck item 0'.",
      inputSchema: toggleTaskShape,
    },
    async (input) => jsonContent(await handlers.toggle_task(input)),
  );

  // ─── Prompt log ───
  server.registerTool(
    "get_prompt_log",
    {
      title: "List the per-knowledge prompt log",
      description:
        "Return the rolling audit trail of `user_prompt` values recorded on every mutation (add_knowledge / add_page / edit_page / append_page / edit_lines / edit_section / replace_text / edit_knowledge). " +
        "Each entry carries: page_id (null = knowledge-level), page_version (after the change, when applicable), tool_name, prompt text (capped at 500 chars), created_at. " +
        "Use this to answer 'why did revision N happen?' or to retrieve the user's verbatim ask that shaped a section.",
      inputSchema: getPromptLogShape,
    },
    async (input) => jsonContent(await handlers.get_prompt_log(input)),
  );

  return server;
}
