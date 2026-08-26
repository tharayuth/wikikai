/**
 * Full-size image overlay.
 *
 * Every surface that shows an image opens the same one: inline images in
 * the signed-in article (`useImageResize`), gallery thumbs from the
 * `images` fence (`useMermaidCharts`), and the public share view. Keeping a
 * single implementation is what stops the three from drifting — the share
 * view had no lightbox at all precisely because the behaviour lived inside
 * a hook it could not call.
 *
 * Built with DOM calls rather than an innerHTML string so a caption or alt
 * text containing markup can never escape into the page.
 */
export interface LightboxContent {
  src: string;
  alt?: string;
  /** Optional line under the image — an inline image's title slot, or a
   *  gallery thumb's figcaption. */
  caption?: string;
}

/** Open the overlay. Returns a closer; calling it twice is harmless. */
export function openImageLightbox(content: LightboxContent): () => void {
  const overlay = document.createElement("div");
  overlay.className = "image-lightbox";

  const img = document.createElement("img");
  img.src = content.src;
  img.alt = content.alt ?? "";
  overlay.appendChild(img);

  if (content.caption) {
    const cap = document.createElement("div");
    cap.className = "lb-caption";
    cap.textContent = content.caption;
    overlay.appendChild(cap);
  }

  const close = document.createElement("button");
  close.type = "button";
  close.className = "lb-close";
  close.setAttribute("aria-label", "close");
  close.textContent = "×";
  overlay.appendChild(close);

  const dismiss = (): void => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") dismiss();
  };

  // Backdrop and the × close; a click on the image itself does not, so
  // dragging to select or right-clicking to save stays possible.
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target === close) dismiss();
  });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);

  return dismiss;
}

/**
 * Wire click-to-enlarge on every plain inline image under `root`, and
 * return a cleanup that unbinds them and closes anything still open.
 *
 * Skips gallery thumbs (they carry their own data-src/figcaption wiring)
 * and images inside a link, where following the link should win.
 */
export function attachInlineImageLightbox(root: HTMLElement): () => void {
  let dismiss: (() => void) | null = null;
  const bound: { el: HTMLImageElement; handler: (e: MouseEvent) => void }[] = [];

  for (const img of Array.from(root.querySelectorAll("img"))) {
    if (img.closest("figure.image-thumb")) continue;
    if (img.closest("a")) continue;
    const handler = (e: MouseEvent): void => {
      e.preventDefault();
      dismiss?.();
      dismiss = openImageLightbox({
        src: img.getAttribute("src") ?? "",
        alt: img.getAttribute("alt") ?? "",
        caption: img.getAttribute("title") ?? "",
      });
    };
    img.addEventListener("click", handler);
    img.classList.add("img-zoomable");
    bound.push({ el: img, handler });
  }

  return () => {
    for (const { el, handler } of bound) {
      el.removeEventListener("click", handler);
      el.classList.remove("img-zoomable");
    }
    dismiss?.();
  };
}
