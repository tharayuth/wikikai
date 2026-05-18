import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.resolve(here, "..", "examples");

export const EXAMPLE_KINDS = [
  "full",
  "minimal",
  "mermaid",
  "chart",
  "stats",
  "steps",
  "er",
  "html",
] as const;

export type ExampleKind = (typeof EXAMPLE_KINDS)[number];

const cache = new Map<ExampleKind, string>();

export function readExample(kind: ExampleKind): string {
  if (cache.has(kind)) return cache.get(kind)!;
  const fp = path.join(examplesDir, `${kind}.md`);
  const content = fs.readFileSync(fp, "utf8");
  cache.set(kind, content);
  return content;
}

export interface ExampleOutlineEntry {
  level: number;
  text: string;
  line: number;
}

/** Extract heading outline (h1–h6) from markdown, ignoring lines inside fenced code blocks. */
export function exampleOutline(content: string): ExampleOutlineEntry[] {
  const out: ExampleOutlineEntry[] = [];
  const lines = content.split("\n");
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^```/.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[i]);
    if (!m) continue;
    const text = m[2].replace(/\s*#+\s*$/, "");
    out.push({ level: m[1].length, text, line: i + 1 });
  }
  return out;
}
