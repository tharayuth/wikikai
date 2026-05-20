import { useEffect } from "react";
import { useGetKnowledgeQuery } from "../store/api";

/**
 * Keep `document.title` (the browser tab + window-switcher label) in
 * sync with the page the user is currently viewing. Pattern:
 *
 *   • `[page title] · [knowledge title] — WikiKai` — when both kid + pid
 *   • `[knowledge title] — WikiKai`                — only kid (no page picked)
 *   • `WikiKai`                                    — neither (landing)
 *
 * Falls back to the static `WikiKai` while the knowledge meta is
 * loading, so navigation doesn't flicker through an empty title.
 */
export function useDocumentTitle(
  activeKid: number | null,
  activePid: number | null,
): void {
  const { data: knowledge } = useGetKnowledgeQuery(activeKid ?? 0, {
    skip: activeKid == null,
  });

  useEffect(() => {
    const base = "WikiKai";
    if (activeKid == null) {
      document.title = base;
      return;
    }
    const kTitle = knowledge?.title;
    if (!kTitle) {
      document.title = base;
      return;
    }
    if (activePid == null) {
      document.title = `${kTitle} — ${base}`;
      return;
    }
    const page = knowledge.pages.find((p) => p.id === activePid);
    if (!page) {
      document.title = `${kTitle} — ${base}`;
      return;
    }
    document.title = `${page.title} · ${kTitle} — ${base}`;
  }, [activeKid, activePid, knowledge]);
}
