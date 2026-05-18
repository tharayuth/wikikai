import { useEffect, useRef, useState } from "react";

const ACCEPT = "image/png,image/jpeg,image/jpg,image/gif,image/webp,image/svg+xml";
const MAX_BYTES = 10 * 1024 * 1024; // ~10 MB per file

export interface UploadedImage {
  src: string;
  alt: string;
  /** Default thumbnail width in px — propagated to the inserted source. */
  width: number;
  /** Default thumbnail height in px — propagated to the inserted source. */
  height: number;
}

const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 180;

interface FileEntry {
  id: string;
  file: File;
  alt: string;
  previewUrl: string;
  error: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onInsert: (images: UploadedImage[]) => void;
}

let uid = 0;
const nextId = () => `f${++uid}`;

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      // FileReader returns a data: URI; strip the prefix.
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

export function ImageUploadModal({ open, onClose, onInsert }: Props) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [width, setWidth] = useState<number>(DEFAULT_WIDTH);
  const [height, setHeight] = useState<number>(DEFAULT_HEIGHT);
  const inputRef = useRef<HTMLInputElement>(null);

  // Revoke preview blob URLs on unmount / close so we don't leak memory.
  useEffect(() => {
    return () => {
      for (const e of entries) URL.revokeObjectURL(e.previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!open) {
      for (const e of entries) URL.revokeObjectURL(e.previewUrl);
      setEntries([]);
      setBusy(false);
      setDragOver(false);
      setWidth(DEFAULT_WIDTH);
      setHeight(DEFAULT_HEIGHT);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open, onClose, busy]);

  if (!open) return null;

  const addFiles = (files: FileList | File[]) => {
    const next: FileEntry[] = [];
    for (const file of Array.from(files)) {
      let error: string | null = null;
      if (!ACCEPT.split(",").includes(file.type)) {
        error = `Unsupported type ${file.type || "(unknown)"}`;
      } else if (file.size > MAX_BYTES) {
        error = `Larger than 10 MB (${fmtBytes(file.size)})`;
      }
      next.push({
        id: nextId(),
        file,
        alt: file.name.replace(/\.[a-z0-9]+$/i, ""),
        previewUrl: URL.createObjectURL(file),
        error,
      });
    }
    setEntries((prev) => [...prev, ...next]);
  };

  const removeEntry = (id: string) => {
    setEntries((prev) => {
      const it = prev.find((e) => e.id === id);
      if (it) URL.revokeObjectURL(it.previewUrl);
      return prev.filter((e) => e.id !== id);
    });
  };

  const setAlt = (id: string, alt: string) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, alt } : e)));
  };

  const onDrop = (ev: React.DragEvent<HTMLDivElement>) => {
    ev.preventDefault();
    setDragOver(false);
    if (ev.dataTransfer.files?.length) addFiles(ev.dataTransfer.files);
  };

  const upload = async () => {
    const valid = entries.filter((e) => !e.error);
    if (valid.length === 0) return;
    setBusy(true);
    const out: UploadedImage[] = [];
    for (const entry of valid) {
      try {
        const data_base64 = await fileToBase64(entry.file);
        const r = await fetch("/api/images", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            data_base64,
            mime_type: entry.file.type,
            alt: entry.alt.trim() || undefined,
          }),
        });
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${r.status}`);
        }
        const body = (await r.json()) as {
          src: string;
          alt?: string | null;
          width?: number | null;
          height?: number | null;
        };
        out.push({
          src: body.src,
          alt: entry.alt.trim() || body.alt || "",
          width,
          height,
        });
      } catch (e) {
        setEntries((prev) =>
          prev.map((p) =>
            p.id === entry.id ? { ...p, error: (e as Error).message } : p,
          ),
        );
      }
    }
    setBusy(false);
    if (out.length > 0) {
      onInsert(out);
      onClose();
    }
  };

  const validCount = entries.filter((e) => !e.error).length;

  return (
    <div className="modal-backdrop show" onClick={() => !busy && onClose()}>
      <div
        className="modal image-upload-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
            🖼 Add Images
          </h3>
          <button
            className="pf-close"
            onClick={() => !busy && onClose()}
            style={{ marginLeft: "auto" }}
            disabled={busy}
            title="Close (Esc)"
          >
            ×
          </button>
        </div>

        <div className="iu-size-row">
          <label className="iu-size-label">
            <span>Width (px)</span>
            <input
              type="number"
              min={1}
              max={4000}
              value={width}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (Number.isFinite(n) && n > 0) setWidth(n);
                else if (e.target.value === "") setWidth(0);
              }}
              disabled={busy}
            />
          </label>
          <label className="iu-size-label">
            <span>Height (px)</span>
            <input
              type="number"
              min={1}
              max={4000}
              value={height}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (Number.isFinite(n) && n > 0) setHeight(n);
                else if (e.target.value === "") setHeight(0);
              }}
              disabled={busy}
            />
          </label>
          <button
            type="button"
            className="iu-size-reset"
            onClick={() => {
              setWidth(DEFAULT_WIDTH);
              setHeight(DEFAULT_HEIGHT);
            }}
            disabled={busy}
            title="Reset to defaults 320 × 180"
          >
            ↺ default
          </button>
        </div>

        <details className="iu-cases">
          <summary>
            How will the image be inserted? (depends on the cursor position)
          </summary>
          <table className="iu-cases-table">
            <thead>
              <tr>
                <th>Cursor is</th>
                <th>Insert form</th>
                <th>Has <code>@N</code></th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Outside any fence (top-level)</td>
                <td>
                  <code>```images</code> fence + width/height in JSON
                </td>
                <td>✓ wrapper</td>
              </tr>
              <tr>
                <td>
                  Inside an <code>html-embed</code> fence
                </td>
                <td>
                  <code>{`<img src=… width="${width}" height="${height}" />`}</code>
                </td>
                <td>—</td>
              </tr>
              <tr>
                <td>
                  Inside any other fence (<code>checklist</code> / <code>steps</code> / …)
                </td>
                <td>
                  <code>{`![alt](src "${width}x${height}")`}</code>
                </td>
                <td>—</td>
              </tr>
            </tbody>
          </table>
        </details>

        <div
          className={`iu-drop${dragOver ? " over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
        >
          <div className="iu-drop-icon">📥</div>
          <div className="iu-drop-text">
            Drop images here, or <strong>click to choose files</strong>
          </div>
          <div className="iu-drop-sub">
            PNG / JPG / WebP / GIF / SVG · up to 10 MB per file
          </div>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {entries.length > 0 && (
          <div className="iu-list">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className={`iu-row${entry.error ? " has-error" : ""}`}
              >
                <img
                  src={entry.previewUrl}
                  alt=""
                  className="iu-thumb"
                  loading="lazy"
                />
                <div className="iu-meta">
                  <div className="iu-filename" title={entry.file.name}>
                    {entry.file.name}
                  </div>
                  <div className="iu-size">{fmtBytes(entry.file.size)}</div>
                  <input
                    type="text"
                    className="iu-alt"
                    placeholder="alt text (optional)"
                    value={entry.alt}
                    onChange={(e) => setAlt(entry.id, e.target.value)}
                    disabled={busy}
                  />
                  {entry.error && <div className="iu-error">{entry.error}</div>}
                </div>
                <button
                  type="button"
                  className="iu-remove"
                  onClick={() => removeEntry(entry.id)}
                  disabled={busy}
                  title="Remove"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="iu-actions">
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="primary"
            onClick={upload}
            disabled={busy || validCount === 0}
          >
            {busy
              ? "Uploading…"
              : validCount === 0
                ? "OK"
                : `OK · insert ${validCount} image(s)`}
          </button>
        </div>
      </div>
    </div>
  );
}
