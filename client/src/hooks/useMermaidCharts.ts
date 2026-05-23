import { useEffect, type RefObject } from "react";
import mermaid from "mermaid";
import Chart from "chart.js/auto";
import { openBadgeMenu } from "../lib/badgeMenu.js";

/**
 * Open the shared badge menu for an `@N` block badge. The "Edit" path
 * dispatches a `wikikai-edit-block` event that PageContent listens for
 * to jump the editor to the right source line. "Delete" calls
 * `DELETE /api/blocks/:id` which removes the block's lines via
 * `editLines` on the server.
 */
function openBlockBadgeMenu(badge: HTMLElement, id: string): void {
  openBadgeMenu({
    kind: "block",
    id,
    badge,
    copyText: `@${id}`,
    contentUrl: `/api/blocks/${encodeURIComponent(id)}/content`,
    editLabel: "Edit this block",
    onEdit: () => {
      window.dispatchEvent(
        new CustomEvent("wikikai-edit-block", {
          detail: { blockId: Number(id) },
        }),
      );
    },
    deleteLabel: "Delete this block",
    confirmDelete: () =>
      window.confirm(
        `Delete block @${id}?\n\nThis removes those lines from the page. The page itself stays — you can undo via the revisions list.`,
      ),
    onDelete: async () => {
      const res = await fetch(`/api/blocks/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `HTTP ${res.status}`);
      }
    },
    onDeleteSuccess: () => {
      window.dispatchEvent(
        new CustomEvent("wikikai-block-deleted", {
          detail: { blockId: Number(id) },
        }),
      );
    },
    onDeleteError: (err) => {
      // eslint-disable-next-line no-console
      console.warn("Delete block failed:", err);
      window.dispatchEvent(
        new CustomEvent("wikikai-toast", {
          detail: { message: `Delete failed: ${(err as Error).message ?? err}`, kind: "error" },
        }),
      );
    },
  });
}

// Lazy init mermaid once per theme change
let lastTheme = "";
function ensureMermaid(theme: "default" | "dark"): void {
  if (theme === lastTheme) return;
  lastTheme = theme;
  mermaid.initialize({
    startOnLoad: false,
    theme,
    securityLevel: "loose",
    // useMaxWidth: false → SVG gets explicit pixel width from viewBox so the
    // container can size naturally (width: fit-content) instead of expanding.
    flowchart: { useMaxWidth: false },
    sequence: { useMaxWidth: false },
    gantt: { useMaxWidth: false },
    er: { useMaxWidth: false },
    journey: { useMaxWidth: false },
    class: { useMaxWidth: false },
    state: { useMaxWidth: false },
    pie: { useMaxWidth: false },
  });
}

// ─── Mermaid run queue ───
// Mermaid 11.x holds module-level state during async renders (diagram
// registry, parser cache, …). If `mermaid.run()` is called a second
// time before the first call's promise settles — exactly what happens
// on a fast page-switch — the two runs can clobber each other and the
// second batch ends up rendering the "Syntax error in text mermaid
// version 11.15.0" placeholder SVG.
//
// Two-part fix: (a) always restore raw source + clear `data-processed`
// so mermaid re-renders the new batch from scratch (no caching on
// stale node refs), and (b) serialise every `mermaid.run` call through
// a single module-level queue so concurrent page navigations can't
// race inside mermaid.
let mermaidQueue: Promise<void> = Promise.resolve();

function queueMermaidRun(nodes: HTMLElement[]): Promise<void> {
  const myNodes = nodes.slice();
  const job = mermaidQueue
    .catch(() => undefined)
    .then(async () => {
      try {
        await mermaid.run({ nodes: myNodes });
      } catch (err) {
        // If the first attempt failed (or rendered the syntax-error
        // SVG), restore raw source and retry once on the next tick —
        // by which point any in-flight stale state has fully settled.
        // eslint-disable-next-line no-console
        console.warn("mermaid first-pass error, retrying once:", err);
        await new Promise((r) => setTimeout(r, 30));
        for (const n of myNodes) {
          if (n.dataset.raw) n.innerHTML = n.dataset.raw;
          n.removeAttribute("data-processed");
        }
        try {
          await mermaid.run({ nodes: myNodes });
        } catch (err2) {
          // eslint-disable-next-line no-console
          console.error("mermaid retry error:", err2);
        }
      }
    });
  mermaidQueue = job;
  return job;
}

/**
 * After mounting rendered HTML, find <pre class="mermaid"> blocks and process them,
 * and <canvas class="chart" data-chart="..."> blocks and instantiate Chart.js.
 *
 * Re-runs whenever `deps` changes (typically: html string + theme).
 */
export function useMermaidCharts(
  containerRef: RefObject<HTMLElement>,
  deps: ReadonlyArray<unknown>,
  theme: "light" | "dark",
  pageId?: number,
): void {
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    ensureMermaid(theme === "dark" ? "dark" : "default");

    // ─── Mermaid ───
    const mermaidNodes = Array.from(root.querySelectorAll<HTMLElement>("pre.mermaid"));
    for (const node of mermaidNodes) {
      // Cache the raw mermaid source on first sight (innerHTML before
      // mermaid replaces it with SVG). Subsequent runs always start
      // from this raw text — never the previous run's SVG output.
      if (!node.dataset.raw) {
        node.dataset.raw = node.innerHTML;
      } else {
        node.innerHTML = node.dataset.raw;
      }
      // Drop the "already processed" marker mermaid sets on success —
      // we always want a fresh render for the current effect run.
      node.removeAttribute("data-processed");
    }
    if (mermaidNodes.length > 0) {
      queueMermaidRun(mermaidNodes);
      // Attach click → open standalone viewer in a new tab.
      if (pageId !== undefined) {
        mermaidNodes.forEach((node, idx) => {
          node.classList.add("mermaid-clickable");
          node.setAttribute("title", "Click to open fullscreen viewer (zoom + pan)");
          const onClick = () => {
            window.open(`/mermaid/${pageId}/${idx}`, "_blank", "noopener");
          };
          node.addEventListener("click", onClick);
          // Store so we can remove on cleanup
          (node as HTMLElement & { __mermaidClick?: () => void }).__mermaidClick = onClick;
        });
      }
    }

    // ─── Chart.js ───
    Chart.defaults.color = theme === "dark" ? "#ccc" : "#444";
    Chart.defaults.borderColor = theme === "dark" ? "#333" : "#ddd";

    const chartNodes = Array.from(root.querySelectorAll<HTMLCanvasElement>("canvas.chart"));
    const charts: Chart[] = [];
    const chartClickTargets: { el: HTMLElement; handler: () => void }[] = [];
    chartNodes.forEach((canvas, idx) => {
      const raw = canvas.getAttribute("data-chart");
      if (!raw) return;
      try {
        const cfg = JSON.parse(raw);
        // The CSS gives the container a fixed height (≤ 50vh). For Chart.js
        // to respect that, options.maintainAspectRatio must be false. Default it
        // to false unless the author opted in explicitly.
        cfg.options = cfg.options ?? {};
        if (cfg.options.maintainAspectRatio === undefined) {
          cfg.options.maintainAspectRatio = false;
        }
        if (cfg.options.responsive === undefined) {
          cfg.options.responsive = true;
        }
        // Destroy any existing chart bound to this canvas
        const existing = Chart.getChart(canvas);
        if (existing) existing.destroy();
        charts.push(new Chart(canvas, cfg));

        // Make the chart's outer card clickable to open the standalone viewer.
        if (pageId !== undefined) {
          const wrap = canvas.closest<HTMLElement>(".chart-wrap, .chart-card");
          if (wrap) {
            wrap.classList.add("chart-clickable");
            wrap.title = "Click to open fullscreen viewer";
            const handler = () => {
              window.open(`/chart/${pageId}/${idx}`, "_blank", "noopener");
            };
            wrap.addEventListener("click", handler);
            chartClickTargets.push({ el: wrap, handler });
          }
        }
      } catch (e) {
        const err = e as Error;
        canvas.outerHTML = `<div class="render-error">chart parse error: ${err.message}</div>`;
      }
    });

    // ─── Image thumbnails → lightbox on click ───
    const imageThumbs = Array.from(
      root.querySelectorAll<HTMLElement>("figure.image-thumb"),
    );
    const imageHandlers: { el: HTMLElement; handler: (e: Event) => void }[] = [];
    let activeLightbox: HTMLDivElement | null = null;
    const closeLightbox = () => {
      if (activeLightbox && activeLightbox.parentNode) {
        activeLightbox.parentNode.removeChild(activeLightbox);
      }
      activeLightbox = null;
      document.removeEventListener("keydown", onEsc);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLightbox();
    };
    for (const fig of imageThumbs) {
      const src = fig.getAttribute("data-src");
      if (!src) continue;
      const handler = (e: Event) => {
        e.preventDefault();
        const alt = fig.getAttribute("data-alt") ?? "";
        const cap = fig.querySelector("figcaption")?.textContent ?? "";
        const overlay = document.createElement("div");
        overlay.className = "image-lightbox";
        overlay.innerHTML =
          `<img src="${src.replace(/"/g, "&quot;")}" alt="${alt.replace(/"/g, "&quot;")}" />` +
          (cap
            ? `<div class="lb-caption">${cap.replace(/</g, "&lt;")}</div>`
            : "") +
          `<button type="button" class="lb-close" aria-label="close">×</button>`;
        overlay.addEventListener("click", (ev) => {
          if (
            ev.target === overlay ||
            (ev.target as HTMLElement).classList.contains("lb-close")
          ) {
            closeLightbox();
          }
        });
        document.body.appendChild(overlay);
        activeLightbox = overlay;
        document.addEventListener("keydown", onEsc);
      };
      fig.addEventListener("click", handler);
      imageHandlers.push({ el: fig, handler });
    }

    // ─── @N block badges → menu (Copy / Edit code) ───
    const badgeNodes = Array.from(root.querySelectorAll<HTMLButtonElement>("button.block-badge"));
    const badgeHandlers: { el: HTMLButtonElement; handler: (e: Event) => void }[] = [];
    for (const btn of badgeNodes) {
      const id = btn.getAttribute("data-block-id");
      if (!id) continue;
      const handler = (e: Event) => {
        e.stopPropagation(); // don't trigger parent click (chart/mermaid open)
        openBlockBadgeMenu(btn, id);
      };
      btn.addEventListener("click", handler);
      badgeHandlers.push({ el: btn, handler });
    }

    return () => {
      for (const c of charts) {
        try {
          c.destroy();
        } catch {
          /* ignore */
        }
      }
      // Detach mermaid click handlers
      for (const node of mermaidNodes) {
        const n = node as HTMLElement & { __mermaidClick?: () => void };
        if (n.__mermaidClick) {
          node.removeEventListener("click", n.__mermaidClick);
          delete n.__mermaidClick;
        }
      }
      // Detach chart click handlers
      for (const { el, handler } of chartClickTargets) {
        el.removeEventListener("click", handler);
        el.classList.remove("chart-clickable");
      }
      // Detach badge click handlers
      for (const { el, handler } of badgeHandlers) {
        el.removeEventListener("click", handler);
      }
      // Detach image thumbnail handlers + tear down any open lightbox
      for (const { el, handler } of imageHandlers) {
        el.removeEventListener("click", handler);
      }
      closeLightbox();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
