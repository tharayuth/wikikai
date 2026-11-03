import { useState } from "react";
import type { NoteSearchHit, SearchHit, TaskSearchHit } from "../store/api";
import { buildNoteLink, buildTaskLink, buildUrl, currentQueryString, navigateTo } from "../hooks/useHash";
import { splitHighlight } from "../lib/highlight";

interface Props {
  hits: SearchHit[];
  total: number;
  tasks: TaskSearchHit[];
  tasksTotal: number;
  notes: NoteSearchHit[];
  notesTotal: number;
  query: string;
  onPick: () => void;
}

/** Tasks and notes sit above the documents, so each stays short until asked for
 *  more. Otherwise a common word would push the documents out of sight. */
const ITEMS_SHOWN = 5;

/** Mark the parts of a snippet that earned the hit, so you are not re-scanning
 *  a wall of text for your own query. Splitting lives in `lib/highlight` where
 *  it can be tested without a DOM. */
function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  return (
    <>
      {splitHighlight(text, terms).map((part, i) =>
        part.hit ? (
          <mark key={i}>{part.text}</mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

/** "3" when everything is on screen, "20 of 340" when it is not: saying "20" when
 *  there are 340 hides the size of what you are looking at. */
function shownOf(shown: number, total: number): string {
  return shown < total ? `${shown} of ${total}` : `${total}`;
}

function ProjectItemHit({
  search,
  project,
  context,
  title,
  label,
  archived,
  snippet,
  terms,
  ratio,
  onPick,
}: {
  search: string;
  project: string;
  context?: string;
  title: string;
  label: string;
  archived: boolean;
  snippet: string;
  terms: string[];
  ratio: number;
  onPick: () => void;
}) {
  return (
    <li>
      <a
        className="sr-hit"
        href={buildUrl({ kid: null, query: search })}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          onPick();
          navigateTo({ kid: null }, { search });
        }}
      >
        <div className="sr-path">
          <span className="sr-project">{project}</span>
          {context && (
            <>
              <span className="sr-knowledge">{context}</span>
              <span className="sr-sep" aria-hidden>
                ›
              </span>
            </>
          )}
          <span className="sr-page">{title}</span>
        </div>
        {snippet && (
          <div className="sr-snippet">
            <Highlighted text={snippet} terms={terms} />
          </div>
        )}
        <div className="sr-meta">
          <span className="sr-line">{label}</span>
          {archived && <span className="sr-archived">archived</span>}
          {ratio < 1 && terms.length > 0 && (
            <span className="sr-partial" title={`matched only: ${terms.join(", ")}`}>
              partial
            </span>
          )}
        </div>
      </a>
    </li>
  );
}

function ItemGroup<T>({
  noun,
  items,
  total,
  renderItem,
}: {
  noun: string;
  items: T[];
  total: number;
  renderItem: (item: T) => JSX.Element;
}) {
  const [all, setAll] = useState(false);
  if (total === 0) return null;
  const shown = all ? items : items.slice(0, ITEMS_SHOWN);
  return (
    <>
      <div className="sr-title">
        {shownOf(shown.length, total)} {noun}
      </div>
      <ul className="sr-list">{shown.map(renderItem)}</ul>
      {items.length > ITEMS_SHOWN && (
        // A toggle rather than a button that disappears: the search box closes on
        // a click whose target has left the page.
        <button type="button" className="sr-more" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
    </>
  );
}

export function SearchResults({ hits, total, tasks, tasksTotal, notes, notesTotal, query, onPick }: Props) {
  if (total === 0 && tasksTotal === 0 && notesTotal === 0) {
    return (
      <div id="search-results" className="show">
        <div className="sr-empty">No matches for "{query}"</div>
      </div>
    );
  }
  return (
    <div id="search-results" className="show">
      <ItemGroup
        noun={tasksTotal === 1 ? "task" : "tasks"}
        items={tasks}
        total={tasksTotal}
        renderItem={(t) => (
          <ProjectItemHit
            key={t.id}
            search={buildTaskLink(currentQueryString(), t.project_id, t.id)}
            project={t.project}
            context={t.column}
            title={t.title}
            label={`T${t.id}`}
            archived={t.archived}
            snippet={t.snippet}
            terms={t.matched_terms}
            ratio={t.match_ratio}
            onPick={onPick}
          />
        )}
      />
      <ItemGroup
        noun={notesTotal === 1 ? "note" : "notes"}
        items={notes}
        total={notesTotal}
        renderItem={(n) => (
          <ProjectItemHit
            key={n.id}
            search={buildNoteLink(currentQueryString(), n.project_id, n.id)}
            project={n.project}
            title={n.title || "Untitled note"}
            label={`N${n.id}`}
            archived={n.archived}
            snippet={n.snippet}
            terms={n.matched_terms}
            ratio={n.match_ratio}
            onPick={onPick}
          />
        )}
      />
      {total > 0 && <div className="sr-title">{shownOf(hits.length, total)} hits in content</div>}
      <ul className="sr-list">
        {hits.map((h) => (
          <li key={`${h.knowledge_id}-${h.page_id}-${h.line}`}>
            <a
              className="sr-hit"
              href={buildUrl({
                kid: h.knowledge_id,
                pid: h.page_id,
                ...(h.block_id != null
                  ? { block: h.block_id }
                  : { line: h.line }),
              })}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                onPick();
                navigateTo({
                  kid: h.knowledge_id,
                  pid: h.page_id,
                  ...(h.block_id != null
                    ? { block: h.block_id }
                    : { line: h.line }),
                });
              }}
            >
              <div className="sr-path">
                {h.project && <span className="sr-project">{h.project}</span>}
                <span className="sr-knowledge">{h.knowledge_title}</span>
                <span className="sr-sep" aria-hidden>
                  ›
                </span>
                <span className="sr-page">{h.page_title}</span>
              </div>
              {h.heading && (
                <div className="sr-heading">
                  {"#".repeat(h.heading.level)} {h.heading.text}
                </div>
              )}
              <div className="sr-snippet">
                <Highlighted text={h.snippet} terms={h.matched_terms} />
              </div>
              <div className="sr-meta">
                <span className="sr-line">L{h.line}</span>
                {h.match_ratio < 1 && h.matched_terms.length > 0 && (
                  <span
                    className="sr-partial"
                    title={`matched only: ${h.matched_terms.join(", ")}`}
                  >
                    partial
                  </span>
                )}
                <span className="sr-ids">
                  &amp;{h.knowledge_id} · #{h.page_id}
                </span>
              </div>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
