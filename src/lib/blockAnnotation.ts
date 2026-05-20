/**
 * Shared parser/formatter for the block-annotation syntax.
 *
 * Every rich block (fenced or markdown-table) carries a stable
 * `{@N}` id in source. The id can optionally be followed by a
 * double-quoted caption:
 *
 *   ```mermaid {@123 "Architecture: API → DB"}
 *   ```chart {@456 "Monthly revenue 2024"}
 *
 *   | col | col |
 *   |-----|-----|
 *   | ... |
 *
 *   {@789 "Q1 inventory by SKU"}
 *
 * The caption is the same idea as HTML `<figcaption>` / a Word
 * figure caption — short human-readable text describing what the
 * block IS, so an AI calling `get_block({ id, summary: true })`
 * can answer "what is @123?" without paying the body's token cost.
 *
 * Caption text may contain spaces, punctuation, unicode. Embedded
 * double-quotes are escaped as `\"`; literal backslashes as `\\`.
 */

/** Matches `{@N}` with an optional `"caption"` and captures both. */
const ANNOTATION_RE = /\{@(\d+)(?:\s+"((?:[^"\\]|\\.)*)")?\}/;

/** Global variant for scanning. */
const ANNOTATION_RE_G = /\{@(\d+)(?:\s+"((?:[^"\\]|\\.)*)")?\}/g;

export interface ParsedAnnotation {
  id: number;
  caption: string | null;
  /** Character offset into the input where the `{` starts. */
  start: number;
  /** Character offset immediately after the closing `}`. */
  end: number;
}

/**
 * Find the first `{@N "caption"?}` annotation in `text` (or null if
 * none). Use `parseAllAnnotations` to enumerate every annotation.
 */
export function parseAnnotation(text: string): ParsedAnnotation | null {
  ANNOTATION_RE.lastIndex = 0;
  const m = ANNOTATION_RE.exec(text);
  if (!m) return null;
  return {
    id: Number(m[1]),
    caption: m[2] != null ? unescapeCaption(m[2]) : null,
    start: m.index,
    end: m.index + m[0].length,
  };
}

/** Return every annotation found in `text`, in source order. */
export function parseAllAnnotations(text: string): ParsedAnnotation[] {
  const out: ParsedAnnotation[] = [];
  ANNOTATION_RE_G.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ANNOTATION_RE_G.exec(text)) !== null) {
    out.push({
      id: Number(m[1]),
      caption: m[2] != null ? unescapeCaption(m[2]) : null,
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return out;
}

/**
 * Render `{@N}` or `{@N "caption"}` into source form. Pass `null`
 * (or undefined) for `caption` to emit the bare id form.
 */
export function formatAnnotation(
  id: number,
  caption?: string | null,
): string {
  if (caption == null || caption === "") return `{@${id}}`;
  return `{@${id} "${escapeCaption(caption)}"}`;
}

function escapeCaption(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function unescapeCaption(s: string): string {
  return s.replace(/\\(["\\])/g, "$1");
}

/**
 * Strip every `{@N ...?}` annotation from a string (leaves
 * surrounding whitespace alone). Used by renderers to clean the
 * fence info string after consuming the annotation.
 */
export function stripAnnotations(text: string): string {
  return text.replace(ANNOTATION_RE_G, "").replace(/\s+/g, " ").trim();
}
