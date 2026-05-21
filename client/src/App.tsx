import { useEffect, useLayoutEffect, useState } from "react";
import { useHash } from "./hooks/useHash";
import { useServerEvents } from "./hooks/useServerEvents";
import { useDocumentTitle } from "./hooks/useDocumentTitle";
import { useAppSelector } from "./store";
import { useGetAuthMeQuery } from "./store/api";
import { Topbar } from "./components/Topbar";
import { Sidebar } from "./components/Sidebar";
import { Viewer } from "./components/Viewer";
import { LoginPage } from "./components/LoginPage";
import { HelpModal } from "./components/HelpModal";
import { ActivityLogModal } from "./components/ActivityLogModal";
import { ProjectFilterModal } from "./components/ProjectFilterModal";
import { Toast } from "./components/Toast";

export function App() {
  const { location, navigate } = useHash();
  const theme = useAppSelector((s) => s.ui.theme);
  const [searchText, setSearchText] = useState("");
  const authMe = useGetAuthMeQuery();
  useServerEvents();
  useDocumentTitle(location.kid, location.pid);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

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
      <ProjectFilterModal />
      <Toast />
    </>
  );
}
