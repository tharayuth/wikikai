import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "../store";
import { clearToast } from "../store/uiSlice";

const ICON: Record<string, string> = {
  success: "✓",
  error: "✕",
  info: "",
};

const DURATION: Record<string, number> = {
  success: 1800,
  info: 1800,
  error: 3500,
};

export function Toast() {
  const toast = useAppSelector((s) => s.ui.toast);
  const dispatch = useAppDispatch();

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => dispatch(clearToast()), DURATION[toast.kind]);
    return () => clearTimeout(t);
  }, [toast, dispatch]);

  const kind = toast?.kind ?? "info";
  const icon = ICON[kind];
  return (
    <div className={`toast toast-${kind}${toast ? " show" : ""}`}>
      {icon && (
        <span className="toast-icon" aria-hidden>
          {icon}
        </span>
      )}
      <span className="toast-msg">{toast?.message ?? ""}</span>
    </div>
  );
}
