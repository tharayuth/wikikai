import { useEffect } from "react";
import { useToggleTaskAtIndexMutation } from "../store/api";
import { useAppDispatch } from "../store";
import { showToast } from "../store/uiSlice";
import { parseLocation } from "./useHash";

/**
 * Listen for `change` events on any `.task-list-item-checkbox` in the
 * document and forward to the server-side toggle endpoint. We attach
 * to `document` (not the article ref) because React replaces the
 * article element on remount and per-element listeners get lost;
 * document survives SPA navigations.
 */
export function useChecklistToggles(): void {
  const [toggleTask] = useToggleTaskAtIndexMutation();
  const dispatch = useAppDispatch();

  useEffect(() => {
    const onChange = async (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (!t || t.tagName !== "INPUT") return;
      const input = t as HTMLInputElement;
      if (input.disabled) return;
      if (!input.classList.contains("task-list-item-checkbox")) return;

      const idx = Number(input.dataset.taskIndex);
      if (!Number.isFinite(idx)) return;
      const pid = parseLocation().pid;
      if (pid == null) return;
      const want = input.checked;
      const li = input.closest("li.task-list-item");
      const prevDone = li?.classList.contains("done") ?? false;
      if (li) li.classList.toggle("done", want);
      try {
        const r = await toggleTask({ pageId: pid, index: idx }).unwrap();
        dispatch(
          showToast({
            message: `Saved · v${r.version}`,
            kind: "success",
          }),
        );
      } catch (err) {
        input.checked = !want;
        if (li) li.classList.toggle("done", prevDone);
        const msg = (err as { data?: { error?: string } } | undefined)?.data
          ?.error;
        dispatch(
          showToast({
            message: `Task toggle failed${msg ? `: ${msg}` : ""}`,
            kind: "error",
          }),
        );
      }
    };
    document.addEventListener("change", onChange);
    return () => document.removeEventListener("change", onChange);
  }, [toggleTask, dispatch]);
}
