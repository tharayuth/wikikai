import { useEffect, type RefObject } from "react";
import { useResizeBlockMutation } from "../store/api";

/** Matches the clamp the server applies, so the live preview never shows a
 *  width the save would reject. */
const MIN_W = 120;
const MAX_W = 2000;

/**
 * Drag-to-resize for diagram blocks, the counterpart of `useImageResize`.
 *
 * A right-edge handle sets the block's width and the diagram scales into
 * it; double-clicking the handle restores the natural size. The chosen
 * width is written to the block's `{@N}` annotation, so it survives a
 * reload and travels with the document — unlike the article width, which is
 * a per-reader browser preference.
 *
 * Width only, deliberately: a mermaid SVG has a fixed aspect ratio, so
 * height follows from width. A second axis would letterbox rather than
 * resize.
 */
export function useBlockResize(
  bodyRef: RefObject<HTMLElement | null>,
  pageId: number | null,
  /** Changes whenever the rendered article HTML does, so blocks that appear
   *  after a refetch get handles too. */
  renderKey: string,
): void {
  const [resizeBlock] = useResizeBlockMutation();

  useEffect(() => {
    const root = bodyRef.current;
    if (!root || pageId == null) return;

    const blocks = Array.from(
      root.querySelectorAll<HTMLElement>(
        ".rich-block-mermaid[data-block-id]",
      ),
    ).filter((el) => !el.querySelector(":scope > .block-resize-handle"));

    const handles: { el: HTMLElement; block: HTMLElement }[] = [];
    for (const block of blocks) {
      const handle = document.createElement("span");
      handle.className = "block-resize-handle";
      handle.setAttribute("aria-hidden", "true");
      handle.title = "Drag to resize · double-click to reset";
      block.appendChild(handle);
      handles.push({ el: handle, block });
    }

    type Drag = {
      block: HTMLElement;
      blockId: number;
      startX: number;
      startW: number;
      finalW: number;
    };
    let drag: Drag | null = null;

    const onMove = (e: MouseEvent): void => {
      if (!drag) return;
      e.preventDefault();
      const w = Math.max(
        MIN_W,
        Math.min(MAX_W, Math.round(drag.startW + (e.clientX - drag.startX))),
      );
      drag.block.style.width = `${w}px`;
      drag.finalW = w;
    };

    const onUp = async (): Promise<void> => {
      if (!drag) return;
      const d = drag;
      drag = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      d.block.classList.remove("block-dragging");
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      // A click without movement is not a resize — leave it to the click
      // handler that opens the fullscreen viewer.
      if (Math.abs(d.finalW - d.startW) < 2) return;
      try {
        await resizeBlock({
          blockId: d.blockId,
          pageId,
          width: d.finalW,
        }).unwrap();
      } catch (err) {
        d.block.style.width = `${d.startW}px`;
        // eslint-disable-next-line no-console
        console.error("block resize failed", err);
      }
    };

    const downHandlers: { el: HTMLElement; handler: (e: MouseEvent) => void }[] =
      [];
    const dblHandlers: { el: HTMLElement; handler: (e: MouseEvent) => void }[] =
      [];

    for (const { el, block } of handles) {
      const blockId = Number(block.getAttribute("data-block-id"));
      if (!Number.isFinite(blockId)) continue;

      const onDown = (e: MouseEvent): void => {
        if (e.button !== 0) return;
        e.preventDefault();
        // The wrapper opens the fullscreen viewer on click; the handle must
        // not count as one.
        e.stopPropagation();
        const w = Math.round(block.getBoundingClientRect().width);
        drag = { block, blockId, startX: e.clientX, startW: w, finalW: w };
        block.classList.add("block-dragging");
        document.body.style.userSelect = "none";
        document.body.style.cursor = "ew-resize";
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      };
      el.addEventListener("mousedown", onDown);
      downHandlers.push({ el, handler: onDown });

      const onDbl = (e: MouseEvent): void => {
        e.preventDefault();
        e.stopPropagation();
        const previous = block.style.width;
        block.style.width = "";
        resizeBlock({ blockId, pageId, width: null })
          .unwrap()
          .catch((err: unknown) => {
            block.style.width = previous;
            // eslint-disable-next-line no-console
            console.error("block resize reset failed", err);
          });
      };
      el.addEventListener("dblclick", onDbl);
      dblHandlers.push({ el, handler: onDbl });
    }

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      for (const { el, handler } of downHandlers) {
        el.removeEventListener("mousedown", handler);
      }
      for (const { el, handler } of dblHandlers) {
        el.removeEventListener("dblclick", handler);
      }
      for (const { el } of handles) el.remove();
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [bodyRef, pageId, renderKey, resizeBlock]);
}
