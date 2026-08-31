import type { Db } from "../db.js";

/**
 * Corpus statistics for the ranker: how big the index is, and how many pages
 * contain a given term.
 *
 * Both are read straight from `pages_fts` and cached, because the planner asks
 * for the same handful of terms over and over while someone types. The cache is
 * dropped wholesale whenever the index changes — page writes go through a
 * single method on `PageStore`, so there is exactly one place that has to
 * remember to invalidate, and a stale entry can only ever be one edit old.
 */
export class SearchStats {
  private readonly db: Db;
  private readonly dfCache = new Map<string, number>();
  private size: number | null = null;

  constructor(db: Db) {
    this.db = db;
  }

  /** Number of indexed pages. */
  corpusSize(): number {
    if (this.size === null) {
      const row = this.db
        .prepare(`SELECT count(*) AS c FROM pages_fts`)
        .get() as { c: number };
      this.size = row.c;
    }
    return this.size;
  }

  /** Pages containing `term` as a literal substring. Zero for a term the
   *  index rejects — a malformed FTS phrase throws rather than matching, and a
   *  term nobody wrote is indistinguishable from one nobody can search. */
  documentFrequency(term: string): number {
    const cached = this.dfCache.get(term);
    if (cached !== undefined) return cached;
    let count = 0;
    try {
      const row = this.db
        .prepare(`SELECT count(*) AS c FROM pages_fts WHERE pages_fts MATCH ?`)
        .get(quote(term)) as { c: number };
      count = row.c;
    } catch {
      count = 0;
    }
    this.dfCache.set(term, count);
    return count;
  }

  /** Called after any write that touches the index. */
  invalidate(): void {
    this.dfCache.clear();
    this.size = null;
  }
}

/** Wrap a term as an FTS5 phrase so its contents are matched literally and
 *  never parsed as query syntax. */
export function quote(term: string): string {
  return `"${term.replace(/"/g, '""')}"`;
}
