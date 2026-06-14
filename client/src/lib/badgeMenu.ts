/**
 * Shared popup menu for `&N` / `#N` / `@N` badges across the UI.
 *
 * The DOM lifecycle is identical to the original block-only menu that
 * used to live in `hooks/useMermaidCharts.ts`: anchor a small floating
 * `<div>` to the badge button, attach mousedown-outside + Escape close
 * handlers, and remove the node on close.
 *
 * Each badge kind composes the SAME four items (Copy id / Copy content
 * / Edit / Delete) — callers supply the contextual handlers + labels.
 */

export type BadgeKind = "knowledge" | "page" | "block";

export interface BadgeMenuOpts {
  kind: BadgeKind;
  /** Numeric id displayed in the badge. */
  id: number | string;
  /** Anchor element — menu floats just below this. */
  badge: HTMLElement;
  /** Pre-formatted id text (e.g. `&12`, `#34`, `@56`). */
  copyText: string;
  /**
   * GET URL returning `text/plain` for the "Copy content" item.
   * Empty string → omit the Copy content button.
   */
  contentUrl: string;
  /** Label for the Edit item — e.g. "Edit this knowledge". */
  editLabel: string;
  /** Fired when the user clicks Edit. The menu closes first. */
  onEdit: () => void;
  /** Label for the Delete item — e.g. "Delete this page". */
  deleteLabel: string;
  /**
   * Confirmation prompt shown before delete. Return false (or a falsy
   * promise) to skip the actual delete (e.g. user cancelled).
   */
  confirmDelete: () => boolean | Promise<boolean>;
  /**
   * Perform the actual delete. Throws on error — caller handles the
   * toast via onDeleteSuccess / onDeleteError below.
   */
  onDelete: () => Promise<void>;
  /** Called after a successful delete (toast + navigation). */
  onDeleteSuccess?: () => void;
  /** Called when delete throws — receives the error. */
  onDeleteError?: (err: unknown) => void;
  /** Toast for a successful copy (id or content). */
  onCopied?: (what: "id" | "content") => void;
  /** Toast for a failed copy. */
  onCopyError?: (err: unknown) => void;
}

/**
 * Hidden textarea + execCommand("copy") fallback for non-secure origins
 * (http://192.168.x.x) where navigator.clipboard isn't exposed.
 */
function copyFallback(text: string, onOk: () => void, onFail: () => void): void {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    if (ok) onOk();
    else onFail();
  } catch (err) {
    onFail();
    // eslint-disable-next-line no-console
    console.warn("copy fallback failed:", err);
  }
}

function writeClipboard(
  text: string,
  onOk: () => void,
  onFail: () => void,
): void {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(onOk, () =>
      copyFallback(text, onOk, onFail),
    );
  } else {
    copyFallback(text, onOk, onFail);
  }
}

/**
 * Build and attach the popup menu. Returns nothing — the menu manages
 * its own lifecycle (outside-click + Escape close).
 */
export function openBadgeMenu(opts: BadgeMenuOpts): void {
  document.querySelectorAll(".block-menu").forEach((m) => m.remove());

  const menu = document.createElement("div");
  menu.className = "block-menu";
  menu.dataset.badgeKind = opts.kind;

  const mkBtn = (action: string, label: string): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.action = action;
    b.textContent = label;
    menu.appendChild(b);
    return b;
  };

  const copyBtn = mkBtn("copy", `Copy ${opts.copyText}`);
  const copyContentBtn = opts.contentUrl ? mkBtn("copy-content", "Copy content") : null;
  const editBtn = mkBtn("edit", opts.editLabel);
  const deleteBtn = mkBtn("delete", opts.deleteLabel);
  deleteBtn.classList.add("danger");

  // Position the menu just below the badge.
  const rect = opts.badge.getBoundingClientRect();
  menu.style.position = "fixed";
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.left = `${rect.left}px`;
  document.body.appendChild(menu);

  const close = (): void => {
    menu.remove();
    document.removeEventListener("mousedown", onOutside);
    document.removeEventListener("keydown", onEsc);
  };
  const onOutside = (e: MouseEvent): void => {
    if (!menu.contains(e.target as Node)) close();
  };
  const onEsc = (e: KeyboardEvent): void => {
    if (e.key === "Escape") close();
  };

  const flashCopied = (): void => {
    opts.badge.classList.add("copied");
    setTimeout(() => opts.badge.classList.remove("copied"), 600);
  };

  copyBtn.addEventListener("click", () => {
    writeClipboard(
      opts.copyText,
      () => {
        flashCopied();
        opts.onCopied?.("id");
      },
      () => opts.onCopyError?.(new Error("copy failed")),
    );
    close();
  });

  if (copyContentBtn) {
    copyContentBtn.addEventListener("click", () => {
      fetch(opts.contentUrl, { credentials: "same-origin" })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.text();
        })
        .then((text) =>
          writeClipboard(
            text,
            () => {
              flashCopied();
              opts.onCopied?.("content");
            },
            () => opts.onCopyError?.(new Error("copy failed")),
          ),
        )
        .catch((err) => {
          opts.onCopyError?.(err);
          // eslint-disable-next-line no-console
          console.warn("Copy content failed:", err);
        });
      close();
    });
  }

  editBtn.addEventListener("click", () => {
    opts.onEdit();
    close();
  });

  deleteBtn.addEventListener("click", async () => {
    close();
    try {
      const ok = await opts.confirmDelete();
      if (!ok) return;
      await opts.onDelete();
      opts.onDeleteSuccess?.();
    } catch (err) {
      opts.onDeleteError?.(err);
    }
  });

  // Defer so the click that opened the menu doesn't immediately bubble
  // to the new outside-click listener and close it.
  setTimeout(() => {
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onEsc);
  }, 0);
}

export interface ActionMenuItem {
  label: string;
  /** Renders in the danger (red) style — for destructive actions. */
  danger?: boolean;
  /** Fired on click. The menu closes first. */
  onSelect: () => void | Promise<void>;
}

/**
 * A lightweight `.block-menu` popup with caller-supplied items — for badges
 * whose actions don't fit the fixed Copy/Edit/Delete shape (e.g. the
 * project-id badge: "Open only this project" / "Edit project name").
 * Shares the look + outside-click/Escape lifecycle with {@link openBadgeMenu}.
 */
export function openActionMenu(opts: {
  kind: string;
  badge: HTMLElement;
  items: ActionMenuItem[];
}): void {
  document.querySelectorAll(".block-menu").forEach((m) => m.remove());

  const menu = document.createElement("div");
  menu.className = "block-menu";
  menu.dataset.badgeKind = opts.kind;

  const rect = opts.badge.getBoundingClientRect();
  menu.style.position = "fixed";
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.left = `${rect.left}px`;

  const close = (): void => {
    menu.remove();
    document.removeEventListener("mousedown", onOutside);
    document.removeEventListener("keydown", onEsc);
  };
  const onOutside = (e: MouseEvent): void => {
    if (!menu.contains(e.target as Node)) close();
  };
  const onEsc = (e: KeyboardEvent): void => {
    if (e.key === "Escape") close();
  };

  for (const item of opts.items) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = item.label;
    if (item.danger) b.classList.add("danger");
    b.addEventListener("click", () => {
      close();
      void item.onSelect();
    });
    menu.appendChild(b);
  }

  document.body.appendChild(menu);
  setTimeout(() => {
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onEsc);
  }, 0);
}
