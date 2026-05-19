import { useEffect, useState } from "react";
import { useHash } from "./hooks/useHash";
import { useServerEvents } from "./hooks/useServerEvents";
import { useAppSelector } from "./store";
import { Topbar } from "./components/Topbar";
import { Sidebar } from "./components/Sidebar";
import { Viewer } from "./components/Viewer";
import { HelpModal } from "./components/HelpModal";
import { ProjectFilterModal } from "./components/ProjectFilterModal";
import { Toast } from "./components/Toast";

export function App() {
  const { location, navigate } = useHash();
  const theme = useAppSelector((s) => s.ui.theme);
  const [searchText, setSearchText] = useState("");
  useServerEvents();

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

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
      <ProjectFilterModal />
      <Toast />
    </>
  );
}
