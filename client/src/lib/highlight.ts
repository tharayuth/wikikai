export interface HighlightPart {
  text: string;
  hit: boolean;
}

/**
 * Split a snippet into alternating plain and matched parts.
 *
 * Pure so it can be tested without a DOM: the component just maps the result
 * to `<mark>` or `<span>`.
 *
 * Terms are applied longest-first because Thai queries produce overlapping
 * windows — `ตรวจสอบข้อ` and `สอบข้อมูล` can both match the same stretch of
 * text, and letting the shorter one win first would chop the longer match into
 * confetti.
 */
export function splitHighlight(text: string, terms: string[]): HighlightPart[] {
  const usable = terms.filter((t) => t.length > 0);
  if (!usable.length || !text) return [{ text, hit: false }];
  const pattern = [...usable]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
  const lowered = new Set(usable.map((t) => t.toLowerCase()));
  return text
    .split(new RegExp(`(${pattern})`, "gi"))
    .filter((part) => part !== "")
    .map((part) => ({ text: part, hit: lowered.has(part.toLowerCase()) }));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
