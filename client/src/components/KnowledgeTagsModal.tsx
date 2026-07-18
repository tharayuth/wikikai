import { useEffect, useMemo, useRef } from "react";
import type React from "react";
import { useAppDispatch, useAppSelector } from "../store";
import {
  useGetKnowledgeQuery,
  useListKnowledgeQuery,
  useUpdateKnowledgeMutation,
} from "../store/api";
import {
  closeKnowledgeTagsModal,
  showToast,
} from "../store/uiSlice";
import { KnowledgeTagEditor } from "./KnowledgeTagEditor";

export function KnowledgeTagsModal(): JSX.Element | null {
  const kid = useAppSelector((state) => state.ui.tagsKnowledgeId);
  const dispatch = useAppDispatch();
  const open = kid != null;
  const knowledge = useGetKnowledgeQuery(kid as number, { skip: !open });
  const { data: knowledges = [] } = useListKnowledgeQuery();
  const [updateKnowledge, updateState] = useUpdateKnowledgeMutation();
  const downOnBackdropRef = useRef(false);

  const suggestions = useMemo(
    () =>
      Array.from(
        new Map(
          knowledges
            .flatMap((item) => item.tags)
            .map((tag) => [tag.toLocaleLowerCase(), tag]),
        ).values(),
      ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [knowledges],
  );

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dispatch(closeKnowledgeTagsModal());
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, dispatch]);

  if (!open) return null;

  const meta = knowledge.data;
  const close = () => dispatch(closeKnowledgeTagsModal());
  const onBackdropMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    downOnBackdropRef.current = event.target === event.currentTarget;
  };
  const onBackdropMouseUp = (event: React.MouseEvent<HTMLDivElement>) => {
    if (downOnBackdropRef.current && event.target === event.currentTarget) {
      close();
    }
    downOnBackdropRef.current = false;
  };

  return (
    <div
      className="modal-backdrop show"
      onMouseDown={onBackdropMouseDown}
      onMouseUp={onBackdropMouseUp}
    >
      <div
        className="modal knowledge-tags-modal"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="knowledge-tags-modal-title"
      >
        <div className="account-header">
          <h2 id="knowledge-tags-modal-title">จัดการ tags &amp;{kid}</h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close tag manager"
            onClick={close}
          >
            ×
          </button>
        </div>
        <div className="account-body knowledge-tags-modal-body">
          {knowledge.isLoading ? (
            <p className="knowledge-tags-modal-hint">กำลังโหลด…</p>
          ) : knowledge.error || !meta ? (
            <p className="knowledge-tags-modal-error">
              โหลดข้อมูล knowledge ไม่สำเร็จ
            </p>
          ) : (
            <>
              <p className="knowledge-tags-modal-title" title={meta.title}>
                {meta.title}
              </p>
              <p className="knowledge-tags-modal-hint">
                พิมพ์ tag แล้วกด Enter หรือวางหลาย tags คั่นด้วย comma
                เพื่อจัดหมวดและค้นหา knowledge ได้ง่ายขึ้น
              </p>
              <KnowledgeTagEditor
                tags={meta.tags}
                suggestions={suggestions}
                disabled={updateState.isLoading}
                initiallyEditing
                onCancel={close}
                onSaved={close}
                onSave={async (tags) => {
                  try {
                    await updateKnowledge({ id: meta.id, tags }).unwrap();
                    dispatch(
                      showToast({
                        message:
                          tags.length > 0
                            ? `Updated tags for &${meta.id}`
                            : `Removed all tags from &${meta.id}`,
                        kind: "success",
                      }),
                    );
                  } catch (error) {
                    dispatch(
                      showToast({
                        message: `Failed to update tags for &${meta.id}`,
                        kind: "error",
                      }),
                    );
                    throw error;
                  }
                }}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
