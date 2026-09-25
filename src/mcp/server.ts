import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ZodRawShape } from "zod";
import {
  AddFileSchema,
  AddImageSchema,
  AddKnowledgeSchema,
  AddLinesSchema,
  AddPageSchema,
  AppendTableRowsSchema,
  DeleteKnowledgeSchema,
  DeletePageSchema,
  EditKnowledgeSchema,
  EditLinesSchema,
  EditPageSchema,
  EditSectionSchema,
  FindTableRowsSchema,
  GetBlockSchema,
  GetExampleSchema,
  GetImageSchema,
  GetKnowledgeSchema,
  GetOutlineSchema,
  GetPromptLogSchema,
  GetTableRowsSchema,
  GetTableRowsWithCheckboxSchema,
  GetUploadUrlSchema,
  InsertLinesSchema,
  InsertTableRowsSchema,
  ListKnowledgeSchema,
  MovePageSchema,
  ReadPageSchema,
  ReorderPagesSchema,
  ReplaceTextSchema,
  RevealSecretSchema,
  SealSecretSchema,
  SearchSchema,
  SetBlockCaptionSchema,
  ToggleTaskSchema,
  UpdateTableRowsSchema,
  type ToolHandlers,
} from "./handlers.js";
import { getCallContext, withCallContext } from "../lib/callContext.js";

// Tool and parameter descriptions are the MCP catalog every client loads,
// usually at the start of every session, so each sentence here is paid for
// again and again. The rule: say what the name and schema don't, once —
// parameter meaning lives in the schemas in handlers.ts (registered below by
// their shapes), and a tool's description covers behaviour, choices between
// tools, return fields worth knowing, and traps.

type ObjectLike<T extends ZodRawShape> =
  | z.ZodObject<T>
  | z.ZodEffects<z.ZodObject<T>>
  | z.ZodEffects<z.ZodEffects<z.ZodObject<T>>>;

/** The object shape under any `.refine()` wrappers — what registerTool takes.
 *  Refinements still run: every handler re-parses its full schema. */
function shapeOf<T extends ZodRawShape>(schema: ObjectLike<T>): T {
  let s: z.ZodTypeAny = schema;
  while (s instanceof z.ZodEffects) s = s.innerType();
  return (s as z.ZodObject<T>).shape;
}

/** add_image / add_file over MCP: `path` is the only way in (the base64
 *  field serves the portal's own upload route), so it is required here. */
function importShape<T extends ZodRawShape & { path: z.ZodOptional<z.ZodString> }>(
  schema: ObjectLike<T>,
) {
  const { data_base64: _internal, path: optionalPath, ...rest } = shapeOf(schema);
  return { path: optionalPath.unwrap().describe(optionalPath.description ?? ""), ...rest };
}

const here = path.dirname(fileURLToPath(import.meta.url));
function packageVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(here, "..", "..", "package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** Compact JSON: indentation would add tokens to every result an agent reads. */
function jsonContent(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

/** Tool result containing the image (MCP `image` content block) followed by
 *  a JSON sidecar with metadata. The host (Claude Code etc.) renders the
 *  image inline; the JSON gives the agent the structured fields. */
function imageContent(meta: {
  data_base64?: string;
  mime: string;
  embedded: boolean;
  /** Set by get_image: the inlined bytes may be a scaled WebP copy. */
  served?: { mime: string };
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
      mimeType: meta.served?.mime ?? meta.mime,
    });
  }
  // Strip the bulky base64 from the sidecar to keep the text small.
  const sidecar = { ...meta };
  delete sidecar.data_base64;
  content.push({ type: "text", text: JSON.stringify(sidecar) });
  return { content };
}

const EDIT_FEEDBACK =
  "Returns `changed_range` (before/after line ranges), `changed_range_hash` (the next `expected_hash` for the after-range, no re-read needed), `page_hash`, `status` (`noop` = nothing changed) and `affected` headings and blocks, including newly stamped ids.";

export function createMcpServer(
  rawHandlers: ToolHandlers,
  opts: { defaultUserId?: number | null } = {},
): McpServer {
  const server = new McpServer({ name: "wikikai", version: packageVersion() });

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

  // ─── Documents (&N) ───
  server.registerTool(
    "add_knowledge",
    {
      title: "Create document",
      description:
        "Create a knowledge document — a set of page tabs — and return its id (`&N`) and url. Pass `first_page` to add the first page in the same call. Non-admins need edit access to `project`.",
      inputSchema: shapeOf(AddKnowledgeSchema),
    },
    async (input) => jsonContent(await handlers.add_knowledge(input)),
  );

  server.registerTool(
    "edit_knowledge",
    {
      title: "Edit document metadata",
      description: "Change a document's metadata. Page content is changed with the page tools.",
      inputSchema: shapeOf(EditKnowledgeSchema),
    },
    async (input) => jsonContent(await handlers.edit_knowledge(input)),
  );

  server.registerTool(
    "list_knowledge",
    {
      title: "List documents",
      description: "List documents you can see, newest first — metadata only.",
      inputSchema: shapeOf(ListKnowledgeSchema),
    },
    async (input) => jsonContent(await handlers.list_knowledge(input)),
  );

  server.registerTool(
    "get_knowledge",
    {
      title: "Get document",
      description:
        "A document's metadata and its pages (id, title, position, summary, line count, version, url) — no page content.",
      inputSchema: shapeOf(GetKnowledgeSchema),
    },
    async (input) => jsonContent(await handlers.get_knowledge(input)),
  );

  server.registerTool(
    "delete_knowledge",
    {
      title: "Delete document",
      description: "Permanently delete a document with all its pages, revisions and prompt log. There is no undo.",
      inputSchema: shapeOf(DeleteKnowledgeSchema),
    },
    async (input) => jsonContent(await handlers.delete_knowledge(input)),
  );

  server.registerTool(
    "get_outline",
    {
      title: "Get document outline",
      description:
        "Cheapest overview of a document: each page's headings and its blocks (`@N`, kind, caption, line range; row count for tables). Start here, then read_page or get_block only what you need.",
      inputSchema: shapeOf(GetOutlineSchema),
    },
    async (input) => jsonContent(await handlers.get_outline(input)),
  );

  // ─── Pages (#N) ───
  server.registerTool(
    "add_page",
    {
      title: "Add page",
      description: "Add a page (a tab) to a document. Returns its id (`#N`) and url.",
      inputSchema: shapeOf(AddPageSchema),
    },
    async (input) => jsonContent(await handlers.add_page(input)),
  );

  server.registerTool(
    "edit_page",
    {
      title: "Replace page",
      description:
        "Replace a page's whole content and/or its title, summary or keywords. To change part of a page use edit_section, edit_lines, insert_lines, add_lines or replace_text.",
      inputSchema: shapeOf(EditPageSchema),
    },
    async (input) => jsonContent(await handlers.edit_page(input)),
  );

  server.registerTool(
    "delete_page",
    {
      title: "Delete page",
      description: "Permanently delete a page and its revisions; later pages move up. There is no undo.",
      inputSchema: shapeOf(DeletePageSchema),
    },
    async (input) => jsonContent(await handlers.delete_page(input)),
  );

  server.registerTool(
    "reorder_pages",
    {
      title: "Reorder pages",
      description: "Set the complete page order of a document. To move a single page, use move_page.",
      inputSchema: shapeOf(ReorderPagesSchema),
    },
    async (input) => jsonContent(await handlers.reorder_pages(input)),
  );

  server.registerTool(
    "move_page",
    {
      title: "Move page",
      description:
        "Move one page. Within its document pass one of `before`, `after` or `position`. To another document pass `knowledge_id`, plus `position` if it shouldn't go last; the page keeps its id, history and images.",
      inputSchema: shapeOf(MovePageSchema),
    },
    async (input) => jsonContent(await handlers.move_page(input)),
  );

  // ─── Reading and editing a page ───
  server.registerTool(
    "read_page",
    {
      title: "Read page",
      description:
        "Read a page, with its document's page list. `summary` mode collapses each block and table to one `[@N kind …: caption]` line and lists them in `blocks`; `full` mode returns the markdown with line numbers matching the source, plus `hash` for edit_lines. `version` is the page version for `expected_version`. `hash` is left out whenever the text differs from the source: summary mode, `absolute_image_urls`, or html-embed styles stripped (then read with `include_styles: true` before editing). In summary mode `total_lines` counts the collapsed text and `source_total_lines` the page. `images_referenced` lists the page's images for get_image.",
      inputSchema: shapeOf(ReadPageSchema),
    },
    async (input) => jsonContent(await handlers.read_page(input)),
  );

  server.registerTool(
    "edit_section",
    {
      title: "Replace section",
      description:
        "Replace everything under a heading, up to the next heading of the same or higher level; the heading line stays. Unaffected by other edits shifting lines, so prefer it to edit_lines. The first matching heading outside code fences is used. " +
        EDIT_FEEDBACK,
      inputSchema: shapeOf(EditSectionSchema),
    },
    async (input) => jsonContent(await handlers.edit_section(input)),
  );

  server.registerTool(
    "edit_lines",
    {
      title: "Replace lines",
      description:
        "Replace lines `line_start`..`line_end` of a page. Line numbers shift with every edit — pass `expected_hash` so a stale range fails instead of hitting the wrong lines. A table's `{@N}` sits two lines under its last row; include them when replacing a whole table. " +
        EDIT_FEEDBACK,
      inputSchema: shapeOf(EditLinesSchema),
    },
    async (input) => jsonContent(await handlers.edit_lines(input)),
  );

  server.registerTool(
    "insert_lines",
    {
      title: "Insert lines",
      description: "Insert `new_text` as whole lines before line `at`; the lines below move down. " + EDIT_FEEDBACK,
      inputSchema: shapeOf(InsertLinesSchema),
    },
    async (input) => jsonContent(await handlers.insert_lines(input)),
  );

  server.registerTool(
    "add_lines",
    {
      title: "Append to page",
      description: "Append `new_text` to the end of a page, starting on a new line.",
      inputSchema: shapeOf(AddLinesSchema),
    },
    async (input) => jsonContent(await handlers.add_lines(input)),
  );

  server.registerTool(
    "replace_text",
    {
      title: "Find and replace",
      description:
        "Replace literal text in one page or in every page of a document. Returns the replacement count per page.",
      inputSchema: shapeOf(ReplaceTextSchema),
    },
    async (input) => jsonContent(await handlers.replace_text(input)),
  );

  // ─── Search ───
  server.registerTool(
    "search",
    {
      title: "Search pages",
      description:
        "Ranked search over page content, titles and keywords, across every project you can see unless filtered. Rare words decide the ranking and filler words cost nothing; words under 3 characters are ignored. Matching is literal — a Thai question won't find a page written only in English. Each hit gives the document and page, the best line with its heading, a snippet and `match_ratio` (share of your terms it contains — well below 1 means a weak hit), usually enough to answer without read_page. `total` counts all relevant pages; raise `limit` to get more of them.",
      inputSchema: shapeOf(SearchSchema),
    },
    async (input) => jsonContent(await handlers.search(input)),
  );

  // ─── Blocks (@N) ───
  server.registerTool(
    "get_block",
    {
      title: "Get block",
      description:
        "Fetch a block by its `@N` id: kind (mermaid, chart, chart-grid, stats, steps, images, file, secret, html-embed, md, text/typescript/bash code, or table), caption, `source`, `inner` body, line range, page `version`, and its page and document. Tables: `source` is header + rows, `inner` the data rows. To change it, use the table tools or set_block_caption, or edit_lines on its range after a full read_page of that range.",
      inputSchema: shapeOf(GetBlockSchema),
    },
    async (input) => jsonContent(await handlers.get_block(input)),
  );

  server.registerTool(
    "set_block_caption",
    {
      title: "Set block caption",
      description:
        "Set or remove the caption of a block or table — the short text saying what it is, shown under it and returned by summary reads so an agent can tell what `@N` is without its body.",
      inputSchema: shapeOf(SetBlockCaptionSchema),
    },
    async (input) => jsonContent(await handlers.set_block_caption(input)),
  );

  // ─── Tables ───
  server.registerTool(
    "get_table_rows",
    {
      title: "Read table rows",
      description:
        "Read data rows of a table block as `{column: cell}` objects with their source line numbers: `start` alone for one row, or with `end` / `offset` for a range. `truncated` says `limit` cut it short.",
      inputSchema: shapeOf(GetTableRowsSchema),
    },
    async (input) => jsonContent(await handlers.get_table_rows(input)),
  );

  server.registerTool(
    "find_table_rows",
    {
      title: "Find table rows",
      description:
        "Find rows of a table block without reading all of it, by `q` and/or `where`; with neither, returns the first `limit` rows. Each match has `row_index` and `source_line`; `total_matched` counts every match.",
      inputSchema: shapeOf(FindTableRowsSchema),
    },
    async (input) => jsonContent(await handlers.find_table_rows(input)),
  );

  server.registerTool(
    "get_table_rows_with_checkbox",
    {
      title: "Table rows with checkboxes",
      description:
        "Rows of a table block that contain `[ ]`/`[x]` checkboxes. Each row lists its boxes with `task_index` — the page-wide index toggle_task takes, which differs from `row_index`.",
      inputSchema: shapeOf(GetTableRowsWithCheckboxSchema),
    },
    async (input) => jsonContent(await handlers.get_table_rows_with_checkbox(input)),
  );

  server.registerTool(
    "update_table_rows",
    {
      title: "Replace table rows",
      description:
        "Replace a range of data rows in a table block, or delete it with `new_rows: []`. The header and the table's `{@N}` line are left alone.",
      inputSchema: shapeOf(UpdateTableRowsSchema),
    },
    async (input) => jsonContent(await handlers.update_table_rows(input)),
  );

  server.registerTool(
    "append_table_rows",
    {
      title: "Append table rows",
      description: "Add rows to the end of a table block. Returns `new_row_indices`.",
      inputSchema: shapeOf(AppendTableRowsSchema),
    },
    async (input) => jsonContent(await handlers.append_table_rows(input)),
  );

  server.registerTool(
    "insert_table_rows",
    {
      title: "Insert table rows",
      description: "Insert rows into a table block before data row `at`. Returns `new_row_indices`.",
      inputSchema: shapeOf(InsertTableRowsSchema),
    },
    async (input) => jsonContent(await handlers.insert_table_rows(input)),
  );

  server.registerTool(
    "toggle_task",
    {
      title: "Toggle checkbox",
      description:
        "Tick or untick a checkbox on a page. Boxes are counted in source order across `- [ ]` list items (bulleted or numbered), `[ ]` in table cells and `<input type=checkbox>` in html-embed; boxes inside other code fences don't count. Pass `expected_version` so an edit that shifted the boxes fails the call instead of flipping the wrong one.",
      inputSchema: shapeOf(ToggleTaskSchema),
    },
    async (input) => jsonContent(await handlers.toggle_task(input)),
  );

  // ─── Images and files ───
  server.registerTool(
    "get_upload_url",
    {
      title: "Get upload links",
      description:
        "How to add an image or file from your machine. Returns upload URLs, valid 15 minutes for any number of uploads; send the bytes with curl so they never pass through the conversation:\n" +
        "  image: `curl -sS --data-binary @shot.png '<image_url>?alt=Login%20screen'` → { src, markdown, width, height, warnings } (PNG/JPEG/GIF/WebP/SVG, max 10MB)\n" +
        "  file: `curl -sS --data-binary @report.pdf '<file_url>?name=report.pdf&description=Q3'` → { src, fence } (`name` required, max 50MB)\n" +
        "Paste `markdown` or `fence` into a page. Capture screenshots as PNG at 2x scale; JPEG blurs text.",
      inputSchema: shapeOf(GetUploadUrlSchema),
    },
    async () => jsonContent(await handlers.get_upload_url({})),
  );

  server.registerTool(
    "add_image",
    {
      title: "Import image from server",
      description:
        "Register an image file that is already on the server's disk; for files on your machine use get_upload_url. Returns `src` (`/img/<sha256>.<ext>`), a ready `markdown` line, width, height and `warnings` (e.g. too small for sharp display). Put `src` or `markdown` in pages, never the absolute `url`. Identical bytes are stored once. An image no page references is deleted after 7 days.",
      inputSchema: importShape(AddImageSchema),
    },
    async (input) => jsonContent(await handlers.add_image(input)),
  );

  server.registerTool(
    "add_file",
    {
      title: "Import file from server",
      description:
        "Register a file already on the server's disk as a download (max 50MB); for files on your machine use get_upload_url. Returns `src` and a ready ```file `fence` to paste — a card with name, size, View and Download. Identical bytes are stored once and keep their first name. A file no page references is deleted after 7 days.",
      inputSchema: importShape(AddFileSchema),
    },
    async (input) => jsonContent(await handlers.add_file(input)),
  );

  server.registerTool(
    "get_image",
    {
      title: "View image",
      description:
        "Show a stored image to you as an image block, with its metadata. The inline copy is scaled to fit 1280px as WebP (SVG is rasterized); `served` reports what was sent, and `embedded: false` means it was over `max_bytes`.",
      inputSchema: shapeOf(GetImageSchema),
    },
    async (input) => imageContent(await handlers.get_image(input)),
  );

  // ─── Encrypted credentials ───
  server.registerTool(
    "seal_secret",
    {
      title: "Encrypt credential",
      description:
        "Encrypt a credential into a ```secret fence to paste into a page (AES-256-GCM, PBKDF2-SHA256 key). The page, search, revisions and exports hold only ciphertext; readers unlock it in the portal with the key. Use when the user wants a password, token or key kept with the docs.",
      inputSchema: shapeOf(SealSecretSchema),
    },
    async (input) => jsonContent(await handlers.seal_secret(input)),
  );

  server.registerTool(
    "reveal_secret",
    {
      title: "Decrypt credential",
      description:
        "Decrypt a ```secret block and return its text. Pick it by `block_id`, or by `page_id` (plus `label` or `index` when the page holds several — the error then lists them). Needs view access to the project; every reveal is logged, never the text.",
      inputSchema: shapeOf(RevealSecretSchema),
    },
    async (input) => jsonContent(await handlers.reveal_secret(input)),
  );

  // ─── Reference ───
  server.registerTool(
    "get_example",
    {
      title: "Get block templates",
      description:
        "Working markdown templates for WikiKai's blocks. Take `outline_only: true` first, then read only the lines you need.",
      inputSchema: shapeOf(GetExampleSchema),
    },
    async (input) => jsonContent(await handlers.get_example(input)),
  );

  server.registerTool(
    "get_prompt_log",
    {
      title: "Get prompt log",
      description:
        "The user prompts recorded with a document's edits (only calls that passed `user_prompt`), newest first, with tool, page and page version — why each change was made. `total` counts all entries.",
      inputSchema: shapeOf(GetPromptLogSchema),
    },
    async (input) => jsonContent(await handlers.get_prompt_log(input)),
  );

  return server;
}
