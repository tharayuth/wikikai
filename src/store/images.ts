import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
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

/** Detect image mime from the leading magic bytes. Returns null for
 *  formats without a reliable binary signature (e.g. SVG, which is text)
 *  — callers fall back to the file extension / explicit mime. Used by the
 *  local-path import branch of `add_image` so a misnamed file is stored
 *  under its true type. */
export function sniffImageMime(buf: Buffer): string | null {
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return "image/png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.toString("ascii", 0, 6))) {
    return "image/gif";
  }
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * Pixel dimensions read straight from the file header — PNG, JPEG, GIF and
 * WebP. Sync and dependency-free so `ImageStore.add` can stay synchronous.
 * Returns null for SVG or anything it cannot parse. JPEG EXIF orientation
 * is ignored: screenshots never carry it.
 */
export function readImageSize(buf: Buffer): { width: number; height: number } | null {
  try {
    const mime = sniffImageMime(buf);
    if (mime === "image/png" && buf.length >= 24) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (mime === "image/gif" && buf.length >= 10) {
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    }
    if (mime === "image/jpeg") {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) {
          i++;
          continue;
        }
        const marker = buf[i + 1];
        // SOF0..SOF15 carry the frame size; C4/C8/CC are other tables.
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
        }
        i += 2 + buf.readUInt16BE(i + 2);
      }
      return null;
    }
    if (mime === "image/webp" && buf.length >= 30) {
      const chunk = buf.toString("ascii", 12, 16);
      if (chunk === "VP8X") {
        return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      }
      if (chunk === "VP8L") {
        const b = buf.readUInt32LE(21);
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
      }
      if (chunk === "VP8 ") {
        return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      }
    }
  } catch {
    /* truncated header — treat as unknown */
  }
  return null;
}

/** Raster types that can be downscaled. SVG is vector and GIF may be
 *  animated, so both are always served as stored. */
const SCALABLE = new Set(["png", "jpg", "webp"]);

export interface ImageVariant {
  bytes: Buffer;
  mime: string;
  width: number | null;
  height: number | null;
  /** True when these are not the stored original's bytes. */
  resized: boolean;
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

/** Explicit column list — keeps the GC bookkeeping column (`orphaned_at`)
 *  out of every API response that spreads an image row. */
const IMAGE_COLS = "hash, ext, mime, size_bytes, width, height, alt, created_at";

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
      .prepare(`SELECT ${IMAGE_COLS} FROM images WHERE hash = ?`)
      .get(hash) as ImageMeta | undefined;
    if (existing) {
      // A re-upload is fresh intent to use the image: take it off the
      // orphan list so it gets a full grace period again.
      this.db.prepare(`UPDATE images SET orphaned_at = NULL WHERE hash = ?`).run(hash);
      if (existing.width == null) this.fillSize(existing);
      // Update alt if the new upload supplied one and old row didn't.
      if (alt && !existing.alt) {
        this.db.prepare(`UPDATE images SET alt = ? WHERE hash = ?`).run(alt, hash);
        existing.alt = alt;
      }
      return { ...existing, src: srcOf(hash, ext) };
    }
    const created_at = new Date().toISOString();
    const size = readImageSize(bytes);
    this.db
      .prepare(
        `INSERT INTO images (hash, ext, mime, size_bytes, width, height, alt, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(hash, ext, mime, bytes.length, size?.width ?? null, size?.height ?? null, alt ?? null, created_at);
    return {
      hash,
      ext,
      mime,
      size_bytes: bytes.length,
      width: size?.width ?? null,
      height: size?.height ?? null,
      alt: alt ?? null,
      created_at,
      src: srcOf(hash, ext),
    };
  }

  /** Look up an image by hash (returns null when not stored). Rows stored
   *  before dimensions were recorded get them filled in on first read. */
  get(hash: string): ImageMetaWithSrc | null {
    const row = this.db
      .prepare(`SELECT ${IMAGE_COLS} FROM images WHERE hash = ?`)
      .get(hash) as ImageMeta | undefined;
    if (!row) return null;
    if (row.width == null) this.fillSize(row);
    return { ...row, src: srcOf(row.hash, row.ext) };
  }

  /** Backfill width/height from the file header, in place on `row`. */
  private fillSize(row: ImageMeta): void {
    if (!SCALABLE.has(row.ext) && row.ext !== "gif") return;
    let size: { width: number; height: number } | null = null;
    try {
      size = readImageSize(this.readBytes(row.hash, row.ext));
    } catch {
      return; // file missing — leave the row alone
    }
    if (!size) return;
    this.db
      .prepare(`UPDATE images SET width = ?, height = ? WHERE hash = ?`)
      .run(size.width, size.height, row.hash);
    row.width = size.width;
    row.height = size.height;
  }

  private variantPath(hash: string, maxEdge: number): string {
    return path.join(this.imagesDir, "variants", hash.slice(0, 2), `${hash}-${maxEdge}.webp`);
  }

  /**
   * The image scaled down so its long edge is at most `maxEdge`, as WebP.
   * Never enlarges; SVG, GIF and images already within the limit come back
   * as the original bytes. Scaled copies are cached on disk next to the
   * originals and removed with them.
   */
  async variant(meta: ImageMeta, maxEdge: number): Promise<ImageVariant> {
    const original = (): ImageVariant => ({
      bytes: this.readBytes(meta.hash, meta.ext),
      mime: meta.mime,
      width: meta.width,
      height: meta.height,
      resized: false,
    });
    const longEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
    if (!SCALABLE.has(meta.ext) || longEdge === 0 || longEdge <= maxEdge) {
      return original();
    }
    const scale = maxEdge / longEdge;
    const width = Math.max(1, Math.round((meta.width ?? 0) * scale));
    const height = Math.max(1, Math.round((meta.height ?? 0) * scale));
    const fp = this.variantPath(meta.hash, maxEdge);
    if (fs.existsSync(fp)) {
      return { bytes: fs.readFileSync(fp), mime: "image/webp", width, height, resized: true };
    }
    const out = await sharp(this.filePath(meta.hash, meta.ext))
      .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 90 })
      .toBuffer({ resolveWithObject: true });
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    // Write-then-rename so a concurrent reader never sees a half file.
    const tmp = `${fp}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, out.data);
    fs.renameSync(tmp, fp);
    return {
      bytes: out.data,
      mime: "image/webp",
      width: out.info.width,
      height: out.info.height,
      resized: true,
    };
  }

  /** Delete every cached scaled copy of `hash`. */
  private removeVariants(hash: string): void {
    const dir = path.join(this.imagesDir, "variants", hash.slice(0, 2));
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const n of names) {
      if (!n.startsWith(`${hash}-`)) continue;
      try {
        fs.unlinkSync(path.join(dir, n));
      } catch {
        /* already gone */
      }
    }
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
    this.removeVariants(hash);
    this.db.prepare(`DELETE FROM images WHERE hash = ?`).run(hash);
    return true;
  }
}

/** Extract every internal image hash (`/img/<hash>.<ext>`) referenced
 *  in `content`. Covers markdown `![alt](/img/...)`, inline `<img src="/img/...">`,
 *  and the same forms inside fenced blocks — anything matching the
 *  shape is counted. Returns a lowercased Set for cheap diffing. The diff
 *  feeds `markDroppedRefs` in orphanGc.ts — nothing is deleted on an edit. */
export function extractImageHashesSet(content: string): Set<string> {
  const out = new Set<string>();
  const re = /\/img\/([a-f0-9]{64})\.[a-z0-9]{2,5}/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) out.add(m[1].toLowerCase());
  return out;
}
