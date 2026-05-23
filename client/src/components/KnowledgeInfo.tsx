import { useEffect, useState, type ReactNode } from "react";
import { useDeleteKnowledgeMutation, useGetKnowledgeQuery } from "../store/api";
import { useAppDispatch } from "../store";
import { showToast } from "../store/uiSlice";
import { InfoPopover } from "./InfoPopover";
import { openBadgeMenu } from "../lib/badgeMenu";
import { navigateTo } from "../hooks/useHash";
import {
  isKnowledgeStarred,
  STARRED_KNOWLEDGE_EVENT,
  toggleKnowledgeStar,
} from "../lib/starredKnowledge";

interface Props {
  kid: number | null;
  pid: number | null;
  /** Rendered immediately after the title text (inside .ki-row-1).
   *  Used by Topbar to pin Refresh right next to the topic name. */
  titleSuffix?: ReactNode;
}

export function KnowledgeInfo({ kid, pid, titleSuffix }: Props) {
  const dispatch = useAppDispatch();
  const knowledge = useGetKnowledgeQuery(kid as number, { skip: kid === null });
  const [deleteKnowledge] = useDeleteKnowledgeMutation();
  const [infoOpen, setInfoOpen] = useState(false);
  const [starred, setStarred] = useState(false);

  useEffect(() => {
    setInfoOpen(false);
    setStarred(kid != null ? isKnowledgeStarred(kid) : false);
  }, [kid]);

  useEffect(() => {
    const refresh = () => setStarred(kid != null ? isKnowledgeStarred(kid) : false);
    window.addEventListener(STARRED_KNOWLEDGE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(STARRED_KNOWLEDGE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [kid]);

  if (kid === null) {
    return <div className="knowledge-info knowledge-info-empty" />;
  }
  if (knowledge.isLoading) {
    return (
      <div className="knowledge-info">
        <div className="ki-row-1">
          <span className="ki-id-badge">&amp;{kid}</span>
          <span className="ki-title">Loading…</span>
        </div>
      </div>
    );
  }
  if (knowledge.error || !knowledge.data) {
    return (
      <div className="knowledge-info">
        <div className="ki-row-1">
          <span className="ki-id-badge">&amp;{kid}</span>
          <span className="ki-title">Knowledge &amp;{kid} not found</span>
        </div>
      </div>
    );
  }

  const meta = knowledge.data;
  const activePid =
    pid && meta.pages.find((p) => p.id === pid)
      ? pid
      : meta.pages[0]?.id ?? null;
  const activePage =
    activePid != null ? meta.pages.find((p) => p.id === activePid) ?? null : null;

  return (
    <div className="knowledge-info">
      <div className="ki-row-1">
        <button
          type="button"
          className={`star-btn${starred ? " active" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            const next = toggleKnowledgeStar(meta.id);
            setStarred(next);
            dispatch(showToast(next ? "Starred topic" : "Unstarred topic"));
          }}
          title={starred ? "Unstar this topic" : "Star this topic"}
          aria-label={starred ? "Unstar this topic" : "Star this topic"}
          aria-pressed={starred}
        >
          <svg
            viewBox="0 0 24 24"
            width="17"
            height="17"
            fill={starred ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        </button>
        <button
          className={`info-btn${infoOpen ? " open" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            setInfoOpen((v) => !v);
          }}
          title="Show details (id, session, tokens, prompt …)"
          aria-label="Show knowledge details"
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="11" x2="12" y2="17" />
            <circle cx="12" cy="7.5" r="0.6" fill="currentColor" stroke="none" />
          </svg>
        </button>
        <button
          className="ki-id-badge"
          onClick={(e) => {
            const btn = e.currentTarget;
            openBadgeMenu({
              kind: "knowledge",
              id: meta.id,
              badge: btn,
              copyText: `&${meta.id}`,
              contentUrl: `/api/knowledge/${meta.id}/content`,
              editLabel: "Edit this knowledge",
              onEdit: () => setInfoOpen(true),
              deleteLabel: "Delete this knowledge",
              confirmDelete: () =>
                window.confirm(
                  `⚠️ Delete knowledge "${meta.title}" (&${meta.id})?\n\nEvery page, revision, and any image used only by this knowledge will be removed permanently. This cannot be undone.`,
                ),
              onDelete: async () => {
                await deleteKnowledge(meta.id).unwrap();
              },
              onDeleteSuccess: () => {
                dispatch(
                  showToast({
                    message: `Deleted "${meta.title}"`,
                    kind: "success",
                  }),
                );
                navigateTo({ kid: null });
              },
              onDeleteError: (err) => {
                const e2 = err as { status?: number; data?: { error?: string } };
                dispatch(
                  showToast({
                    message: `Delete failed: ${e2.data?.error ?? e2.status ?? "error"}`,
                    kind: "error",
                  }),
                );
              },
              onCopied: (what) =>
                dispatch(
                  showToast(
                    what === "id"
                      ? `copied &${meta.id}`
                      : `copied &${meta.id} content`,
                  ),
                ),
              onCopyError: () =>
                dispatch(showToast({ message: "Copy failed", kind: "error" })),
            });
          }}
          title="knowledge actions: copy / edit / delete"
        >
          &amp;{meta.id}
        </button>
        <h2 className="ki-title">{meta.title}</h2>
        {titleSuffix}
        {infoOpen && (
          <InfoPopover
            meta={meta}
            activePage={activePage}
            onClose={() => setInfoOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
