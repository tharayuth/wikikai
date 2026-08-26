import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "../store";
import { clearToolCall } from "../store/uiSlice";

/**
 * How long the tool name stays on screen after its call. Must match
 * TOOL_CALL_TTL_MS in src/lib/events.ts — the server uses the same
 * window to decide whether a newly connected tab gets the last call
 * replayed, so a mismatch would leave tabs disagreeing about what is
 * still "current".
 */
const HOLD_MS = 30_000;

/**
 * Live readout of the most recent MCP tool call, sitting beside the
 * WikiKai logo. Every tool the AI invokes — reads included — arrives
 * over SSE as a `tool-called` event; the name shows immediately and
 * holds for HOLD_MS, with each new call restarting the window. Renders
 * nothing when the AI has been idle, so the topbar stays quiet.
 */
export function ToolActivity(): JSX.Element | null {
  const dispatch = useAppDispatch();
  const last = useAppSelector((s) => s.ui.lastTool);

  useEffect(() => {
    if (!last) return;
    let timer: number | undefined;
    const evaluate = () => {
      // Time left is measured from the call, not from mount: a replayed
      // event arrives already partway through its window.
      const remaining = last.at + HOLD_MS - Date.now();
      if (remaining <= 0) {
        dispatch(clearToolCall());
        return;
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(evaluate, remaining);
    };
    evaluate();
    // Browsers throttle timers in hidden tabs, so a backgrounded tab can
    // hold a name long past HOLD_MS and greet the user with activity that
    // is minutes stale. Re-check the deadline the moment it comes back.
    document.addEventListener("visibilitychange", evaluate);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", evaluate);
    };
  }, [last, dispatch]);

  if (!last) return null;

  return (
    <span
      className="tool-activity"
      role="status"
      aria-live="polite"
      title={`AI last called the ${last.name} tool`}
    >
      <span className="tool-activity-dot" aria-hidden />
      <span className="tool-activity-name">{last.name}</span>
    </span>
  );
}
