export const MAX_KNOWLEDGE_TAGS = 20;
export const MAX_KNOWLEDGE_TAG_LENGTH = 60;

export interface MergeKnowledgeTagsResult {
  tags: string[];
  invalid: string[];
  overflow: string[];
}

function keyForTag(tag: string): string {
  return tag.toLocaleLowerCase();
}

export function dedupeKnowledgeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim();
    if (!tag) continue;
    const key = keyForTag(tag);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result;
}

/**
 * Return true when a knowledge has at least one of the selected tags.
 *
 * Comparisons are case-insensitive. An empty selection means the tag filter
 * is inactive, so every knowledge matches.
 */
export function matchesAnyKnowledgeTag(
  knowledgeTags: string[],
  selectedTags: string[],
): boolean {
  if (selectedTags.length === 0) return true;
  const selected = new Set(selectedTags.map(keyForTag));
  return knowledgeTags.some((tag) => selected.has(keyForTag(tag)));
}

/**
 * Merge comma/newline-separated input into a tag list.
 *
 * Tags are case-insensitively unique while preserving the first spelling.
 * Invalid (>60 chars) and over-limit (>20 tags) entries are reported instead
 * of being silently truncated.
 */
export function mergeKnowledgeTagInput(
  current: string[],
  input: string,
): MergeKnowledgeTagsResult {
  const tags = dedupeKnowledgeTags(current);
  const seen = new Set(tags.map(keyForTag));
  const invalid: string[] = [];
  const overflow: string[] = [];

  for (const raw of input.split(/[,\n]/)) {
    const tag = raw.trim();
    if (!tag) continue;
    if (tag.length > MAX_KNOWLEDGE_TAG_LENGTH) {
      invalid.push(tag);
      continue;
    }
    const key = keyForTag(tag);
    if (seen.has(key)) continue;
    if (tags.length >= MAX_KNOWLEDGE_TAGS) {
      overflow.push(tag);
      continue;
    }
    seen.add(key);
    tags.push(tag);
  }

  return { tags, invalid, overflow };
}
