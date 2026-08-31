/**
 * Measure search quality against the live corpus.
 *
 * Ranking changes are easy to talk yourself into — a query you happen to try
 * looks better and the work feels done. This runs every query in
 * `test/fixtures/search-eval.json` against the real database and prints the
 * numbers that decide it, broken down by the KIND of query so a gain on short
 * keywords can't hide a loss on whole sentences.
 *
 *   node --import tsx scripts/eval-search.ts
 *   node --import tsx scripts/eval-search.ts --save baseline.json
 *   node --import tsx scripts/eval-search.ts --baseline baseline.json
 *
 * The metrics, and why each one is here:
 *
 *   0-hit   share of queries that return nothing at all. The agent's worst
 *           case: it learns nothing and pays for a retry.
 *   P@1     the first result is a correct document. What lets an agent stop
 *           reading after one hit.
 *   R@5     a correct document is somewhere in the top five.
 *   MRR     mean reciprocal rank of the first correct document — rewards
 *           moving the right answer UP, not merely including it.
 *   hits    median number of results returned. The wading cost: every extra
 *           result is text the agent reads before deciding.
 *
 * Knowledge-level metrics come first because several documents can legitimately
 * answer one question. Page-level metrics follow for the queries whose fixture
 * names specific pages — that is the number that matters for landing an agent
 * on the right lines instead of the right document.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/lib/config.js";
import { openDb } from "../src/store/db.js";
import { KnowledgeStore } from "../src/store/knowledge.js";
import { PageStore, type SearchHit } from "../src/store/pages.js";

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.resolve(here, "..", ".env"));
} catch {
  /* no .env is fine */
}

interface EvalQuery {
  q: string;
  kind: string;
  knowledge: number[];
  pages?: number[];
  note?: string;
}

interface Scores {
  n: number;
  zero: number;
  p1: number;
  r5: number;
  mrr: number;
  hitCounts: number[];
  pageN: number;
  pageP1: number;
  pageR5: number;
}

const LIMIT = intArg("--limit", 20);
const savePath = strArg("--save");
const baselinePath = strArg("--baseline");
const verbose = process.argv.includes("--verbose");

const fixturePath = path.resolve(here, "..", "test", "fixtures", "search-eval.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as {
  queries: EvalQuery[];
};

const cfg = loadConfig(process.env);
const db = openDb(cfg.dbPath);
const knowledge = new KnowledgeStore(db);
const pages = new PageStore(db, cfg.itemsDir);

// ─── Fixture sanity: a target that no longer exists would score as a miss and
// quietly drag every number down, so say so instead of counting it. ───
const liveKnowledge = new Set(knowledge.list({ limit: 5000 }).map((k) => k.id));
const livePages = new Set(
  (db.prepare(`SELECT id FROM pages`).all() as { id: number }[]).map((r) => r.id),
);
const stale: string[] = [];
for (const q of fixture.queries) {
  const kMissing = q.knowledge.filter((id) => !liveKnowledge.has(id));
  const pMissing = (q.pages ?? []).filter((id) => !livePages.has(id));
  if (kMissing.length || pMissing.length) {
    stale.push(
      `  "${q.q}" → missing ${[
        ...kMissing.map((id) => `&${id}`),
        ...pMissing.map((id) => `#${id}`),
      ].join(", ")}`,
    );
  }
}

// ─── Run ───
interface Row {
  query: EvalQuery;
  hits: SearchHit[];
  kRank: number | null; // 1-based rank of first correct knowledge, null = never
  pRank: number | null;
}

const rows: Row[] = fixture.queries.map((query) => {
  const hits = pages.search(query.q, { limit: LIMIT });
  const kTargets = new Set(query.knowledge);
  const pTargets = new Set(query.pages ?? []);
  const kIdx = hits.findIndex((h) => kTargets.has(h.knowledge_id));
  const pIdx = pTargets.size
    ? hits.findIndex((h) => pTargets.has(h.page_id))
    : -1;
  return {
    query,
    hits,
    kRank: kIdx === -1 ? null : kIdx + 1,
    pRank: pIdx === -1 ? null : pIdx + 1,
  };
});

// ─── Score ───
function score(subset: Row[]): Scores {
  const s: Scores = {
    n: subset.length,
    zero: 0,
    p1: 0,
    r5: 0,
    mrr: 0,
    hitCounts: [],
    pageN: 0,
    pageP1: 0,
    pageR5: 0,
  };
  for (const r of subset) {
    if (r.hits.length === 0) s.zero++;
    s.hitCounts.push(r.hits.length);
    if (r.kRank === 1) s.p1++;
    if (r.kRank !== null && r.kRank <= 5) s.r5++;
    if (r.kRank !== null) s.mrr += 1 / r.kRank;
    if (r.query.pages?.length) {
      s.pageN++;
      if (r.pRank === 1) s.pageP1++;
      if (r.pRank !== null && r.pRank <= 5) s.pageR5++;
    }
  }
  return s;
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : Math.round((a[mid - 1] + a[mid]) / 2);
};

const pct = (num: number, den: number) => (den ? num / den : 0);
const fmtPct = (v: number) => `${(v * 100).toFixed(0)}%`.padStart(5);
const fmtNum = (v: number) => v.toFixed(2).padStart(5);

function reportLine(label: string, s: Scores): string {
  return [
    label.padEnd(14),
    String(s.n).padStart(3),
    fmtPct(pct(s.zero, s.n)),
    fmtNum(pct(s.p1, s.n)),
    fmtNum(pct(s.r5, s.n)),
    fmtNum(s.n ? s.mrr / s.n : 0),
    String(median(s.hitCounts)).padStart(6),
  ].join("  ");
}

const kinds = [...new Set(fixture.queries.map((q) => q.kind))];
const overall = score(rows);

const corpus = db
  .prepare(
    `SELECT (SELECT count(*) FROM pages) AS pages,
            (SELECT count(*) FROM knowledge) AS docs`,
  )
  .get() as { pages: number; docs: number };

console.log(
  `\nWikiKai search eval · ${rows.length} queries · corpus ${corpus.pages} pages / ${corpus.docs} docs · limit ${LIMIT}\n`,
);
if (stale.length) {
  console.log(`⚠️  fixture targets that no longer exist (scored as misses):`);
  console.log(stale.join("\n") + "\n");
}

console.log(
  ["kind".padEnd(14), "  n", "0-hit", "  P@1", "  R@5", "  MRR", "median"].join("  "),
);
console.log("─".repeat(58));
for (const kind of kinds) {
  console.log(reportLine(kind, score(rows.filter((r) => r.query.kind === kind))));
}
console.log("─".repeat(58));
console.log(reportLine("overall", overall));

if (overall.pageN) {
  console.log(
    `\npage-level (${overall.pageN} queries name specific pages) · ` +
      `P@1 ${fmtNum(pct(overall.pageP1, overall.pageN)).trim()} · ` +
      `R@5 ${fmtNum(pct(overall.pageR5, overall.pageN)).trim()}`,
  );
}

// ─── Where it fails — the part that tells you what to fix next ───
const failures = rows.filter((r) => r.kRank === null || r.kRank > 5);
if (failures.length) {
  console.log(`\nmisses (${failures.length}):`);
  for (const r of failures) {
    const where =
      r.hits.length === 0
        ? "0 hits"
        : r.kRank === null
          ? `not in top ${LIMIT} of ${r.hits.length}`
          : `rank ${r.kRank} of ${r.hits.length}`;
    console.log(`  [${r.query.kind}] "${r.query.q}" — ${where}`);
    if (verbose && r.hits.length) {
      for (const h of r.hits.slice(0, 3)) {
        console.log(`      &${h.knowledge_id} #${h.page_id} ${h.page_title}`);
      }
    }
  }
}

// ─── Save / compare ───
const snapshot = {
  limit: LIMIT,
  corpus,
  overall: {
    n: overall.n,
    zero: pct(overall.zero, overall.n),
    p1: pct(overall.p1, overall.n),
    r5: pct(overall.r5, overall.n),
    mrr: overall.n ? overall.mrr / overall.n : 0,
    medianHits: median(overall.hitCounts),
    pageP1: pct(overall.pageP1, overall.pageN),
    pageR5: pct(overall.pageR5, overall.pageN),
  },
  byKind: Object.fromEntries(
    kinds.map((kind) => {
      const s = score(rows.filter((r) => r.query.kind === kind));
      return [
        kind,
        {
          n: s.n,
          zero: pct(s.zero, s.n),
          p1: pct(s.p1, s.n),
          r5: pct(s.r5, s.n),
          mrr: s.n ? s.mrr / s.n : 0,
          medianHits: median(s.hitCounts),
        },
      ];
    }),
  ),
};

if (savePath) {
  fs.writeFileSync(savePath, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(`\nsaved → ${savePath}`);
}

if (baselinePath) {
  const base = JSON.parse(fs.readFileSync(baselinePath, "utf8")) as typeof snapshot;
  console.log(`\nvs ${path.basename(baselinePath)}:`);
  const keys = ["zero", "p1", "r5", "mrr", "pageP1", "pageR5"] as const;
  for (const k of keys) {
    const before = base.overall[k] ?? 0;
    const after = snapshot.overall[k] ?? 0;
    const d = after - before;
    // 0-hit is the one metric where down is good.
    const good = k === "zero" ? d < 0 : d > 0;
    const mark = Math.abs(d) < 0.005 ? "  " : good ? "▲ " : "▼ ";
    console.log(
      `  ${mark}${k.padEnd(7)} ${before.toFixed(2)} → ${after.toFixed(2)}  (${d >= 0 ? "+" : ""}${d.toFixed(2)})`,
    );
  }
  const mb = base.overall.medianHits;
  const ma = snapshot.overall.medianHits;
  console.log(`    ${"hits".padEnd(7)} ${mb} → ${ma}`);
}

console.log();

function strArg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}
function intArg(flag: string, dflt: number): number {
  const v = strArg(flag);
  const n = v ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 ? n : dflt;
}
