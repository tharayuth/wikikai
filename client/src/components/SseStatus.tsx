import { useAppSelector } from "../store";

const LABEL: Record<string, string> = {
  connecting: "Connecting to live updates…",
  connected: "Live updates active",
  reconnecting: "Live updates dropped — reconnecting",
  offline: "Cannot reach live updates",
};

export function SseStatus() {
  const status = useAppSelector((s) => s.ui.sseStatus);
  return (
    <span
      className={`sse-status sse-${status}`}
      title={LABEL[status] ?? status}
      role="status"
      aria-label={LABEL[status] ?? status}
    />
  );
}
