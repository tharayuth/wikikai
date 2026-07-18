import { describe, expect, it } from "vitest";
import {
  MAX_KNOWLEDGE_TAGS,
  MAX_KNOWLEDGE_TAG_LENGTH,
  dedupeKnowledgeTags,
  matchesAnyKnowledgeTag,
  mergeKnowledgeTagInput,
} from "../client/src/lib/knowledgeTags";

describe("knowledge tag helpers", () => {
  it("trims and deduplicates tags case-insensitively", () => {
    expect(
      dedupeKnowledgeTags([" roadmap ", "Roadmap", "", "urgent"]),
    ).toEqual(["roadmap", "urgent"]);
  });

  it("accepts comma and newline separated input", () => {
    const result = mergeKnowledgeTagInput(
      ["existing"],
      "roadmap, urgent\ncustomer-a",
    );
    expect(result).toEqual({
      tags: ["existing", "roadmap", "urgent", "customer-a"],
      invalid: [],
      overflow: [],
    });
  });

  it("preserves the first spelling of duplicate tags", () => {
    const result = mergeKnowledgeTagInput(["Release"], "release, RELEASE");
    expect(result.tags).toEqual(["Release"]);
  });

  it("reports tags longer than the server limit", () => {
    const tooLong = "x".repeat(MAX_KNOWLEDGE_TAG_LENGTH + 1);
    const result = mergeKnowledgeTagInput([], tooLong);
    expect(result.tags).toEqual([]);
    expect(result.invalid).toEqual([tooLong]);
  });

  it("reports entries beyond the maximum tag count", () => {
    const current = Array.from(
      { length: MAX_KNOWLEDGE_TAGS },
      (_, index) => `tag-${index}`,
    );
    const result = mergeKnowledgeTagInput(current, "one-more");
    expect(result.tags).toHaveLength(MAX_KNOWLEDGE_TAGS);
    expect(result.overflow).toEqual(["one-more"]);
  });

  it("matches any selected tag case-insensitively", () => {
    expect(matchesAnyKnowledgeTag(["Urgent", "customer-a"], ["urgent"])).toBe(
      true,
    );
    expect(
      matchesAnyKnowledgeTag(
        ["Urgent", "customer-a"],
        ["roadmap", "CUSTOMER-A"],
      ),
    ).toBe(true);
    expect(matchesAnyKnowledgeTag(["Urgent"], ["roadmap", "review"])).toBe(
      false,
    );
    expect(matchesAnyKnowledgeTag(["Urgent"], [])).toBe(true);
  });
});
