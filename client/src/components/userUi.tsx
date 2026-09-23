import { useState } from "react";

/**
 * Small building blocks shared by the account dialog and the admin user
 * manager, so both read as one surface: avatar initials, role badge,
 * segmented picker, password field with a show/hide toggle, and the
 * dialog close glyph.
 */

export function Avatar({
  name,
  size = "md",
}: {
  name: string;
  size?: "md" | "lg";
}): JSX.Element {
  const firsts = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => Array.from(w)[0] ?? "");
  // Two initials read well in Latin script; Thai leading vowels and
  // tone marks don't, so other scripts get the first letter only.
  const initials =
    (firsts.every((c) => /[A-Za-z0-9]/.test(c)) ? firsts.join("") : firsts[0] ?? "")
      .toUpperCase() || "?";
  // Stable hue per name so the list is scannable without being loud.
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) | 0;
  const tone = Math.abs(hash) % 6;
  return (
    <span className={`user-avatar user-avatar-${size} tone-${tone}`} aria-hidden="true">
      {initials}
    </span>
  );
}

export function RoleBadge({ admin }: { admin: boolean }): JSX.Element {
  return (
    <span className={`role-badge ${admin ? "admin" : "member"}`}>
      {admin ? "Admin" : "Member"}
    </span>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  size = "md",
  tone,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  /** Colour the selected option by its value (none / view / edit). */
  tone?: boolean;
}): JSX.Element {
  return (
    <div
      className={`segmented segmented-${size}${disabled ? " disabled" : ""}`}
      role="radiogroup"
      aria-label={label}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            className={`segmented-opt${on ? " on" : ""}${tone && on ? ` tone-${o.value}` : ""}`}
            onClick={() => {
              if (!on) onChange(o.value);
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function PasswordInput({
  value,
  onChange,
  required,
  placeholder,
  invalid,
}: {
  value: string;
  onChange: (next: string) => void;
  required?: boolean;
  placeholder?: string;
  invalid?: boolean;
}): JSX.Element {
  const [visible, setVisible] = useState(false);
  return (
    <div className={`password-input-wrap${invalid ? " password-input-wrap-invalid" : ""}`}>
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        autoComplete="new-password"
        aria-invalid={invalid || undefined}
      />
      <button
        type="button"
        className="password-toggle"
        aria-label={visible ? "Hide password" : "Show password"}
        title={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        onClick={() => setVisible((v) => !v)}
        tabIndex={-1}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}

export function CloseIcon(): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function EyeIcon(): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon="eye-open"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon(): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon="eye-off"
    >
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a19.77 19.77 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a19.86 19.86 0 0 1-3.17 4.19" />
      <path d="M14.12 14.12A3 3 0 1 1 9.88 9.88" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

/** Pulls the `{ error }` message out of an RTK Query failure, if any. */
export function apiErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("data" in error)) return null;
  const data = (error as { data?: unknown }).data;
  if (data && typeof data === "object" && "error" in data) {
    const msg = (data as { error?: unknown }).error;
    if (typeof msg === "string") return msg;
  }
  return null;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
