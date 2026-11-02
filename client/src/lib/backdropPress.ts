/**
 * Closing a dialog from its backdrop, kept free of React so the server's test run
 * can exercise it. Only a press and a release that both land on the backdrop count.
 * A plain click handler is not enough: selecting text by dragging out of a dialog
 * ends with the browser firing `click` on the backdrop, their common ancestor.
 */

interface PressEvent {
  target: unknown;
  currentTarget: unknown;
}

export interface BackdropHandlers {
  onMouseDown: (e: PressEvent) => void;
  onMouseUp: (e: PressEvent) => void;
}

export function backdropPress(onClose: () => void): BackdropHandlers {
  let downOnBackdrop = false;
  return {
    onMouseDown: (e) => {
      downOnBackdrop = e.target === e.currentTarget;
    },
    onMouseUp: (e) => {
      const closes = downOnBackdrop && e.target === e.currentTarget;
      downOnBackdrop = false;
      if (closes) onClose();
    },
  };
}
