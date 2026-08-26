import { useEffect, useRef, useState } from "react";
import { useMermaidCharts } from "../hooks/useMermaidCharts";
import { attachInlineImageLightbox } from "../lib/imageLightbox";
import { ArticleResizeHandle } from "./ArticleResizeHandle";

/**
 * Public, read-only viewer for a single shared knowledge document.
 *
 * Rendered (from `main.tsx`) when the URL is `/share/<token>` — completely
 * isolated from the authenticated app: it never touches the Redux store or
 * any gated endpoint, only the token-scoped public API (`/api/share/...`).
 * No sidebar, no editing, no account/search — just the document's pages.
 */
interface SharePage {
  id: number;
  title: string;
  position: number;
  line_count: number;
}

interface ShareData {
  knowledge: {
    id: number;
    title: string;
    project: string | null;
    updated_at: string;
    version: number;
  };
  pages: SharePage[];
}

function readTheme(): "light" | "dark" {
  try {
    return localStorage.getItem("wikikai-theme") === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function PublicView({ token }: { token: string }): JSX.Element {
  const [data, setData] = useState<ShareData | null>(null);
  const [error, setError] = useState<"not-found" | "error" | null>(null);
  const [activePid, setActivePid] = useState<number | null>(null);
  const [html, setHtml] = useState<string>("");
  const [theme, setTheme] = useState<"light" | "dark">(readTheme());
  const bodyRef = useRef<HTMLDivElement>(null);

  // Apply the chosen theme to the root so theme.css variables resolve.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("wikikai-theme", theme);
    } catch {
      /* private mode — ignore */
    }
  }, [theme]);

  // Load the shared document's metadata + page list.
  useEffect(() => {
    let alive = true;
    fetch(`/api/share/${encodeURIComponent(token)}`)
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 404 ? "not-found" : "error");
        return r.json() as Promise<ShareData>;
      })
      .then((d) => {
        if (!alive) return;
        setData(d);
        const hashPid = Number(window.location.hash.replace(/^#/, ""));
        const initial =
          d.pages.find((p) => p.id === hashPid)?.id ?? d.pages[0]?.id ?? null;
        setActivePid(initial);
      })
      .catch((e: Error) => {
        if (alive) setError(e.message === "not-found" ? "not-found" : "error");
      });
    return () => {
      alive = false;
    };
  }, [token]);

  // Load the rendered HTML for the active page; keep the URL hash in sync
  // so a page is deep-linkable (`/share/<token>#<pid>`).
  useEffect(() => {
    if (activePid == null) {
      setHtml("");
      return;
    }
    let alive = true;
    setHtml("");
    fetch(`/api/share/${encodeURIComponent(token)}/pages/${activePid}/rendered`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => {
        if (alive) setHtml(t);
      })
      .catch(() => {
        if (alive)
          setHtml('<p class="render-error">Failed to load this page.</p>');
      });
    if (window.location.hash !== `#${activePid}`) {
      history.replaceState(null, "", `#${activePid}`);
    }
    return () => {
      alive = false;
    };
  }, [token, activePid]);

  // Render mermaid + charts + image lightbox. `readOnly` skips the @N
  // block-badge edit menus (which hit gated endpoints).
  useMermaidCharts(
    bodyRef,
    [html, theme, activePid],
    theme,
    activePid ?? undefined,
    { readOnly: true, viewerBase: `/share/${encodeURIComponent(token)}` },
  );

  // Inline images get click-to-enlarge here too. The signed-in article gets
  // it from useImageResize, which a public reader cannot use — it needs the
  // Redux store for the resize mutation, and resizing is an edit anyway.
  useEffect(() => {
    const root = bodyRef.current;
    if (!root || !html) return undefined;
    return attachInlineImageLightbox(root);
  }, [html, activePid]);

  if (error === "not-found") {
    return (
      <ShareMessage
        title="ลิงก์นี้ใช้ไม่ได้"
        detail="การแชร์อาจถูกปิด หรือลิงก์ไม่ถูกต้อง"
      />
    );
  }
  if (error) {
    return <ShareMessage title="เกิดข้อผิดพลาด" detail="โหลดเอกสารไม่สำเร็จ" />;
  }
  if (!data) {
    return (
      <div className="public-view">
        <div className="public-msg">กำลังโหลด…</div>
      </div>
    );
  }

  return (
    <div className="public-view">
      <header className="public-header">
        <div className="public-header-main">
          <span className="public-brand">WikiKai</span>
          <h1 className="public-title">{data.knowledge.title}</h1>
        </div>
        <button
          type="button"
          className="public-theme-btn"
          onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          title="สลับธีม"
          aria-label="Toggle theme"
        >
          {theme === "dark" ? "☀" : "☾"}
        </button>
      </header>
      {/* Two page pickers, one shown at a time by CSS: a dropdown where
          width is scarce, a persistent list once there is room for one.
          Both are rendered so switching is a pure media-query concern with
          no resize listener or layout-measuring state. */}
      {data.pages.length > 1 && (
        <nav className="public-pagenav" aria-label="Pages">
          <select
            className="public-page-select"
            aria-label="เลือกหน้า"
            value={activePid ?? ""}
            onChange={(e) => setActivePid(Number(e.target.value))}
          >
            {data.pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </nav>
      )}
      <div className="public-body">
        {data.pages.length > 1 && (
          <aside className="public-sidebar" aria-label="Pages">
            <ul className="public-page-list">
              {data.pages.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className={`public-page-item${p.id === activePid ? " active" : ""}`}
                    aria-current={p.id === activePid ? "page" : undefined}
                    onClick={() => setActivePid(p.id)}
                  >
                    {p.title}
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        )}
        <div className="public-scroll">
          <main className="public-main">
            {/* Same `.article-frame` wrapper the signed-in article uses, so
                the reading column is left-aligned and the right-edge handle
                resizes it against the same --article-w preference. */}
            <div className="article-frame">
              <article
                className="markdown-body"
                ref={bodyRef}
                dangerouslySetInnerHTML={{ __html: html }}
              />
              <ArticleResizeHandle />
            </div>
          </main>
          <footer className="public-footer">อ่านอย่างเดียว · แชร์ผ่าน WikiKai</footer>
        </div>
      </div>
    </div>
  );
}

function ShareMessage({
  title,
  detail,
}: {
  title: string;
  detail: string;
}): JSX.Element {
  return (
    <div className="public-view">
      <div className="public-msg public-msg-error">
        <h1>{title}</h1>
        <p>{detail}</p>
      </div>
    </div>
  );
}
