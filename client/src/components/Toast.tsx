import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "../store";
import { clearToast } from "../store/uiSlice";

export function Toast() {
  const toast = useAppSelector((s) => s.ui.toast);
  const dispatch = useAppDispatch();

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => dispatch(clearToast()), 1800);
    return () => clearTimeout(t);
  }, [toast, dispatch]);

  return <div className={`toast${toast ? " show" : ""}`}>{toast?.message ?? ""}</div>;
}
