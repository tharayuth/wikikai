import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { createPortal } from "react-dom";

export interface SidebarTagFilterOption {
  tag: string;
  count: number;
}

interface Props {
  open: boolean;
  options: SidebarTagFilterOption[];
  selectedTags: string[];
  onToggle: (tag: string) => void;
  onClear: () => void;
  onClose: () => void;
}

const tagKey = (tag: string) => tag.toLocaleLowerCase();

export function SidebarTagFilterModal({
  open,
  options,
  selectedTags,
  onToggle,
  onClear,
  onClose,
}: Props): JSX.Element | null {
  const [query, setQuery] = useState("");
  const downOnBackdropRef = useRef(false);
  const selectedKeys = useMemo(
    () => new Set(selectedTags.map(tagKey)),
    [selectedTags],
  );
  const visibleOptions = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return options;
    return options.filter((option) =>
      option.tag.toLocaleLowerCase().includes(normalized),
    );
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const onBackdropMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    downOnBackdropRef.current = event.target === event.currentTarget;
  };
  const onBackdropMouseUp = (event: React.MouseEvent<HTMLDivElement>) => {
    if (downOnBackdropRef.current && event.target === event.currentTarget) {
      onClose();
    }
    downOnBackdropRef.current = false;
  };

  return createPortal(
    <div
      className="modal-backdrop show"
      onMouseDown={onBackdropMouseDown}
      onMouseUp={onBackdropMouseUp}
    >
      <div
        className="modal project-filter-modal tag-filter-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tag-filter-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h3 id="tag-filter-modal-title" className="tag-filter-modal-title">
            Filter by tags ({selectedTags.length} selected)
          </h3>
          <div className="tag-filter-modal-actions">
            <button
              type="button"
              className="pf-action"
              onClick={onClear}
              disabled={selectedTags.length === 0}
            >
              Clear
            </button>
            <button
              type="button"
              className="pf-close"
              onClick={onClose}
              title="Close (Esc)"
              aria-label="Close tag filter"
            >
              ×
            </button>
          </div>
        </div>

        <div className="tag-filter-search-row">
          <input
            type="search"
            className="pf-add-input"
            placeholder="Search tags…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
            aria-label="Search available tags"
          />
        </div>

        <p className="tag-filter-modal-hint">
          Topics matching any selected tag are shown.
        </p>

        <div className="pf-list tag-filter-list">
          {options.length === 0 ? (
            <div className="tag-filter-empty">No tags have been added yet</div>
          ) : visibleOptions.length === 0 ? (
            <div className="tag-filter-empty">
              No tags match “{query.trim()}”
            </div>
          ) : (
            visibleOptions.map((option) => (
              <div className="pf-item" key={tagKey(option.tag)}>
                <label className="pf-row">
                  <input
                    type="checkbox"
                    checked={selectedKeys.has(tagKey(option.tag))}
                    onChange={() => onToggle(option.tag)}
                  />
                  <span className="pf-name">{option.tag}</span>
                  <span className="pf-count">{option.count}</span>
                </label>
              </div>
            ))
          )}
        </div>

        <div className="tag-filter-modal-footer">
          <button type="button" className="primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
