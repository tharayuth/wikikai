/**
 * Tunables for the search planner, in one place because they are meant to be
 * tuned by measurement rather than argued about: change a number, run
 * `node --import tsx scripts/eval-search.ts --baseline test/fixtures/search-baseline.json`,
 * and keep the change only if the table improves.
 */
export interface SearchParams {
  /** The trigram tokenizer cannot match anything shorter than three
   *  codepoints, so shorter tokens are dropped rather than looked up. */
  minTermLength: number;
  /** Thai runs at most this long are used whole. */
  thaiWholeMax: number;
  /** Window size for slicing a longer Thai run. Five is wide enough to carry
   *  meaning (a short word or a solid fragment of a long one) and narrow
   *  enough that a real page can contain it. */
  thaiWindow: number;
  /** Step between windows. Two overlaps heavily, which is the point: Thai has
   *  no spaces, so the window boundaries never line up with word boundaries
   *  and overlapping is what keeps a real word intact in at least one slice. */
  thaiStride: number;
  /** Ceiling on how many terms reach the index. Each term costs one query, so
   *  this bounds the work a pathological query can ask for. */
  maxTerms: number;
  /** Terms appearing in more than this share of the corpus are dropped as
   *  noise. Measured against the live index rather than a fixed stopword
   *  list, so it works the same for Thai, English, and code identifiers, and
   *  it follows the corpus as it grows. */
  maxDfRatio: number;
  /** How hard to favour pages matching more of the query. Raising it makes
   *  breadth of match outweigh rarity of match. */
  coordExponent: number;
  /** bm25 column weights, in the column order of `pages_fts`. A hit in the
   *  title says more about what a page is about than a hit in its body. */
  fieldWeights: { content: number; title: number; keywords: number };
  /** Rows to consider per term. Only the best rows for a term can plausibly
   *  reach the top of the fused list, so this caps memory and time on a
   *  common term without changing the outcome in practice. */
  perTermCap: number;
  /** Target length of the snippet returned with each hit. Long enough for an
   *  agent to judge a hit without opening the page, short enough that twenty
   *  hits are still cheap to read. */
  snippetChars: number;
  /** Discard hits scoring below this fraction of the best hit.
   *
   *  Matching any term makes a page a candidate, so a broad query can put
   *  hundreds of pages in the list, nearly all of them matching one common
   *  fragment and nothing else. Returning them is not free: every result is
   *  text a caller reads before dismissing it, and for an agent that is the
   *  main cost of searching. Cutting relative to the best hit adapts to the
   *  query — a query with one strong answer trims hard, a query with many
   *  comparable answers keeps them. */
  minScoreRatio: number;
}

/**
 * Every value here was chosen by sweeping it against the 44-query fixture on
 * the real corpus, not by taste. Two cautions for whoever tunes them next:
 *
 * 44 queries is a small sample — a difference of one or two queries is noise,
 * so only move a value when the gain is worth several. And the corpus these
 * were fitted to is this one; a corpus that grows tenfold will want at least
 * `maxDfRatio` revisited, since what counts as a common term changes with it.
 */
export const DEFAULT_PARAMS: SearchParams = {
  minTermLength: 3,
  thaiWholeMax: 6,
  thaiWindow: 7,
  thaiStride: 3,
  maxTerms: 16,
  maxDfRatio: 0.2,
  coordExponent: 1,
  fieldWeights: { content: 1, title: 4, keywords: 2 },
  perTermCap: 400,
  snippetChars: 240,
  minScoreRatio: 0.35,
};
