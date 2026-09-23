import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  useGetProjectCalendarQuery,
  useListProjectsQuery,
  type CalendarDay,
} from "../store/api";
import {
  buildCalendarSearch,
  currentQueryString,
  navigateTo,
} from "../hooks/useHash";
import {
  filterDays,
  monthGrid,
  monthOf,
  shiftMonth,
  todayLocal,
} from "../lib/calendarGrid";

/**
 * Google-Calendar-style month view of one project: each day lists the
 * knowledge touched that day with its created (+) / edited (✎) pages.
 * Rendered in place of the viewer for `/?calendar=<projectId>&month=YYYY-MM`.
 */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Lines (knowledge headers + pages) a day cell shows before "+N more". */
const CELL_LINES = 5;
/** Knowledge accent colours, picked by id so a doc keeps its colour. */
const K_COLORS = ["blue", "green", "amber", "purple", "cyan", "red"];

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * A view toggle remembered in this browser. `showPages` (off by default)
 * lists pages in day cells — the day dialog always shows them; `created` /
 * `edited` (both on by default) pick which kind of change is shown anywhere.
 */
function useStoredFlag(name: string, initial: boolean): [boolean, () => void] {
  const key = `wikikai.calendar.${name}`;
  const [value, setValue] = useState(() => {
    try {
      const v = localStorage.getItem(key);
      return v == null ? initial : v === "1";
    } catch {
      return initial; // localStorage may be unavailable (private mode)
    }
  });
  const toggle = () => {
    setValue((v) => {
      try {
        localStorage.setItem(key, v ? "0" : "1");
      } catch {
        /* private mode — the toggle just won't be remembered */
      }
      return !v;
    });
  };
  return [value, toggle];
}

function kColor(kid: number): CSSProperties {
  return { "--k-color": `var(--${K_COLORS[kid % K_COLORS.length]})` } as CSSProperties;
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function longDateLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function goMonth(projectId: number, month: string | null): void {
  navigateTo(
    { kid: null },
    { search: buildCalendarSearch(currentQueryString(), projectId, month) },
  );
}

interface Props {
  projectId: number;
  /** `YYYY-MM`, or null for the current month. */
  month: string | null;
}

export function CalendarView({ projectId, month }: Props): JSX.Element {
  const today = todayLocal();
  const shown = month ?? monthOf(today);
  const grid = useMemo(() => monthGrid(shown), [shown]);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [showPages, toggleShowPages] = useStoredFlag("showPages", false);
  const [showCreated, toggleCreated] = useStoredFlag("created", true);
  const [showEdited, toggleEdited] = useStoredFlag("edited", true);

  const projects = useListProjectsQuery();
  const projectName =
    projects.data?.projects.find((p) => p.id === projectId)?.name ?? null;
  const { data, error, isFetching } = useGetProjectCalendarQuery({
    projectId,
    from: grid.from,
    to: grid.to,
    tz: TZ,
  });

  const days = useMemo(
    () => filterDays(data?.days ?? [], { created: showCreated, edited: showEdited }),
    [data, showCreated, showEdited],
  );

  const byDate = useMemo(() => {
    const m = new Map<string, CalendarDay>();
    for (const d of days) m.set(d.date, d);
    return m;
  }, [days]);

  // Month totals only count days inside the shown month, not the padding.
  const stats = useMemo(() => {
    let activeDays = 0;
    const pages = new Set<number>();
    const docs = new Set<number>();
    for (const d of days) {
      if (monthOf(d.date) !== shown) continue;
      activeDays++;
      for (const k of d.knowledge) {
        docs.add(k.id);
        for (const p of k.pages) pages.add(p.id);
      }
    }
    return { days: activeDays, pages: pages.size, docs: docs.size };
  }, [days, shown]);

  useEffect(() => setOpenDay(null), [shown, projectId]);

  const status = (error as { status?: number } | undefined)?.status;

  return (
    <section className="viewer calendar-view">
      <header className="cal-header">
        <div className="cal-title">
          <span className="cal-project">📅 {data?.project.name ?? projectName ?? `Project ${projectId}`}</span>
          <span className="cal-stats">
            {error
              ? ""
              : `${stats.docs} knowledge · ${stats.pages} pages · ${stats.days} active days`}
            {isFetching ? " · loading…" : ""}
          </span>
        </div>
        <div className="cal-nav">
          <div className="cal-filter" role="group" aria-label="Show changes">
            <button
              type="button"
              className={`cal-toggle cal-toggle-created${showCreated ? " on" : ""}`}
              aria-pressed={showCreated}
              onClick={toggleCreated}
              title={showCreated ? "Hide created pages" : "Show created pages"}
            >
              <span className="cal-p-mark created">+</span> Created
            </button>
            <button
              type="button"
              className={`cal-toggle cal-toggle-edited${showEdited ? " on" : ""}`}
              aria-pressed={showEdited}
              onClick={toggleEdited}
              title={showEdited ? "Hide edited pages" : "Show edited pages"}
            >
              <span className="cal-p-mark edited">✎</span> Edited
            </button>
          </div>
          <button
            type="button"
            className={`cal-toggle cal-toggle-pages${showPages ? " on" : ""}`}
            aria-pressed={showPages}
            onClick={toggleShowPages}
            title={showPages ? "Hide pages in day cells" : "Show pages in day cells"}
          >
            {showPages ? "Hide pages" : "Show pages"}
          </button>
          <button type="button" onClick={() => goMonth(projectId, null)} disabled={shown === monthOf(today)}>
            Today
          </button>
          <button type="button" aria-label="Previous month" onClick={() => goMonth(projectId, shiftMonth(shown, -1))}>
            ‹
          </button>
          <button type="button" aria-label="Next month" onClick={() => goMonth(projectId, shiftMonth(shown, 1))}>
            ›
          </button>
          <h2 className="cal-month">{monthLabel(shown)}</h2>
        </div>
      </header>

      {error ? (
        <div className="viewer-empty">
          <h2>
            {status === 403
              ? "No access to this project"
              : status === 404
                ? `Project ${projectId} not found`
                : "Could not load the calendar"}
          </h2>
        </div>
      ) : (
        <div className="cal-grid" style={{ gridTemplateRows: `auto repeat(${grid.weeks.length}, minmax(0, 1fr))` }}>
          {WEEKDAYS.map((w) => (
            <div key={w} className="cal-weekday">{w}</div>
          ))}
          {grid.weeks.flat().map((date) => (
            <DayCell
              key={date}
              date={date}
              day={byDate.get(date)}
              outside={monthOf(date) !== shown}
              today={date === today}
              showPages={showPages}
              onOpen={() => setOpenDay(date)}
            />
          ))}
        </div>
      )}

      {openDay && (
        <DayPanel date={openDay} day={byDate.get(openDay)} onClose={() => setOpenDay(null)} />
      )}
    </section>
  );
}

function DayCell({
  date,
  day,
  outside,
  today,
  showPages,
  onOpen,
}: {
  date: string;
  day: CalendarDay | undefined;
  outside: boolean;
  today: boolean;
  showPages: boolean;
  onOpen: () => void;
}): JSX.Element {
  const dayNum = Number(date.slice(8));
  const total = day?.knowledge.reduce((n, k) => n + k.pages.length, 0) ?? 0;

  // Fill the cell line by line; whatever doesn't fit becomes "+N more"
  // (pages when they are listed, knowledge when only knowledge is).
  const knowledge = day?.knowledge ?? [];
  let budget = CELL_LINES;
  let hidden: number;
  const groups: JSX.Element[] = [];
  if (showPages) {
    let shownPages = 0;
    for (const k of knowledge) {
      if (budget < 2) break; // a header alone is not worth a line
      budget--;
      const pages = k.pages.slice(0, budget);
      budget -= pages.length;
      shownPages += pages.length;
      groups.push(<KnowledgeGroup key={k.id} k={k} pages={pages} />);
    }
    hidden = total - shownPages;
  } else {
    for (const k of knowledge.slice(0, CELL_LINES)) {
      groups.push(<KnowledgeGroup key={k.id} k={k} pages={[]} compact />);
    }
    hidden = Math.max(0, knowledge.length - CELL_LINES);
  }

  const cls = ["cal-day"];
  if (outside) cls.push("outside");
  if (today) cls.push("today");
  if (total > 0) cls.push("has-items");

  return (
    <div className={cls.join(" ")} onClick={total > 0 ? onOpen : undefined}>
      <button
        type="button"
        className="cal-daynum"
        onClick={(e) => {
          e.stopPropagation();
          if (total > 0) onOpen();
        }}
        aria-label={`${longDateLabel(date)}${total ? `, ${total} pages` : ""}`}
      >
        {dayNum}
      </button>
      {total > 0 && <span className="cal-count">{total}</span>}
      <div className="cal-items">
        {groups}
        {hidden > 0 && (
          <button
            type="button"
            className="cal-more"
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
          >
            +{hidden} more
          </button>
        )}
      </div>
    </div>
  );
}

function KnowledgeGroup({
  k,
  pages,
  compact = false,
}: {
  k: CalendarDay["knowledge"][number];
  pages: CalendarDay["knowledge"][number]["pages"];
  /** Knowledge line only, with a count of the day's pages. */
  compact?: boolean;
}): JSX.Element {
  const created = k.pages.filter((p) => p.created).length;
  return (
    <div className="cal-k" style={kColor(k.id)}>
      <a
        className="cal-k-title"
        href={`/&${k.id}`}
        title={
          compact
            ? `${k.title} — ${k.pages.length} page${k.pages.length > 1 ? "s" : ""}` +
              (created ? `, ${created} created` : "")
            : k.title
        }
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          navigateTo({ kid: k.id });
        }}
      >
        <span className="cal-k-text">
          <span className="cal-k-id">&amp;{k.id}</span> {k.title}
        </span>
        {compact && (
          <span className={`cal-k-count${created ? " created" : ""}`}>
            {k.pages.length}
          </span>
        )}
      </a>
      {pages.map((p) => (
        <a
          key={p.id}
          className={`cal-p${p.archived ? " archived" : ""}`}
          href={`/&${k.id}/#${p.id}`}
          title={`${p.created ? "Created" : "Edited"}${p.count > 1 ? ` · ${p.count} changes` : ""} — ${p.title}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            navigateTo({ kid: k.id, pid: p.id });
          }}
        >
          <span className={`cal-p-mark ${p.created ? "created" : "edited"}`}>
            {p.created ? "+" : "✎"}
          </span>
          <span className="cal-p-title">{p.title}</span>
          {p.count > 1 && <span className="cal-p-count">×{p.count}</span>}
        </a>
      ))}
    </div>
  );
}

function DayPanel({
  date,
  day,
  onClose,
}: {
  date: string;
  day: CalendarDay | undefined;
  onClose: () => void;
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop show" onClick={onClose}>
      <div
        className="modal cal-panel"
        role="dialog"
        aria-modal="true"
        aria-label={longDateLabel(date)}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header cal-panel-header">
          <span>{longDateLabel(date)}</span>
          <button type="button" className="cal-panel-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="cal-panel-body">
          {(day?.knowledge ?? []).map((k) => (
            <KnowledgeGroup key={k.id} k={k} pages={k.pages} />
          ))}
          {!day && <p className="cal-empty">Nothing created or edited on this day.</p>}
        </div>
      </div>
    </div>
  );
}
