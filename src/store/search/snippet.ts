import { DEFAULT_PARAMS, type SearchParams } from "./params.js";

export interface Excerpt {
  /** 1-based line the excerpt was taken from. */
  line: number;
  text: string;
}

/**
 * Pick the line a hit should point at, and quote enough of it to judge the hit
 * without opening the page.
 *
 * The old excerpt came from FTS5's `snippet()`, whose window is measured in
 * tokens — and with a trigram tokenizer a token is three characters, so forty
 * of them is a fragment barely wider than the match itself. Building the
 * excerpt here instead means the width is in characters, the line number comes
 * from the same decision that chose the text, and the excerpt is centred on
 * the term that actually earned the hit rather than on whichever one appears
 * first in the file.
 *
 * Terms are tried in the order given, so callers should pass them rarest
 * first: the line containing `better-sqlite3` says far more about why a page
 * matched than the line containing `แทน`.
 */
export function buildExcerpt(
  content: string,
  terms: string[],
  overrides: Partial<SearchParams> = {},
): Excerpt {
  const p = { ...DEFAULT_PARAMS, ...overrides };
  const lines = content.split("\n");
  const fenced = markFencedLines(lines);
  const found = locate(lines, terms, fenced);
  if (!found) {
    // Nothing matched in the body — the hit came from the title or keywords.
    // Quote the opening instead of pretending to point somewhere.
    return {
      line: 1,
      text: condense(firstProseLine(lines, fenced, 0), p.snippetChars),
    };
  }
  const line = lines[found.line - 1];
  if (isStructural(line)) {
    // The match is on a heading or a fence. The line number is right — that is
    // where the term is — but quoting `## Cache` back to someone who searched
    // for "cache" tells them nothing they did not just type. Carry the prose
    // under it instead, which is the part that answers the question.
    const prose = firstProseLine(lines, fenced, found.line);
    const head = line.replace(/^#+\s*/, "").trim();
    return {
      line: found.line,
      text: condense(prose ? `${head} — ${prose}` : head, p.snippetChars),
    };
  }
  return {
    line: found.line,
    text: window(line, found.column, found.length, p.snippetChars),
  };
}

/**
 * First line containing any of the terms, preferring earlier terms in the list
 * and readable prose over everything else.
 *
 * Three passes, in descending order of how much the quoted line will tell a
 * reader:
 *
 *   1. prose outside any fenced block — the paragraph that explains the term
 *   2. headings, and other structure outside a fence
 *   3. anything at all, including the inside of a fence
 *
 * The fence rule earns its keep on this corpus. A page built around a Mermaid
 * diagram mentions its subject inside the diagram source long before the prose
 * gets to it, and quoting `A["ต้องเข้ากล่อง"] --> B{"WireGuard ไหม?"}` at
 * someone tells them nothing except that they should open the page — which is
 * the read this excerpt exists to save.
 */
function locate(
  lines: string[],
  terms: string[],
  fenced: boolean[],
): { line: number; column: number; length: number } | null {
  const passes: Array<(i: number) => boolean> = [
    (i) => !fenced[i] && !isStructural(lines[i]),
    (i) => !fenced[i],
    () => true,
  ];
  for (const allowed of passes) {
    for (const term of terms) {
      const needle = term.toLowerCase();
      for (let i = 0; i < lines.length; i++) {
        if (!allowed(i)) continue;
        const column = lines[i].toLowerCase().indexOf(needle);
        if (column !== -1) return { line: i + 1, column, length: term.length };
      }
    }
  }
  return null;
}

/** Flag every line that sits inside a ``` fence, the fence markers included. */
function markFencedLines(lines: string[]): boolean[] {
  const out = new Array<boolean>(lines.length).fill(false);
  let open = false;
  for (let i = 0; i < lines.length; i++) {
    const isMarker = lines[i].trimStart().startsWith("```");
    if (isMarker) {
      out[i] = true;
      open = !open;
      continue;
    }
    out[i] = open;
  }
  return out;
}

/** Headings and blockquote markers — structure rather than prose. */
function isStructural(line: string): boolean {
  const t = line.trim();
  return t.startsWith("#") || t.startsWith("```") || t.startsWith(">");
}

/** First line of actual prose at or after `from`, skipping blanks, structure
 *  and anything inside a fence, so an excerpt is never just `# Title` or a
 *  line of diagram source. */
function firstProseLine(lines: string[], fenced: boolean[], from: number): string {
  for (let i = from; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || fenced[i] || isStructural(t)) continue;
    return t;
  }
  for (let i = from; i < lines.length; i++) {
    if (lines[i].trim()) return lines[i].trim();
  }
  return "";
}

/** Take `width` characters around the match, breaking on spaces where one is
 *  near the cut so the excerpt does not start or end mid-word. */
function window(line: string, column: number, length: number, width: number): string {
  const text = line.trim();
  const shift = line.length - line.trimStart().length;
  const at = Math.max(0, column - shift);
  if (text.length <= width) return condense(text, width);

  const slack = Math.max(0, width - length);
  let start = Math.max(0, at - Math.floor(slack / 2));
  let end = Math.min(text.length, start + width);
  start = Math.max(0, end - width);

  // Only nudge to a word boundary when one is close — Thai has no spaces, and
  // hunting for one there would walk off the match entirely.
  const spaceAfterStart = text.indexOf(" ", start);
  if (start > 0 && spaceAfterStart !== -1 && spaceAfterStart - start < 12) {
    start = spaceAfterStart + 1;
  }
  const spaceBeforeEnd = text.lastIndexOf(" ", end);
  if (end < text.length && spaceBeforeEnd > end - 12) end = spaceBeforeEnd;

  const body = condense(text.slice(start, end), width);
  return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`;
}

/** Collapse runs of whitespace and hard-cap the length. */
function condense(text: string, width: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= width ? flat : `${flat.slice(0, width).trimEnd()}…`;
}
