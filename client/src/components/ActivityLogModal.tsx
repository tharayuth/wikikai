import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "../store";
import { closeActivityLog } from "../store/uiSlice";
import {
  useGetActivityLogQuery,
  type ActivityLogEntry,
} from "../store/api";
import { navigateTo } from "../hooks/useHash";

/**
 * Tall, scrollable audit-log dialog opened from the topbar. Lists
 * the most recent mutating actions (add / edit / delete / toggle /
 * caption / upload / reorder / resize) across knowledge / page /
 * block / image / task targets — newest first.
 *
 * Captures snapshots of titles + captions at record time, so entries
 * stay readable even after the target is renamed or deleted. When
 * the row's target is still present, clicking the title navigates
 * to it.
 */
export function ActivityLogModal(): JSX.Element | null {
  const open = useAppSelector((s) => s.ui.activityLogOpen);
  const dispatch = useAppDispatch();
  const { data, isFetching } = useGetActivityLogQuery(
    { limit: 200 },
    { skip: !open },
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dispatch(closeActivityLog());
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, dispatch]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop show activity-log-backdrop"
      onClick={() => dispatch(closeActivityLog())}
    >
      <div
        className="modal activity-log-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Activity log"
      >
        <div className="activity-log-header">
          <h2>Activity log</h2>
          <div className="activity-log-meta">
            {data
              ? `${data.entries.length} of ${data.total} entries`
              : isFetching
                ? "loading…"
                : ""}
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="close"
            onClick={() => dispatch(closeActivityLog())}
          >
            ×
          </button>
        </div>
        <div className="activity-log-body">
          {data?.entries.length === 0 && (
            <div className="activity-log-empty">No activity yet.</div>
          )}
          <ul className="activity-log-list">
            {data?.entries.map((e) => (
              <ActivityRow key={e.id} entry={e} />
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function ActivityRow({ entry }: { entry: ActivityLogEntry }): JSX.Element {
  const dispatch = useAppDispatch();
  const time = formatTime(entry.created_at);
  const tag = describeAction(entry.action);
  const targetText = describeTarget(entry);
  const jumpable =
    entry.action !== "delete" &&
    entry.knowledge_id != null &&
    !(entry.target === "page" && entry.page_id == null);

  const onJump = () => {
    if (entry.knowledge_id == null) return;
    navigateTo({
      kid: entry.knowledge_id,
      pid: entry.page_id ?? null,
    });
    dispatch(closeActivityLog());
  };

  return (
    <li className={`activity-log-row activity-action-${entry.action}`}>
      <div className="activity-log-time" title={entry.created_at}>
        {time}
      </div>
      <div className={`activity-log-tag tag-${entry.action}`}>{tag}</div>
      <div className="activity-log-target">
        {jumpable ? (
          <button
            type="button"
            className="activity-log-jump"
            onClick={onJump}
            title="Jump to this knowledge / page"
          >
            {targetText}
          </button>
        ) : (
          <span>{targetText}</span>
        )}
      </div>
      <div className="activity-log-source">
        {entry.user_name && (
          <span className="activity-log-user">{entry.user_name}</span>
        )}
        {entry.source === "mcp" ? (
          <span className="activity-log-tool">
            MCP{entry.tool_name ? ` · ${entry.tool_name}` : ""}
          </span>
        ) : (
          <span className="activity-log-tool web">web UI</span>
        )}
      </div>
    </li>
  );
}

function formatTime(iso: string): string {
  const t = new Date(iso);
  const diff = Date.now() - t.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}d ago`;
  return t.toLocaleDateString();
}

function describeAction(action: ActivityLogEntry["action"]): string {
  switch (action) {
    case "add":
      return "Add";
    case "edit":
      return "Edit";
    case "delete":
      return "Delete";
    case "reorder":
      return "Reorder";
    case "toggle":
      return "Toggle";
    case "caption":
      return "Caption";
    case "upload":
      return "Upload";
    case "resize":
      return "Resize";
    default:
      return action;
  }
}

function describeTarget(entry: ActivityLogEntry): string {
  const knTitle = entry.knowledge_title ?? null;
  const pgTitle = entry.page_title ?? null;
  const blockText =
    entry.block_id != null
      ? entry.block_caption
        ? `@${entry.block_id} "${entry.block_caption}"`
        : `@${entry.block_id}`
      : null;

  // Build something like:
  //   "page #45 'How to deploy' — in &9 'WikiKai Guide'"
  //   "block @217 'Architecture' — on page #45 in &9"
  //   "knowledge &12 'Project notes'"
  switch (entry.target) {
    case "knowledge": {
      const kn = knTitle
        ? `&${entry.knowledge_id} "${knTitle}"`
        : `&${entry.knowledge_id ?? "?"}`;
      return `knowledge ${kn}`;
    }
    case "page": {
      const pg = pgTitle
        ? `#${entry.page_id} "${pgTitle}"`
        : `#${entry.page_id ?? "?"}`;
      const kn = knTitle
        ? ` in &${entry.knowledge_id} "${knTitle}"`
        : entry.knowledge_id
          ? ` in &${entry.knowledge_id}`
          : "";
      return `page ${pg}${kn}`;
    }
    case "block": {
      const where =
        entry.page_id && pgTitle
          ? ` on page #${entry.page_id} "${pgTitle}"`
          : entry.page_id
            ? ` on page #${entry.page_id}`
            : "";
      return `block ${blockText ?? `@?`}${where}`;
    }
    case "task": {
      const pg = pgTitle
        ? `page #${entry.page_id} "${pgTitle}"`
        : `page #${entry.page_id ?? "?"}`;
      return `task on ${pg}`;
    }
    case "image": {
      const where =
        entry.page_id && pgTitle
          ? ` on page #${entry.page_id} "${pgTitle}"`
          : entry.page_id
            ? ` on page #${entry.page_id}`
            : "";
      return `image${where}`;
    }
    default:
      return entry.target;
  }
}
