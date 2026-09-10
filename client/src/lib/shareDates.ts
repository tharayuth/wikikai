const DAY_MS = 86_400_000;

/** The date a share user added right now with `days` days would expire.
 *  Matches the server's arithmetic (whole days from the moment of adding). */
export function expiryFromDays(days: number, now = Date.now()): Date {
  return new Date(now + days * DAY_MS);
}

/** "17 ก.ย. 2569 12:45" — Thai locale, so the Buddhist year matches the
 *  rest of the UI copy. Empty string for a null expiry. */
export function formatExpiry(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Parse the "days" text box: whole number ≥ 1, or null for "never". */
export function parseDays(raw: string): number | null | "invalid" {
  const t = raw.trim();
  if (t === "") return null;
  if (!/^\d+$/.test(t)) return "invalid";
  const n = Number(t);
  return n >= 1 ? n : "invalid";
}
