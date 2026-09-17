import { markdownLanguage } from "@codemirror/lang-markdown";

export interface RawSelection { from: number; to: number }
interface Endpoint { line: number; endLine: number; text: string; offset: number }
export interface ReadingSelection { start: Endpoint | null; end: Endpoint | null; text: string }

// Keep UTF-16 offsets, just like DOM Range and CodeMirror. Collapsed whitespace
// carries the entire original interval so multiline selections remain intact.
export function normalizeText(text: string, positions?: RawSelection[]) {
  let value = "";
  const spans: RawSelection[] = [];
  for (let i = 0; i < text.length; i++) {
    const char = /\s/u.test(text[i]) ? " " : text[i];
    const span = positions?.[i] ?? { from: i, to: i + 1 };
    if (char === " " && value.endsWith(" ")) spans[spans.length - 1].to = span.to;
    else { value += char; spans.push({ ...span }); }
  }
  return { value, spans };
}

export function captureReadingSelection(root: HTMLElement | null): ReadingSelection | null {
  const selection = window.getSelection();
  if (!root || !selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const endpoint = (node: Node, offset: number): Endpoint | null => {
    const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
    const block = element?.closest<HTMLElement>("[data-source-line]");
    if (!block || !root.contains(block)) return null;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => n.parentElement?.closest(".header-anchor, button, .block-badge")
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    const before = document.createRange();
    before.setStart(block, 0);
    before.setEnd(node, offset);
    let text = "";
    let position = 0;
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (n === node) position = text.length + offset;
      else if (before.comparePoint(n, n.textContent?.length ?? 0) <= 0) {
        position = text.length + (n.textContent?.length ?? 0);
      }
      text += n.textContent ?? "";
    }
    return { line: Number(block.dataset.sourceLine), endLine: Number(block.dataset.sourceEndLine), text, offset: position };
  };
  return { start: endpoint(range.startContainer, range.startOffset), end: endpoint(range.endContainer, range.endOffset), text: range.toString() };
}

function visibleSource(source: string) {
  const hidden = new Uint8Array(source.length);
  const replacements = new Map<number, { to: number; value: string }>();
  markdownLanguage.parser.parse(source).iterate({
    enter(node) {
      if (/^(HeaderMark|EmphasisMark|LinkMark|CodeMark|ListMark|QuoteMark|EscapeMark|LinkTitle|TableDelimiter)$/.test(node.name)
        || (node.name === "URL" && node.node.parent?.name === "Link")) {
        hidden.fill(1, node.from, node.to);
      }
      if (node.name === "Entity") {
        const textarea = document.createElement("textarea");
        textarea.innerHTML = source.slice(node.from, node.to);
        replacements.set(node.from, { to: node.to, value: textarea.value });
      }
    },
  });
  let text = "";
  const positions: RawSelection[] = [];
  for (let i = 0; i < source.length; i++) {
    const replacement = replacements.get(i);
    if (replacement) {
      text += replacement.value;
      for (let j = 0; j < replacement.value.length; j++) positions.push({ from: i, to: replacement.to });
      i = replacement.to - 1;
    } else if (!hidden[i]) {
      text += source[i];
      positions.push({ from: i, to: i + 1 });
    }
  }
  return normalizeText(text, positions);
}

export function resolveReadingSelection(source: string, selection: ReadingSelection): RawSelection | null {
  const lines = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") lines.push(i + 1);
  const visible = visibleSource(source);
  const resolve = (endpoint: Endpoint | null, end: boolean): number | null => {
    if (!endpoint) return null;
    const from = lines[endpoint.line];
    const to = lines[endpoint.endLine] ?? source.length;
    if (from == null) return null;
    const first = visible.spans.findIndex((span) => span.to > from);
    let last = visible.spans.findIndex((span) => span.from >= to);
    if (first < 0) return null;
    if (last < 0) last = visible.spans.length;
    const projected = { value: visible.value.slice(first, last), spans: visible.spans.slice(first, last) };
    const rendered = normalizeText(endpoint.text);
    const needle = rendered.value.trim();
    const index = projected.value.indexOf(needle);
    // Refuse to guess if this block no longer matches the freshly fetched source.
    if (!needle || index < 0 || projected.value.indexOf(needle, index + 1) >= 0) return null;
    const trim = rendered.value.length - rendered.value.trimStart().length;
    const char = rendered.spans.findIndex((span) => end ? span.to >= endpoint.offset : span.to > endpoint.offset);
    if (char < 0) return null;
    const span = projected.spans[index + char - trim];
    return span ? (end && endpoint.offset > rendered.spans[char].from ? span.to : span.from) : null;
  };
  const from = resolve(selection.start, false);
  const to = resolve(selection.end, true);
  if (from != null && to != null && from < to) return { from, to };
  if (selection.start || selection.end) return null;
  // Generated rich blocks may have no source coordinates. Only use an exact,
  // unique match there; repeated labels must never jump to an unrelated block.
  const text = selection.text.trim();
  const index = source.indexOf(text);
  return text && index >= 0 && source.indexOf(text, index + 1) < 0
    ? { from: index, to: index + text.length } : null;
}
