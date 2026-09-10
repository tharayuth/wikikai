/**
 * In-app viewer for ```file attachments.
 *
 * One plain-DOM overlay used by both the signed-in article and the public
 * share view (same reasoning as `imageLightbox`: a hook-bound React modal
 * would leave the share view without one). Images, PDFs and audio/video
 * render natively; anything else is fetched through `?view=1`, which the
 * server answers as text/plain when the bytes are text and as a download
 * otherwise — so a `.http`, `.sql` or `.yaml` opens right here, and a zip
 * gets a clear "download instead" instead of a broken pane.
 */
export interface FileViewerContent {
  src: string;
  name: string;
  size?: string;
  type?: string;
}

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
const VIDEO_EXT = new Set(["mp4", "webm"]);
const AUDIO_EXT = new Set(["mp3"]);

function extOf(src: string): string {
  return (/\.([a-z0-9]{1,10})$/i.exec(src)?.[1] ?? "").toLowerCase();
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Open the viewer. Returns a closer; calling it twice is harmless. */
export function openFileViewer(content: FileViewerContent): () => void {
  const ext = extOf(content.src);
  const viewUrl = `${content.src}?view=1`;

  const overlay = el("div", "file-viewer");
  const dialog = el("div", "file-viewer-dialog");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", content.name);

  const header = el("div", "file-viewer-head");
  const title = el("div", "file-viewer-title");
  title.appendChild(el("span", "file-viewer-name", content.name));
  const meta = [content.type, content.size].filter(Boolean).join(" · ");
  if (meta) title.appendChild(el("span", "file-viewer-meta", meta));
  header.appendChild(title);

  const actions = el("div", "file-viewer-actions");
  const openTab = el("a", "file-viewer-btn", "เปิดใน tab ใหม่ ↗");
  openTab.href = viewUrl;
  openTab.target = "_blank";
  openTab.rel = "noopener";
  const download = el("a", "file-viewer-btn primary", "Download");
  download.href = content.src;
  download.setAttribute("download", "");
  const close = el("button", "file-viewer-close", "×");
  close.type = "button";
  close.setAttribute("aria-label", "close");
  actions.append(openTab, download, close);
  header.appendChild(actions);

  const body = el("div", "file-viewer-body");
  dialog.append(header, body);
  overlay.appendChild(dialog);

  let aborted = false;
  const dismiss = (): void => {
    aborted = true;
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") dismiss();
  };
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) dismiss();
  });
  close.addEventListener("click", dismiss);
  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);

  const showMessage = (text: string): void => {
    body.replaceChildren(el("div", "file-viewer-msg", text));
  };

  if (IMAGE_EXT.has(ext)) {
    const img = el("img", "file-viewer-img");
    img.src = viewUrl;
    img.alt = content.name;
    body.appendChild(img);
  } else if (ext === "pdf") {
    const frame = el("iframe", "file-viewer-frame");
    frame.src = viewUrl;
    frame.title = content.name;
    body.appendChild(frame);
  } else if (VIDEO_EXT.has(ext)) {
    const video = el("video", "file-viewer-media");
    video.src = viewUrl;
    video.controls = true;
    body.appendChild(video);
  } else if (AUDIO_EXT.has(ext)) {
    const audio = el("audio", "file-viewer-media");
    audio.src = viewUrl;
    audio.controls = true;
    body.appendChild(audio);
  } else {
    showMessage("กำลังโหลด…");
    fetch(viewUrl)
      .then(async (r) => {
        if (aborted) return;
        const type = r.headers.get("content-type") ?? "";
        if (!r.ok) {
          showMessage(`โหลดไม่สำเร็จ (HTTP ${r.status})`);
          return;
        }
        if (!type.startsWith("text/plain")) {
          showMessage("ไฟล์ชนิดนี้เปิดดูในตัวไม่ได้ — กด Download เพื่อเปิดด้วยโปรแกรมของคุณ");
          return;
        }
        const text = await r.text();
        if (aborted) return;
        const pre = el("pre", "file-viewer-text");
        pre.appendChild(el("code", undefined, text));
        body.replaceChildren(pre);
      })
      .catch(() => {
        if (!aborted) showMessage("โหลดไม่สำเร็จ");
      });
  }

  return dismiss;
}

/** Wire every View button under `root` to the in-app viewer. Returns a
 *  cleanup that unbinds them and closes anything still open. Runs as a
 *  delegated listener so a re-rendered card needs no re-wiring. */
export function attachFileViewer(root: HTMLElement): () => void {
  let dismiss: (() => void) | null = null;
  const handler = (e: MouseEvent): void => {
    const target = e.target as HTMLElement | null;
    const btn = target?.closest<HTMLElement>(".file-card-view");
    if (!btn || !root.contains(btn)) return;
    // Modified clicks keep the native "open in new tab" behaviour.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    const card = btn.closest<HTMLElement>(".file-card");
    if (!card) return;
    e.preventDefault();
    dismiss?.();
    dismiss = openFileViewer({
      src: card.getAttribute("data-src") ?? btn.getAttribute("href")?.replace(/\?.*$/, "") ?? "",
      name: card.getAttribute("data-name") ?? "file",
      size: card.getAttribute("data-size") ?? undefined,
      type: card.getAttribute("data-type") ?? undefined,
    });
  };
  root.addEventListener("click", handler);
  return () => {
    root.removeEventListener("click", handler);
    dismiss?.();
  };
}
