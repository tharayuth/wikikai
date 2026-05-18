import { useEffect } from "react";
import {
  useToggleChecklistItemMutation,
  useToggleTaskAtIndexMutation,
} from "../store/api";
import { useAppDispatch } from "../store";
import { showToast } from "../store/uiSlice";
import { parseLocation } from "./useHash";

/**
 * Listen for `change` events on any `.checklist-toggle` checkbox in the
 * document and forward to the server-side toggle endpoint.
 *
 * We attach to `document` (not the article ref) because React replaces
 * the article element on remount and the per-element listener gets
 * lost; document survives navigations between pages of an SPA.
 */
export function useChecklistToggles(): void {
  const [toggleChecklist] = useToggleChecklistItemMutation();
  const [toggleTask] = useToggleTaskAtIndexMutation();
  const dispatch = useAppDispatch();

  useEffect(() => {
    const onChange = async (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (!t || t.tagName !== "INPUT") return;
      const input = t as HTMLInputElement;
      if (input.disabled) return;

      // Path A — checklist fence (rich block)
      if (input.classList.contains("checklist-toggle")) {
        const blockId = Number(input.dataset.blockId);
        const idx = Number(input.dataset.itemIdx);
        if (!Number.isFinite(blockId) || !Number.isFinite(idx)) return;
        const want = input.checked;
        const li = input.closest(".checklist-item");
        const prevDone = li?.classList.contains("done") ?? false;
        if (li) li.classList.toggle("done", want);
        try {
          await toggleChecklist({
            block_id: blockId,
            index: idx,
            done: want,
          }).unwrap();
        } catch (err) {
          input.checked = !want;
          if (li) li.classList.toggle("done", prevDone);
          const msg = (err as { data?: { error?: string } } | undefined)?.data
            ?.error;
          dispatch(showToast(`Toggle failed${msg ? `: ${msg}` : ""}`));
        }
        return;
      }

      // Path B — GFM task list (- [ ] / - [x] anywhere in markdown)
      if (input.classList.contains("task-list-item-checkbox")) {
        const idx = Number(input.dataset.taskIndex);
        if (!Number.isFinite(idx)) return;
        const pid = parseLocation().pid;
        if (pid == null) return;
        const want = input.checked;
        const li = input.closest("li.task-list-item");
        const prevDone = li?.classList.contains("done") ?? false;
        if (li) li.classList.toggle("done", want);
        try {
          await toggleTask({ pageId: pid, index: idx }).unwrap();
        } catch (err) {
          input.checked = !want;
          if (li) li.classList.toggle("done", prevDone);
          const msg = (err as { data?: { error?: string } } | undefined)?.data
            ?.error;
          dispatch(showToast(`Task toggle failed${msg ? `: ${msg}` : ""}`));
        }
      }
    };
    document.addEventListener("change", onChange);
    return () => document.removeEventListener("change", onChange);
  }, [toggleChecklist, toggleTask, dispatch]);
}
