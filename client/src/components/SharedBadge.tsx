import { useAppDispatch } from "../store";
import { openShareModal } from "../store/uiSlice";

/**
 * Marks a knowledge that currently has a public share link, and opens the
 * share dialog when clicked.
 *
 * Rendered only while sharing is on, so its presence is the signal — there
 * is deliberately no "not shared" state to read past. Both the sidebar row
 * and the topbar title use it, which is why it stops propagation: in both
 * places it sits inside something else that navigates on click.
 */
export function SharedBadge({
  knowledgeId,
  title,
}: {
  knowledgeId: number;
  /** Knowledge title, used to keep the accessible label specific when
   *  several rows carry the badge. */
  title?: string;
}): JSX.Element {
  const dispatch = useAppDispatch();
  const label = title
    ? `${title} has a public share link — open share settings`
    : "Public share link is on — open share settings";
  return (
    <button
      type="button"
      className="shared-badge"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        dispatch(openShareModal(knowledgeId));
      }}
      title="แชร์ public อยู่ — คลิกเพื่อจัดการลิงก์"
      aria-label={label}
    >
      <svg
        viewBox="0 0 24 24"
        width="12"
        height="12"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    </button>
  );
}
