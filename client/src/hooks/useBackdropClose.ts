import { useRef } from "react";
import { backdropPress, type BackdropHandlers } from "../lib/backdropPress";

/** Handlers for a dialog's `.modal-backdrop`. Spread them on the backdrop element
 *  in place of `onClick`, so selecting text in the dialog cannot close it. */
export function useBackdropClose(onClose: () => void): BackdropHandlers {
  const latest = useRef(onClose);
  latest.current = onClose;
  const handlers = useRef<BackdropHandlers | null>(null);
  handlers.current ??= backdropPress(() => latest.current());
  return handlers.current;
}
