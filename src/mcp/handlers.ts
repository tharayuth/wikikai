import { z } from "zod";
import type { KnowledgeStore, KnowledgeMetadata } from "../store/knowledge.js";
import type { PageStore, PageEntry, PageWithStats, EditFeedback } from "../store/pages.js";
import type { ImageStore } from "../store/images.js";
import { cleanupRemovedImageRefs, extractImageHashesSet } from "../store/images.js";
import type { Db } from "../store/db.js";
import type { PromptLogStore, PromptLogEntry } from "../store/promptLog.js";
import type { ActivityLogStore } from "../store/activityLog.js";
import type { PermissionStore } from "../store/permissions.js";
import type { User, UserStore } from "../store/users.js";
import { getCallContext } from "../lib/callContext.js";
import { assertProjectAccess } from "../lib/permissions.js";
import {
  stripInlineStyles,
  stripHtmlEmbedStylesInMarkdown,
} from "../lib/htmlStrip.js";
import {
  EXAMPLE_KINDS,
  exampleOutline,
  readExample,
  type ExampleKind,
  type ExampleOutlineEntry,
} from "./examples.js";

export interface HandlerContext {
  publicBaseUrl: string;
  /** Defaults to true. When false, project-level ACL is bypassed. */
  projectAclEnabled?: boolean;
}

const USER_PROMPT_EDIT_NOTE =
  "Optional. The user's verbatim message that triggered this edit. " +
  "Stored as a row in the prompt-log so the UI can show 'why each revision happened'. " +
  "Capped at 500 chars on insert. Send only when the prompt carries intent — " +
  "skip for trivial retries / follow-ups.";

function urlFor(ctx: HandlerContext, kid: number, pid?: number, line?: number): string {
  const base = ctx.publicBaseUrl.replace(/\/$/, "");
  // Symbol convention (self-documenting URL):
  //   &N  in the path     → knowledge id (the whole document)
  //   #N  in the fragment → page id (a tab inside a document)
  //   :L  on the fragment → line number within the page
  // Examples:
  //   /&2            knowledge &2
  //   /&2/#6         knowledge &2, page #6
  //   /&2/#6:42      knowledge &2, page #6, line 42
  let url = `${base}/&${kid}`;
  if (pid !== undefined) {
    url += `/#${pid}`;
    if (line !== undefined) url += `:${line}`;
  }
  return url;
}

function withUrl<T extends { id: number }>(ctx: HandlerContext, k: T): T & { url: string } {
  return { ...k, url: urlFor(ctx, k.id) };
}

/** Merge a handler's base response with the scoped mutation feedback
 *  (Phase 2a, &50 #324). Undefined optional fields are dropped so a no-op
 *  edit returns a lean shape. `page_hash` is always present. */
function withFeedback<B extends object>(base: B, r: EditFeedback): B & EditFeedback {
  return {
    ...base,
    status: r.status,
    ...(r.changed_range ? { changed_range: r.changed_range } : {}),
    ...(r.changed_range_hash ? { changed_range_hash: r.changed_range_hash } : {}),
    page_hash: r.page_hash,
    ...(r.affected ? { affected: r.affected } : {}),
  };
}

function pageWithUrl<T extends { id: number; knowledge_id: number }>(
  ctx: HandlerContext,
  p: T,
): T & { url: string } {
  return { ...p, url: urlFor(ctx, p.knowledge_id, p.id) };
}

// ─────────── Knowledge schemas ───────────

const SESSION_NOTE =
  "Claude Code chat session UUID (the value used by `claude --resume <id>`). " +
  "Available to hooks as session_id in their JSON input. Optional if unknown.";

const USER_PROMPT_NOTE =
  "The user's original message/question that triggered this knowledge — verbatim if possible. " +
  "Shown in the UI's info popover so people know why the doc exists.";

const TOKENS_NOTE =
  "Optional: number of tokens AI consumed producing this knowledge (input + output combined). " +
  "Surfaced in the UI info popover for cost tracking.";

export const AddKnowledgeSchema = z.object({
  title: z.string().min(1).max(200),
  project: z.string().min(1, "project is required").max(100),
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
    .optional(),
});

export const EditKnowledgeSchema = z
  .object({
    id: z.number().int().positive(),
    title: z.string().min(1).max(200).optional(),
    project: z.string().min(1, "project is required").max(100).optional(),
    session_id: z.string().max(200).optional().describe(SESSION_NOTE),
    user_prompt: z.string().max(8000).optional().describe(USER_PROMPT_NOTE),
    tokens_used: z.number().int().min(0).optional().describe(TOKENS_NOTE),
    tags: z.array(z.string().max(60)).max(20).optional(),
  })
  .refine(
    (v) =>
      v.title !== undefined ||
      v.project !== undefined ||
      v.session_id !== undefined ||
      v.user_prompt !== undefined ||
      v.tokens_used !== undefined ||
      v.tags !== undefined,
    { message: "at least one field" },
  );

export const ListKnowledgeSchema = z.object({
  project: z.string().optional(),
  session_id: z.string().optional(),
  tag: z.string().optional(),
  search: z.string().optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
});

export const GetKnowledgeSchema = z.object({
  id: z.number().int().positive(),
  include_pages: z.boolean().optional().describe("Include page list with line counts (default true)"),
});

export const DeleteKnowledgeSchema = z.object({
  id: z.number().int().positive(),
});

export const GetOutlineSchema = z.object({
  knowledge_id: z.number().int().positive(),
  include_blocks: z.boolean().optional(),
});

// ─────────── Page schemas ───────────

export const AddPageSchema = z.object({
  knowledge_id: z.number().int().positive(),
  title: z.string().min(1).max(200),
  content: z.string(),
  position: z.number().int().min(1).optional(),
  summary: z.string().max(500).optional(),
  keywords: z.array(z.string().max(60)).max(20).optional(),
  user_prompt: z.string().max(2000).optional().describe(USER_PROMPT_EDIT_NOTE),
});

export const EditPageSchema = z
  .object({
    page_id: z.number().int().positive(),
    title: z.string().min(1).max(200).optional(),
    content: z.string().optional(),
    summary: z.string().max(500).optional(),
    keywords: z.array(z.string().max(60)).max(20).optional(),
    user_prompt: z.string().max(2000).optional().describe(USER_PROMPT_EDIT_NOTE),
  })
  .refine(
    (v) =>
      v.title !== undefined ||
      v.content !== undefined ||
      v.summary !== undefined ||
      v.keywords !== undefined,
    { message: "at least one field" },
  );

export const AppendPageSchema = z.object({
  page_id: z.number().int().positive(),
  text: z.string().min(1),
  user_prompt: z.string().max(2000).optional().describe(USER_PROMPT_EDIT_NOTE),
});

export const DeletePageSchema = z.object({
  page_id: z.number().int().positive(),
});

export const ListPagesSchema = z.object({
  knowledge_id: z.number().int().positive(),
});

export const ReorderPagesSchema = z.object({
  knowledge_id: z.number().int().positive(),
  order: z.array(z.number().int().positive()).min(1),
});

export const MovePageSchema = z
  .object({
    page_id: z.number().int().positive(),
    before: z.number().int().positive().optional(),
    after: z.number().int().positive().optional(),
    user_prompt: z.string().max(2000).optional(),
  })
  .refine(
    (v) => (v.before === undefined) !== (v.after === undefined),
    { message: "Provide either `before` or `after`, not both" },
  );

export const MovePageToSchema = z.object({
  page_id: z.number().int().positive(),
  position: z.number().int().min(1),
  user_prompt: z.string().max(2000).optional(),
});

export const ReadPageSchema = z.object({
  page_id: z.number().int().positive(),
  line_start: z.number().int().min(1).optional(),
  line_end: z.number().int().min(1).optional(),
  mode: z
    .enum(["full", "summary"])
    .optional()
    .describe(
      "How to return the page body. `summary` (DEFAULT) returns a compact skeleton where every rich fenced block AND every annotated markdown table is replaced with a single placeholder line of the form `[@N kind 25 lines: caption]` (or `[@N table 12r × 3c: caption]`). The page reads as headings + prose + 1-line-per-block. Use this for first reads, navigation, and 'tell me what's on this page' / 'find @47' probes — typical 5-10× token saving on pages with diagrams or large tables. **`hash` is OMITTED in summary mode** — switch to `mode: \"full\"` (or pass `line_start`/`line_end`) before any `edit_lines` call. `full` returns verbatim markdown with hash, line numbers matching source — use when you're about to edit. " +
        "Tip: use ```md``` fences (with optional `{@N \"caption\"}`) for ASCII diagrams, card templates, and simple structural examples — cheaper than mermaid and shows up as `[@N md N lines: caption]` in summary mode just like other rich blocks.",
    ),
  include_styles: z
    .boolean()
    .optional()
    .describe(
      "By DEFAULT every `style=\"...\"` attribute inside `html-embed` fence bodies is stripped from the returned `content` — inline styles bloat token cost (60-70% of a typical card/grid block) and add nothing when you're reading text/structure. Pass `true` when you need to see the presentation (recolouring, redesigning a layout). Only affects html-embed bodies; the rest of the markdown is untouched. Has no effect in `summary` mode (blocks are already collapsed to placeholder lines).",
    ),
});

export const EditLinesSchema = z.object({
  page_id: z.number().int().positive(),
  line_start: z.number().int().min(1),
  line_end: z.number().int().min(1),
  new_text: z
    .string()
    .describe(
      "Lines replacing [line_start..line_end]. Block-id preservation: every `{@N}` from the replaced region is auto-carried into the first eligible slot (fence info / table-trailing line) in `new_text` when missing — so converting a block from one type to another (markdown table → html-embed, stats → mermaid, etc.) keeps the same `@N` even if you don't write the annotation yourself.",
    ),
  expected_hash: z.string().optional().describe("Hash of the line range from read_page — gate against stale edits"),
  user_prompt: z.string().max(2000).optional().describe(USER_PROMPT_EDIT_NOTE),
});

export const EditSectionSchema = z.object({
  page_id: z.number().int().positive(),
  heading: z.string().min(1).describe("Heading line exactly as it appears, e.g. '## 3. Performance'"),
  new_content: z
    .string()
    .describe(
      "Body to put under the heading. The heading itself is preserved automatically; if you accidentally include it as the first line of new_content, the server strips it (and one optional blank line after) so the heading isn't emitted twice. Block-id preservation: every `{@N}` from the replaced section is auto-carried into the first eligible slot in `new_content` (fence info / table-trailing line), so block-type conversions keep their `@N`.",
    ),
  user_prompt: z.string().max(2000).optional().describe(USER_PROMPT_EDIT_NOTE),
});

export const ReplaceTextSchema = z.object({
  knowledge_id: z.number().int().positive(),
  page_id: z.number().int().positive().optional(),
  find: z.string().min(1),
  replace: z.string(),
  count: z.number().int().min(1).optional(),
  user_prompt: z.string().max(2000).optional().describe(USER_PROMPT_EDIT_NOTE),
});

export const GetPromptLogSchema = z.object({
  knowledge_id: z.number().int().positive(),
  limit: z.number().int().min(1).max(500).optional().describe("Default 100; max 500."),
  offset: z.number().int().min(0).optional(),
});

export const ToggleTaskSchema = z.object({
  page_id: z.number().int().positive(),
  index: z
    .number()
    .int()
    .min(0)
    .describe(
      "0-based index of the checkbox on the page, counted top-down in source order across all surfaces — GFM `- [ ]`/`- [x]` task items, `[ ]`/`[x]` inside markdown-table cells, and `<input type=\"checkbox\">` inside `html-embed` fences. Tasks inside any non-`html-embed` fenced code block are skipped.",
    ),
  expected_version: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Optional. The `version` value returned by the most recent `read_page` / `get_block` for this page. When provided, the server rejects the toggle if the page's current version doesn't match — guards against index drift if another tool inserted/removed a checkbox earlier in the document between read and toggle. Web UI clicks omit this (no race window). AI workflows that read → think → toggle SHOULD pass it.",
    ),
  user_prompt: z.string().max(2000).optional().describe(USER_PROMPT_EDIT_NOTE),
});

export const SearchSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      "Substring to find. Minimum 3 codepoints (trigram FTS index). Works for Thai/CJK because the index is character-trigram based, not whitespace-tokenized.",
    ),
  project: z
    .string()
    .optional()
    .describe(
      "Optional single project name. Omit to search across every project. " +
        "Use `projects` for multi-project filtering.",
    ),
  projects: z
    .array(z.string())
    .optional()
    .describe(
      "Optional list of project names to restrict the search to. Combined with `project` as a union.",
    ),
  knowledge_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Optional. Restrict the search to a single knowledge document."),
  limit: z.number().int().min(1).max(200).optional(),
});

export const AddImageSchema = z.object({
  data_base64: z
    .string()
    .min(4)
    .describe(
      "The image bytes, base64-encoded. Max ~10MB (decoded). Send raw bytes only — no `data:` URI prefix.",
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
    .describe("MIME type of the bytes. The server picks the file extension from this."),
  alt: z
    .string()
    .max(500)
    .optional()
    .describe(
      "Optional default alt text. Stored with the image record; rendering fences can override per-image.",
    ),
});

export const GetImageSchema = z
  .object({
    hash: z
      .string()
      .regex(/^[a-f0-9]{64}$/i)
      .optional()
      .describe("Image SHA-256 (64-hex). Mutually exclusive with `src`."),
    src: z
      .string()
      .optional()
      .describe(
        "Image path (`/img/<hash>.<ext>`). Mutually exclusive with `hash`.",
      ),
    max_bytes: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "If set and the image exceeds this size, the call still returns metadata but omits the inline base64 (`embedded: false`).",
      ),
    mode: z
      .enum(["meta", "full"])
      .optional()
      .describe(
        "`meta` = metadata only, NEVER inline bytes (cheapest — prefer this to decide what an image is). `full` = inline base64 (still capped by max_bytes). Omit for legacy behavior (inline when under the size cap). Default will switch to `meta` in a future major version.",
      ),
  })
  .refine((v) => !!v.hash || !!v.src, {
    message: "must supply either hash or src",
  });

export const GetBlockSchema = z.object({
  id: z
    .number()
    .int()
    .positive()
    .describe(
      "Global block id (the `N` in `@N`). Returns the block's source + inner body + parent page/knowledge context in one call. `kind` is the fence language for rich blocks, or `\"table\"` when `@N` annotates a plain markdown table. " +
        "Tip: ```md``` fences (with optional `{@N \"caption\"}`) are first-class rich blocks like mermaid/chart/stats — prefer them for ASCII diagrams, card templates, and simple structural examples (cheaper than mermaid, no client-side compile).",
    ),
  summary: z
    .boolean()
    .optional()
    .describe(
      "When true, omit `source` and `inner` (no body bytes). For table blocks the response gains `columns: string[]` + `row_count: number` so you can probe a table's schema cheaply before deciding whether to fetch the full source or slice rows via get_table_row / find_table_rows. Use for large tables where the body would be expensive.",
    ),
  include_styles: z
    .boolean()
    .optional()
    .describe(
      "Only meaningful for `kind: \"html-embed\"` blocks. By DEFAULT every `style=\"...\"` attribute is stripped from the returned `source` and `inner` — inline styles eat 60-70% of a typical card/grid block's tokens and add nothing when you're editing text or structure. Pass `true` when you need to see the presentation (recolouring a card, redesigning the layout). Other attributes (src, href, alt, title, data-*, class) are always preserved.",
    ),
});

export const GetTableRowSchema = z.object({
  block_id: z
    .number()
    .int()
    .positive()
    .describe("Table block id (`@N`)."),
  index: z
    .number()
    .int()
    .describe(
      "0-based data-row index (header + separator excluded). Negative wraps from the end: -1 = last row.",
    ),
});

export const SetBlockCaptionSchema = z.object({
  id: z
    .number()
    .int()
    .positive()
    .describe("Block id (the N in @N)."),
  caption: z
    .string()
    .max(500)
    .nullable()
    .describe(
      "Caption text — short human description of what the block IS (like an HTML `<figcaption>` / a Word figure caption). Pass an empty string or null to remove the caption. Max 500 chars.",
    ),
  user_prompt: z.string().max(2000).optional().describe(USER_PROMPT_EDIT_NOTE),
});

export const FindTableRowsSchema = z.object({
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
      "Substring search (case-insensitive). Matched against each cell of every row; restrict to specific columns via `columns`. Cheaper than pulling the whole table when you just need rows containing some text.",
    ),
  where: z
    .record(z.string())
    .optional()
    .describe(
      "Exact column=value match. Multiple keys are AND-ed. Case-sensitive (use `q` for fuzzy text search).",
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
});

export const GetTableRowsSchema = z.object({
  block_id: z
    .number()
    .int()
    .positive()
    .describe("Table block id (`@N`)."),
  start: z
    .number()
    .int()
    .describe(
      "0-based start row index. Negative wraps from the end (-1 = last row).",
    ),
  end: z
    .number()
    .int()
    .optional()
    .describe(
      "Inclusive end row index, 0-based. Negative wraps from end. Mutually exclusive with `offset`.",
    ),
  offset: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "Count of rows to take from `start` (so `start=2, offset=3` returns rows 2,3,4). Mutually exclusive with `end`.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe("Safety cap on returned rows. Default 100, max 500."),
});

export const GetTableRowsWithCheckboxSchema = z.object({
  block_id: z
    .number()
    .int()
    .positive()
    .describe("Table block id (`@N`)."),
  checked: z
    .boolean()
    .optional()
    .describe(
      "Filter by checkbox state. `true` = rows where EVERY checkbox is `[x]`. `false` = rows where EVERY checkbox is `[ ]`. Omit to return any row containing at least one `[ ]`/`[x]` checkbox (mixed-state rows included).",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe("Cap on returned rows. Default 100, max 500."),
});

export const UpdateTableRowsSchema = z.object({
  block_id: z
    .number()
    .int()
    .positive()
    .describe("Table block id (`@N`)."),
  start: z
    .number()
    .int()
    .describe(
      "0-based start row index. Negative wraps from end (-1 = last data row).",
    ),
  end: z
    .number()
    .int()
    .optional()
    .describe("Inclusive end. Mutually exclusive with `offset`."),
  offset: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Number of rows to replace from `start`. Mutually exclusive with `end`."),
  new_rows: z
    .array(z.string())
    .describe(
      "Replacement rows — each a raw markdown table row like `| a | b |`. Length may differ from the range size (shrink/expand the table). Each entry must start and end with `|` and contain no newlines.",
    ),
  expected_version: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Page `version` from the most recent read. The server rejects the update with a `STALE` error when the page has changed since.",
    ),
  user_prompt: z.string().max(2000).optional().describe(USER_PROMPT_EDIT_NOTE),
});

export const AppendTableRowSchema = z.object({
  block_id: z.number().int().positive().describe("Table block id (`@N`)."),
  new_rows: z
    .array(z.string())
    .describe(
      "Rows to append, raw markdown like `| a | b |` — each must start AND end with `|`, no newlines. Validated up-front so nothing is half-written on bad input.",
    ),
  expected_version: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Page `version` from the most recent read. The server returns a `STALE` error if the page changed since.",
    ),
  user_prompt: z.string().max(2000).optional().describe(USER_PROMPT_EDIT_NOTE),
});

export const InsertTableRowSchema = z.object({
  block_id: z.number().int().positive().describe("Table block id (`@N`)."),
  at: z
    .number()
    .int()
    .min(0)
    .describe(
      "0-based row index. The new rows are inserted BEFORE this row; existing rows from `at` onward shift down. `at = 0` → top; `at = row_count` → equivalent to `append_table_row`. Negative not allowed (throws).",
    ),
  new_rows: z
    .array(z.string())
    .describe(
      "Rows to insert, raw markdown like `| a | b |` — each must start AND end with `|`, no newlines.",
    ),
  expected_version: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Page `version` from the most recent read. The server returns a `STALE` error if the page changed since.",
    ),
  user_prompt: z.string().max(2000).optional().describe(USER_PROMPT_EDIT_NOTE),
});

export const InsertLinesSchema = z.object({
  page_id: z.number().int().positive(),
  at: z
    .number()
    .int()
    .min(1)
    .describe(
      "1-based line number (matches `read_page` / `edit_lines`). Insert BEFORE this line; original line `at` shifts to `at + N`. `at = total_lines + 1` appends (prefer `add_lines` for that).",
    ),
  new_text: z
    .string()
    .describe(
      "Lines to insert. May span multiple lines via `\\n`. If `new_text` doesn't end with `\\n`, one is appended automatically so the next line isn't joined.",
    ),
  expected_hash: z
    .string()
    .optional()
    .describe(
      "Optional. Hash of the single line at `at` from a recent `read_page({ line_start: at, line_end: at })`. Empty-line hash when `at = total_lines + 1`. Server rejects on mismatch.",
    ),
  user_prompt: z.string().max(2000).optional().describe(USER_PROMPT_EDIT_NOTE),
});

export const AddLinesSchema = z.object({
  page_id: z.number().int().positive(),
  new_text: z
    .string()
    .describe(
      "Text to append at the END of the page. A newline is prepended to existing content if it doesn't already end with one. `new_text` itself may or may not end with `\\n` — both are fine.",
    ),
  expected_hash: z
    .string()
    .optional()
    .describe(
      "Optional. Hash of the LAST line of the page (line_start = line_end = total_lines from a recent read_page).",
    ),
  user_prompt: z.string().max(2000).optional().describe(USER_PROMPT_EDIT_NOTE),
});

export const GetExampleSchema = z.object({
  kind: z.enum(EXAMPLE_KINDS).optional(),
  outline_only: z
    .boolean()
    .optional()
    .describe("Return just the heading outline + total_lines, no body (cheapest)"),
  line_start: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Read from this line (1-based, inclusive)"),
  line_end: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Read up to this line (inclusive); default = last line"),
});

// ─────────── Types ───────────

export type ToolInputs = {
  add_knowledge: z.infer<typeof AddKnowledgeSchema>;
  edit_knowledge: z.infer<typeof EditKnowledgeSchema>;
  list_knowledge: z.infer<typeof ListKnowledgeSchema>;
  get_knowledge: z.infer<typeof GetKnowledgeSchema>;
  delete_knowledge: z.infer<typeof DeleteKnowledgeSchema>;
  get_outline: z.infer<typeof GetOutlineSchema>;
  add_page: z.infer<typeof AddPageSchema>;
  edit_page: z.infer<typeof EditPageSchema>;
  append_page: z.infer<typeof AppendPageSchema>;
  delete_page: z.infer<typeof DeletePageSchema>;
  list_pages: z.infer<typeof ListPagesSchema>;
  reorder_pages: z.infer<typeof ReorderPagesSchema>;
  move_page: z.infer<typeof MovePageSchema>;
  move_page_to: z.infer<typeof MovePageToSchema>;
  read_page: z.infer<typeof ReadPageSchema>;
  edit_lines: z.infer<typeof EditLinesSchema>;
  edit_section: z.infer<typeof EditSectionSchema>;
  replace_text: z.infer<typeof ReplaceTextSchema>;
  search: z.infer<typeof SearchSchema>;
  get_block: z.infer<typeof GetBlockSchema>;
  get_table_row: z.infer<typeof GetTableRowSchema>;
  find_table_rows: z.infer<typeof FindTableRowsSchema>;
  get_table_rows: z.infer<typeof GetTableRowsSchema>;
  get_table_rows_with_checkbox: z.infer<typeof GetTableRowsWithCheckboxSchema>;
  update_table_rows: z.infer<typeof UpdateTableRowsSchema>;
  append_table_row: z.infer<typeof AppendTableRowSchema>;
  insert_table_row: z.infer<typeof InsertTableRowSchema>;
  insert_lines: z.infer<typeof InsertLinesSchema>;
  add_lines: z.infer<typeof AddLinesSchema>;
  set_block_caption: z.infer<typeof SetBlockCaptionSchema>;
  add_image: z.infer<typeof AddImageSchema>;
  get_image: z.infer<typeof GetImageSchema>;
  get_example: z.infer<typeof GetExampleSchema>;
  get_prompt_log: z.infer<typeof GetPromptLogSchema>;
  toggle_task: z.infer<typeof ToggleTaskSchema>;
};

export interface ToolHandlers {
  add_knowledge(input: ToolInputs["add_knowledge"]): Promise<{
    id: number;
    url: string;
    created_at: string;
    first_page?: { id: number; position: number };
  }>;
  edit_knowledge(input: ToolInputs["edit_knowledge"]): Promise<{
    id: number;
    url: string;
    version: number;
    updated_at: string;
  }>;
  list_knowledge(
    input: ToolInputs["list_knowledge"],
  ): Promise<(KnowledgeMetadata & { url: string })[]>;
  get_knowledge(input: ToolInputs["get_knowledge"]): Promise<
    KnowledgeMetadata & {
      url: string;
      pages?: (PageWithStats & { url: string })[];
    }
  >;
  delete_knowledge(input: ToolInputs["delete_knowledge"]): Promise<{
    id: number;
    deleted: true;
    removed_images: number;
  }>;
  get_outline(input: ToolInputs["get_outline"]): Promise<{
    knowledge_id: number;
    title: string;
    pages: Array<
      {
        id: number;
        title: string;
        position: number;
        summary: string | null;
        line_count: number;
        url: string;
        headings: { level: number; text: string; line: number; id: string }[];
      } & {
        blocks?: Array<{
          id: number;
          kind: string;
          caption: string | null;
          line_start: number;
          line_end: number;
          row_count?: number;
        }>;
      }
    >;
  }>;

  add_page(input: ToolInputs["add_page"]): Promise<{
    id: number;
    knowledge_id: number;
    position: number;
    url: string;
    created_at: string;
  }>;
  edit_page(input: ToolInputs["edit_page"]): Promise<{
    id: number;
    knowledge_id: number;
    version: number;
    updated_at: string;
    url: string;
  }>;
  append_page(input: ToolInputs["append_page"]): Promise<{
    id: number;
    knowledge_id: number;
    version: number;
    new_line_count: number;
    url: string;
  }>;
  delete_page(input: ToolInputs["delete_page"]): Promise<{
    id: number;
    deleted: true;
    removed_images: number;
  }>;
  list_pages(input: ToolInputs["list_pages"]): Promise<(PageWithStats & { url: string })[]>;
  reorder_pages(input: ToolInputs["reorder_pages"]): Promise<{ ok: true; order: number[] }>;
  move_page(input: ToolInputs["move_page"]): Promise<{ ok: true; order: number[] }>;
  move_page_to(input: ToolInputs["move_page_to"]): Promise<{ ok: true; order: number[] }>;

  read_page(input: ToolInputs["read_page"]): Promise<{
    page_id: number;
    knowledge_id: number;
    title: string;
    position: number;
    content: string;
    total_lines: number;
    line_start: number;
    line_end: number;
    /** Present in `full` mode ONLY when `include_styles: true` was
     *  requested. Omitted in `summary` mode (skeleton's hash wouldn't
     *  match source) and in default-stripped `full` mode (writing
     *  the stripped content back via `edit_lines` would silently
     *  wipe the user's inline styles — re-read with
     *  `include_styles: true` to get a hash for editing). */
    hash?: string;
    url: string;
    /** Echoes the requested mode. `"full"` when omitted by caller. */
    mode: "full" | "summary";
    /** Present only in `summary` mode — the actual source line count
     *  (skeleton's `total_lines` may be smaller because each rich
     *  block collapses to one placeholder line). */
    source_total_lines?: number;
    /** Present only in `summary` mode — every block summarised in the
     *  skeleton, in source order, with id, kind, optional caption,
     *  and source line range. AI can decide which `@N` to fetch in
     *  full via `get_block({ id })` without re-parsing placeholders. */
    blocks?: Array<{
      id: number;
      kind: string;
      caption: string | null;
      source_line_start: number;
      source_line_end: number;
      url: string;
    }>;
    /** Parent knowledge (&) — title + sibling pages so AI knows where this page sits */
    knowledge: {
      id: number;
      title: string;
      project: string | null;
      version: number;
      updated_at: string;
      url: string;
      pages: {
        id: number;
        title: string;
        position: number;
        line_count: number;
        url: string;
        is_current: boolean;
      }[];
    };
    /** Every internal image referenced in the returned `content`.
     *  Covers three surfaces: ```images fences, `<img src="/img/...">`
     *  inside ```html-embed fences, and plain markdown image refs
     *  `![alt](/img/...)` (or inline `<img>`) anywhere in the page —
     *  paragraphs, list items, markdown table cells. Pre-parsed so
     *  callers can `get_image(src)` without re-scanning the source
     *  themselves. `via` notes which surface the reference came from.
     *  Empty array when the page has no images. */
    images_referenced: {
      src: string;
      alt?: string;
      caption?: string;
      block_id?: number;
      via: "images" | "html-embed" | "markdown";
    }[];
  }>;
  edit_lines(input: ToolInputs["edit_lines"]): Promise<{
    id: number;
    knowledge_id: number;
    version: number;
    new_line_count: number;
    url: string;
  }>;
  edit_section(input: ToolInputs["edit_section"]): Promise<{
    id: number;
    knowledge_id: number;
    version: number;
    new_line_count: number;
    replaced_lines: number;
    url: string;
  }>;
  replace_text(input: ToolInputs["replace_text"]): Promise<{
    replacements: { page_id: number; page_title: string; count: number; url: string }[];
    total: number;
  }>;

  search(input: ToolInputs["search"]): Promise<{
    hits: {
      knowledge_id: number;
      knowledge_title: string;
      project: string | null;
      page_id: number;
      page_position: number;
      page_title: string;
      line: number;
      heading: {
        level: number;
        text: string;
        line: number;
        id: string;
      } | null;
      snippet: string;
      url: string;
      score: number;
    }[];
    total: number;
  }>;

  get_block(input: ToolInputs["get_block"]): Promise<{
    block_id: number;
    kind: string;
    /** Optional human-readable caption from the `{@N "caption"}`
     *  annotation. Same idea as an HTML `<figcaption>` — short text
     *  describing what the block IS. Use when probing with
     *  `summary: true` to answer "what is @N?" cheaply. */
    caption: string | null;
    /** Omitted when `summary: true`. */
    source?: string;
    /** Omitted when `summary: true`. */
    inner?: string;
    line_start: number;
    line_end: number;
    page_id: number;
    page_position: number;
    page_title: string;
    knowledge_id: number;
    knowledge_title: string;
    project: string | null;
    url: string;
    /** Present when `summary: true` AND `kind === "table"`. */
    columns?: string[];
    /** Present when `summary: true` AND `kind === "table"`. */
    row_count?: number;
  }>;

  get_table_row(input: ToolInputs["get_table_row"]): Promise<{
    block_id: number;
    knowledge_id: number;
    page_id: number;
    row_index: number;
    columns: Record<string, string>;
    source_line: number;
    url: string;
  }>;

  find_table_rows(input: ToolInputs["find_table_rows"]): Promise<{
    block_id: number;
    knowledge_id: number;
    page_id: number;
    columns: string[];
    matches: Array<{
      row_index: number;
      columns: Record<string, string>;
      source_line: number;
      url: string;
    }>;
    total_matched: number;
    truncated: boolean;
  }>;

  get_table_rows(input: ToolInputs["get_table_rows"]): Promise<{
    block_id: number;
    knowledge_id: number;
    page_id: number;
    knowledge_title: string;
    page_title: string;
    project: string | null;
    url: string;
    columns: string[];
    row_count: number;
    matches: Array<{
      row_index: number;
      columns: Record<string, string>;
      source_line: number;
      url: string;
    }>;
    truncated: boolean;
  }>;

  get_table_rows_with_checkbox(
    input: ToolInputs["get_table_rows_with_checkbox"],
  ): Promise<{
    block_id: number;
    knowledge_id: number;
    page_id: number;
    knowledge_title: string;
    page_title: string;
    project: string | null;
    url: string;
    columns: string[];
    row_count: number;
    matches: Array<{
      row_index: number;
      columns: Record<string, string>;
      source_line: number;
      url: string;
    }>;
    truncated: boolean;
  }>;

  update_table_rows(input: ToolInputs["update_table_rows"]): Promise<{
    page_id: number;
    knowledge_id: number;
    page_version: number;
    updated_count: number;
    url: string;
  }>;

  append_table_row(input: ToolInputs["append_table_row"]): Promise<{
    page_id: number;
    knowledge_id: number;
    page_version: number;
    appended_count: number;
    new_row_indices: number[];
    url: string;
  }>;

  insert_table_row(input: ToolInputs["insert_table_row"]): Promise<{
    page_id: number;
    knowledge_id: number;
    page_version: number;
    inserted_count: number;
    new_row_indices: number[];
    url: string;
  }>;

  insert_lines(input: ToolInputs["insert_lines"]): Promise<{
    id: number;
    knowledge_id: number;
    version: number;
    new_line_count: number;
    inserted_lines: number;
    url: string;
  }>;

  add_lines(input: ToolInputs["add_lines"]): Promise<{
    id: number;
    knowledge_id: number;
    version: number;
    new_line_count: number;
    appended_lines: number;
    url: string;
  }>;

  set_block_caption(input: ToolInputs["set_block_caption"]): Promise<{
    block_id: number;
    page_id: number;
    knowledge_id: number;
    caption: string | null;
    version: number;
    url: string;
  }>;

  add_image(input: ToolInputs["add_image"]): Promise<{
    hash: string;
    ext: string;
    mime: string;
    size_bytes: number;
    width: number | null;
    height: number | null;
    alt: string | null;
    created_at: string;
    src: string;
    url: string;
  }>;

  get_image(input: ToolInputs["get_image"]): Promise<{
    hash: string;
    ext: string;
    mime: string;
    size_bytes: number;
    width: number | null;
    height: number | null;
    alt: string | null;
    src: string;
    url: string;
    embedded: boolean;
    /** Which return mode applied: "meta" (no bytes) or "full" (bytes when under cap). */
    mode: "meta" | "full";
    /** Present iff `embedded` is true — raw bytes for MCP image content. */
    data_base64?: string;
  }>;

  get_example(input: ToolInputs["get_example"]): Promise<{
    kind: ExampleKind;
    total_lines: number;
    outline: ExampleOutlineEntry[];
    content: string;
    line_start?: number;
    line_end?: number;
  }>;

  get_prompt_log(input: ToolInputs["get_prompt_log"]): Promise<{
    knowledge_id: number;
    total: number;
    entries: PromptLogEntry[];
  }>;

  toggle_task(input: ToolInputs["toggle_task"]): Promise<{
    page_id: number;
    knowledge_id: number;
    index: number;
    done: boolean;
    version: number;
    updated_at: string;
    url: string;
  }>;
}

/** Walk page content and collect every image reference. Three surfaces:
 *   - ```images fence (JSON entries) — via: "images"
 *   - <img src="/img/..."> inside an ```html-embed fence — via: "html-embed"
 *   - plain markdown `![alt](/img/...)` or inline <img> outside any fence
 *     (paragraphs, list items, markdown table cells) — via: "markdown"
 *  so callers can `get_image({ src })` without re-scanning. */
function extractImageRefs(
  content: string,
): {
  src: string;
  alt?: string;
  caption?: string;
  block_id?: number;
  via: "images" | "html-embed" | "markdown";
}[] {
  const refs: {
    src: string;
    alt?: string;
    caption?: string;
    block_id?: number;
    via: "images" | "html-embed" | "markdown";
  }[] = [];
  const lines = content.split("\n");
  let inFence = false;
  let fenceMarker = "";
  let kind: "images" | "html-embed" | "" = "";
  let curBlockId: number | null = null;
  let buf: string[] = [];

  const flushBuffered = () => {
    if (kind === "images") {
      try {
        const parsed = JSON.parse(buf.join("\n")) as unknown;
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const it of items) {
          if (
            it &&
            typeof it === "object" &&
            typeof (it as { src?: unknown }).src === "string"
          ) {
            const r = it as { src: string; alt?: unknown; caption?: unknown };
            refs.push({
              src: r.src,
              alt: typeof r.alt === "string" ? r.alt : undefined,
              caption: typeof r.caption === "string" ? r.caption : undefined,
              block_id: curBlockId ?? undefined,
              via: "images",
            });
          }
        }
      } catch {
        /* skip */
      }
    } else if (kind === "html-embed") {
      // Pull <img src="/img/..."> (and the optional alt) out of the raw HTML.
      const html = buf.join("\n");
      const imgRe = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
      let m: RegExpExecArray | null;
      while ((m = imgRe.exec(html)) !== null) {
        const src = m[1];
        // Only surface internal images — external URLs aren't fetched by get_image.
        if (!/^\/img\/[a-f0-9]{64}\.[a-z0-9]{2,5}$/i.test(src)) continue;
        const altMatch = /\balt\s*=\s*["']([^"']*)["']/i.exec(m[0]);
        refs.push({
          src,
          alt: altMatch?.[1],
          block_id: curBlockId ?? undefined,
          via: "html-embed",
        });
      }
    }
  };

  // Plain markdown `![alt](/img/<hash>.<ext>)` and inline `<img src="/img/...">`
  // outside any fence are also picked up — authors can reference images from
  // paragraphs, list items, or markdown table cells with no wrapper block.
  const INTERNAL = /^\/img\/[a-f0-9]{64}\.[a-z0-9]{2,5}$/i;
  const mdImgRe = /!\[([^\]]*)\]\((\/img\/[a-f0-9]{64}\.[a-z0-9]{2,5})\)/gi;
  const htmlImgRe = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;

  for (const line of lines) {
    if (!inFence) {
      const open = /^(\s*)(```+)\s*([A-Za-z0-9_-]+)(.*)$/.exec(line);
      if (open) {
        inFence = true;
        fenceMarker = open[2];
        const lang = open[3].toLowerCase();
        kind = lang === "images" || lang === "html-embed" ? lang : "";
        const idm = /\{@(\d+)\}/.exec(open[4]);
        curBlockId = idm ? Number(idm[1]) : null;
        buf = [];
      } else {
        let mm: RegExpExecArray | null;
        mdImgRe.lastIndex = 0;
        while ((mm = mdImgRe.exec(line)) !== null) {
          refs.push({ src: mm[2], alt: mm[1] || undefined, via: "markdown" });
        }
        htmlImgRe.lastIndex = 0;
        while ((mm = htmlImgRe.exec(line)) !== null) {
          if (!INTERNAL.test(mm[1])) continue;
          const altMatch = /\balt\s*=\s*["']([^"']*)["']/i.exec(mm[0]);
          refs.push({ src: mm[1], alt: altMatch?.[1], via: "markdown" });
        }
      }
    } else {
      const closeRe = new RegExp(`^\\s*${fenceMarker}+\\s*$`);
      if (closeRe.test(line)) {
        flushBuffered();
        inFence = false;
        fenceMarker = "";
        kind = "";
        curBlockId = null;
        buf = [];
      } else {
        buf.push(line);
      }
    }
  }
  return refs;
}

function pageEntryShape(ctx: HandlerContext, p: PageEntry) {
  return { ...p, url: urlFor(ctx, p.knowledge_id, p.id) };
}

/** Compare every stored image hash against the set still referenced
 *  by remaining page content; delete the orphans (file + DB row) and
 *  return how many were removed. Run after delete_knowledge /
 *  delete_page so a removed page's exclusive images don't linger. */
function cleanupOrphanImages(pages: PageStore, images: ImageStore): number {
  const referenced = pages.allReferencedImageHashes();
  const stored = images.listAllHashes();
  let removed = 0;
  for (const { hash } of stored) {
    if (referenced.has(hash)) continue;
    if (images.remove(hash)) removed++;
  }
  return removed;
}

export function buildToolHandlers(
  knowledge: KnowledgeStore,
  pages: PageStore,
  images: ImageStore,
  promptLog: PromptLogStore,
  activityLog: ActivityLogStore,
  ctx: HandlerContext,
  permissions: PermissionStore,
  users: UserStore,
  db: Db,
): ToolHandlers {
  const aclEnabled = ctx.projectAclEnabled ?? true;

  function resolveCallerForAcl(): { user: User | null } {
    const { user_id } = getCallContext();
    const user = user_id != null ? users.get(user_id) : null;
    return { user };
  }

  function gateReadByKid(kid: number): void {
    const { user } = resolveCallerForAcl();
    if (!user || !aclEnabled || user.is_admin) return;
    const k = knowledge.get(kid);
    if (!k || !k.project) return; // let the handler throw its own not-found
    assertProjectAccess(user, k.project, "view", permissions, {
      enabled: aclEnabled,
    });
  }

  function gateReadByPid(pid: number): void {
    const { user } = resolveCallerForAcl();
    if (!user || !aclEnabled || user.is_admin) return;
    const page = pages.getMetadata(pid);
    if (!page) return;
    const k = knowledge.get(page.knowledge_id);
    if (!k || !k.project) return;
    assertProjectAccess(user, k.project, "view", permissions, {
      enabled: aclEnabled,
    });
  }

  function visibleProjectsForCaller(): Set<string> | null {
    const { user } = resolveCallerForAcl();
    if (!user || !aclEnabled || user.is_admin) return null;
    return new Set(permissions.listVisibleProjects(user.id, false));
  }

  function gateReadByProject(project: string | null | undefined): void {
    const { user } = resolveCallerForAcl();
    if (!user || !aclEnabled || user.is_admin) return;
    if (!project) return;
    assertProjectAccess(user, project, "view", permissions, {
      enabled: aclEnabled,
    });
  }

  function gateEditByKid(kid: number): void {
    const { user } = resolveCallerForAcl();
    if (!user || !aclEnabled || user.is_admin) return;
    const k = knowledge.get(kid);
    if (!k || !k.project) return; // let the handler throw its own not-found
    assertProjectAccess(user, k.project, "edit", permissions, {
      enabled: aclEnabled,
    });
  }

  function gateEditByPid(pid: number): void {
    const { user } = resolveCallerForAcl();
    if (!user || !aclEnabled || user.is_admin) return;
    const page = pages.getMetadata(pid);
    if (!page) return;
    const k = knowledge.get(page.knowledge_id);
    if (!k || !k.project) return;
    assertProjectAccess(user, k.project, "edit", permissions, {
      enabled: aclEnabled,
    });
  }

  function gateEditByProject(project: string | null | undefined): void {
    const { user } = resolveCallerForAcl();
    if (!user || !aclEnabled || user.is_admin) return;
    if (!project) return;
    assertProjectAccess(user, project, "edit", permissions, {
      enabled: aclEnabled,
    });
  }
  // Snapshot title/caption helpers used by the activity-log recorder.
  // Best-effort — if the target doesn't exist (e.g. we're logging a
  // delete that already happened), fall back to null and let the entry
  // carry just the id.
  const titlesFor = (knowledge_id?: number | null, page_id?: number | null) => {
    let knowledge_title: string | null = null;
    let page_title: string | null = null;
    if (knowledge_id != null) {
      try {
        knowledge_title = knowledge.get(knowledge_id)?.title ?? null;
      } catch {
        /* ignore */
      }
    }
    if (page_id != null) {
      try {
        page_title = pages.getMetadata(page_id)?.title ?? null;
      } catch {
        /* ignore */
      }
    }
    return { knowledge_title, page_title };
  };
  const recordActivity = (
    entry: Parameters<ActivityLogStore["record"]>[0],
  ): void => {
    try {
      // Snapshot titles when the caller didn't supply them.
      const filled = { ...entry };
      if (
        (filled.knowledge_title == null || filled.page_title == null) &&
        (filled.knowledge_id != null || filled.page_id != null)
      ) {
        const t = titlesFor(filled.knowledge_id, filled.page_id);
        if (filled.knowledge_title == null) filled.knowledge_title = t.knowledge_title;
        if (filled.page_title == null) filled.page_title = t.page_title;
      }
      activityLog.record(filled);
    } catch {
      // Never let audit logging take down a mutation.
    }
  };
  const logIf = (
    tool: string,
    prompt: string | undefined,
    knowledge_id: number,
    page_id: number | null,
    page_version: number | null,
  ) => {
    if (!prompt) return;
    try {
      promptLog.add({
        knowledge_id,
        page_id,
        page_version,
        tool_name: tool,
        prompt,
      });
    } catch {
      // never let logging take down a mutation
    }
  };

  return {
    async add_knowledge(input) {
      const parsed = AddKnowledgeSchema.parse(input);
      gateEditByProject(parsed.project);
      const k = knowledge.add(parsed);
      let first_page;
      if (parsed.first_page) {
        const p = pages.add({ ...parsed.first_page, knowledge_id: k.id });
        first_page = { id: p.id, position: p.position };
      }
      // The initial user_prompt is *also* the first log entry — gives the
      // popover a uniform timeline (creation + every edit).
      logIf(
        "add_knowledge",
        parsed.user_prompt,
        k.id,
        first_page?.id ?? null,
        first_page ? 1 : null,
      );
      recordActivity({
        action: "add",
        target: "knowledge",
        knowledge_id: k.id,
        knowledge_title: parsed.title,
        page_id: first_page?.id ?? null,
        page_title: parsed.first_page?.title ?? null,
      });
      return { id: k.id, url: urlFor(ctx, k.id), created_at: k.created_at, first_page };
    },

    async edit_knowledge(input) {
      const parsed = EditKnowledgeSchema.parse(input);
      gateEditByKid(parsed.id);
      if (parsed.project) {
        const current = knowledge.get(parsed.id);
        if (current && current.project !== parsed.project) {
          gateEditByProject(parsed.project);
        }
      }
      const r = knowledge.update(parsed.id, parsed);
      logIf("edit_knowledge", parsed.user_prompt, r.id, null, null);
      recordActivity({
        action: "edit",
        target: "knowledge",
        knowledge_id: r.id,
      });
      return { id: r.id, url: urlFor(ctx, r.id), version: r.version, updated_at: r.updated_at };
    },

    async list_knowledge(input) {
      const parsed = ListKnowledgeSchema.parse(input);
      const visible = visibleProjectsForCaller();
      const rows = knowledge.list(parsed);
      const filtered =
        visible === null
          ? rows
          : rows.filter((k) => k.project != null && visible.has(k.project));
      return filtered.map((k) => withUrl(ctx, k));
    },

    async get_knowledge(input) {
      const parsed = GetKnowledgeSchema.parse(input);
      gateReadByKid(parsed.id);
      const meta = knowledge.get(parsed.id);
      if (!meta) throw new Error(`knowledge #${parsed.id} not found`);
      const includePages = parsed.include_pages ?? true;
      const out: KnowledgeMetadata & { url: string; pages?: (PageWithStats & { url: string })[] } =
        withUrl(ctx, meta);
      if (includePages) {
        out.pages = pages.list(parsed.id).map((p) => pageWithUrl(ctx, p));
      }
      return out;
    },

    async delete_knowledge(input) {
      const parsed = DeleteKnowledgeSchema.parse(input);
      gateEditByKid(parsed.id);
      // Snapshot the title BEFORE we drop the row so the audit row stays
      // meaningful after the knowledge is gone.
      const before = knowledge.get(parsed.id);
      pages.removeKnowledgeFiles(parsed.id);
      knowledge.remove(parsed.id);
      const removed_images = cleanupOrphanImages(pages, images);
      recordActivity({
        action: "delete",
        target: "knowledge",
        knowledge_id: parsed.id,
        knowledge_title: before?.title ?? null,
      });
      return { id: parsed.id, deleted: true, removed_images };
    },

    async get_outline(input) {
      const parsed = GetOutlineSchema.parse(input);
      gateReadByKid(parsed.knowledge_id);
      const meta = knowledge.get(parsed.knowledge_id);
      if (!meta) throw new Error(`knowledge #${parsed.knowledge_id} not found`);
      const out = pages.outline(parsed.knowledge_id, {
        include_blocks: parsed.include_blocks,
      });
      return {
        knowledge_id: meta.id,
        title: meta.title,
        pages: out.pages.map((p) => ({
          ...p,
          url: urlFor(ctx, meta.id, p.id),
        })),
      };
    },

    // ─── pages ───

    async add_page(input) {
      const parsed = AddPageSchema.parse(input);
      gateEditByKid(parsed.knowledge_id);
      const r = pages.add(parsed);
      logIf("add_page", parsed.user_prompt, parsed.knowledge_id, r.id, 1);
      recordActivity({
        action: "add",
        target: "page",
        knowledge_id: parsed.knowledge_id,
        page_id: r.id,
        page_title: parsed.title,
      });
      return {
        id: r.id,
        knowledge_id: parsed.knowledge_id,
        position: r.position,
        url: urlFor(ctx, parsed.knowledge_id, r.id),
        created_at: r.created_at,
      };
    },

    async edit_page(input) {
      const parsed = EditPageSchema.parse(input);
      gateEditByPid(parsed.page_id);
      const beforePage = pages.get(parsed.page_id);
      if (!beforePage) throw new Error(`page #${parsed.page_id} not found`);
      const before = beforePage;
      const oldHashes = extractImageHashesSet(beforePage.content);
      const r = pages.update(parsed.page_id, parsed);
      const afterPage = pages.get(parsed.page_id);
      const newHashes = afterPage ? extractImageHashesSet(afterPage.content) : new Set<string>();
      const removed = new Set<string>([...oldHashes].filter((h) => !newHashes.has(h)));
      cleanupRemovedImageRefs(removed, parsed.page_id, db, images);
      logIf(
        "edit_page",
        parsed.user_prompt,
        before.knowledge_id,
        r.id,
        r.version,
      );
      recordActivity({
        action: "edit",
        target: "page",
        knowledge_id: before.knowledge_id,
        page_id: r.id,
      });
      return {
        id: r.id,
        knowledge_id: before.knowledge_id,
        version: r.version,
        updated_at: r.updated_at,
        url: urlFor(ctx, before.knowledge_id, r.id),
      };
    },

    async append_page(input) {
      const parsed = AppendPageSchema.parse(input);
      gateEditByPid(parsed.page_id);
      const before = pages.getMetadata(parsed.page_id);
      if (!before) throw new Error(`page #${parsed.page_id} not found`);
      // append is purely additive — it can't drop an existing image
      // reference. Skip the before/after diff entirely.
      const r = pages.append(parsed.page_id, parsed.text);
      logIf(
        "append_page",
        parsed.user_prompt,
        before.knowledge_id,
        r.id,
        r.version,
      );
      recordActivity({
        action: "edit",
        target: "page",
        knowledge_id: before.knowledge_id,
        page_id: r.id,
      });
      return withFeedback(
        {
          id: r.id,
          knowledge_id: before.knowledge_id,
          version: r.version,
          new_line_count: r.new_line_count,
          url: urlFor(ctx, before.knowledge_id, r.id),
        },
        r,
      );
    },

    async delete_page(input) {
      const parsed = DeletePageSchema.parse(input);
      gateEditByPid(parsed.page_id);
      // Snapshot title + parent knowledge BEFORE removing so the audit
      // row keeps human-readable context.
      const before = pages.getMetadata(parsed.page_id);
      pages.remove(parsed.page_id);
      const removed_images = cleanupOrphanImages(pages, images);
      recordActivity({
        action: "delete",
        target: "page",
        knowledge_id: before?.knowledge_id ?? null,
        page_id: parsed.page_id,
        page_title: before?.title ?? null,
      });
      return { id: parsed.page_id, deleted: true, removed_images };
    },

    async list_pages(input) {
      const parsed = ListPagesSchema.parse(input);
      gateReadByKid(parsed.knowledge_id);
      return pages.list(parsed.knowledge_id).map((p) => pageWithUrl(ctx, p));
    },

    async reorder_pages(input) {
      const parsed = ReorderPagesSchema.parse(input);
      gateEditByKid(parsed.knowledge_id);
      pages.reorder(parsed.knowledge_id, parsed.order);
      recordActivity({
        action: "reorder",
        target: "knowledge",
        knowledge_id: parsed.knowledge_id,
      });
      return { ok: true, order: parsed.order };
    },

    async move_page(input) {
      const parsed = MovePageSchema.parse(input);
      gateEditByPid(parsed.page_id);
      const r = pages.movePage(parsed.page_id, {
        before: parsed.before,
        after: parsed.after,
      });
      recordActivity({
        action: "reorder",
        target: "knowledge",
        knowledge_id: r.knowledge_id,
        page_id: parsed.page_id,
      });
      logIf("move_page", parsed.user_prompt, r.knowledge_id, parsed.page_id, null);
      return { ok: true, order: r.order };
    },

    async move_page_to(input) {
      const parsed = MovePageToSchema.parse(input);
      gateEditByPid(parsed.page_id);
      const r = pages.movePageTo(parsed.page_id, parsed.position);
      recordActivity({
        action: "reorder",
        target: "knowledge",
        knowledge_id: r.knowledge_id,
        page_id: parsed.page_id,
      });
      logIf("move_page_to", parsed.user_prompt, r.knowledge_id, parsed.page_id, null);
      return { ok: true, order: r.order };
    },

    // ─── line ops ───

    async read_page(input) {
      const parsed = ReadPageSchema.parse(input);
      gateReadByPid(parsed.page_id);
      const meta = pages.getMetadata(parsed.page_id);
      if (!meta) throw new Error(`page #${parsed.page_id} not found`);
      const r = pages.readLines(parsed.page_id, parsed.line_start, parsed.line_end);
      const k = knowledge.get(meta.knowledge_id);
      const siblings = pages.list(meta.knowledge_id);
      const baseEnvelope = {
        page_id: parsed.page_id,
        knowledge_id: meta.knowledge_id,
        title: meta.title,
        position: meta.position,
        knowledge: {
          id: meta.knowledge_id,
          title: k?.title ?? "(unknown)",
          project: k?.project ?? null,
          version: k?.version ?? 0,
          updated_at: k?.updated_at ?? "",
          url: urlFor(ctx, meta.knowledge_id),
          pages: siblings.map((p) => ({
            id: p.id,
            title: p.title,
            position: p.position,
            line_count: p.line_count,
            url: urlFor(ctx, meta.knowledge_id, p.id),
            is_current: p.id === parsed.page_id,
          })),
        },
        url: urlFor(ctx, meta.knowledge_id, parsed.page_id, r.line_start),
      };
      // Default to summary mode when the caller didn't say — saves
      // tokens on every navigation/probe read. AI workflows that need
      // the full body for editing must explicitly pass `mode: "full"`.
      const mode = parsed.mode ?? "summary";
      if (mode === "summary") {
        const { skeleton, blocks } = pages.summarizePageContent(r.content);
        const skelLines = skeleton === "" ? 0 : skeleton.split("\n").length;
        return {
          ...baseEnvelope,
          mode: "summary" as const,
          content: skeleton,
          total_lines: skelLines,
          source_total_lines: r.total_lines,
          line_start: r.line_start,
          line_end: r.line_end,
          // Hash omitted on purpose — skeleton's hash doesn't match
          // the source so it would only mislead `expected_hash`
          // callers. Re-read with `mode: "full"` to get an editable
          // slice + hash.
          blocks: blocks.map((b) => ({
            ...b,
            url: urlFor(
              ctx,
              meta.knowledge_id,
              parsed.page_id,
              b.source_line_start,
            ),
          })),
          images_referenced: extractImageRefs(r.content),
        };
      }
      // Full mode: strip inline `style="..."` from every html-embed
      // fence body unless the caller opted in to see them. Keeps the
      // common "AI reading to edit text" path cheap.
      const fullContent = parsed.include_styles
        ? r.content
        : stripHtmlEmbedStylesInMarkdown(r.content);
      const wasStripped = fullContent !== r.content;
      return {
        ...baseEnvelope,
        mode: "full" as const,
        content: fullContent,
        total_lines: r.total_lines,
        line_start: r.line_start,
        line_end: r.line_end,
        // Hash omitted only when stripping actually changed the
        // returned content — writing the stripped HTML back via
        // `edit_lines` would wipe the user's inline styles from
        // source, so we force a re-read with `include_styles: true`
        // in that case. Pages with no html-embed bodies return hash
        // normally regardless of the flag.
        ...(wasStripped ? {} : { hash: r.hash }),
        images_referenced: extractImageRefs(fullContent),
      };
    },

    async edit_lines(input) {
      const parsed = EditLinesSchema.parse(input);
      gateEditByPid(parsed.page_id);
      const beforePage = pages.get(parsed.page_id);
      if (!beforePage) throw new Error(`page #${parsed.page_id} not found`);
      const meta = beforePage;
      const oldHashes = extractImageHashesSet(beforePage.content);
      const r = pages.editLines(
        parsed.page_id,
        parsed.line_start,
        parsed.line_end,
        parsed.new_text,
        parsed.expected_hash,
      );
      const afterPage = pages.get(parsed.page_id);
      const newHashes = afterPage ? extractImageHashesSet(afterPage.content) : new Set<string>();
      const removed = new Set<string>([...oldHashes].filter((h) => !newHashes.has(h)));
      cleanupRemovedImageRefs(removed, parsed.page_id, db, images);
      logIf(
        "edit_lines",
        parsed.user_prompt,
        meta.knowledge_id,
        r.id,
        r.version,
      );
      recordActivity({
        action: "edit",
        target: "page",
        knowledge_id: meta.knowledge_id,
        page_id: r.id,
      });
      return withFeedback(
        {
          id: r.id,
          knowledge_id: meta.knowledge_id,
          version: r.version,
          new_line_count: r.new_line_count,
          url: urlFor(ctx, meta.knowledge_id, r.id, parsed.line_start),
        },
        r,
      );
    },

    async edit_section(input) {
      const parsed = EditSectionSchema.parse(input);
      gateEditByPid(parsed.page_id);
      const beforePage = pages.get(parsed.page_id);
      if (!beforePage) throw new Error(`page #${parsed.page_id} not found`);
      const meta = beforePage;
      const oldHashes = extractImageHashesSet(beforePage.content);
      const r = pages.editSection(parsed.page_id, parsed.heading, parsed.new_content);
      const afterPage = pages.get(parsed.page_id);
      const newHashes = afterPage ? extractImageHashesSet(afterPage.content) : new Set<string>();
      const removed = new Set<string>([...oldHashes].filter((h) => !newHashes.has(h)));
      cleanupRemovedImageRefs(removed, parsed.page_id, db, images);
      logIf(
        "edit_section",
        parsed.user_prompt,
        meta.knowledge_id,
        r.id,
        r.version,
      );
      recordActivity({
        action: "edit",
        target: "page",
        knowledge_id: meta.knowledge_id,
        page_id: r.id,
      });
      return withFeedback(
        {
          id: r.id,
          knowledge_id: meta.knowledge_id,
          version: r.version,
          new_line_count: r.new_line_count,
          replaced_lines: r.replaced_lines,
          url: urlFor(ctx, meta.knowledge_id, r.id),
        },
        r,
      );
    },

    async replace_text(input) {
      const parsed = ReplaceTextSchema.parse(input);
      if (parsed.page_id != null) {
        gateEditByPid(parsed.page_id);
      } else {
        gateEditByKid(parsed.knowledge_id);
      }
      // Only snapshot when `find` could plausibly contain an image
      // hash — otherwise the diff is provably empty and we skip the
      // overhead. Same heuristic for the rare cross-page rename case.
      const mayAffectImages = /\/img\//i.test(parsed.find);
      const beforeSnapshots = new Map<number, Set<string>>();
      if (mayAffectImages) {
        const targets =
          parsed.page_id != null
            ? [pages.getMetadata(parsed.page_id)].filter(
                (m): m is NonNullable<typeof m> => m !== null,
              )
            : pages.list(parsed.knowledge_id);
        for (const t of targets) {
          const got = pages.get(t.id);
          if (got) beforeSnapshots.set(t.id, extractImageHashesSet(got.content));
        }
      }
      const r = pages.replaceText(
        parsed.knowledge_id,
        parsed.page_id,
        parsed.find,
        parsed.replace,
        parsed.count,
      );
      if (mayAffectImages) {
        for (const rep of r.replacements) {
          const oldHashes = beforeSnapshots.get(rep.page_id) ?? new Set<string>();
          const after = pages.get(rep.page_id);
          const newHashes = after ? extractImageHashesSet(after.content) : new Set<string>();
          const removed = new Set<string>(
            [...oldHashes].filter((h) => !newHashes.has(h)),
          );
          cleanupRemovedImageRefs(removed, rep.page_id, db, images);
        }
      }
      const total = r.replacements.reduce((sum, it) => sum + it.count, 0);
      // Log once at the knowledge level — the prompt usually intended
      // the change conceptually, not per affected page.
      logIf(
        "replace_text",
        parsed.user_prompt,
        parsed.knowledge_id,
        parsed.page_id ?? null,
        null,
      );
      if (total > 0) {
        recordActivity({
          action: "edit",
          target: parsed.page_id != null ? "page" : "knowledge",
          knowledge_id: parsed.knowledge_id,
          page_id: parsed.page_id ?? null,
        });
      }
      return {
        replacements: r.replacements.map((it) => ({
          ...it,
          url: urlFor(ctx, parsed.knowledge_id, it.page_id),
        })),
        total,
      };
    },

    async search(input) {
      const parsed = SearchSchema.parse(input);
      const hits = pages.search(parsed.query, {
        project: parsed.project,
        projects: parsed.projects,
        knowledge_id: parsed.knowledge_id,
        limit: parsed.limit,
      });
      const visible = visibleProjectsForCaller();
      const filtered =
        visible === null
          ? hits
          : hits.filter((h) => h.project != null && visible.has(h.project));
      return {
        hits: filtered.map((h) => ({
          ...h,
          url: urlFor(ctx, h.knowledge_id, h.page_id, h.line),
        })),
        total: filtered.length,
      };
    },

    async get_block(input) {
      const parsed = GetBlockSchema.parse(input);
      if (parsed.summary) {
        const s = pages.getBlockSummary(parsed.id);
        if (!s) throw new Error(`block @${parsed.id} not found`);
        gateReadByProject(s.project);
        return {
          ...s,
          url: urlFor(ctx, s.knowledge_id, s.page_id, s.line_start),
        };
      }
      const b = pages.getBlock(parsed.id);
      if (!b) throw new Error(`block @${parsed.id} not found`);
      gateReadByProject(b.project);
      // For html-embed blocks, strip inline `style="..."` by default
      // so AI editing the body doesn't pay for presentation tokens.
      // `include_styles: true` keeps the raw HTML verbatim.
      const stripped =
        b.kind === "html-embed" && !parsed.include_styles
          ? {
              ...b,
              source: stripInlineStyles(b.source),
              inner: stripInlineStyles(b.inner),
            }
          : b;
      return {
        ...stripped,
        url: urlFor(ctx, b.knowledge_id, b.page_id, b.line_start),
      };
    },

    async get_table_row(input) {
      const parsed = GetTableRowSchema.parse(input);
      const r = pages.getTableRow(parsed.block_id, parsed.index);
      gateReadByKid(r.knowledge_id);
      return {
        ...r,
        url: urlFor(ctx, r.knowledge_id, r.page_id, r.source_line),
      };
    },

    async find_table_rows(input) {
      const parsed = FindTableRowsSchema.parse(input);
      const r = pages.findTableRows(parsed.block_id, {
        q: parsed.q,
        where: parsed.where,
        columns: parsed.columns,
        limit: parsed.limit,
      });
      gateReadByKid(r.knowledge_id);
      return {
        ...r,
        matches: r.matches.map((m) => ({
          ...m,
          url: urlFor(ctx, r.knowledge_id, r.page_id, m.source_line),
        })),
      };
    },

    async get_table_rows(input) {
      const parsed = GetTableRowsSchema.parse(input);
      const r = pages.getTableRows(parsed.block_id, {
        start: parsed.start,
        end: parsed.end,
        offset: parsed.offset,
        limit: parsed.limit,
      });
      gateReadByKid(r.knowledge_id);
      return {
        ...r,
        url: urlFor(ctx, r.knowledge_id, r.page_id),
        matches: r.matches.map((m) => ({
          ...m,
          url: urlFor(ctx, r.knowledge_id, r.page_id, m.source_line),
        })),
      };
    },

    async get_table_rows_with_checkbox(input) {
      const parsed = GetTableRowsWithCheckboxSchema.parse(input);
      const r = pages.getTableRowsWithCheckbox(parsed.block_id, {
        checked: parsed.checked,
        limit: parsed.limit,
      });
      gateReadByKid(r.knowledge_id);
      return {
        ...r,
        url: urlFor(ctx, r.knowledge_id, r.page_id),
        matches: r.matches.map((m) => ({
          ...m,
          url: urlFor(ctx, r.knowledge_id, r.page_id, m.source_line),
        })),
      };
    },

    async update_table_rows(input) {
      const parsed = UpdateTableRowsSchema.parse(input);
      // Project-edit gate via the owning page.
      const summary = pages.getBlockSummary(parsed.block_id);
      if (summary) gateEditByProject(summary.project);
      const r = pages.updateTableRows(parsed.block_id, {
        start: parsed.start,
        end: parsed.end,
        offset: parsed.offset,
        newRows: parsed.new_rows,
        expectedVersion: parsed.expected_version,
      });
      logIf(
        "update_table_rows",
        parsed.user_prompt,
        r.knowledge_id,
        r.page_id,
        r.page_version,
      );
      recordActivity({
        action: "edit",
        target: "block",
        knowledge_id: r.knowledge_id,
        page_id: r.page_id,
        block_id: parsed.block_id,
      });
      return {
        page_id: r.page_id,
        knowledge_id: r.knowledge_id,
        page_version: r.page_version,
        updated_count: r.updated_count,
        url: urlFor(ctx, r.knowledge_id, r.page_id),
      };
    },

    async append_table_row(input) {
      const parsed = AppendTableRowSchema.parse(input);
      const summary = pages.getBlockSummary(parsed.block_id);
      if (summary) gateEditByProject(summary.project);
      const r = pages.appendTableRows(parsed.block_id, {
        newRows: parsed.new_rows,
        expectedVersion: parsed.expected_version,
      });
      logIf(
        "append_table_row",
        parsed.user_prompt,
        r.knowledge_id,
        r.page_id,
        r.page_version,
      );
      recordActivity({
        action: "edit",
        target: "block",
        knowledge_id: r.knowledge_id,
        page_id: r.page_id,
        block_id: parsed.block_id,
      });
      return {
        page_id: r.page_id,
        knowledge_id: r.knowledge_id,
        page_version: r.page_version,
        appended_count: r.appended_count,
        new_row_indices: r.new_row_indices,
        url: urlFor(ctx, r.knowledge_id, r.page_id),
      };
    },

    async insert_table_row(input) {
      const parsed = InsertTableRowSchema.parse(input);
      const summary = pages.getBlockSummary(parsed.block_id);
      if (summary) gateEditByProject(summary.project);
      const r = pages.insertTableRows(parsed.block_id, {
        at: parsed.at,
        newRows: parsed.new_rows,
        expectedVersion: parsed.expected_version,
      });
      logIf(
        "insert_table_row",
        parsed.user_prompt,
        r.knowledge_id,
        r.page_id,
        r.page_version,
      );
      recordActivity({
        action: "edit",
        target: "block",
        knowledge_id: r.knowledge_id,
        page_id: r.page_id,
        block_id: parsed.block_id,
      });
      return {
        page_id: r.page_id,
        knowledge_id: r.knowledge_id,
        page_version: r.page_version,
        inserted_count: r.inserted_count,
        new_row_indices: r.new_row_indices,
        url: urlFor(ctx, r.knowledge_id, r.page_id),
      };
    },

    async insert_lines(input) {
      const parsed = InsertLinesSchema.parse(input);
      gateEditByPid(parsed.page_id);
      const meta = pages.getMetadata(parsed.page_id);
      if (!meta) throw new Error(`page #${parsed.page_id} not found`);
      const r = pages.insertLines(
        parsed.page_id,
        parsed.at,
        parsed.new_text,
        parsed.expected_hash,
      );
      logIf(
        "insert_lines",
        parsed.user_prompt,
        meta.knowledge_id,
        r.id,
        r.version,
      );
      recordActivity({
        action: "edit",
        target: "page",
        knowledge_id: meta.knowledge_id,
        page_id: r.id,
      });
      return withFeedback(
        {
          id: r.id,
          knowledge_id: meta.knowledge_id,
          version: r.version,
          new_line_count: r.new_line_count,
          inserted_lines: r.inserted_lines,
          url: urlFor(ctx, meta.knowledge_id, r.id, parsed.at),
        },
        r,
      );
    },

    async add_lines(input) {
      const parsed = AddLinesSchema.parse(input);
      gateEditByPid(parsed.page_id);
      const meta = pages.getMetadata(parsed.page_id);
      if (!meta) throw new Error(`page #${parsed.page_id} not found`);
      const r = pages.addLines(
        parsed.page_id,
        parsed.new_text,
        parsed.expected_hash,
      );
      logIf(
        "add_lines",
        parsed.user_prompt,
        meta.knowledge_id,
        r.id,
        r.version,
      );
      recordActivity({
        action: "edit",
        target: "page",
        knowledge_id: meta.knowledge_id,
        page_id: r.id,
      });
      return withFeedback(
        {
          id: r.id,
          knowledge_id: meta.knowledge_id,
          version: r.version,
          new_line_count: r.new_line_count,
          appended_lines: r.appended_lines,
          url: urlFor(ctx, meta.knowledge_id, r.id),
        },
        r,
      );
    },

    async set_block_caption(input) {
      const parsed = SetBlockCaptionSchema.parse(input);
      const summary = pages.getBlockSummary(parsed.id);
      if (summary) gateEditByProject(summary.project);
      const r = pages.setBlockCaption(parsed.id, parsed.caption);
      logIf(
        "set_block_caption",
        parsed.user_prompt,
        r.knowledge_id,
        r.page_id,
        null,
      );
      recordActivity({
        action: "caption",
        target: "block",
        knowledge_id: r.knowledge_id,
        page_id: r.page_id,
        block_id: r.block_id,
        block_caption: r.caption,
      });
      return {
        ...r,
        url: urlFor(ctx, r.knowledge_id, r.page_id),
      };
    },

    async add_image(input) {
      const parsed = AddImageSchema.parse(input);
      // add_image has no knowledge_id binding — images live in a shared
      // pool and are linked by reference from page content. The eventual
      // page edit that embeds the image will enforce per-project edit.
      const raw = parsed.data_base64.replace(/^data:[^,]+,/, ""); // strip data: URI if present
      let bytes: Buffer;
      try {
        bytes = Buffer.from(raw, "base64");
      } catch (e) {
        throw new Error(`base64 decode failed: ${(e as Error).message}`);
      }
      const meta = images.add(bytes, parsed.mime_type, parsed.alt ?? null);
      const base = ctx.publicBaseUrl.replace(/\/$/, "");
      recordActivity({
        action: "upload",
        target: "image",
      });
      return { ...meta, url: `${base}${meta.src}` };
    },

    async get_image(input) {
      const parsed = GetImageSchema.parse(input);
      const meta = parsed.hash
        ? images.get(parsed.hash)
        : images.getBySrc(parsed.src!);
      if (!meta) throw new Error(`image not found`);
      const base = ctx.publicBaseUrl.replace(/\/$/, "");
      const url = `${base}${meta.src}`;
      // `mode: "meta"` never reads bytes — cheapest path, lets an agent
      // decide what an image is without dragging base64 into context.
      // Omitted mode keeps the legacy "inline when under cap" behavior so
      // existing callers don't break (default flips to "meta" in a future
      // major — &50 #325).
      if (parsed.mode === "meta") {
        return { ...meta, url, embedded: false, mode: "meta" as const };
      }
      const cap = parsed.max_bytes ?? 6 * 1024 * 1024;
      if (meta.size_bytes > cap) {
        return { ...meta, url, embedded: false, mode: "full" as const };
      }
      const bytes = images.readBytes(meta.hash, meta.ext);
      return {
        ...meta,
        url,
        embedded: true,
        mode: "full" as const,
        data_base64: bytes.toString("base64"),
      };
    },

    async get_example(input) {
      const parsed = GetExampleSchema.parse(input);
      const kind = (parsed.kind ?? "full") as ExampleKind;
      const full = readExample(kind);
      const lines = full.split("\n");
      const total = lines.length;
      const outline = exampleOutline(full);

      if (parsed.outline_only) {
        return { kind, total_lines: total, outline, content: "" };
      }
      if (parsed.line_start !== undefined || parsed.line_end !== undefined) {
        const start = Math.max(1, parsed.line_start ?? 1);
        const end = Math.min(total, parsed.line_end ?? total);
        const slice = start > end ? "" : lines.slice(start - 1, end).join("\n");
        return {
          kind,
          total_lines: total,
          outline,
          content: slice,
          line_start: start,
          line_end: end,
        };
      }
      return { kind, total_lines: total, outline, content: full };
    },

    async get_prompt_log(input) {
      const parsed = GetPromptLogSchema.parse(input);
      gateReadByKid(parsed.knowledge_id);
      const meta = knowledge.get(parsed.knowledge_id);
      if (!meta) throw new Error(`knowledge #${parsed.knowledge_id} not found`);
      const entries = promptLog.listForKnowledge(parsed.knowledge_id, {
        limit: parsed.limit,
        offset: parsed.offset,
      });
      return {
        knowledge_id: parsed.knowledge_id,
        total: entries.length,
        entries,
      };
    },

    async toggle_task(input) {
      const parsed = ToggleTaskSchema.parse(input);
      gateEditByPid(parsed.page_id);
      const meta = pages.getMetadata(parsed.page_id);
      if (!meta) throw new Error(`page #${parsed.page_id} not found`);
      const r = pages.toggleTaskAtIndex(parsed.page_id, parsed.index, {
        expectedVersion: parsed.expected_version,
      });
      logIf(
        "toggle_task",
        parsed.user_prompt,
        meta.knowledge_id,
        parsed.page_id,
        r.version,
      );
      recordActivity({
        action: "toggle",
        target: "task",
        knowledge_id: meta.knowledge_id,
        page_id: parsed.page_id,
      });
      return {
        page_id: parsed.page_id,
        knowledge_id: meta.knowledge_id,
        index: r.index,
        done: r.done,
        version: r.version,
        updated_at: r.updated_at,
        url: urlFor(ctx, meta.knowledge_id, parsed.page_id),
      };
    },
  };
}

export { pageEntryShape };
