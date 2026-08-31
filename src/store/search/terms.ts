import { DEFAULT_PARAMS, type SearchParams } from "./params.js";

/** Thai block. Anything in here is written without spaces between words. */
const THAI = /[฀-๿]/;
/** Splits a query into chunks. `\p{M}` matters as much as `\p{L}` here: Thai
 *  vowels and tone marks are combining marks, not letters, so leaving them out
 *  would chop every Thai word apart at its own vowels. Keeps `-`, `_`, `.` and
 *  `#`/`&`/`@` so `better-sqlite3`, `รง.8` and `&12` survive as single terms. */
const CHUNK_SPLIT = /[^\p{L}\p{M}\p{N}\-_.#&@]+/u;
/** Characters that belong to whichever run they land in rather than starting
 *  one of their own — digits and the joiners above. Without this, `รง.8`
 *  would split into a two-character Thai run and a stray digit. */
const NEUTRAL = /[\p{N}\-_.#&@]/u;

/**
 * Turn a raw query into the terms to look up.
 *
 * The index is character-trigram based, which is what makes Thai and CJK
 * searchable at all, but it also means a term is matched as a literal
 * substring. A Thai question arrives as a handful of very long tokens — Thai
 * puts no spaces between words — and demanding that a twelve-character phrase
 * appear verbatim is a demand almost no page can meet. Slicing long Thai runs
 * into overlapping windows gives the index fragments a real page can contain,
 * and the whole run is kept as well so a page that does contain the exact
 * phrase still gets that much stronger signal.
 *
 * Latin words are already whitespace-delimited, so they pass through as they
 * are; only their length is checked, since the index cannot match anything
 * shorter than a trigram.
 */
export function planTerms(
  query: string,
  overrides: Partial<SearchParams> = {},
): string[] {
  const p = { ...DEFAULT_PARAMS, ...overrides };
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (term: string): void => {
    const trimmed = term.replace(/^[-_.#&@]+|[-_.#&@]+$/g, "");
    if ([...trimmed].length < p.minTermLength) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(trimmed);
  };

  for (const chunk of query.trim().split(CHUNK_SPLIT)) {
    if (!chunk) continue;
    for (const run of splitByScript(chunk)) {
      const cp = [...run];
      if (!THAI.test(run) || cp.length <= p.thaiWholeMax) {
        push(run);
        continue;
      }
      // The whole run first: it is the rarest form of the phrase, so when a
      // page does contain it verbatim, it should carry the most weight.
      push(run);
      for (let i = 0; i + p.thaiWindow <= cp.length; i += p.thaiStride) {
        push(cp.slice(i, i + p.thaiWindow).join(""));
      }
    }
  }
  return out;
}

/** Split a chunk where the script changes, so `lockข้อมูล` becomes two terms
 *  and a Thai run is never windowed together with a Latin one. Digits and
 *  joiners are neutral: they stay with the run they are attached to, which is
 *  what keeps `รง.8` and `oie-qa2` whole. */
function splitByScript(chunk: string): string[] {
  const runs: string[] = [];
  let current = "";
  let currentIsThai: boolean | null = null;
  for (const ch of chunk) {
    if (NEUTRAL.test(ch)) {
      current += ch;
      continue;
    }
    const isThai = THAI.test(ch);
    if (currentIsThai === null || isThai === currentIsThai) {
      current += ch;
      currentIsThai = isThai;
      continue;
    }
    runs.push(current);
    current = ch;
    currentIsThai = isThai;
  }
  if (current) runs.push(current);
  return runs;
}
