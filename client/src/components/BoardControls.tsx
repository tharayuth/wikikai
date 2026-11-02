import { useEffect, useRef, useState } from "react";

export interface BoardMenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** Why it is disabled, shown under the label so touch screens see it too. */
  note?: string;
  danger?: boolean;
}

/** The `⋯` menu on a module or a custom column. */
export function BoardMenu({ label, items }: { label: string; items: BoardMenuItem[] }): JSX.Element {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="board-menu" ref={root}>
      <button
        type="button"
        className="board-menu-button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      {open && (
        <div className="board-menu-items" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={item.danger ? "danger" : undefined}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
              {item.note && <small>{item.note}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A small inline form for naming a module or column. `onSubmit` resolves true
 *  when the name was accepted; a refused name stays in the field to correct. */
export function NameForm({
  initial = "",
  label,
  placeholder,
  submitLabel = "Save",
  onSubmit,
  onCancel,
  children,
}: {
  initial?: string;
  label: string;
  placeholder?: string;
  submitLabel?: string;
  onSubmit: (name: string) => Promise<boolean>;
  onCancel: () => void;
  children?: React.ReactNode;
}): JSX.Element {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    const text = name.trim();
    if (!text || busy) return;
    setBusy(true);
    void onSubmit(text).finally(() => setBusy(false));
  };

  return (
    <form className="board-name-form" onSubmit={submit}>
      <input
        type="text"
        value={name}
        maxLength={50}
        aria-label={label}
        placeholder={placeholder}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
      />
      {children}
      <button type="submit" className="primary" disabled={busy || !name.trim()}>
        {submitLabel}
      </button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
