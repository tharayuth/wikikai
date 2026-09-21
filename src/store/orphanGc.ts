import type { Db } from "./db.js";
import type { PageStore } from "./pages.js";
import type { ImageStore } from "./images.js";
import type { FileStore } from "./files.js";

/**
 * Deferred garbage collection for content-addressed assets (`images`, `files`).
 *
 * An asset is never deleted at the moment it loses its last reference. That
 * moment is routinely temporary: splitting a page drops the image from the
 * parent a minute before the sub-page that reuses it exists, an upload is
 * unreferenced until the page that embeds it is saved, and an edit can be
 * undone from a revision. Deleting inline turned each of those into permanent
 * data loss, because the bytes cannot be rebuilt from the markdown.
 *
 * Instead the row is stamped `orphaned_at`. The stamp is cleared as soon as a
 * live page references the asset again, and the bytes go only once the asset
 * has stayed unreferenced for the whole grace period AND no stored page
 * revision mentions it either.
 */
export type AssetTable = "images" | "files";

/** How long an unreferenced asset survives before a sweep may delete it. */
export const ORPHAN_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * After one page's edit: stamp every hash the edit dropped, unless some OTHER
 * live page still references it (checked through `pages_fts`, which the caller
 * has already synced). The stamp is overwritten on purpose — an asset that was
 * re-referenced and dropped again restarts its grace period from the latest
 * drop. Deletes nothing. Returns how many rows were stamped.
 */
export function markDroppedRefs(
  db: Db,
  table: AssetTable,
  droppedHashes: Set<string>,
  exceptPageId: number,
  now: Date = new Date(),
): number {
  if (droppedHashes.size === 0) return 0;
  const stillUsed = db.prepare(
    `SELECT 1 FROM pages_fts WHERE pages_fts MATCH ? AND rowid != ? LIMIT 1`,
  );
  const stamp = db.prepare(`UPDATE ${table} SET orphaned_at = ? WHERE hash = ?`);
  const iso = now.toISOString();
  let marked = 0;
  for (const hash of droppedHashes) {
    // Phrase-match the hash — the trigram tokenizer keeps this fast.
    if (stillUsed.get(`"${hash}"`, exceptPageId)) continue;
    marked += Number(stamp.run(iso, hash).changes ?? 0);
  }
  return marked;
}

interface SweepOptions {
  db: Db;
  table: AssetTable;
  /** Hashes referenced by live page content (lowercased). */
  liveRefs: Set<string>;
  /** Hashes referenced by stored revisions. Lazy: only a sweep that actually
   *  has something due pays for the revision scan. */
  revisionRefs: () => Set<string>;
  /** Delete bytes + row for one hash. */
  remove: (hash: string) => boolean;
  graceMs: number;
  now: Date;
}

/**
 * Reconcile `orphaned_at` with reality, then delete what is past its grace
 * period. Returns how many assets were actually deleted.
 */
export function sweepOrphans(opts: SweepOptions): number {
  const { db, table, liveRefs, graceMs, now } = opts;
  const rows = db.prepare(`SELECT hash, orphaned_at FROM ${table}`).all() as {
    hash: string;
    orphaned_at: string | null;
  }[];
  const clear = db.prepare(`UPDATE ${table} SET orphaned_at = NULL WHERE hash = ?`);
  const stamp = db.prepare(`UPDATE ${table} SET orphaned_at = ? WHERE hash = ?`);
  const nowIso = now.toISOString();
  const cutoff = now.getTime() - graceMs;
  const due: string[] = [];
  db.transaction(() => {
    for (const row of rows) {
      if (liveRefs.has(row.hash.toLowerCase())) {
        if (row.orphaned_at !== null) clear.run(row.hash);
        continue;
      }
      // First time a sweep sees it unreferenced (e.g. an upload that was
      // never embedded): the grace period starts now, not at upload time.
      if (row.orphaned_at === null) stamp.run(nowIso, row.hash);
      const since = Date.parse(row.orphaned_at ?? nowIso);
      if (Number.isNaN(since) || since <= cutoff) due.push(row.hash);
    }
  })();
  if (due.length === 0) return 0;
  const inRevisions = opts.revisionRefs();
  let removed = 0;
  for (const hash of due) {
    if (inRevisions.has(hash.toLowerCase())) continue;
    if (opts.remove(hash)) removed++;
  }
  return removed;
}

/** One sweep over both asset kinds. Run after delete_page / delete_knowledge
 *  and on the server's housekeeping timer. */
export function sweepOrphanedAssets(opts: {
  db: Db;
  pages: PageStore;
  images: ImageStore;
  files: FileStore | null;
  graceMs?: number;
  now?: Date;
}): { removed_images: number; removed_files: number } {
  const graceMs = opts.graceMs ?? ORPHAN_GRACE_MS;
  const now = opts.now ?? new Date();
  const { db, pages, images, files } = opts;
  const removed_images = sweepOrphans({
    db,
    table: "images",
    liveRefs: pages.allReferencedImageHashes(),
    revisionRefs: () => pages.allRevisionImageHashes(),
    remove: (hash) => images.remove(hash),
    graceMs,
    now,
  });
  const removed_files = files
    ? sweepOrphans({
        db,
        table: "files",
        liveRefs: pages.allReferencedFileHashes(),
        revisionRefs: () => pages.allRevisionFileHashes(),
        remove: (hash) => files.remove(hash),
        graceMs,
        now,
      })
    : 0;
  return { removed_images, removed_files };
}
