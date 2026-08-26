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
 *
 * A trailing `h=NNN` token records a reader-chosen display height in px,
 * written by dragging a diagram's resize handle in the web UI:
 *
 *   ```mermaid {@123 h=320}
 *   ```mermaid {@123 "Architecture: API → DB" h=320}
 *
 * It is presentation only — absent means "render at the natural size", so
 * every existing annotation keeps behaving exactly as before. Width is
 * always left to the diagram itself.
 *
 * A bare `NNNpx` token is also accepted and ignored: a short-lived earlier
 * build wrote display *widths* that way. Parsing it keeps those blocks'
 * ids intact (a token the regex could not match would take the whole
 * annotation with it), and dropping the value is what returns them to the
 * natural width they should have had.
 */

/** `{@N}` with an optional `"caption"`, an optional `h=NNN`, and tolerance
 *  for the legacy `NNNpx` width token. */
const ANNOTATION_BODY =
  /\{@(\d+)(?:\s+"((?:[^"\\]|\\.)*)")?(?:\s+h=(\d+))?(?:\s+\d+px)?\}/;
const ANNOTATION_RE = new RegExp(ANNOTATION_BODY.source);

/** Global variant for scanning. */
const ANNOTATION_RE_G = new RegExp(ANNOTATION_BODY.source, "g");

export interface ParsedAnnotation {
  id: number;
  caption: string | null;
  /** Display height in px chosen by a reader, or null for natural size. */
  height: number | null;
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
    height: m[3] != null ? Number(m[3]) : null,
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
      height: m[3] != null ? Number(m[3]) : null,
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return out;
}

/**
 * Render an annotation back into source form. Omitted / null parts are
 * left out, so `{@N}` remains the shape of an annotation carrying neither
 * a caption nor a width.
 *
 * Callers that change one part must pass the others through — the caption
 * and width editors both re-emit the whole annotation, so dropping a field
 * here silently erases it from the page.
 */
export function formatAnnotation(
  id: number,
  parts: { caption?: string | null; height?: number | null } = {},
): string {
  const caption =
    parts.caption == null || parts.caption === ""
      ? ""
      : ` "${escapeCaption(parts.caption)}"`;
  const height =
    parts.height == null || !Number.isFinite(parts.height) || parts.height <= 0
      ? ""
      : ` h=${Math.round(parts.height)}`;
  return `{@${id}${caption}${height}}`;
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
