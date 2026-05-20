import { useEffect, type RefObject } from "react";
import { useResizeInlineImageMutation } from "../store/api";

/**
 * Wire up drag-to-resize handles + click-to-lightbox on every inline
 * markdown `<img>` rendered inside `bodyRef`. Handles live in three
 * spots: right edge (width), bottom edge (height), bottom-right corner
 * (both). On mouseup, the new max-width / max-height is persisted to
 * the source markdown's title slot via the resize-image API endpoint.
 *
 * Skipped sources:
 *   • `<figure class="image-thumb">` images (the `images` fence
 *     gallery — its own lightbox runs in useMermaidCharts).
 *   • Images inside an `<a>` link (the link's click should win).
 *
 * Images that come back as part of a re-render keep working — the
 * effect re-runs on `pageId` change, tearing down old handles before
 * binding new ones.
 */
export function useImageResize(
  bodyRef: RefObject<HTMLElement | null>,
  pageId: number | null,
): void {
  const [resize] = useResizeInlineImageMutation();

  useEffect(() => {
    const root = bodyRef.current;
    if (!root || pageId == null) return;

    type Wrap = {
      wrap: HTMLSpanElement;
      img: HTMLImageElement;
      handles: HTMLSpanElement[];
    };
    const wraps: Wrap[] = [];

    const imgs = Array.from(root.querySelectorAll<HTMLImageElement>("img"));
    for (const img of imgs) {
      // Skip gallery thumbs (own lightbox in useMermaidCharts)
      if (img.closest("figure.image-thumb")) continue;
      // Skip linked images — link click should win
      if (img.closest("a")) continue;
      // Skip embedded HTML (html-embed) — Phase 2 / different surface
      if (img.closest(".html-embed")) continue;
      // Skip if we've already wrapped this <img> on a previous run
      if (img.parentElement?.classList.contains("img-resize-wrap")) continue;
      // Only inline markdown images carry data-img-src (the renderer
      // stamps it). Without it we can't talk to the resize endpoint.
      const src = img.getAttribute("data-img-src");
      if (!src) continue;

      const wrap = document.createElement("span");
      wrap.className = "img-resize-wrap";
      // Inherit the image's display sizing so the handles sit on its
      // actual rendered box, not on a stretched container.
      img.parentNode?.insertBefore(wrap, img);
      wrap.appendChild(img);

      const mkHandle = (cls: string): HTMLSpanElement => {
        const h = document.createElement("span");
        h.className = `img-resize-handle ${cls}`;
        h.setAttribute("aria-hidden", "true");
        wrap.appendChild(h);
        return h;
      };
      const handles = [mkHandle("right"), mkHandle("bottom"), mkHandle("corner")];
      wraps.push({ wrap, img, handles });
    }

    type DragState = {
      kind: "right" | "bottom" | "corner";
      img: HTMLImageElement;
      src: string;
      occurrence: number;
      startX: number;
      startY: number;
      startW: number;
      startH: number;
      finalW?: number;
      finalH?: number;
    };
    let drag: DragState | null = null;

    const onMove = (e: MouseEvent) => {
      if (!drag) return;
      e.preventDefault();
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (drag.kind === "right" || drag.kind === "corner") {
        const w = Math.max(40, Math.round(drag.startW + dx));
        drag.img.style.maxWidth = `${w}px`;
        drag.img.style.width = "auto";
        drag.finalW = w;
      }
      if (drag.kind === "bottom" || drag.kind === "corner") {
        const h = Math.max(40, Math.round(drag.startH + dy));
        drag.img.style.maxHeight = `${h}px`;
        drag.img.style.height = "auto";
        drag.finalH = h;
      }
      drag.img.classList.add("img-dragging");
    };

    const onUp = async () => {
      if (!drag) return;
      const d = drag;
      drag = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      d.img.classList.remove("img-dragging");
      // If neither dimension changed (a click without drag), skip the
      // API call — the click handler below opens the lightbox.
      const changedW =
        d.finalW != null && Math.abs(d.finalW - d.startW) >= 2;
      const changedH =
        d.finalH != null && Math.abs(d.finalH - d.startH) >= 2;
      if (!changedW && !changedH) return;
      try {
        await resize({
          pageId,
          src: d.src,
          occurrence: d.occurrence,
          width: changedW ? d.finalW : undefined,
          height: changedH ? d.finalH : undefined,
        }).unwrap();
      } catch (err) {
        // Roll back the live preview on failure
        d.img.style.maxWidth = `${d.startW}px`;
        d.img.style.maxHeight = `${d.startH}px`;
        console.error("image resize failed", err);
      }
    };

    const handleDownHandlers: {
      el: HTMLElement;
      handler: (e: MouseEvent) => void;
    }[] = [];
    for (const { img, handles } of wraps) {
      for (const handle of handles) {
        const kind = handle.classList.contains("right")
          ? "right"
          : handle.classList.contains("bottom")
            ? "bottom"
            : "corner";
        const handler = (e: MouseEvent) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          const rect = img.getBoundingClientRect();
          drag = {
            kind,
            img,
            src: img.getAttribute("data-img-src") ?? "",
            occurrence: Number(img.getAttribute("data-img-occurrence") ?? "0"),
            startX: e.clientX,
            startY: e.clientY,
            startW: Math.round(rect.width),
            startH: Math.round(rect.height),
          };
          window.addEventListener("mousemove", onMove);
          window.addEventListener("mouseup", onUp);
        };
        handle.addEventListener("mousedown", handler);
        handleDownHandlers.push({ el: handle, handler });
      }
    }

    // ─── Click-to-lightbox on any inline image we wrapped ───
    let activeLightbox: HTMLDivElement | null = null;
    const closeLightbox = () => {
      if (activeLightbox?.parentNode) {
        activeLightbox.parentNode.removeChild(activeLightbox);
      }
      activeLightbox = null;
      document.removeEventListener("keydown", onEsc);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLightbox();
    };
    const clickHandlers: {
      el: HTMLImageElement;
      handler: (e: MouseEvent) => void;
    }[] = [];
    for (const { img } of wraps) {
      const handler = (e: MouseEvent) => {
        // Ignore clicks that bubbled from a resize handle (handles call
        // stopPropagation, but defensive). Ignore mid-drag clicks.
        if (drag) return;
        const t = e.target as HTMLElement;
        if (t.classList.contains("img-resize-handle")) return;
        e.preventDefault();
        const src = img.getAttribute("src") ?? "";
        const alt = img.getAttribute("alt") ?? "";
        const title = img.getAttribute("title") ?? "";
        const overlay = document.createElement("div");
        overlay.className = "image-lightbox";
        overlay.innerHTML =
          `<img src="${src.replace(/"/g, "&quot;")}" alt="${alt.replace(/"/g, "&quot;")}" />` +
          (title
            ? `<div class="lb-caption">${title.replace(/</g, "&lt;")}</div>`
            : "") +
          `<button type="button" class="lb-close" aria-label="close">×</button>`;
        overlay.addEventListener("click", (ev) => {
          if (
            ev.target === overlay ||
            (ev.target as HTMLElement).classList.contains("lb-close")
          ) {
            closeLightbox();
          }
        });
        document.body.appendChild(overlay);
        activeLightbox = overlay;
        document.addEventListener("keydown", onEsc);
      };
      img.addEventListener("click", handler);
      clickHandlers.push({ el: img, handler });
    }

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      for (const { el, handler } of handleDownHandlers) {
        el.removeEventListener("mousedown", handler);
      }
      for (const { el, handler } of clickHandlers) {
        el.removeEventListener("click", handler);
      }
      closeLightbox();
      // Unwrap so a subsequent render doesn't see a stale wrapper.
      for (const { wrap, img } of wraps) {
        if (wrap.parentNode) {
          wrap.parentNode.insertBefore(img, wrap);
          for (const h of wrap.children) {
            if (h !== img) (h as HTMLElement).remove();
          }
          wrap.parentNode.removeChild(wrap);
        }
      }
    };
  }, [bodyRef, pageId, resize]);
}
