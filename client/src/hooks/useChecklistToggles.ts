import { useEffect } from "react";
import { useToggleChecklistItemMutation } from "../store/api";
import { useAppDispatch } from "../store";
import { showToast } from "../store/uiSlice";

/**
 * Listen for `change` events on any `.checklist-toggle` checkbox in the
 * document and forward to the server-side toggle endpoint.
 *
 * We attach to `document` (not the article ref) because React replaces
 * the article element on remount and the per-element listener gets
 * lost; document survives navigations between pages of an SPA.
 */
export function useChecklistToggles(): void {
  const [toggle] = useToggleChecklistItemMutation();
  const dispatch = useAppDispatch();

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log("[checklist] document-level delegation attached");
    const onChange = async (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (
        !t ||
        t.tagName !== "INPUT" ||
        !(t as HTMLInputElement).classList.contains("checklist-toggle")
      ) {
        return;
      }
      const input = t as HTMLInputElement;
      if (input.disabled) return;
      const blockId = Number(input.dataset.blockId);
      const idx = Number(input.dataset.itemIdx);
      if (!Number.isFinite(blockId) || !Number.isFinite(idx)) return;
      const want = input.checked;
      const li = input.closest(".checklist-item");
      const prevDone = li?.classList.contains("done") ?? false;
      if (li) li.classList.toggle("done", want);
      // eslint-disable-next-line no-console
      console.log("[checklist] PATCH", { blockId, idx, want });
      try {
        const r = await toggle({
          block_id: blockId,
          index: idx,
          done: want,
        }).unwrap();
        // eslint-disable-next-line no-console
        console.log("[checklist] PATCH ok", r);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[checklist] PATCH failed", err);
        input.checked = !want;
        if (li) li.classList.toggle("done", prevDone);
        const msg = (err as { data?: { error?: string } } | undefined)?.data
          ?.error;
        dispatch(showToast(`Toggle failed${msg ? `: ${msg}` : ""}`));
      }
    };
    document.addEventListener("change", onChange);
    return () => document.removeEventListener("change", onChange);
  }, [toggle, dispatch]);
}
