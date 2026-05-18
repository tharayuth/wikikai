import { useEffect, useState } from "react";
import { useGetKnowledgeQuery } from "../store/api";
import { useAppDispatch } from "../store";
import { showToast } from "../store/uiSlice";
import { InfoPopover } from "./InfoPopover";

interface Props {
  kid: number | null;
  pid: number | null;
}

export function KnowledgeInfo({ kid, pid }: Props) {
  const dispatch = useAppDispatch();
  const knowledge = useGetKnowledgeQuery(kid as number, { skip: kid === null });
  const [infoOpen, setInfoOpen] = useState(false);

  useEffect(() => {
    setInfoOpen(false);
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
          onClick={() => {
            navigator.clipboard.writeText(`&${meta.id}`);
            dispatch(showToast(`copied &${meta.id}`));
          }}
          title="copy knowledge id (&N)"
        >
          &amp;{meta.id}
        </button>
        <h2 className="ki-title">{meta.title}</h2>
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
