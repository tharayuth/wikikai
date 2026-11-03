import { DEFAULT_PARAMS, type SearchParams } from "./params.js";
import { fuse, selectTerms, type TermHits } from "./rank.js";
import { buildExcerpt } from "./snippet.js";
import { planTerms } from "./terms.js";

/** The best field a term appeared in sets its score. These sit closer together
 *  than the bm25 weights for pages because they are the score itself: a task
 *  that says the word only in its description is still a match, so it has to
 *  clear `minScoreRatio` beside one that says it in the title. */
const FIELD_SCORE = { title: 3, keywords: 2.5, body: 2 };

export interface SearchableRecord {
  id: number;
  title: string;
  /** The text a snippet quotes from. */
  body: string;
  keywords: string[];
}

export interface RecordHit {
  id: number;
  score: number;
  /** Rarest first. */
  matched: string[];
  matchRatio: number;
  snippet: string;
}

/**
 * Rank rows that have no full-text index, such as tasks and notes, the way
 * pages are ranked: the same terms, rarity weighting and cut-off, so a question
 * that works in one list works in all of them. A term is a literal substring,
 * which is what the trigram index means by a match too.
 *
 * It scans every row it is given. These lists are far smaller than the page
 * corpus, and an index would need keeping in step on every write.
 */
export function rankRecords(
  records: SearchableRecord[],
  query: string,
  overrides: Partial<SearchParams> = {},
): RecordHit[] {
  const p = { ...DEFAULT_PARAMS, ...overrides };
  const planned = planTerms(query, p);
  if (planned.length === 0 || records.length === 0) return [];

  const rows = records.map((r) => ({
    id: r.id,
    title: r.title.toLocaleLowerCase(),
    body: r.body.toLocaleLowerCase(),
    keywords: r.keywords.join("\n").toLocaleLowerCase(),
  }));
  const weightFor = (row: (typeof rows)[number], term: string): number => {
    const t = term.toLocaleLowerCase();
    if (row.title.includes(t)) return FIELD_SCORE.title;
    if (row.keywords.includes(t)) return FIELD_SCORE.keywords;
    return row.body.includes(t) ? FIELD_SCORE.body : 0;
  };

  const terms = selectTerms(
    planned,
    (term) => rows.filter((row) => weightFor(row, term) > 0).length,
    rows.length,
    p,
  );
  const perTerm: TermHits[] = terms.map((term) => ({
    term,
    hits: rows.flatMap((row) => {
      const score = weightFor(row, term.text);
      return score > 0 ? [{ pageId: row.id, score }] : [];
    }),
  }));

  const ranked = fuse(perTerm, terms.length, p);
  if (ranked.length === 0) return [];
  const floor = ranked[0].score * p.minScoreRatio;
  const bodies = new Map(records.map((r) => [r.id, r.body]));
  return ranked
    .filter((hit) => hit.score >= floor)
    .map((hit) => ({
      id: hit.pageId,
      score: hit.score,
      matched: hit.matched,
      matchRatio: hit.matchRatio,
      snippet: buildExcerpt(bodies.get(hit.pageId) ?? "", hit.matched, p).text,
    }));
}
