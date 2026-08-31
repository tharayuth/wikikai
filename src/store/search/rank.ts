import type { SearchParams } from "./params.js";

export interface ScoredTerm {
  text: string;
  df: number;
  idf: number;
}

export interface TermHits {
  term: ScoredTerm;
  /** `score` is a positive "how well this page matched THIS term" value —
   *  bm25 negated, so bigger is better. */
  hits: Array<{ pageId: number; score: number }>;
}

export interface FusedHit {
  pageId: number;
  score: number;
  matched: string[];
  /** Share of the query's terms this page matched. Passed through to callers
   *  so an agent can see a weak hit for what it is without opening the page. */
  matchRatio: number;
}

/**
 * Inverse document frequency, in the bm25 form, clamped at zero.
 *
 * This is the number that decides which part of a question matters. In
 * "ทำไมถึงเลือก better-sqlite3 แทน ORM", `better-sqlite3` appears on three
 * pages and `แทน` on two hundred; without an explicit idf the four filler
 * fragments outvote the one term that names the subject.
 */
export function idf(df: number, corpusSize: number): number {
  if (df <= 0 || corpusSize <= 0) return 0;
  const value = Math.log(1 + (corpusSize - df + 0.5) / (df + 0.5));
  return value > 0 ? value : 0;
}

/**
 * Score the planned terms and keep the ones worth querying.
 *
 * Terms matching nothing are dropped — they cost a query and contribute
 * nothing. Terms matching more than `maxDfRatio` of the corpus are dropped as
 * noise: measuring frequency against the live index catches English stop
 * words, Thai function fragments, and whatever word this particular corpus
 * happens to repeat on every page, without anyone maintaining a list.
 *
 * If that would discard everything, the rarest terms are kept instead. A query
 * made entirely of common words should still return its best guess rather than
 * the empty result this change exists to eliminate.
 */
export function selectTerms(
  terms: string[],
  df: (term: string) => number,
  corpusSize: number,
  p: SearchParams,
): ScoredTerm[] {
  const scored: ScoredTerm[] = [];
  for (const text of terms) {
    const frequency = df(text);
    if (frequency <= 0) continue;
    scored.push({ text, df: frequency, idf: idf(frequency, corpusSize) });
  }
  scored.sort((a, b) => a.df - b.df);
  const informative = scored.filter((t) => t.df <= corpusSize * p.maxDfRatio);
  return (informative.length ? informative : scored).slice(0, p.maxTerms);
}

/**
 * Combine per-term result sets into one ranking.
 *
 * Each term's scores are normalised against the best score for that term
 * before being weighted by idf. Raw bm25 magnitudes are not comparable across
 * terms — a common term can produce far larger numbers than a rare one — so
 * without normalising, the loudest term wins regardless of how little it says
 * about the query. After normalising, a term contributes at most its idf, and
 * idf alone decides how much any part of the query is worth.
 *
 * The coordination factor then favours pages matching more of the query, which
 * is what keeps a broad OR from behaving like a broad OR.
 */
export function fuse(
  perTerm: TermHits[],
  totalTerms: number,
  p: SearchParams,
): FusedHit[] {
  const acc = new Map<number, { score: number; matched: string[] }>();
  for (const { term, hits } of perTerm) {
    if (!hits.length) continue;
    let best = 0;
    for (const h of hits) if (h.score > best) best = h.score;
    if (best <= 0) continue;
    for (const h of hits) {
      const contribution = term.idf * (h.score / best);
      const entry = acc.get(h.pageId);
      if (entry) {
        entry.score += contribution;
        entry.matched.push(term.text);
      } else {
        acc.set(h.pageId, { score: contribution, matched: [term.text] });
      }
    }
  }

  const denominator = totalTerms > 0 ? totalTerms : 1;
  const fused: FusedHit[] = [];
  for (const [pageId, { score, matched }] of acc) {
    const matchRatio = matched.length / denominator;
    fused.push({
      pageId,
      score: score * Math.pow(matchRatio, p.coordExponent),
      matched,
      matchRatio,
    });
  }
  fused.sort((a, b) => b.score - a.score || a.pageId - b.pageId);
  return fused;
}
