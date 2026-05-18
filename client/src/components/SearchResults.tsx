import type { SearchHit } from "../store/api";
import { buildUrl, navigateTo } from "../hooks/useHash";

interface Props {
  hits: SearchHit[];
  total: number;
  query: string;
  onPick: () => void;
}

export function SearchResults({ hits, total, query, onPick }: Props) {
  if (total === 0) {
    return (
      <div id="search-results" className="show">
        <div className="sr-empty">No content matches for "{query}"</div>
      </div>
    );
  }
  return (
    <div id="search-results" className="show">
      <div className="sr-title">{total} hits in content</div>
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
              <div className="sr-snippet">{h.snippet}</div>
              <div className="sr-meta">
                <span className="sr-line">L{h.line}</span>
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
