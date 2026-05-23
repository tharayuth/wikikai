import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Db } from "./db.js";

/** Per-mime extension. We accept these as upload mime types and serve them
 *  back unchanged via /img/<hash>.<ext>. SVG kept text-mime even though
 *  served from disk. */
const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

const EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

export interface ImageMeta {
  hash: string;
  ext: string;
  mime: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  alt: string | null;
  created_at: string;
}

export interface ImageMetaWithSrc extends ImageMeta {
  /** Public URL path the renderer / fence sources use. */
  src: string;
}

export const IMAGE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB cap on upload

export function extForMime(mime: string): string | null {
  return MIME_TO_EXT[mime.toLowerCase()] ?? null;
}

export function mimeForExt(ext: string): string | null {
  return EXT_TO_MIME[ext.toLowerCase()] ?? null;
}

/** Parse a /img/<hash>.<ext> path into its hash + ext components. */
export function parseImageSrc(src: string): { hash: string; ext: string } | null {
  const m = /^\/img\/([a-f0-9]{64})\.([a-z0-9]{2,5})$/i.exec(src);
  if (!m) return null;
  return { hash: m[1].toLowerCase(), ext: m[2].toLowerCase() };
}

function srcOf(hash: string, ext: string): string {
  return `/img/${hash}.${ext}`;
}

export class ImageStore {
  constructor(private db: Db, private imagesDir: string) {
    fs.mkdirSync(imagesDir, { recursive: true });
  }

  /** Resolve the on-disk file path for a stored image. Returns null if the
   *  hash isn't known (no DB row). */
  filePath(hash: string, ext: string): string {
    const prefix = hash.slice(0, 2);
    return path.join(this.imagesDir, prefix, `${hash}.${ext}`);
  }

  /**
   * Store bytes content-addressed. If the same content already exists,
   * returns the existing row without writing anything new. Mime determines
   * the file extension.
   */
  add(bytes: Buffer, mime: string, alt?: string | null): ImageMetaWithSrc {
    const ext = extForMime(mime);
    if (!ext) {
      throw new Error(`unsupported mime type: ${mime}`);
    }
    if (bytes.length === 0) {
      throw new Error("image bytes are empty");
    }
    if (bytes.length > IMAGE_MAX_BYTES) {
      throw new Error(
        `image too large: ${bytes.length} bytes (max ${IMAGE_MAX_BYTES})`,
      );
    }
    const hash = crypto.createHash("sha256").update(bytes).digest("hex");
    const prefix = hash.slice(0, 2);
    const dir = path.join(this.imagesDir, prefix);
    fs.mkdirSync(dir, { recursive: true });
    const fp = path.join(dir, `${hash}.${ext}`);
    if (!fs.existsSync(fp)) {
      fs.writeFileSync(fp, bytes);
    }
    const existing = this.db
      .prepare(`SELECT * FROM images WHERE hash = ?`)
      .get(hash) as ImageMeta | undefined;
    if (existing) {
      // Update alt if the new upload supplied one and old row didn't.
      if (alt && !existing.alt) {
        this.db.prepare(`UPDATE images SET alt = ? WHERE hash = ?`).run(alt, hash);
        existing.alt = alt;
      }
      return { ...existing, src: srcOf(hash, ext) };
    }
    const created_at = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO images (hash, ext, mime, size_bytes, width, height, alt, created_at)
         VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)`,
      )
      .run(hash, ext, mime, bytes.length, alt ?? null, created_at);
    return {
      hash,
      ext,
      mime,
      size_bytes: bytes.length,
      width: null,
      height: null,
      alt: alt ?? null,
      created_at,
      src: srcOf(hash, ext),
    };
  }

  /** Look up an image by hash (returns null when not stored). */
  get(hash: string): ImageMetaWithSrc | null {
    const row = this.db
      .prepare(`SELECT * FROM images WHERE hash = ?`)
      .get(hash) as ImageMeta | undefined;
    if (!row) return null;
    return { ...row, src: srcOf(row.hash, row.ext) };
  }

  /** Look up an image by its public /img/<hash>.<ext> path. */
  getBySrc(src: string): ImageMetaWithSrc | null {
    const parsed = parseImageSrc(src);
    if (!parsed) return null;
    return this.get(parsed.hash);
  }

  /** Read raw bytes for serving. Throws if not on disk. */
  readBytes(hash: string, ext: string): Buffer {
    return fs.readFileSync(this.filePath(hash, ext));
  }

  /** All currently-stored image hashes (used by orphan cleanup). */
  listAllHashes(): { hash: string; ext: string }[] {
    return this.db
      .prepare(`SELECT hash, ext FROM images`)
      .all() as { hash: string; ext: string }[];
  }

  /** Remove a single image from disk + DB. Returns true if it was
   *  there and deleted, false if it wasn't in the registry. */
  remove(hash: string): boolean {
    const meta = this.get(hash);
    if (!meta) return false;
    const fp = this.filePath(meta.hash, meta.ext);
    try {
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch {
      /* file might already be gone — DB row is still removed below */
    }
    this.db.prepare(`DELETE FROM images WHERE hash = ?`).run(hash);
    return true;
  }
}

/** Extract every internal image hash (`/img/<hash>.<ext>`) referenced
 *  in `content`. Covers markdown `![alt](/img/...)`, inline `<img src="/img/...">`,
 *  and the same forms inside fenced blocks — anything matching the
 *  shape is counted. Returns a lowercased Set for cheap diffing. */
export function extractImageHashesSet(content: string): Set<string> {
  const out = new Set<string>();
  const re = /\/img\/([a-f0-9]{64})\.[a-z0-9]{2,5}/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) out.add(m[1].toLowerCase());
  return out;
}

/** Diff-based image GC: for each `removedHashes` entry, check via FTS5
 *  phrase match whether any OTHER page (excluding `exceptPageId`) still
 *  references it; if not, delete the image (file + row). Returns the
 *  count of images actually removed. Pre-condition: the caller's edit
 *  must have already been written to disk AND synced into `pages_fts`
 *  — otherwise the lookup would see stale content for `exceptPageId`
 *  (the `rowid != ?` exclusion still defends against that case but
 *  other pages must be up-to-date for the check to be correct).
 *  Revisions are intentionally NOT counted as live references — same
 *  policy as `cleanupOrphanImages` on delete_page. */
export function cleanupRemovedImageRefs(
  removedHashes: Set<string>,
  exceptPageId: number,
  db: Db,
  images: ImageStore,
): number {
  if (removedHashes.size === 0) return 0;
  const stmt = db.prepare(
    `SELECT 1 FROM pages_fts WHERE pages_fts MATCH ? AND rowid != ? LIMIT 1`,
  );
  let removed = 0;
  for (const hash of removedHashes) {
    // Phrase-match the hash — trigram tokenizer makes this fast even
    // on big content tables.
    const hit = stmt.get(`"${hash}"`, exceptPageId);
    if (hit) continue;
    if (images.remove(hash)) removed++;
  }
  return removed;
}
