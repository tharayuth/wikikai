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
  /**
   * Optional caller-supplied items (e.g. "Add page") rendered between the
   * copy actions and Edit/Delete. Each closes the menu before firing.
   */
  extraItems?: ActionMenuItem[];
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
 * Feather-style icon path markup keyed by a short name. Rendered as the
 * inner content of a 24×24 stroked `<svg>` — see {@link makeIcon}.
 */
const MENU_ICONS: Record<string, string> = {
  // overlapping rectangles — copy
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  // document with text lines — copy content
  "copy-content":
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/>',
  // document with a plus — add page
  "add-page":
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="12" x2="12" y2="18"/><line x1="9" y1="15" x2="15" y2="15"/>',
  // pencil — edit / rename
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>',
  // trash can — delete
  delete:
    '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
  // arrow into a tray — open
  open: '<path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
};

/** Build a stroked SVG icon element, or null when the name is unknown. */
function makeIcon(name: string | undefined): SVGSVGElement | null {
  if (!name || !MENU_ICONS[name]) return null;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "15");
  svg.setAttribute("height", "15");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("menu-ico");
  svg.innerHTML = MENU_ICONS[name]; // static markup — no untrusted input
  return svg;
}

/** Set a menu button's content to an optional icon followed by a label. */
function setMenuButtonContent(
  btn: HTMLButtonElement,
  icon: string | undefined,
  label: string,
): void {
  btn.textContent = "";
  const ico = makeIcon(icon);
  if (ico) btn.appendChild(ico);
  const span = document.createElement("span");
  span.textContent = label;
  btn.appendChild(span);
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

  const mkBtn = (
    action: string,
    label: string,
    icon?: string,
  ): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.action = action;
    setMenuButtonContent(b, icon, label);
    menu.appendChild(b);
    return b;
  };

  const copyBtn = mkBtn("copy", `Copy ${opts.copyText}`, "copy");
  const copyContentBtn = opts.contentUrl
    ? mkBtn("copy-content", "Copy content", "copy-content")
    : null;
  // Extra items (e.g. "Add page") sit between the copy actions and
  // Edit/Delete. Click handlers attached below, once `close` exists.
  const extraBtns = (opts.extraItems ?? []).map((item) => {
    const b = mkBtn("extra", item.label, item.icon);
    if (item.danger) b.classList.add("danger");
    return { b, item };
  });
  const editBtn = mkBtn("edit", opts.editLabel, "edit");
  const deleteBtn = mkBtn("delete", opts.deleteLabel, "delete");
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

  for (const { b, item } of extraBtns) {
    b.addEventListener("click", () => {
      close();
      void item.onSelect();
    });
  }

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

/** Best-effort message extraction from an RTK Query error. */
function rtkErrText(err: unknown): string {
  const e = err as { status?: number; data?: { error?: string } };
  return e?.data?.error ?? (e?.status != null ? String(e.status) : "error");
}

/**
 * Open the shared knowledge `&N` badge menu (Copy id / Copy content /
 * Edit name / Delete). Used by BOTH the topbar (`KnowledgeInfo`) and the
 * sidebar knowledge row so the two stay byte-for-byte identical — the
 * caller only supplies the id, title, RTK mutation triggers, a toast
 * sink, and an optional post-delete hook.
 */
export function openKnowledgeBadgeMenu(deps: {
  badge: HTMLElement;
  id: number;
  title: string;
  /** e.g. `(id, title) => updateKnowledge({ id, title }).unwrap()` */
  renameKnowledge: (id: number, title: string) => Promise<unknown>;
  /** e.g. `(id) => deleteKnowledge(id).unwrap()` */
  deleteKnowledge: (id: number) => Promise<unknown>;
  /** Show a toast — `kind` omitted for plain info (copy) toasts. */
  notify: (message: string, kind?: "success" | "error") => void;
  /** Fired after a successful delete (e.g. navigate away). */
  onDeleted?: () => void;
  /**
   * When provided, the menu gains an "Add page" item. Should create an
   * empty page and resolve with its new id — e.g.
   * `(id, title) => addPage({ knowledge_id: id, title, content: "" }).unwrap()`
   */
  addPage?: (id: number, title: string) => Promise<{ id: number }>;
  /** Fired with the new page id after a successful "Add page". */
  onPageAdded?: (pageId: number) => void;
}): void {
  const extraItems: ActionMenuItem[] = [];
  if (deps.addPage) {
    const addPage = deps.addPage;
    extraItems.push({
      label: "Add page",
      icon: "add-page",
      onSelect: () => {
        const title = window.prompt(`New page in "${deps.title}" — title?`, "");
        if (!title || !title.trim()) return;
        const t = title.trim();
        addPage(deps.id, t).then(
          (created) => {
            deps.notify(`Added page "${t}"`, "success");
            deps.onPageAdded?.(created.id);
          },
          (err) => deps.notify(`Add page failed: ${rtkErrText(err)}`, "error"),
        );
      },
    });
  }
  openBadgeMenu({
    extraItems,
    kind: "knowledge",
    id: deps.id,
    badge: deps.badge,
    copyText: `&${deps.id}`,
    contentUrl: `/api/knowledge/${deps.id}/content`,
    editLabel: "Edit knowledge name",
    onEdit: () => {
      const next = window.prompt("Knowledge name:", deps.title);
      if (next == null) return; // cancelled
      const trimmed = next.trim();
      if (!trimmed || trimmed === deps.title) return;
      deps.renameKnowledge(deps.id, trimmed).then(
        () => deps.notify(`Renamed to "${trimmed}"`, "success"),
        (err) => deps.notify(`Rename failed: ${rtkErrText(err)}`, "error"),
      );
    },
    deleteLabel: "Delete this knowledge",
    confirmDelete: () =>
      window.confirm(
        `⚠️ Delete knowledge "${deps.title}" (&${deps.id})?\n\nEvery page, revision, and any image used only by this knowledge will be removed permanently. This cannot be undone.`,
      ),
    onDelete: async () => {
      await deps.deleteKnowledge(deps.id);
    },
    onDeleteSuccess: () => {
      deps.notify(`Deleted "${deps.title}"`, "success");
      deps.onDeleted?.();
    },
    onDeleteError: (err) => deps.notify(`Delete failed: ${rtkErrText(err)}`, "error"),
    onCopied: (what) =>
      deps.notify(
        what === "id" ? `copied &${deps.id}` : `copied &${deps.id} content`,
      ),
    onCopyError: () => deps.notify("Copy failed", "error"),
  });
}

export interface ActionMenuItem {
  label: string;
  /** Optional leading icon — a key of the shared menu icon set. */
  icon?: string;
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
    setMenuButtonContent(b, item.icon, item.label);
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
