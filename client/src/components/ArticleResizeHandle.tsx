import { useEffect, useRef, useState } from "react";

/**
 * Drag handle pinned to the right edge of `.article-frame`. Updates a
 * --article-w custom property on <html> (so the page-editor-wrap and the
 * rendered article stay in lockstep). Persists to localStorage; restored
 * once on first mount of any handle in the session.
 *
 * Shared by the signed-in article and the public share view, which both
 * wrap their content in `.article-frame`, so a width the reader drags is
 * one preference rather than one per surface.
 */
const STORAGE_KEY = "wikikai-article-w";
let restoredFromStorage = false;
export function ArticleResizeHandle(): JSX.Element {
  const [dragging, setDragging] = useState(false);
  // Captured on mousedown so each mousemove computes a delta from the
  // pointer's start position rather than re-deriving from frame.left.
  const startRef = useRef<{ x: number; width: number } | null>(null);

  useEffect(() => {
    if (restoredFromStorage) return;
    restoredFromStorage = true;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const n = raw == null ? NaN : Number(raw);
      if (Number.isFinite(n) && n >= 480 && n <= 2000) {
        document.documentElement.style.setProperty("--article-w", `${n}px`);
      }
    } catch {
      /* private mode / no storage */
    }
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const start = startRef.current;
      if (!start) return;
      // Frame is left-aligned: dragging the right edge by N px grows
      // (or shrinks) the width by N px — no 2× scaling.
      const delta = e.clientX - start.x;
      const next = Math.max(480, Math.min(2000, start.width + delta));
      document.documentElement.style.setProperty(
        "--article-w",
        `${Math.round(next)}px`,
      );
    };
    const onUp = () => {
      setDragging(false);
      startRef.current = null;
      const cur = document.documentElement.style.getPropertyValue("--article-w");
      const n = parseInt(cur.replace("px", ""), 10);
      if (Number.isFinite(n)) {
        try {
          localStorage.setItem(STORAGE_KEY, String(n));
        } catch {
          /* ignore */
        }
      }
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [dragging]);

  return (
    <div
      className={`article-resize-handle${dragging ? " dragging" : ""}`}
      onMouseDown={(e) => {
        e.preventDefault();
        const frame = e.currentTarget.parentElement;
        if (!frame) return;
        startRef.current = {
          x: e.clientX,
          width: frame.getBoundingClientRect().width,
        };
        setDragging(true);
      }}
      onDoubleClick={() => {
        // Reset to default
        document.documentElement.style.removeProperty("--article-w");
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          /* ignore */
        }
      }}
      title="Drag to resize article width · double-click to reset"
      aria-label="Resize article width"
    />
  );
}
