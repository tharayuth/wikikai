import { useEffect, type RefObject } from "react";
import { useResizeBlockMutation } from "../store/api";
import { showSizeReadout, type SizeReadout } from "../lib/sizeReadout";

/** Matches the clamp the server applies, so the live preview never shows a
 *  height the save would reject. */
const MIN_H = 80;
const MAX_H = 1600;

/**
 * Drag-to-resize for diagram blocks, the counterpart of `useImageResize`.
 *
 * A bottom-edge handle sets the block's height and the diagram scales to
 * it; double-clicking the handle restores the natural size. The chosen
 * height is written to the block's `{@N}` annotation, so it survives a
 * reload and travels with the document — unlike the article width, which is
 * a per-reader browser preference.
 *
 * Height only, deliberately: a mermaid SVG has a fixed aspect ratio, so
 * width follows from height and is left to the diagram. Dragging height is
 * what "zoom the diagram" means here, and it also lifts the default cap
 * that otherwise clips tall diagrams.
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
      startY: number;
      startH: number;
      finalH: number;
    };
    let drag: Drag | null = null;
    let readout: SizeReadout | null = null;

    const onMove = (e: MouseEvent): void => {
      if (!drag) return;
      e.preventDefault();
      const h = Math.max(
        MIN_H,
        Math.min(MAX_H, Math.round(drag.startH + (e.clientY - drag.startY))),
      );
      drag.block.style.setProperty("--block-h", `${h}px`);
      drag.block.classList.add("block-sized");
      drag.finalH = h;
      readout?.update();
    };

    const onUp = async (): Promise<void> => {
      if (!drag) return;
      const d = drag;
      drag = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      d.block.classList.remove("block-dragging");
      readout?.remove();
      readout = null;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      // A click without movement is not a resize — leave it to the click
      // handler that opens the fullscreen viewer.
      if (Math.abs(d.finalH - d.startH) < 2) return;
      try {
        await resizeBlock({
          blockId: d.blockId,
          pageId,
          height: d.finalH,
        }).unwrap();
      } catch (err) {
        d.block.style.setProperty("--block-h", `${d.startH}px`);
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
        // Measure the diagram box, not the wrapper — the wrapper also holds
        // the caption, which must not creep into the height on every drag.
        const box = block.querySelector("pre.mermaid") ?? block;
        const h = Math.round(box.getBoundingClientRect().height);
        drag = { block, blockId, startY: e.clientY, startH: h, finalH: h };
        // Height is the only axis here, and it is the diagram box that
        // carries it — the wrapper would fold the caption into the number.
        readout = showSizeReadout(block, box, "height");
        block.classList.add("block-dragging");
        document.body.style.userSelect = "none";
        document.body.style.cursor = "ns-resize";
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      };
      el.addEventListener("mousedown", onDown);
      downHandlers.push({ el, handler: onDown });

      const onDbl = (e: MouseEvent): void => {
        e.preventDefault();
        e.stopPropagation();
        const previous = block.style.getPropertyValue("--block-h");
        block.style.removeProperty("--block-h");
        block.classList.remove("block-sized");
        resizeBlock({ blockId, pageId, height: null })
          .unwrap()
          .catch((err: unknown) => {
            block.style.setProperty("--block-h", previous);
            block.classList.add("block-sized");
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
      readout?.remove();
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
