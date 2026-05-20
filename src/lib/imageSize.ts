/**
 * Shared helpers for the inline-markdown image sizing convention.
 *
 * An author (or the drag-resize handles) encodes the maximum render
 * width / height inside the standard markdown image *title* slot:
 *
 *   ![alt](src "WxH")          — both axes
 *   ![alt](src "Wx")           — width only
 *   ![alt](src "xH")           — height only
 *   ![alt](src "caption w=300 h=200")   — caption text + tokens
 *
 * The renderer translates the recognised tokens into a `style` attribute
 * with `max-width:Npx` / `max-height:Mpx` (always with `width:auto +
 * height:auto` so the image keeps its aspect ratio).
 *
 * `parseImageSize` extracts the size + remaining caption from a title.
 * `formatImageTitle` builds a title back from (caption, width?, height?),
 * picking the compact `WxH` form when there's no caption and the verbose
 * `w=N h=M` form otherwise (so the caption stays readable).
 */
export function parseImageSize(
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

/**
 * Build a markdown-image title from an optional caption + width/height.
 * Returns an empty string when there's nothing to write (caller can then
 * drop the title slot entirely so the rendered source stays clean).
 *
 *   formatImageTitle("",    300, 200) // → "300x200"
 *   formatImageTitle("",    300, undefined) // → "300x"
 *   formatImageTitle("cap", 300, 200) // → "cap w=300 h=200"
 *   formatImageTitle("cap", undefined, undefined) // → "cap"
 *   formatImageTitle("",    undefined, undefined) // → ""
 */
export function formatImageTitle(
  caption: string,
  width?: number,
  height?: number,
): string {
  const cap = caption.trim();
  if (cap) {
    const tokens: string[] = [];
    if (width != null) tokens.push(`w=${width}`);
    if (height != null) tokens.push(`h=${height}`);
    return tokens.length === 0 ? cap : `${cap} ${tokens.join(" ")}`;
  }
  if (width != null && height != null) return `${width}x${height}`;
  if (width != null) return `${width}x`;
  if (height != null) return `x${height}`;
  return "";
}
