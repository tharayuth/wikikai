/**
 * Standalone Mermaid viewer page — opens in a new tab when the user clicks
 * a rendered Mermaid diagram in the main viewer. Supports pan, zoom, and
 * export-to-PNG. Inspired by the iSingleForm docs/dfd-*.html viewers.
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
 * Pull every ```mermaid``` fenced block out of a markdown source in the order
 * they appear. Index aligns with the rendered <pre class="mermaid"> order in
 * the page DOM.
 */
export function extractMermaidFences(md: string): string[] {
  const lines = md.split("\n");
  const out: string[] = [];
  let inFence = false;
  let isMermaid = false;
  let buf: string[] = [];
  for (const line of lines) {
    // Match the opening fence: optional indent, ```, language, optional rest
    // (the rest can carry `{@N}` block-id annotations or other attributes).
    const open = line.match(/^```\s*([A-Za-z0-9_-]*)(?:\s.*)?$/);
    if (open) {
      if (!inFence) {
        inFence = true;
        isMermaid = open[1].toLowerCase() === "mermaid";
        buf = [];
      } else {
        if (isMermaid) out.push(buf.join("\n"));
        inFence = false;
        isMermaid = false;
        buf = [];
      }
      continue;
    }
    if (inFence && isMermaid) buf.push(line);
  }
  return out;
}

export function mermaidViewerHtml(opts: {
  pageTitle: string;
  knowledgeTitle: string;
  source: string;
}): string {
  const safeTitle = escapeHtml(opts.pageTitle);
  const safeKnowledge = escapeHtml(opts.knowledgeTitle);
  const safeSource = escapeHtml(opts.source);
  const filenameBase = JSON.stringify(opts.pageTitle.replace(/[^A-Za-z0-9฀-๿ _-]/g, "").trim() || "mermaid");
  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${safeTitle} — Mermaid Viewer</title>
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
  flex-shrink: 0; z-index: 100;
}
.toolbar .titles { display: flex; flex-direction: column; line-height: 1.15; min-width: 0; }
.toolbar .titles .knowledge { font-size: 11px; color: #888; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.toolbar .titles h1 { font-size: 13px; font-weight: 600; color: #1a1a2e; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.toolbar .titles h1 span { color: #6366f1; }
.toolbar .sep { width: 1px; height: 22px; background: #e0e4ea; }
.toolbar .spacer { flex: 1; }
.toolbar .zoom-info {
  font-size: 11px; color: #888; font-family: 'JetBrains Mono', 'Consolas', monospace;
  min-width: 44px; text-align: center;
}
.toolbar button {
  background: #f0f1f5; border: 1px solid #d0d4dc; color: #555;
  border-radius: 5px; padding: 5px 10px; font-size: 11px; cursor: pointer;
  transition: all .15s; display: flex; align-items: center; gap: 5px; white-space: nowrap;
  font-family: inherit;
}
.toolbar button:hover { background: #e8e9f0; color: #1a1a2e; border-color: #6366f1; }
#viewport { flex: 1; overflow: hidden; cursor: grab; position: relative; touch-action: none; background: #f8f9fb; }
#viewport.grabbing { cursor: grabbing; }
#container { position: absolute; top: 0; left: 0; transform-origin: 0 0; padding: 24px; }
.hint {
  position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%);
  background: #ffffffee; border: 1px solid #e0e4ea; border-radius: 6px;
  padding: 6px 14px; font-size: 11px; color: #888; z-index: 50;
  pointer-events: none; transition: opacity 1s;
  box-shadow: 0 2px 8px rgba(0,0,0,.08);
}
.error { padding: 24px; color: #c00; font-family: monospace; }
</style>
</head>
<body>

<div class="toolbar">
  <div class="titles">
    <span class="knowledge">${safeKnowledge}</span>
    <h1><span>◆</span> ${safeTitle}</h1>
  </div>
  <div class="sep"></div>
  <div class="spacer"></div>
  <button onclick="window.zoomTo()" title="Fit to view (0)">Fit</button>
  <button onclick="window.zoomBy(1.3)" title="Zoom in (+)">+</button>
  <button onclick="window.zoomBy(0.7)" title="Zoom out (-)">&minus;</button>
  <span class="zoom-info" id="zoomInfo">100%</span>
  <div class="sep"></div>
  <button onclick="window.exportPNG()">📷 PNG</button>
</div>

<div id="viewport">
  <div id="container">
    <pre class="mermaid">${safeSource}</pre>
  </div>
  <div class="hint" id="hint">Scroll = zoom · Drag = pan · 0 = fit</div>
</div>

<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
  mermaid.initialize({
    startOnLoad: true,
    theme: 'default',
    securityLevel: 'loose',
    flowchart: { useMaxWidth: false, htmlLabels: true, curve: 'basis' },
  });
  setTimeout(function () { if (window.fitToView) window.fitToView(); }, 1200);
  setTimeout(function () { if (window.fitToView) window.fitToView(); }, 2400);
</script>

<script>
  var vp = document.getElementById('viewport');
  var ct = document.getElementById('container');
  var zoomInfo = document.getElementById('zoomInfo');
  var hint = document.getElementById('hint');
  var pan = { x: 0, y: 0 }, zoom = 1, MIN_ZOOM = 0.1, MAX_ZOOM = 5;

  function applyTransform() {
    ct.style.transform = 'translate(' + pan.x + 'px,' + pan.y + 'px) scale(' + zoom + ')';
    zoomInfo.textContent = Math.round(zoom * 100) + '%';
  }

  var dragging = false, dragStart = { x: 0, y: 0 };
  vp.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    dragging = true; dragStart.x = e.clientX - pan.x; dragStart.y = e.clientY - pan.y;
    vp.classList.add('grabbing'); e.preventDefault();
  });
  window.addEventListener('mousemove', function (e) {
    if (!dragging) return; pan.x = e.clientX - dragStart.x; pan.y = e.clientY - dragStart.y; applyTransform();
  });
  window.addEventListener('mouseup', function () { dragging = false; vp.classList.remove('grabbing'); });

  vp.addEventListener('wheel', function (e) {
    e.preventDefault();
    var rect = vp.getBoundingClientRect(), mx = e.clientX - rect.left, my = e.clientY - rect.top;
    var delta = e.ctrlKey ? Math.pow(2, -e.deltaY * 0.01) : (e.deltaY > 0 ? 0.9 : 1.1);
    var newZoom = Math.min(Math.max(zoom * delta, MIN_ZOOM), MAX_ZOOM), ratio = newZoom / zoom;
    pan.x = mx - (mx - pan.x) * ratio; pan.y = my - (my - pan.y) * ratio; zoom = newZoom; applyTransform();
    if (hint) { hint.style.opacity = '0'; hint = null; }
  }, { passive: false });

  window.zoomBy = function (f) {
    var rect = vp.getBoundingClientRect(), cx = rect.width / 2, cy = rect.height / 2;
    var nz = Math.min(Math.max(zoom * f, MIN_ZOOM), MAX_ZOOM), r = nz / zoom;
    pan.x = cx - (cx - pan.x) * r; pan.y = cy - (cy - pan.y) * r; zoom = nz; applyTransform();
  };

  window.zoomTo = window.fitToView = function () {
    var svg = ct.querySelector('svg'); if (!svg) return;
    var rect = vp.getBoundingClientRect();
    var sb = svg.getBoundingClientRect();
    var sw = sb.width / zoom, sh = sb.height / zoom;
    if (!sw || !sh) return;
    zoom = Math.min((rect.width - 80) / sw, (rect.height - 80) / sh, 1.5);
    pan.x = (rect.width - sw * zoom) / 2; pan.y = (rect.height - sh * zoom) / 2; applyTransform();
  };

  document.addEventListener('keydown', function (e) {
    if (e.key === '=' || e.key === '+') { window.zoomBy(1.2); e.preventDefault(); }
    else if (e.key === '-' || e.key === '_') { window.zoomBy(0.8); e.preventDefault(); }
    else if (e.key === '0') { window.zoomTo(); e.preventDefault(); }
  });
  setTimeout(function () { if (hint) hint.style.opacity = '0'; }, 4000);

  window.exportPNG = function () {
    var svg = ct.querySelector('svg'); if (!svg) return alert('Diagram not ready');
    var clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    var data = new XMLSerializer().serializeToString(clone);
    var img = new Image();
    img.onload = function () {
      var s = 2, c = document.createElement('canvas');
      c.width = img.naturalWidth * s; c.height = img.naturalHeight * s;
      var cx = c.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, c.width, c.height);
      cx.drawImage(img, 0, 0, c.width, c.height);
      var a = document.createElement('a');
      a.download = ${filenameBase} + '.png';
      a.href = c.toDataURL('image/png'); a.click();
    };
    img.onerror = function () { alert('Export failed — SVG not loadable as image'); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(data);
  };
</script>
</body>
</html>`;
}
