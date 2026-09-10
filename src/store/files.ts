import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Db } from "./db.js";

/**
 * Attachments: arbitrary files an agent attaches to a page via `add_file`,
 * rendered as a ```file block with a download button.
 *
 * Storage mirrors images — content-addressed under
 * `data/files/<2-prefix>/<sha256>.<ext>`, so the on-disk name is opaque,
 * identical uploads dedupe, and the URL (`/file/<hash>.<ext>`) is stable.
 * The ORIGINAL filename lives in the `files` row and is restored in the
 * download's Content-Disposition, so what the reader saves is what was
 * uploaded. Cleanup is reference-counted by page content, same as images.
 */
export interface FileMeta {
  hash: string;
  ext: string;
  mime: string;
  /** Original filename as uploaded (what the download is saved as). */
  name: string;
  size_bytes: number;
  created_at: string;
}

export interface FileMetaWithSrc extends FileMeta {
  /** Public download path, `/file/<hash>.<ext>`. */
  src: string;
}

export const FILE_MAX_BYTES = 50 * 1024 * 1024; // 50 MB

/** A few common types so the block can show something friendlier than
 *  "octet-stream" when the caller did not pass a mime. Anything else is
 *  served as a generic binary download. */
const EXT_TO_MIME: Record<string, string> = {
  pdf: "application/pdf",
  csv: "text/csv",
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  xml: "application/xml",
  zip: "application/zip",
  gz: "application/gzip",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
};

export function mimeForFileExt(ext: string): string {
  return EXT_TO_MIME[ext.toLowerCase()] ?? "application/octet-stream";
}

/** Extension taken from the original filename: 1–10 alphanumerics, else
 *  `bin`. Only ever used to build the opaque on-disk / URL name. */
export function extForFileName(name: string): string {
  const m = /\.([a-z0-9]{1,10})$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : "bin";
}

/** Strip path separators and control characters so a name like
 *  `../../etc/passwd` becomes a plain basename. Keeps Unicode. */
export function sanitizeFileName(name: string): string {
  const base = name.replace(/[\\/]+/g, "/").split("/").pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\x00-\x1f\x7f"]/g, "").trim();
  return cleaned || "file";
}

/** Parse a /file/<hash>.<ext> path into its components. */
export function parseFileSrc(src: string): { hash: string; ext: string } | null {
  const m = /^\/file\/([a-f0-9]{64})\.([a-z0-9]{1,10})$/i.exec(src);
  if (!m) return null;
  return { hash: m[1].toLowerCase(), ext: m[2].toLowerCase() };
}

function srcOf(hash: string, ext: string): string {
  return `/file/${hash}.${ext}`;
}

export class FileStore {
  constructor(private db: Db, private filesDir: string) {
    fs.mkdirSync(filesDir, { recursive: true });
  }

  filePath(hash: string, ext: string): string {
    return path.join(this.filesDir, hash.slice(0, 2), `${hash}.${ext}`);
  }

  /** Store bytes content-addressed. Re-uploading identical content returns
   *  the existing row (the first uploaded name wins — the block's own
   *  `name` field still lets a page label it differently). */
  add(bytes: Buffer, name: string, mime?: string | null): FileMetaWithSrc {
    const cleanName = sanitizeFileName(name);
    if (bytes.length === 0) throw new Error("file bytes are empty");
    if (bytes.length > FILE_MAX_BYTES) {
      throw new Error(`file too large: ${bytes.length} bytes (max ${FILE_MAX_BYTES})`);
    }
    const ext = extForFileName(cleanName);
    const resolvedMime = (mime && mime.trim()) || mimeForFileExt(ext);
    const hash = crypto.createHash("sha256").update(bytes).digest("hex");
    const fp = this.filePath(hash, ext);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    if (!fs.existsSync(fp)) fs.writeFileSync(fp, bytes);
    const existing = this.db
      .prepare(`SELECT * FROM files WHERE hash = ?`)
      .get(hash) as FileMeta | undefined;
    if (existing) return { ...existing, src: srcOf(existing.hash, existing.ext) };
    const created_at = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO files (hash, ext, mime, name, size_bytes, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(hash, ext, resolvedMime, cleanName, bytes.length, created_at);
    return {
      hash,
      ext,
      mime: resolvedMime,
      name: cleanName,
      size_bytes: bytes.length,
      created_at,
      src: srcOf(hash, ext),
    };
  }

  get(hash: string): FileMetaWithSrc | null {
    const row = this.db
      .prepare(`SELECT * FROM files WHERE hash = ?`)
      .get(hash) as FileMeta | undefined;
    return row ? { ...row, src: srcOf(row.hash, row.ext) } : null;
  }

  getBySrc(src: string): FileMetaWithSrc | null {
    const parsed = parseFileSrc(src);
    return parsed ? this.get(parsed.hash) : null;
  }

  listAllHashes(): { hash: string; ext: string }[] {
    return this.db.prepare(`SELECT hash, ext FROM files`).all() as {
      hash: string;
      ext: string;
    }[];
  }

  /** Delete file + row. False when the hash was not registered. */
  remove(hash: string): boolean {
    const meta = this.get(hash);
    if (!meta) return false;
    const fp = this.filePath(meta.hash, meta.ext);
    try {
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch {
      /* the row still goes; a stray file is harmless */
    }
    this.db.prepare(`DELETE FROM files WHERE hash = ?`).run(hash);
    return true;
  }
}

/** Every `/file/<hash>.<ext>` reference in `content`, lowercased. */
export function extractFileHashesSet(content: string): Set<string> {
  const out = new Set<string>();
  const re = /\/file\/([a-f0-9]{64})\.[a-z0-9]{1,10}/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) out.add(m[1].toLowerCase());
  return out;
}

/** Diff-based cleanup after one page's edit: for each hash the edit
 *  dropped, delete the file unless some OTHER page still references it
 *  (checked through pages_fts, which the caller has already synced).
 *  Returns how many files were actually deleted. */
export function cleanupRemovedFileRefs(
  removedHashes: Set<string>,
  exceptPageId: number,
  db: Db,
  files: FileStore,
): number {
  if (removedHashes.size === 0) return 0;
  const stmt = db.prepare(
    `SELECT 1 FROM pages_fts WHERE pages_fts MATCH ? AND rowid != ? LIMIT 1`,
  );
  let removed = 0;
  for (const hash of removedHashes) {
    if (stmt.get(`"${hash}"`, exceptPageId)) continue;
    if (files.remove(hash)) removed++;
  }
  return removed;
}
