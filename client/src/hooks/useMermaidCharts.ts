import { useEffect, type RefObject } from "react";
import mermaid from "mermaid";
import Chart from "chart.js/auto";

/**
 * Hidden textarea + execCommand("copy") fallback for non-secure
 * origins (e.g. http://192.168.x.x) where navigator.clipboard isn't
 * exposed.
 */
function copyFallback(text: string, onOk: () => void): void {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    if (ok) onOk();
  } catch {
    /* ignore */
  }
}

/**
 * Open a small popup menu anchored to a block badge with two actions:
 * copy `@N` to the clipboard, or enter the page editor positioned at
 * that block's source line. The "edit" path emits a custom event the
 * PageContent component listens for.
 */
function openBlockMenu(badge: HTMLElement, id: string): void {
  document.querySelectorAll(".block-menu").forEach((m) => m.remove());

  const menu = document.createElement("div");
  menu.className = "block-menu";

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.dataset.action = "copy";
  copyBtn.textContent = `Copy @${id}`;
  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.dataset.action = "edit";
  editBtn.textContent = "Edit this block";
  menu.appendChild(copyBtn);
  menu.appendChild(editBtn);

  const rect = badge.getBoundingClientRect();
  menu.style.position = "fixed";
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.left = `${rect.left}px`;
  document.body.appendChild(menu);

  const close = () => {
    menu.remove();
    document.removeEventListener("mousedown", onOutside);
    document.removeEventListener("keydown", onEsc);
  };
  const onOutside = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) close();
  };
  const onEsc = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };

  copyBtn.addEventListener("click", () => {
    const text = `@${id}`;
    const flash = () => {
      badge.classList.add("copied");
      setTimeout(() => badge.classList.remove("copied"), 600);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(flash, () => copyFallback(text, flash));
    } else {
      copyFallback(text, flash);
    }
    close();
  });
  editBtn.addEventListener("click", () => {
    window.dispatchEvent(
      new CustomEvent("wikikai-edit-block", {
        detail: { blockId: Number(id) },
      }),
    );
    close();
  });

  setTimeout(() => {
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onEsc);
  }, 0);
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
      // restore raw source if previously processed
      if (node.dataset.processed === "true" && node.dataset.raw) {
        node.removeAttribute("data-processed");
        node.innerHTML = node.dataset.raw;
      } else if (!node.dataset.raw) {
        node.dataset.raw = node.innerHTML;
      }
    }
    if (mermaidNodes.length > 0) {
      mermaid.run({ nodes: mermaidNodes }).catch((err) => {
        // eslint-disable-next-line no-console
        console.error("mermaid render error:", err);
      });
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
        openBlockMenu(btn, id);
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
