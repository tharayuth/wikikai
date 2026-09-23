/**
 * Date math for the month calendar. Dates are plain `YYYY-MM-DD` /
 * `YYYY-MM` strings computed on UTC epochs, so no local DST shift can
 * skip or repeat a day.
 */

const DAY_MS = 86_400_000;

function iso(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

/** Today's date in the browser's own time zone. */
export function todayLocal(): string {
  return new Date().toLocaleDateString("en-CA");
}

/** `YYYY-MM` of the given local date. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** Month `delta` months away from `month`. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  return iso(Date.UTC(y, m - 1 + delta, 1)).slice(0, 7);
}

/**
 * Sunday-first weeks covering `month`: 4–6 rows of 7 dates, padded with
 * the tail of the previous month and the head of the next.
 */
export function monthGrid(month: string): { from: string; to: string; weeks: string[][] } {
  const [y, m] = month.split("-").map(Number);
  const first = Date.UTC(y, m - 1, 1);
  const lead = new Date(first).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const rows = Math.ceil((lead + daysInMonth) / 7);
  const start = first - lead * DAY_MS;
  const weeks: string[][] = [];
  for (let r = 0; r < rows; r++) {
    const week: string[] = [];
    for (let c = 0; c < 7; c++) week.push(iso(start + (r * 7 + c) * DAY_MS));
    weeks.push(week);
  }
  return { from: weeks[0][0], to: weeks[rows - 1][6], weeks };
}

/** Structural subset of the calendar API's day shape, so this module stays
 *  free of client store imports (it is also exercised by server tests). */
interface FilterableDay<P extends { created: boolean; count: number }> {
  date: string;
  knowledge: { id: number; title: string; pages: P[] }[];
}

/**
 * Keep only the created and/or edited side of each day. A page created and
 * then edited on the same day counts under both: with "created" alone it
 * shows as one creation, with "edited" alone as its edits (marked edited).
 * Knowledge and days left with no pages are dropped.
 */
export function filterDays<P extends { created: boolean; count: number }>(
  days: FilterableDay<P>[],
  show: { created: boolean; edited: boolean },
): FilterableDay<P>[] {
  if (show.created && show.edited) return days;
  const out: FilterableDay<P>[] = [];
  for (const d of days) {
    const knowledge = [];
    for (const k of d.knowledge) {
      const pages: P[] = [];
      for (const p of k.pages) {
        const edits = p.count - (p.created ? 1 : 0);
        const created = p.created && show.created;
        const count = (created ? 1 : 0) + (show.edited ? edits : 0);
        if (count > 0) pages.push({ ...p, created, count });
      }
      if (pages.length) knowledge.push({ ...k, pages });
    }
    if (knowledge.length) out.push({ ...d, knowledge });
  }
  return out;
}
