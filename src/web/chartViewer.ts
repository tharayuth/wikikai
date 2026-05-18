/**
 * Standalone Chart.js viewer page — opens in a new tab when the user clicks
 * a rendered chart in the main viewer. Supports Chart.js's built-in
 * interactivity (tooltips, hover) plus an export-to-PNG button.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Walk every ```chart``` and ```chart-grid``` fence in markdown order and
 * return a flat list of Chart.js configs, expanding chart-grid arrays into
 * their elements. Index aligns with the DOM order of `canvas.chart` elements
 * produced by the renderer.
 */
export function extractChartConfigs(md: string): { config: unknown; title?: string }[] {
  const lines = md.split("\n");
  const out: { config: unknown; title?: string }[] = [];
  let inFence = false;
  let kind: "" | "chart" | "chart-grid" = "";
  let buf: string[] = [];
  for (const line of lines) {
    // Match the opening fence: optional indent, ```, language, optional rest
    // (the rest can carry `{@N}` block-id annotations or other attributes).
    const open = line.match(/^```\s*([A-Za-z0-9_-]*)(?:\s.*)?$/);
    if (open) {
      if (!inFence) {
        inFence = true;
        const k = open[1].toLowerCase();
        kind = k === "chart" || k === "chart-grid" ? k : "";
        buf = [];
      } else {
        if (kind === "chart") {
          try {
            out.push({ config: JSON.parse(buf.join("\n")) });
          } catch {
            /* skip malformed */
          }
        } else if (kind === "chart-grid") {
          try {
            const arr = JSON.parse(buf.join("\n"));
            if (Array.isArray(arr)) {
              for (const raw of arr) {
                if (raw && typeof raw === "object") {
                  const { title, ...cfg } = raw as { title?: unknown };
                  out.push({
                    config: cfg,
                    title: typeof title === "string" ? title : undefined,
                  });
                }
              }
            }
          } catch {
            /* skip malformed */
          }
        }
        inFence = false;
        kind = "";
        buf = [];
      }
      continue;
    }
    if (inFence && (kind === "chart" || kind === "chart-grid")) buf.push(line);
  }
  return out;
}

export function chartViewerHtml(opts: {
  pageTitle: string;
  knowledgeTitle: string;
  config: unknown;
  chartTitle?: string;
}): string {
  const safePageTitle = escapeHtml(opts.pageTitle);
  const safeKnowledge = escapeHtml(opts.knowledgeTitle);
  const safeChartTitle = opts.chartTitle ? escapeHtml(opts.chartTitle) : "";
  // Double-stringify so the resulting expression is a string literal in JS,
  // which we then JSON.parse at runtime — keeps the config opaque to HTML.
  const cfgLiteral = JSON.stringify(JSON.stringify(opts.config));
  const filenameBase = JSON.stringify(
    (opts.chartTitle || opts.pageTitle).replace(/[^A-Za-z0-9฀-๿ _-]/g, "").trim() || "chart",
  );
  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${safeChartTitle || safePageTitle} — Chart Viewer</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600&family=IBM+Plex+Sans+Thai:wght@400;600&display=swap" rel="stylesheet">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { height: 100%; overflow: hidden; }
body {
  font-family: 'Sarabun', 'IBM Plex Sans Thai', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  background: #f8f9fb; color: #1a1a2e;
  display: flex; flex-direction: column;
}
.toolbar {
  height: 46px; background: #fff; border-bottom: 1px solid #e0e4ea;
  display: flex; align-items: center; padding: 0 16px; gap: 10px;
  flex-shrink: 0;
}
.toolbar .titles { display: flex; flex-direction: column; line-height: 1.15; min-width: 0; }
.toolbar .titles .knowledge { font-size: 11px; color: #888; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.toolbar .titles h1 { font-size: 13px; font-weight: 600; color: #1a1a2e; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.toolbar .titles h1 span { color: #6366f1; }
.toolbar .sep { width: 1px; height: 22px; background: #e0e4ea; }
.toolbar .spacer { flex: 1; }
.toolbar button {
  background: #f0f1f5; border: 1px solid #d0d4dc; color: #555;
  border-radius: 5px; padding: 5px 10px; font-size: 11px; cursor: pointer;
  transition: all .15s; font-family: inherit;
}
.toolbar button:hover { background: #e8e9f0; color: #1a1a2e; border-color: #6366f1; }
#stage {
  flex: 1; padding: 24px; min-height: 0;
  display: flex; align-items: stretch; justify-content: center;
}
#frame {
  background: #fff; border: 1px solid #e0e4ea; border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,.06), 0 4px 16px rgba(0,0,0,.04);
  padding: 20px; flex: 1; min-width: 0; min-height: 0;
  display: flex; flex-direction: column;
  max-width: 1400px;
}
#frame h2 {
  font-size: 14px; font-weight: 600; color: #555;
  margin: 0 0 12px; flex-shrink: 0;
}
#chartHolder { flex: 1; min-height: 0; position: relative; }
.error { padding: 24px; color: #c00; font-family: monospace; }
</style>
</head>
<body>

<div class="toolbar">
  <div class="titles">
    <span class="knowledge">${safeKnowledge}</span>
    <h1><span>📊</span> ${safeChartTitle || safePageTitle}</h1>
  </div>
  <div class="sep"></div>
  <div class="spacer"></div>
  <button onclick="window.exportPNG()">📷 Export PNG</button>
</div>

<div id="stage">
  <div id="frame">
    ${safeChartTitle ? `<h2>${safeChartTitle}</h2>` : ""}
    <div id="chartHolder"><canvas id="chart"></canvas></div>
  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
<script>
  var canvas = document.getElementById('chart');
  var chart = null;
  try {
    var cfg = JSON.parse(${cfgLiteral});
    cfg.options = cfg.options || {};
    if (cfg.options.maintainAspectRatio === undefined) cfg.options.maintainAspectRatio = false;
    if (cfg.options.responsive === undefined) cfg.options.responsive = true;
    chart = new Chart(canvas, cfg);
  } catch (e) {
    canvas.outerHTML = '<div class="error">chart config error: ' + (e && e.message ? e.message : e) + '</div>';
  }

  window.exportPNG = function () {
    if (!chart) { alert('Chart not ready'); return; }
    var url = chart.toBase64Image('image/png', 1);
    var a = document.createElement('a');
    a.download = ${filenameBase} + '.png';
    a.href = url; a.click();
  };
</script>
</body>
</html>`;
}
