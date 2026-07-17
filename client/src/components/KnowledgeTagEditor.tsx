import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  MAX_KNOWLEDGE_TAGS,
  MAX_KNOWLEDGE_TAG_LENGTH,
  dedupeKnowledgeTags,
  mergeKnowledgeTagInput,
} from "../lib/knowledgeTags";

interface Props {
  tags: string[];
  suggestions: string[];
  disabled?: boolean;
  onSave: (tags: string[]) => Promise<void>;
}

export function KnowledgeTagEditor({
  tags,
  suggestions,
  disabled = false,
  onSave,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => dedupeKnowledgeTags(tags));
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionId = useId();

  useEffect(() => {
    if (!editing) setDraft(dedupeKnowledgeTags(tags));
  }, [tags, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const availableSuggestions = useMemo(() => {
    const selected = new Set(draft.map((tag) => tag.toLocaleLowerCase()));
    return suggestions
      .filter((tag) => !selected.has(tag.toLocaleLowerCase()))
      .slice(0, 100);
  }, [draft, suggestions]);

  const mergeInput = (raw: string): boolean => {
    const result = mergeKnowledgeTagInput(draft, raw);
    setDraft(result.tags);
    if (result.invalid.length > 0) {
      setError(`Each tag can contain at most ${MAX_KNOWLEDGE_TAG_LENGTH} characters.`);
      return false;
    }
    if (result.overflow.length > 0) {
      setError(`A knowledge can have at most ${MAX_KNOWLEDGE_TAGS} tags.`);
      return false;
    }
    setError(null);
    return true;
  };

  const addPendingInput = (): boolean => {
    if (!input.trim()) return true;
    const ok = mergeInput(input);
    if (ok) setInput("");
    return ok;
  };

  const cancel = () => {
    setDraft(dedupeKnowledgeTags(tags));
    setInput("");
    setError(null);
    setEditing(false);
  };

  const save = async () => {
    if (!addPendingInput()) return;
    const next = mergeKnowledgeTagInput(draft, input).tags;
    setSaving(true);
    setError(null);
    try {
      await onSave(next);
      setInput("");
      setEditing(false);
    } catch {
      setError("Could not save tags. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="knowledge-tags-view">
        {tags.length > 0 ? (
          <div className="knowledge-tag-list" aria-label="Knowledge tags">
            {tags.map((tag) => (
              <span className="knowledge-tag" key={tag.toLocaleLowerCase()}>
                {tag}
              </span>
            ))}
          </div>
        ) : (
          <span className="knowledge-tags-empty">No tags</span>
        )}
        <button
          type="button"
          className="knowledge-tags-edit"
          onClick={() => setEditing(true)}
          disabled={disabled}
        >
          {tags.length > 0 ? "Edit" : "+ Add tags"}
        </button>
      </div>
    );
  }

  return (
    <div
      className="knowledge-tags-editor"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          cancel();
        }
      }}
    >
      <div className="knowledge-tag-list editing" aria-label="Selected tags">
        {draft.map((tag) => (
          <span className="knowledge-tag" key={tag.toLocaleLowerCase()}>
            {tag}
            <button
              type="button"
              onClick={() =>
                setDraft((current) =>
                  current.filter(
                    (candidate) =>
                      candidate.toLocaleLowerCase() !== tag.toLocaleLowerCase(),
                  ),
                )
              }
              aria-label={`Remove tag ${tag}`}
              title={`Remove ${tag}`}
              disabled={saving}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="knowledge-tags-input-row">
        <input
          ref={inputRef}
          type="text"
          list={suggestionId}
          value={input}
          maxLength={MAX_KNOWLEDGE_TAG_LENGTH}
          placeholder="Type a tag, then Enter…"
          disabled={saving || draft.length >= MAX_KNOWLEDGE_TAGS}
          onChange={(event) => {
            const value = event.target.value;
            if (value.includes(",") || value.includes("\n")) {
              const result = mergeKnowledgeTagInput(draft, value);
              setDraft(result.tags);
              setInput("");
              if (result.overflow.length > 0) {
                setError(`A knowledge can have at most ${MAX_KNOWLEDGE_TAGS} tags.`);
              } else {
                setError(null);
              }
              return;
            }
            setInput(value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              addPendingInput();
            } else if (
              event.key === "Backspace" &&
              input === "" &&
              draft.length > 0
            ) {
              setDraft((current) => current.slice(0, -1));
            }
          }}
          onPaste={(event) => {
            const pasted = event.clipboardData.getData("text");
            if (!/[\n,]/.test(pasted)) return;
            event.preventDefault();
            const result = mergeKnowledgeTagInput(draft, pasted);
            setDraft(result.tags);
            if (result.invalid.length > 0) {
              setError(
                `Each tag can contain at most ${MAX_KNOWLEDGE_TAG_LENGTH} characters.`,
              );
            } else if (result.overflow.length > 0) {
              setError(`A knowledge can have at most ${MAX_KNOWLEDGE_TAGS} tags.`);
            } else {
              setError(null);
            }
          }}
        />
        <datalist id={suggestionId}>
          {availableSuggestions.map((tag) => (
            <option value={tag} key={tag.toLocaleLowerCase()} />
          ))}
        </datalist>
        <span className="knowledge-tags-count">
          {draft.length}/{MAX_KNOWLEDGE_TAGS}
        </span>
      </div>
      {error && <div className="knowledge-tags-error">{error}</div>}
      <div className="knowledge-tags-actions">
        <button type="button" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={cancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </div>
  );
}

