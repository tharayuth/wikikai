/**
 * The little "480 × 300" chip that follows a resize drag.
 *
 * Shared by the image and diagram resize hooks so both report a size the
 * same way. It pins itself to the element being dragged, which is already
 * a positioning context in both cases (`.img-resize-wrap`,
 * `.rich-block-mermaid`).
 *
 * The numbers are the box the reader can actually see, measured from the
 * element rather than from the value being written. An image dragged past
 * its natural width stops growing, and a readout that kept counting up
 * would be describing something that is not on screen.
 */
export interface SizeReadout {
  /** Re-measure `target` and redraw. Call on every mousemove. */
  update(): void;
  remove(): void;
}

export type ReadoutAxis = "width" | "height" | "both";

export function showSizeReadout(
  /** Positioned ancestor the chip is pinned inside. */
  host: HTMLElement,
  /** Element whose rendered box is reported. */
  target: Element,
  axis: ReadoutAxis,
): SizeReadout {
  const chip = document.createElement("span");
  chip.className = "size-readout";
  chip.setAttribute("aria-hidden", "true");
  host.appendChild(chip);

  const update = (): void => {
    const r = target.getBoundingClientRect();
    const w = Math.round(r.width);
    const h = Math.round(r.height);
    chip.textContent =
      axis === "width" ? `${w}px` : axis === "height" ? `${h}px` : `${w} × ${h}`;
  };
  update();

  return {
    update,
    remove: () => chip.remove(),
  };
}
