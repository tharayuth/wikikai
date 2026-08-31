import type { SearchHit } from "../store/api";
import { buildUrl, navigateTo } from "../hooks/useHash";
import { splitHighlight } from "../lib/highlight";

interface Props {
  hits: SearchHit[];
  total: number;
  query: string;
  onPick: () => void;
}

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

export function SearchResults({ hits, total, query, onPick }: Props) {
  if (total === 0) {
    return (
      <div id="search-results" className="show">
        <div className="sr-empty">No content matches for "{query}"</div>
      </div>
    );
  }
  // `total` counts every match; `hits` is the page of them we asked for. Saying
  // "20 hits" when there are 340 hides the size of what you are looking at.
  const shown = hits.length < total ? `${hits.length} of ${total}` : `${total}`;
  return (
    <div id="search-results" className="show">
      <div className="sr-title">{shown} hits in content</div>
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
