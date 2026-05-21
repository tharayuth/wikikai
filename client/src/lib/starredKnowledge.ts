const KEY = "wikikai.starredKnowledgeIds";
export const STARRED_KNOWLEDGE_EVENT = "wikikai-starred-knowledge";

function parseIds(raw: string | null): Set<number> {
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed
        .map((v) => Number(v))
        .filter((v) => Number.isInteger(v) && v > 0),
    );
  } catch {
    return new Set();
  }
}

export function readStarredKnowledgeIds(): Set<number> {
  try {
    return parseIds(localStorage.getItem(KEY));
  } catch {
    return new Set();
  }
}

export function writeStarredKnowledgeIds(ids: Set<number>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(Array.from(ids).sort((a, b) => a - b)));
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new CustomEvent(STARRED_KNOWLEDGE_EVENT));
}

export function isKnowledgeStarred(id: number): boolean {
  return readStarredKnowledgeIds().has(id);
}

export function toggleKnowledgeStar(id: number): boolean {
  const ids = readStarredKnowledgeIds();
  const next = !ids.has(id);
  if (next) ids.add(id);
  else ids.delete(id);
  writeStarredKnowledgeIds(ids);
  return next;
}
