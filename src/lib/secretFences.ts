import { parseAnnotation } from "./blockAnnotation.js";
import { parseSecretEnvelope, type SecretEnvelope } from "./secret.js";

export interface SecretFence {
  /** 0-based position among the page's secret envelopes, in source order. */
  index: number;
  block_id: number | null;
  label: string | null;
  envelope: SecretEnvelope;
  /** 1-based line of the fence opener. */
  line: number;
}

/** Every ```secret envelope on a page, in source order. A fence holding a
 *  JSON array contributes one entry per element, all sharing its block id.
 *  Malformed bodies are skipped — the renderer reports those inline. */
export function findSecretFences(content: string): SecretFence[] {
  const out: SecretFence[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const open = /^(\s*)(```+)\s*secret\b(.*)$/i.exec(lines[i]);
    if (!open) continue;
    const marker = open[2];
    const blockId = parseAnnotation(open[3])?.id ?? null;
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (new RegExp(`^\\s*${marker}\\s*$`).test(lines[j])) break;
      body.push(lines[j]);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.join("\n"));
    } catch {
      i = j;
      continue;
    }
    for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
      try {
        const envelope = parseSecretEnvelope(JSON.stringify(item));
        out.push({ index: out.length, block_id: blockId, label: envelope.label ?? null, envelope, line: i + 1 });
      } catch {
        /* renderer shows the error */
      }
    }
    i = j;
  }
  return out;
}
