/**
 * Recover a tab that outlived a deploy.
 *
 * Every build replaces `client/dist/assets`, so a tab opened before a deploy
 * still asks for the old build's lazy chunks — mermaid loads each diagram
 * type the first time a page needs it — and those files are gone. The
 * import fails and mermaid draws its "Syntax error" bomb where the diagram
 * should be; only a reload fixed it. Vite reports the failure as
 * `vite:preloadError`, so reload onto the new build right there.
 */
const RELOADED_AT = "wikikai-stale-build-reload";

export function reloadOnStaleBuild(): void {
  window.addEventListener("vite:preloadError", (event) => {
    // An open raw editor holds an unsaved draft — never reload under it.
    if (document.querySelector(".page-editor-wrap")) {
      window.dispatchEvent(
        new CustomEvent("wikikai-toast", {
          detail: { message: "WikiKai was updated — save, then reload the page", kind: "error" },
        }),
      );
      return;
    }
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(RELOADED_AT) ?? 0);
    } catch {
      /* storage blocked — the time check below still stops a loop */
    }
    // Failing again right after a reload means the chunk is really missing,
    // not stale; let the error surface instead of reloading forever.
    if (Date.now() - last < 30_000) return;
    try {
      sessionStorage.setItem(RELOADED_AT, String(Date.now()));
    } catch {
      return; // can't record the attempt, so don't risk a reload loop
    }
    event.preventDefault();
    window.location.reload();
  });
}
