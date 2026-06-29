import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useHash } from "./hooks/useHash";
import { useServerEvents } from "./hooks/useServerEvents";
import { useDocumentTitle } from "./hooks/useDocumentTitle";
import { useAppDispatch, useAppSelector } from "./store";
import { showToast } from "./store/uiSlice";
import { useGetAuthMeQuery } from "./store/api";
import { Topbar } from "./components/Topbar";
import { Sidebar } from "./components/Sidebar";
import { Viewer } from "./components/Viewer";
import { LoginPage } from "./components/LoginPage";
import { HelpModal } from "./components/HelpModal";
import { ActivityLogModal } from "./components/ActivityLogModal";
import { AccountModal } from "./components/AccountModal";
import { UsersAdminModal } from "./components/UsersAdminModal";
import { ProjectFilterModal } from "./components/ProjectFilterModal";
import { ShareModal } from "./components/ShareModal";
import { Toast } from "./components/Toast";

const SIDEBAR_W_KEY = "wikikai-sidebar-w";
let sidebarWidthRestored = false;

function SidebarResizeHandle() {
  const [dragging, setDragging] = useState(false);
  const startRef = useRef<{ x: number; width: number } | null>(null);

  // Restore from localStorage on first mount (belt-and-suspenders with
  // the useLayoutEffect in App — that one runs before paint to avoid flash).
  useEffect(() => {
    if (sidebarWidthRestored) return;
    sidebarWidthRestored = true;
    try {
      const raw = localStorage.getItem(SIDEBAR_W_KEY);
      const n = raw == null ? NaN : Number(raw);
      if (Number.isFinite(n) && n >= 200 && n <= 600) {
        document.documentElement.style.setProperty("--sidebar-w", `${n}px`);
      }
    } catch {
      /* private mode */
    }
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const start = startRef.current;
      if (!start) return;
      const delta = e.clientX - start.x;
      const next = Math.max(200, Math.min(600, start.width + delta));
      document.documentElement.style.setProperty(
        "--sidebar-w",
        `${Math.round(next)}px`,
      );
    };
    const onUp = () => {
      setDragging(false);
      startRef.current = null;
      const cur = document.documentElement.style.getPropertyValue("--sidebar-w");
      const n = parseInt(cur.replace("px", ""), 10);
      if (Number.isFinite(n)) {
        try {
          localStorage.setItem(SIDEBAR_W_KEY, String(n));
        } catch {
          /* ignore */
        }
      }
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [dragging]);

  return (
    <div
      className={`sidebar-resize-handle${dragging ? " dragging" : ""}`}
      onMouseDown={(e) => {
        e.preventDefault();
        const sidebar = document.getElementById("sidebar");
        if (!sidebar) return;
        startRef.current = {
          x: e.clientX,
          width: sidebar.getBoundingClientRect().width,
        };
        setDragging(true);
      }}
      onDoubleClick={() => {
        // Reset to default
        document.documentElement.style.removeProperty("--sidebar-w");
        try {
          localStorage.removeItem(SIDEBAR_W_KEY);
        } catch {
          /* ignore */
        }
      }}
      title="Drag to resize sidebar · double-click to reset"
      aria-label="Resize sidebar width"
    />
  );
}

export function App() {
  const { location, navigate } = useHash();
  const dispatch = useAppDispatch();
  const theme = useAppSelector((s) => s.ui.theme);
  const [searchText, setSearchText] = useState("");
  const authMe = useGetAuthMeQuery();
  useServerEvents();
  useDocumentTitle(location.kid, location.pid);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Bridge non-React `wikikai-toast` CustomEvents (dispatched from the
  // shared badge menu in `lib/badgeMenu.ts`) onto the redux toast queue.
  useEffect(() => {
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { message: string; kind?: "success" | "error" | "info" }
        | undefined;
      if (!detail) return;
      dispatch(showToast({ message: detail.message, kind: detail.kind }));
    };
    window.addEventListener("wikikai-toast", onToast);
    return () => window.removeEventListener("wikikai-toast", onToast);
  }, [dispatch]);

  // Restore the article width preference before first paint so the
  // article doesn't jump from the default to the user's chosen size.
  useLayoutEffect(() => {
    try {
      const raw = localStorage.getItem("wikikai-article-w");
      const n = raw == null ? NaN : Number(raw);
      if (Number.isFinite(n) && n >= 480 && n <= 2000) {
        document.documentElement.style.setProperty("--article-w", `${n}px`);
      }
    } catch {
      /* private mode */
    }
    try {
      const raw = localStorage.getItem("wikikai-sidebar-w");
      const n = raw == null ? NaN : Number(raw);
      if (Number.isFinite(n) && n >= 200 && n <= 600) {
        document.documentElement.style.setProperty("--sidebar-w", `${n}px`);
      }
    } catch {
      /* private mode */
    }
  }, []);

  // Auth gate — when the server has WIKIKAI_WEB_AUTH=1 AND the user
  // isn't logged in, render the login screen instead of the portal.
  // First load shows nothing briefly while the auth-me query resolves.
  // (Placed AFTER every hook call to keep the Rules of Hooks order
  // stable across renders.)
  if (authMe.isLoading) {
    return <div className="boot-splash" />;
  }
  if (authMe.data?.auth_enabled && !authMe.data.user) {
    return <LoginPage />;
  }

  return (
    <>
      <Topbar
        searchText={searchText}
        onSearchText={setSearchText}
        activeKid={location.kid}
        activePid={location.pid}
      />
      <div className="main">
        <Sidebar
          activeKid={location.kid}
          activePid={location.pid}
          onPick={(kid) => navigate({ kid })}
        />
        <SidebarResizeHandle />
        <Viewer
          kid={location.kid}
          pid={location.pid}
          line={location.line}
          block={location.block}
          onPickPage={(pid) => navigate({ kid: location.kid, pid })}
        />
      </div>
      <HelpModal />
      <ActivityLogModal />
      <AccountModal />
      <UsersAdminModal />
      <ProjectFilterModal />
      <ShareModal />
      <Toast />
    </>
  );
}
