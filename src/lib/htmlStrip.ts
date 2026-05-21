/**
 * Strip inline `style="..."` attributes from an HTML string.
 *
 * Author-written `html-embed` blocks routinely carry verbose inline
 * styles (gradient cards, sticky-header tables, custom badges). When
 * an AI reads such a block — to edit content, add a row, or summarise
 * what it says — those styles are mostly noise and can easily eat
 * 60-70% of the block's token cost.
 *
 * `get_block` and `read_page` strip styles by default and accept an
 * opt-in `include_styles: true` flag when the AI is genuinely working
 * on the block's presentation (recolouring, redesigning layout, …).
 *
 * Targets only the `style="…"` / `style='…'` attribute. Leaves every
 * other attribute (`src`, `href`, `alt`, `title`, `data-*`, `class`,
 * etc.) untouched.
 */
export function stripInlineStyles(html: string): string {
  return html
    .replace(/\s+style\s*=\s*"[^"]*"/gi, "")
    .replace(/\s+style\s*=\s*'[^']*'/gi, "");
}

/**
 * Walk a piece of markdown source, fence-aware, and strip inline
 * `style` attributes from every `html-embed` fence body. Code fences
 * of other languages (typescript, markdown, …) stay verbatim — their
 * content is illustrative and we'd corrupt examples by editing them.
 *
 * If the input is sliced mid-fence (e.g. a `read_page` with line range
 * that doesn't include the fence-open marker), no stripping happens
 * on that slice — better safe than to half-strip the body.
 */
export function stripHtmlEmbedStylesInMarkdown(content: string): string {
  const lines = content.split("\n");
  const out: string[] = [];
  let inFence = false;
  let fenceMarker = "";
  let isHtmlEmbed = false;
  for (const line of lines) {
    if (!inFence) {
      const open = /^(\s*)(```+)\s*([A-Za-z0-9_-]+)/.exec(line);
      if (open) {
        inFence = true;
        fenceMarker = open[2];
        isHtmlEmbed = open[3].toLowerCase() === "html-embed";
      }
      out.push(line);
      continue;
    }
    const close = new RegExp(`^\\s*${fenceMarker.replace(/`/g, "`")}+\\s*$`);
    if (close.test(line)) {
      out.push(line);
      inFence = false;
      isHtmlEmbed = false;
      continue;
    }
    out.push(isHtmlEmbed ? stripInlineStyles(line) : line);
  }
  return out.join("\n");
}
