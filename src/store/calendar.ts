import type { Db } from "./db.js";

/**
 * Per-project month calendar: which knowledge / pages were created or
 * edited on each day.
 *
 * Built from `activity_log`, not `page_revisions` — revisions are pruned
 * to the latest few per page, so a chatty page has no history left for
 * earlier months, while the activity log is append-only. Pages created
 * before the log existed fall back to `pages.created_at`.
 *
 * Titles and project membership come from the live `pages` / `knowledge`
 * rows (a knowledge moved to another project moves its history with it);
 * deleted pages drop out because their links would be dead.
 */

export interface CalendarPage {
  id: number;
  title: string;
  position: number;
  /** Created on this day (as opposed to only edited). */
  created: boolean;
  /** Number of logged changes on this day, the creation included. */
  count: number;
  archived: boolean;
}

export interface CalendarKnowledge {
  id: number;
  title: string;
  pages: CalendarPage[];
}

export interface CalendarDay {
  /** Local date in the requested time zone, `YYYY-MM-DD`. */
  date: string;
  knowledge: CalendarKnowledge[];
}

export interface CalendarEvent {
  /** ISO timestamp (UTC). */
  at: string;
  created: boolean;
  page_id: number;
  page_title: string;
  position: number;
  archived: boolean;
  knowledge_id: number;
  knowledge_title: string;
}

/** Longest range one request may span — six calendar weeks. */
export const MAX_CALENDAR_DAYS = 42;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse a `YYYY-MM-DD` date into a UTC-midnight epoch, or throw. */
function parseDate(s: string, name: string): number {
  if (!DATE_RE.test(s)) throw new Error(`${name} must be YYYY-MM-DD`);
  const t = Date.parse(`${s}T00:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== s) {
    throw new Error(`${name} is not a valid date`);
  }
  return t;
}

/** Formatter that turns an instant into its local `YYYY-MM-DD` in `tz`.
 *  Throws a readable error for an unknown zone name. */
export function localDateFormatter(tz: string): (iso: string) => string {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    throw new Error(`unknown time zone '${tz}'`);
  }
  return (iso) => fmt.format(new Date(iso));
}

/**
 * Group events into days → knowledge → pages. Pure, so the time-zone
 * and collapsing rules can be tested without a database.
 *
 * Days are ascending; knowledge within a day is most-recently-touched
 * first; pages keep their tab order.
 */
export function bucketEvents(
  events: CalendarEvent[],
  opts: { from: string; to: string; tz: string },
): CalendarDay[] {
  const toLocal = localDateFormatter(opts.tz);
  const days = new Map<
    string,
    Map<number, { k: CalendarKnowledge; last: string; pages: Map<number, CalendarPage> }>
  >();
  for (const e of events) {
    const date = toLocal(e.at);
    if (date < opts.from || date > opts.to) continue;
    let day = days.get(date);
    if (!day) days.set(date, (day = new Map()));
    let k = day.get(e.knowledge_id);
    if (!k) {
      k = {
        k: { id: e.knowledge_id, title: e.knowledge_title, pages: [] },
        last: e.at,
        pages: new Map(),
      };
      day.set(e.knowledge_id, k);
    }
    if (e.at > k.last) k.last = e.at;
    let p = k.pages.get(e.page_id);
    if (!p) {
      p = {
        id: e.page_id,
        title: e.page_title,
        position: e.position,
        created: false,
        count: 0,
        archived: e.archived,
      };
      k.pages.set(e.page_id, p);
    }
    p.count += 1;
    if (e.created) p.created = true;
  }
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, day]) => ({
      date,
      knowledge: [...day.values()]
        .sort((a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : 0))
        .map(({ k, pages }) => ({
          ...k,
          pages: [...pages.values()].sort((a, b) => a.position - b.position),
        })),
    }));
}

/** Activity rows that changed a page's content. Everything else in the log
 *  (delete, reorder, secret reveal, uploads) is not a create/edit. */
const CONTENT_ACTIONS = `(
     (a.target = 'page'      AND a.action IN ('add', 'edit'))
  OR (a.target = 'knowledge' AND a.action = 'add')
  OR (a.target = 'block'     AND a.action IN ('edit', 'caption', 'resize'))
  OR (a.target = 'image'     AND a.action = 'resize')
  OR (a.target = 'task'      AND a.action = 'toggle')
)`;

export function projectCalendar(
  db: Db,
  opts: { project: string; from: string; to: string; tz: string },
): CalendarDay[] {
  const fromT = parseDate(opts.from, "from");
  const toT = parseDate(opts.to, "to");
  if (toT < fromT) throw new Error("to must not be before from");
  const span = (toT - fromT) / 86_400_000 + 1;
  if (span > MAX_CALENDAR_DAYS) {
    throw new Error(`range must be at most ${MAX_CALENDAR_DAYS} days`);
  }
  localDateFormatter(opts.tz); // validate before touching the db

  // Widen by a day each side: any zone's local day lies inside
  // [UTC day − 14h, UTC day + 1 day + 12h]. Exact filtering is in bucketEvents.
  const lo = new Date(fromT - 86_400_000).toISOString();
  const hi = new Date(toT + 2 * 86_400_000).toISOString();

  const rows = db
    .prepare(
      `SELECT a.created_at AS at,
              (a.action = 'add') AS created,
              p.id AS page_id, p.title AS page_title, p.position,
              (p.archived_at IS NOT NULL) AS archived,
              k.id AS knowledge_id, k.title AS knowledge_title
       FROM activity_log a
       JOIN pages p     ON p.id = a.page_id
       JOIN knowledge k ON k.id = p.knowledge_id
       WHERE k.project = @project
         AND a.created_at >= @lo AND a.created_at < @hi
         AND ${CONTENT_ACTIONS}
       UNION ALL
       SELECT p.created_at, 1,
              p.id, p.title, p.position,
              (p.archived_at IS NOT NULL),
              k.id, k.title
       FROM pages p
       JOIN knowledge k ON k.id = p.knowledge_id
       WHERE k.project = @project
         AND p.created_at >= @lo AND p.created_at < @hi
         AND NOT EXISTS (
           SELECT 1 FROM activity_log a
           WHERE a.page_id = p.id AND a.action = 'add'
             AND a.target IN ('page', 'knowledge')
         )`,
    )
    .all({ project: opts.project, lo, hi }) as Array<
    Omit<CalendarEvent, "created" | "archived"> & { created: number; archived: number }
  >;

  return bucketEvents(
    rows.map((r) => ({ ...r, created: r.created === 1, archived: r.archived === 1 })),
    opts,
  );
}
