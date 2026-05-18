import { z } from "zod";
import type { KnowledgeStore, KnowledgeMetadata } from "../store/knowledge.js";
import type { PageStore, PageEntry, PageWithStats } from "../store/pages.js";
import type { ImageStore } from "../store/images.js";
import type { PromptLogStore, PromptLogEntry } from "../store/promptLog.js";
import {
  EXAMPLE_KINDS,
  exampleOutline,
  readExample,
  type ExampleKind,
  type ExampleOutlineEntry,
} from "./examples.js";

export interface HandlerContext {
  publicBaseUrl: string;
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
  project: z.string().max(100).optional(),
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
    project: z.string().max(100).optional(),
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

export const ReadPageSchema = z.object({
  page_id: z.number().int().positive(),
  line_start: z.number().int().min(1).optional(),
  line_end: z.number().int().min(1).optional(),
});

export const EditLinesSchema = z.object({
  page_id: z.number().int().positive(),
  line_start: z.number().int().min(1),
  line_end: z.number().int().min(1),
  new_text: z.string(),
  expected_hash: z.string().optional().describe("Hash of the line range from read_page — gate against stale edits"),
  user_prompt: z.string().max(2000).optional().describe(USER_PROMPT_EDIT_NOTE),
});

export const EditSectionSchema = z.object({
  page_id: z.number().int().positive(),
  heading: z.string().min(1).describe("Heading line exactly as it appears, e.g. '## 3. Performance'"),
  new_content: z.string(),
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
      "0-based index of the `- [ ]` / `- [x]` task on the page, counted top-down across all lists, ignoring tasks that sit inside fenced code blocks.",
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
      "Global block id (the `N` in `@N`). Returns the fenced block's source + inner body + parent page/knowledge context in one call.",
    ),
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
  read_page: z.infer<typeof ReadPageSchema>;
  edit_lines: z.infer<typeof EditLinesSchema>;
  edit_section: z.infer<typeof EditSectionSchema>;
  replace_text: z.infer<typeof ReplaceTextSchema>;
  search: z.infer<typeof SearchSchema>;
  get_block: z.infer<typeof GetBlockSchema>;
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
  delete_knowledge(input: ToolInputs["delete_knowledge"]): Promise<{ id: number; deleted: true }>;
  get_outline(input: ToolInputs["get_outline"]): Promise<{
    knowledge_id: number;
    title: string;
    pages: {
      id: number;
      title: string;
      position: number;
      summary: string | null;
      line_count: number;
      url: string;
      headings: { level: number; text: string; line: number; id: string }[];
    }[];
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
  delete_page(input: ToolInputs["delete_page"]): Promise<{ id: number; deleted: true }>;
  list_pages(input: ToolInputs["list_pages"]): Promise<(PageWithStats & { url: string })[]>;
  reorder_pages(input: ToolInputs["reorder_pages"]): Promise<{ ok: true; order: number[] }>;

  read_page(input: ToolInputs["read_page"]): Promise<{
    page_id: number;
    knowledge_id: number;
    title: string;
    position: number;
    content: string;
    total_lines: number;
    line_start: number;
    line_end: number;
    hash: string;
    url: string;
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
    source: string;
    inner: string;
    line_start: number;
    line_end: number;
    page_id: number;
    page_position: number;
    page_title: string;
    knowledge_id: number;
    knowledge_title: string;
    project: string | null;
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

export function buildToolHandlers(
  knowledge: KnowledgeStore,
  pages: PageStore,
  images: ImageStore,
  promptLog: PromptLogStore,
  ctx: HandlerContext,
): ToolHandlers {
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
      return { id: k.id, url: urlFor(ctx, k.id), created_at: k.created_at, first_page };
    },

    async edit_knowledge(input) {
      const parsed = EditKnowledgeSchema.parse(input);
      const r = knowledge.update(parsed.id, parsed);
      logIf("edit_knowledge", parsed.user_prompt, r.id, null, null);
      return { id: r.id, url: urlFor(ctx, r.id), version: r.version, updated_at: r.updated_at };
    },

    async list_knowledge(input) {
      const parsed = ListKnowledgeSchema.parse(input);
      return knowledge.list(parsed).map((k) => withUrl(ctx, k));
    },

    async get_knowledge(input) {
      const parsed = GetKnowledgeSchema.parse(input);
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
      pages.removeKnowledgeFiles(parsed.id);
      knowledge.remove(parsed.id);
      return { id: parsed.id, deleted: true };
    },

    async get_outline(input) {
      const parsed = GetOutlineSchema.parse(input);
      const meta = knowledge.get(parsed.knowledge_id);
      if (!meta) throw new Error(`knowledge #${parsed.knowledge_id} not found`);
      const out = pages.outline(parsed.knowledge_id);
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
      const r = pages.add(parsed);
      logIf("add_page", parsed.user_prompt, parsed.knowledge_id, r.id, 1);
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
      const before = pages.getMetadata(parsed.page_id);
      if (!before) throw new Error(`page #${parsed.page_id} not found`);
      const r = pages.update(parsed.page_id, parsed);
      logIf(
        "edit_page",
        parsed.user_prompt,
        before.knowledge_id,
        r.id,
        r.version,
      );
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
      const before = pages.getMetadata(parsed.page_id);
      if (!before) throw new Error(`page #${parsed.page_id} not found`);
      const r = pages.append(parsed.page_id, parsed.text);
      logIf(
        "append_page",
        parsed.user_prompt,
        before.knowledge_id,
        r.id,
        r.version,
      );
      return {
        id: r.id,
        knowledge_id: before.knowledge_id,
        version: r.version,
        new_line_count: r.new_line_count,
        url: urlFor(ctx, before.knowledge_id, r.id),
      };
    },

    async delete_page(input) {
      const parsed = DeletePageSchema.parse(input);
      pages.remove(parsed.page_id);
      return { id: parsed.page_id, deleted: true };
    },

    async list_pages(input) {
      const parsed = ListPagesSchema.parse(input);
      return pages.list(parsed.knowledge_id).map((p) => pageWithUrl(ctx, p));
    },

    async reorder_pages(input) {
      const parsed = ReorderPagesSchema.parse(input);
      pages.reorder(parsed.knowledge_id, parsed.order);
      return { ok: true, order: parsed.order };
    },

    // ─── line ops ───

    async read_page(input) {
      const parsed = ReadPageSchema.parse(input);
      const meta = pages.getMetadata(parsed.page_id);
      if (!meta) throw new Error(`page #${parsed.page_id} not found`);
      const r = pages.readLines(parsed.page_id, parsed.line_start, parsed.line_end);
      const k = knowledge.get(meta.knowledge_id);
      const siblings = pages.list(meta.knowledge_id);
      return {
        page_id: parsed.page_id,
        knowledge_id: meta.knowledge_id,
        title: meta.title,
        position: meta.position,
        content: r.content,
        total_lines: r.total_lines,
        line_start: r.line_start,
        line_end: r.line_end,
        hash: r.hash,
        url: urlFor(ctx, meta.knowledge_id, parsed.page_id, r.line_start),
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
        images_referenced: extractImageRefs(r.content),
      };
    },

    async edit_lines(input) {
      const parsed = EditLinesSchema.parse(input);
      const meta = pages.getMetadata(parsed.page_id);
      if (!meta) throw new Error(`page #${parsed.page_id} not found`);
      const r = pages.editLines(
        parsed.page_id,
        parsed.line_start,
        parsed.line_end,
        parsed.new_text,
        parsed.expected_hash,
      );
      logIf(
        "edit_lines",
        parsed.user_prompt,
        meta.knowledge_id,
        r.id,
        r.version,
      );
      return {
        id: r.id,
        knowledge_id: meta.knowledge_id,
        version: r.version,
        new_line_count: r.new_line_count,
        url: urlFor(ctx, meta.knowledge_id, r.id, parsed.line_start),
      };
    },

    async edit_section(input) {
      const parsed = EditSectionSchema.parse(input);
      const meta = pages.getMetadata(parsed.page_id);
      if (!meta) throw new Error(`page #${parsed.page_id} not found`);
      const r = pages.editSection(parsed.page_id, parsed.heading, parsed.new_content);
      logIf(
        "edit_section",
        parsed.user_prompt,
        meta.knowledge_id,
        r.id,
        r.version,
      );
      return {
        id: r.id,
        knowledge_id: meta.knowledge_id,
        version: r.version,
        new_line_count: r.new_line_count,
        replaced_lines: r.replaced_lines,
        url: urlFor(ctx, meta.knowledge_id, r.id),
      };
    },

    async replace_text(input) {
      const parsed = ReplaceTextSchema.parse(input);
      const r = pages.replaceText(
        parsed.knowledge_id,
        parsed.page_id,
        parsed.find,
        parsed.replace,
        parsed.count,
      );
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
      return {
        hits: hits.map((h) => ({
          ...h,
          url: urlFor(ctx, h.knowledge_id, h.page_id, h.line),
        })),
        total: hits.length,
      };
    },

    async get_block(input) {
      const parsed = GetBlockSchema.parse(input);
      const b = pages.getBlock(parsed.id);
      if (!b) throw new Error(`block @${parsed.id} not found`);
      return {
        ...b,
        url: urlFor(ctx, b.knowledge_id, b.page_id, b.line_start),
      };
    },

    async add_image(input) {
      const parsed = AddImageSchema.parse(input);
      const raw = parsed.data_base64.replace(/^data:[^,]+,/, ""); // strip data: URI if present
      let bytes: Buffer;
      try {
        bytes = Buffer.from(raw, "base64");
      } catch (e) {
        throw new Error(`base64 decode failed: ${(e as Error).message}`);
      }
      const meta = images.add(bytes, parsed.mime_type, parsed.alt ?? null);
      const base = ctx.publicBaseUrl.replace(/\/$/, "");
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
      const cap = parsed.max_bytes ?? 6 * 1024 * 1024;
      if (meta.size_bytes > cap) {
        return { ...meta, url, embedded: false };
      }
      const bytes = images.readBytes(meta.hash, meta.ext);
      return {
        ...meta,
        url,
        embedded: true,
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
      const meta = pages.getMetadata(parsed.page_id);
      if (!meta) throw new Error(`page #${parsed.page_id} not found`);
      const r = pages.toggleTaskAtIndex(parsed.page_id, parsed.index);
      logIf(
        "toggle_task",
        parsed.user_prompt,
        meta.knowledge_id,
        parsed.page_id,
        r.version,
      );
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
