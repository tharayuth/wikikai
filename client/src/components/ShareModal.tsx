import { useEffect, useState } from "react";
import { useAppDispatch, useAppSelector } from "../store";
import { closeShareModal, showToast } from "../store/uiSlice";
import { copyText } from "../lib/clipboard";
import {
  useDisableShareMutation,
  useEnableShareMutation,
  useGetKnowledgeQuery,
  useGetShareStatusQuery,
  useRotateShareMutation,
} from "../store/api";

/**
 * Public-share dialog for a single knowledge (`&N`). Opened from the badge
 * menu's "Share…" item. Lets an editor turn on a read-only public link,
 * copy it, rotate it (invalidating the old one), or turn sharing off.
 * The link works for anyone without a login: `/share/<token>`.
 */
export function ShareModal(): JSX.Element | null {
  const kid = useAppSelector((s) => s.ui.shareKnowledgeId);
  const dispatch = useAppDispatch();
  const open = kid != null;

  const knowledge = useGetKnowledgeQuery(kid as number, { skip: !open });
  const status = useGetShareStatusQuery(kid as number, { skip: !open });
  const [enable, enableState] = useEnableShareMutation();
  const [rotate, rotateState] = useRotateShareMutation();
  const [disable, disableState] = useDisableShareMutation();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dispatch(closeShareModal());
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, dispatch]);

  if (!open) return null;

  const title = knowledge.data?.title ?? `&${kid}`;
  const shared = status.data?.shared ?? false;
  const url = status.data?.url ?? "";
  const busy =
    enableState.isLoading || rotateState.isLoading || disableState.isLoading;

  const onCopy = () => {
    if (!url) return;
    copyText(url).then((ok) => {
      if (!ok) {
        dispatch(showToast({ message: "คัดลอกไม่สำเร็จ", kind: "error" }));
        return;
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const fail = (action: string) => () =>
    dispatch(showToast({ message: `${action}ไม่สำเร็จ`, kind: "error" }));

  return (
    <div className="modal-backdrop show" onClick={() => dispatch(closeShareModal())}>
      <div
        className="modal share-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Share knowledge"
      >
        <div className="account-header">
          <h2>แชร์ &amp;{kid}</h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="close"
            onClick={() => dispatch(closeShareModal())}
          >
            ×
          </button>
        </div>
        <div className="account-body share-body">
          <p className="share-doc-title" title={title}>
            {title}
          </p>

          {status.isLoading ? (
            <p className="share-hint">กำลังโหลด…</p>
          ) : shared ? (
            <>
              <p className="share-hint">
                เปิดแชร์อยู่ — ใครก็ตามที่มีลิงก์นี้เปิดดูได้ (อ่านอย่างเดียว)
                โดยไม่ต้องล็อกอิน
              </p>
              <div className="share-link-row">
                <input
                  type="text"
                  className="share-link-input"
                  value={url}
                  readOnly
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button
                  type="button"
                  className="account-btn"
                  onClick={onCopy}
                  disabled={!url}
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <div className="share-actions">
                <button
                  type="button"
                  className="account-btn"
                  onClick={() =>
                    rotate(kid as number).unwrap().catch(fail("สร้างลิงก์ใหม่"))
                  }
                  disabled={busy}
                  title="ออกลิงก์ใหม่ — ลิงก์เดิมจะใช้ไม่ได้ทันที"
                >
                  สร้างลิงก์ใหม่
                </button>
                <button
                  type="button"
                  className="account-btn danger"
                  onClick={() =>
                    disable(kid as number).unwrap().catch(fail("ปิดการแชร์"))
                  }
                  disabled={busy}
                >
                  ปิดการแชร์
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="share-hint">
                ยังไม่ได้แชร์ — เปิดเพื่อสร้างลิงก์ public ที่เปิดดูเอกสารนี้ได้
                โดยไม่ต้องล็อกอิน (อ่านอย่างเดียว)
              </p>
              <button
                type="button"
                className="account-btn primary"
                onClick={() =>
                  enable(kid as number).unwrap().catch(fail("เปิดการแชร์"))
                }
                disabled={busy}
              >
                เปิดการแชร์แบบ public
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
