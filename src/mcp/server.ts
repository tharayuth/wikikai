import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { EXAMPLE_KINDS } from "./examples.js";
import type { ToolHandlers } from "./handlers.js";

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
  project: z.string().max(100).optional().describe("Group key (e.g. repo/project name)"),
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
  project: z.string().max(100).optional(),
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
    "Markdown body. Custom fences for richer content: ```mermaid (diagrams), ```chart / ```chart-grid (Chart.js), ```stats (KPI cards), ```steps (numbered step cards), ```images (thumbnail gallery from add_image src paths), ```html-embed (raw HTML for flexible tables, layouts, SVG, iframes, AND `<img>` tags using add_image src paths). " +
      "Each rendered fenced block is auto-assigned a stable global id and annotated in source as ```mermaid {@123}; you can refer to it by `@N` thereafter (e.g. 'update @123'). " +
      "Interactive checkboxes: write a GFM task list — `- [ ] thing to do` / `- [x] done` inside any bulleted list. The UI renders real clickable checkboxes that write back to source on click (server-side toggle, version-bumped, FTS-reindexed). AI can drive the same toggle via the `toggle_task` tool — pass `page_id` + the 0-based task index (counted top-down across all `- [ ]` / `- [x]` lines on the page, skipping any inside fenced code). For checkboxes inside a styled table or custom HTML layout, drop `<input type=\"checkbox\">` markup inside an ```html-embed block — visual-only (no write-back), useful for status readouts. " +
      "Plain markdown tables ARE supported but do NOT receive an `@N` id — if a table needs to be referenceable, write it as a `<table>` inside an ```html-embed block instead. " +
      "Images: upload via `add_image` first, then embed the returned `src` in any of three ways: (a) plain markdown `![alt](/img/...)` — the most flexible, works in paragraphs, list items, AND markdown table cells; use this when the image is inline content. Optional sizing via the title slot — `![alt](src \"WxH\")` (e.g. `\"300x200\"`, `\"300x\"` width-only, `\"x200\"` height-only, or `\"caption w=300 h=200\"`); aspect ratio is always preserved. (b) Paste the `src` into an ```images fence for a thumbnail gallery with click-to-lightbox, or (c) `<img src='/img/...' />` inside an ```html-embed when the image is part of a custom HTML layout (flex row, `<details>`, custom width). All three surfaces are picked up by `read_page`'s `images_referenced` list. " +
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
};

const editLinesShape = {
  page_id: z.number().int().positive(),
  line_start: z.number().int().min(1),
  line_end: z.number().int().min(1),
  new_text: z.string().describe("Lines replacing [line_start..line_end]. Empty string deletes the range."),
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
  new_content: z.string().describe("Body to put under the heading (heading itself is kept)"),
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
      "0-based index of the GFM task on the page (counts `- [ ]` / `- [x]` lines top-down, skipping any inside fenced code blocks). The web UI exposes the same index in each rendered checkbox's `data-task-index`.",
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
      "Global block id — the `N` in `@N`. Each rendered rich fenced block (mermaid / chart / chart-grid / stats / steps / html-embed) is stamped with one of these and the source carries it as ```mermaid {@N}.",
    ),
};

const getExampleShape = {
  kind: z
    .enum(EXAMPLE_KINDS)
    .optional()
    .describe(
      "Example flavor; default 'full' shows every fenced-block type. " +
        "Pick one to learn the template for that fence: full / minimal / mermaid / chart / stats / steps / er / html. " +
        "Note: rendered rich blocks (mermaid/chart/chart-grid/stats/steps/html-embed) carry a `@N` id you can refer to later. " +
        "Plain markdown tables don't — wrap a `<table>` in `html-embed` if you need to address the table by id.",
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

export function createMcpServer(handlers: ToolHandlers): McpServer {
  const server = new McpServer({ name: "wikikai", version: "0.2.0" });

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
        "Return page content + total line count + hash. The response also includes the parent knowledge (&) with all sibling pages, so you know where this page sits in the document without a separate get_knowledge call. " +
        "The returned content includes `{@N}` annotations on every rich fenced block — that's the global block id the user (or you) can refer to by `@N` later. Plain markdown tables don't have one; if the user asks to update a table by `@N`, the table needs to be authored as `<table>` inside an `html-embed` fence first. " +
        "If the page references any internal image (via an ```images fence OR a `<img src=\"/img/...\" />` inside an ```html-embed fence), the response carries `images_referenced` — a pre-parsed list of `{ src, alt?, caption?, block_id?, via }` where `via` is either 'images' or 'html-embed'. Use it with `get_image({ src })` to view the bytes inline instead of re-scanning the page yourself. " +
        "Optional line_start/line_end to read just a slice. Always re-read before `edit_lines` if you intend to use expected_hash.",
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
      title: "Fetch a rich block by its @N id",
      description:
        "Locate the page containing the given `@N` block id, parse the wrapping fence, and return the block's source + inner body + line range + parent page/knowledge in one call. " +
        "Use this when the user references a block by id (e.g. 'update @47' / 'read @123') so you don't need to FTS + read_page + parse boundaries yourself. " +
        "Throws if the id isn't found. After reading, edit with `edit_lines({page_id, line_start, line_end, new_text, expected_hash})` from a fresh `read_page`, or rewrite the whole page section with `edit_section`.",
      inputSchema: getBlockShape,
    },
    async (input) => jsonContent(await handlers.get_block(input)),
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
        "Three ways to embed the returned `src` in a page — pick whichever fits the surrounding content:\\n" +
        "  • Plain markdown `![alt](<src>)` — the most flexible. Works in paragraphs, list items, AND markdown table cells. Use when the image is inline content (a screenshot in prose, a thumbnail inside a comparison table). Example table cell: `| Logo | ![brand](/img/abc….png) | … |`. Optional size via the title slot — `![alt](<src> \"WxH\")` (e.g. `\"300x200\"` fits both, `\"300x\"` width-only, `\"x200\"` height-only, or `\"caption w=300 h=200\"` to mix with caption text); aspect ratio is always preserved (uses max-width / max-height + auto on the other axis).\\n" +
        "  • ```images fence — JSON array of `{ src, alt?, caption? }`; renders a thumbnail grid with click-to-lightbox. Use for galleries.\\n" +
        "  • `<img src='<src>' alt='...' />` inside an ```html-embed fence — when the image is part of a custom HTML layout (flex row, `<details>`, custom width/border).\\n" +
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
      title: "Toggle a `- [ ]` task checkbox on a page",
      description:
        "Flip a GFM-style task checkbox written as `- [ ] task` or `- [x] task` in a list. " +
        "Identifies the target by `page_id` + a 0-based `index` counted top-down across all such lines on the page (tasks inside fenced code blocks are skipped). " +
        "Writes the new `[ ]` / `[x]` marker back to the page source (bumps version, snapshots revision, reindexes FTS). The web UI calls this same endpoint when a user clicks a rendered checkbox. " +
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
