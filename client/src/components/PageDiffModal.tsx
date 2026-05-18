import { useEffect, useMemo, useRef } from "react";
import { useGetPageRawQuery } from "../store/api";

interface Props {
  pageId: number;
  oldVersion: number;
  newVersion: number;
  newIsLatest: boolean;
  onClose: () => void;
}

type DiffLine =
  | { type: "same"; text: string; aLine: number; bLine: number }
  | { type: "del"; text: string; aLine: number }
  | { type: "add"; text: string; bLine: number };

function lineDiff(a: string, b: string): DiffLine[] {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const n = aLines.length;
  const m = bLines.length;
  // LCS DP (length-only)
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (aLines[i] === bLines[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) {
      out.push({ type: "same", text: aLines[i], aLine: i + 1, bLine: j + 1 });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "del", text: aLines[i], aLine: i + 1 });
      i++;
    } else {
      out.push({ type: "add", text: bLines[j], bLine: j + 1 });
      j++;
    }
  }
  while (i < n) {
    out.push({ type: "del", text: aLines[i], aLine: i + 1 });
    i++;
  }
  while (j < m) {
    out.push({ type: "add", text: bLines[j], bLine: j + 1 });
    j++;
  }
  return out;
}

export function PageDiffModal({
  pageId,
  oldVersion,
  newVersion,
  newIsLatest,
  onClose,
}: Props) {
  const oldRaw = useGetPageRawQuery({ pageId, version: oldVersion });
  const newRaw = useGetPageRawQuery(
    newIsLatest ? pageId : { pageId, version: newVersion },
  );
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  const lines = useMemo<DiffLine[] | null>(() => {
    if (oldRaw.data == null || newRaw.data == null) return null;
    return lineDiff(oldRaw.data, newRaw.data);
  }, [oldRaw.data, newRaw.data]);

  const stats = useMemo(() => {
    if (!lines) return { add: 0, del: 0 };
    let add = 0;
    let del = 0;
    for (const l of lines) {
      if (l.type === "add") add++;
      else if (l.type === "del") del++;
    }
    return { add, del };
  }, [lines]);

  // mousedown/up pair so dragging-to-select doesn't close the modal
  const downRef = useRef(false);
  const onDown = (e: React.MouseEvent<HTMLDivElement>) => {
    downRef.current = e.target === e.currentTarget;
  };
  const onUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (downRef.current && e.target === e.currentTarget) onClose();
    downRef.current = false;
  };

  return (
    <div
      className="modal-backdrop show"
      onMouseDown={onDown}
      onMouseUp={onUp}
    >
      <div
        className="modal page-diff-modal"
        onMouseDown={(e) => e.stopPropagation()}
        ref={ref}
      >
        <div className="modal-header">
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
            Diff: v{oldVersion} → v{newVersion}
            {newIsLatest && <span className="diff-latest-tag">latest</span>}
          </h3>
          <div className="diff-stats">
            <span className="diff-stat-add">+{stats.add}</span>
            <span className="diff-stat-del">−{stats.del}</span>
          </div>
          <button
            className="pf-close"
            onClick={onClose}
            title="Close (Esc)"
            style={{ marginLeft: "auto" }}
          >
            ×
          </button>
        </div>

        <div className="page-diff-body">
          {oldRaw.isLoading || newRaw.isLoading ? (
            <div className="diff-empty">Loading…</div>
          ) : oldRaw.error || newRaw.error ? (
            <div className="diff-empty diff-error">
              Failed to load revisions
            </div>
          ) : !lines || lines.length === 0 ? (
            <div className="diff-empty">No content</div>
          ) : stats.add === 0 && stats.del === 0 ? (
            <div className="diff-empty">Lines are identical</div>
          ) : (
            <pre className="diff-pre">
              {lines.map((l, idx) => (
                <div key={idx} className={`diff-row diff-${l.type}`}>
                  <span className="diff-gutter diff-gutter-a">
                    {l.type === "add" ? "" : l.aLine}
                  </span>
                  <span className="diff-gutter diff-gutter-b">
                    {l.type === "del" ? "" : l.bLine}
                  </span>
                  <span className="diff-sign">
                    {l.type === "add" ? "+" : l.type === "del" ? "−" : " "}
                  </span>
                  <span className="diff-text">{l.text || " "}</span>
                </div>
              ))}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
